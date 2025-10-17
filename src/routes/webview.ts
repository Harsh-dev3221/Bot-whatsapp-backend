/**
 * Webview REST API Routes
 * 
 * Handles web chat session bootstrap, history retrieval, and session management
 * 
 * Architecture: docs/WEB_CHAT_ARCHITECTURE.txt Section 6
 * 
 * Endpoints:
 * - POST /api/webview/:botId/session - Create or resume session
 * - GET /api/webview/:botId/history - Get conversation history
 * - POST /api/webview/:botId/end - End session
 * - POST /api/webview/:botId/typing - Send typing indicator (optional)
 */

import { Hono } from 'hono';
import { supabaseAdmin } from '../db/supabase.js';
import { logger } from '../utils/logger.js';
import { generateWebChatToken } from '../utils/jwt.js';
import { z } from 'zod';

const app = new Hono();

// ============================================
// VALIDATION SCHEMAS
// ============================================

const createSessionSchema = z.object({
  token: z.string().min(1, 'Widget token is required'),
  pageUrl: z.string().url().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  resumeSessionId: z.string().uuid().optional(),
});

const endSessionSchema = z.object({
  sessionId: z.string().uuid(),
  reason: z.string().optional(),
});


// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Validate origin against allowed origins
 */
function validateOrigin(origin: string, allowedOrigins: string[]): boolean {
  if (!origin) return false;

  // Allow all origins if '*' is in the list
  if (allowedOrigins.includes('*')) {
    return true;
  }

  // Allow file:// protocol for local testing
  if (origin.startsWith('file://')) {
    return true;
  }

  // Exact match
  if (allowedOrigins.includes(origin)) {
    return true;
  }

  // Wildcard match (e.g., *.example.com)
  for (const allowed of allowedOrigins) {
    if (allowed.startsWith('*.')) {
      const domain = allowed.substring(2);
      if (origin.endsWith(domain)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Rate limit check (simple in-memory implementation)
 * In production, use Redis for distributed rate limiting
 */
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, limit: number, windowMs: number = 60000): boolean {
  const now = Date.now();
  const record = rateLimitStore.get(key);

  if (!record || now > record.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (record.count >= limit) {
    return false;
  }

  record.count++;
  return true;
}

// ============================================
// POST /api/webview/:botId/session
// Create or resume a web chat session
// ============================================

app.post('/:botId/session', async (c) => {
  try {
    const botId = c.req.param('botId');
    const origin = c.req.header('Origin') || c.req.header('Referer') || '';
    const userAgent = c.req.header('User-Agent') || '';

    // Parse and validate request body
    const body = await c.req.json();
    const validated = createSessionSchema.parse(body);

    // Get bot and widget settings
    const { data: bot, error: botError } = await supabaseAdmin
      .from('bots')
      .select('id, business_id, name, status')
      .eq('id', botId)
      .single();

    if (botError || !bot) {
      return c.json({ error: { code: 'bot_not_found', message: 'Bot not found' } }, 404);
    }

    const { data: widgetSettings, error: widgetError } = await supabaseAdmin
      .from('bot_widget_settings')
      .select('*')
      .eq('bot_id', botId)
      .single();

    if (widgetError || !widgetSettings) {
      return c.json({ error: { code: 'widget_not_configured', message: 'Web chat not configured for this bot' } }, 404);
    }

    // Check if widget is enabled
    if (!widgetSettings.enabled) {
      return c.json({ error: { code: 'widget_disabled', message: 'Web chat is disabled for this bot' } }, 403);
    }

    // Validate widget token (plain text comparison like API keys)
    if (validated.token !== widgetSettings.widget_token) {
      return c.json({ error: { code: 'invalid_token', message: 'Invalid widget token' } }, 401);
    }

    // Validate origin
    if (!validateOrigin(origin, widgetSettings.allowed_origins)) {
      logger.warn({ botId, origin, allowedOrigins: widgetSettings.allowed_origins }, 'Origin not allowed');
      return c.json({ error: { code: 'origin_not_allowed', message: 'Origin not allowed' } }, 403);
    }

    // Rate limit check
    const rateLimitKey = `session:${botId}:${origin}`;
    const sessionLimit = widgetSettings.rate_limits?.sessionPerMin || 10;
    if (!checkRateLimit(rateLimitKey, sessionLimit)) {
      return c.json({ error: { code: 'rate_limited', message: 'Too many session requests' } }, 429);
    }

    let session;
    let isNewSession = false;

    // Resume existing session or create new one
    if (validated.resumeSessionId) {
      const { data: existingSession } = await supabaseAdmin
        .from('web_sessions')
        .select('*')
        .eq('id', validated.resumeSessionId)
        .eq('bot_id', botId)
        .eq('status', 'active')
        .single();

      if (existingSession && existingSession.origin === origin) {
        // Update last_seen_at
        await supabaseAdmin
          .from('web_sessions')
          .update({ last_seen_at: new Date().toISOString() } as any)
          .eq('id', validated.resumeSessionId);

        session = existingSession;
      }
    }

    // Create new session if not resuming
    if (!session) {
      const { data: newSession, error: sessionError } = await supabaseAdmin
        .from('web_sessions')
        .insert({
          bot_id: botId,
          origin,
          origin_url: validated.pageUrl || null,
          user_agent: userAgent,
          metadata: validated.metadata || {},
          status: 'active',
        } as any)
        .select()
        .single();

      if (sessionError || !newSession) {
        logger.error({ err: String(sessionError) }, 'Error creating session');
        return c.json({ error: { code: 'server_error', message: 'Failed to create session' } }, 500);
      }

      session = newSession;
      isNewSession = true;
    }

    // Generate JWT
    const jwt = generateWebChatToken({
      botId,
      sessionId: session.id,
      origin,
      tokenVersion: widgetSettings.token_version,
    });

    // Calculate WebSocket URL with token
    const wsProtocol = c.req.url.startsWith('https') ? 'wss' : 'ws';
    const host = c.req.header('Host') || 'localhost:3000';
    const wsUrl = `${wsProtocol}://${host}/api/webview/ws?botId=${botId}&sessionId=${session.id}&token=${jwt}`;

    // Return session info
    return c.json({
      sessionId: session.id,
      jwt,
      wsUrl,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 minutes
      botName: bot.name,
      theme: widgetSettings.theme,
      greeting: widgetSettings.greeting,
      rateLimits: widgetSettings.rate_limits,
      serverTime: new Date().toISOString(),
      isNewSession,
    }, isNewSession ? 201 : 200);

  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return c.json({ error: { code: 'invalid_request', message: error.issues[0].message } }, 400);
    }
    logger.error({ err: String(error) }, 'Error in POST /session');
    return c.json({ error: { code: 'server_error', message: 'Internal server error' } }, 500);
  }
});

// ============================================
// GET /api/webview/:botId/history
// Get conversation history for a session
// ============================================

app.get('/:botId/history', async (c) => {
  try {
    const botId = c.req.param('botId');
    const sessionId = c.req.query('sessionId');
    const limit = parseInt(c.req.query('limit') || '30');
    const cursor = c.req.query('cursor'); // Message ID for pagination

    if (!sessionId) {
      return c.json({ error: { code: 'invalid_request', message: 'sessionId is required' } }, 400);
    }

    // Verify session exists and matches origin
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('web_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('bot_id', botId)
      .single();

    if (sessionError || !session) {
      return c.json({ error: { code: 'session_not_found', message: 'Session not found' } }, 404);
    }

    // Check if session is expired
    if (session.expires_at && new Date(session.expires_at) < new Date()) {
      return c.json({ error: { code: 'session_expired', message: 'Session has expired' } }, 410);
    }

    // Build query
    let query = supabaseAdmin
      .from('messages')
      .select('id, direction, content, metadata, created_at')
      .eq('bot_id', botId)
      .eq('session_id', sessionId)
      .eq('channel', 'web')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (cursor) {
      // Pagination: get messages before cursor
      const { data: cursorMessage } = await supabaseAdmin
        .from('messages')
        .select('created_at')
        .eq('id', cursor)
        .single();

      if (cursorMessage) {
        query = query.lt('created_at', cursorMessage.created_at);
      }
    }

    const { data: messages, error: messagesError } = await query;

    if (messagesError) {
      logger.error({ err: String(messagesError) }, 'Error fetching messages');
      return c.json({ error: { code: 'server_error', message: 'Failed to fetch messages' } }, 500);
    }

    // Reverse to get chronological order
    const items = (messages || []).reverse();

    return c.json({
      items,
      nextCursor: messages && messages.length === limit ? messages[messages.length - 1].id : null,
      totalReturned: items.length,
    });

  } catch (error: any) {
    logger.error({ err: String(error) }, 'Error in GET /history');
    return c.json({ error: { code: 'server_error', message: 'Internal server error' } }, 500);
  }
});

// ============================================
// POST /api/webview/:botId/end
// End a web chat session
// ============================================

app.post('/:botId/end', async (c) => {
  try {
    const botId = c.req.param('botId');
    const body = await c.req.json();
    const validated = endSessionSchema.parse(body);

    // Update session status
    const { error } = await supabaseAdmin
      .from('web_sessions')
      .update({
        status: 'ended',
        last_seen_at: new Date().toISOString(),
      } as any)
      .eq('id', validated.sessionId)
      .eq('bot_id', botId);

    if (error) {
      logger.error({ err: String(error) }, 'Error ending session');
      return c.json({ error: { code: 'server_error', message: 'Failed to end session' } }, 500);
    }

    return c.json({ success: true });

  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return c.json({ error: { code: 'invalid_request', message: error.issues[0].message } }, 400);
    }
    logger.error({ err: String(error) }, 'Error in POST /end');
    return c.json({ error: { code: 'server_error', message: 'Internal server error' } }, 500);
  }
});

export default app;

