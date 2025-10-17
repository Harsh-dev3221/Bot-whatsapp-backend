/**
 * WebSocket Gateway for Web Chat
 * 
 * Handles WebSocket connections for the web chat channel
 * Authenticates JWT, manages connection registry, routes messages
 * 
 * Architecture: docs/WEB_CHAT_ARCHITECTURE.txt Section 7
 */

import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { logger } from '../utils/logger.js';
import { verifyWebChatToken, validateTokenVersion } from '../utils/jwt.js';
import { supabaseAdmin } from '../db/supabase.js';
import type { Server } from 'http';

// Connection metadata
interface ConnectionMeta {
  botId: string;
  sessionId: string;
  businessId: string;
  origin: string;
  connectedAt: Date;
  lastPingAt: Date;
}

// Connection registry: sessionId -> { ws, meta }
const connections = new Map<string, { ws: WebSocket; meta: ConnectionMeta }>();

// Heartbeat interval (30 seconds)
const HEARTBEAT_INTERVAL = 30000;
const HEARTBEAT_TIMEOUT = 60000; // 60 seconds without ping = disconnect

/**
 * Initialize WebSocket server
 */
export function initWebSocketServer(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({
    noServer: true,
    path: '/api/webview/ws'
  });

  // Handle HTTP upgrade requests
  httpServer.on('upgrade', async (request: IncomingMessage, socket, head) => {
    try {
      const url = new URL(request.url || '', `http://${request.headers.host}`);

      // Only handle /api/webview/ws path
      if (url.pathname !== '/api/webview/ws') {
        socket.destroy();
        return;
      }

      // Authenticate the connection
      const authResult = await authenticateConnection(request);

      if (!authResult.success) {
        logger.warn({
          error: authResult.error,
          url: request.url
        }, 'WebSocket authentication failed');

        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      // Upgrade the connection
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, authResult.meta);
      });
    } catch (error) {
      logger.error({ err: String(error) }, 'Error handling WebSocket upgrade');
      socket.destroy();
    }
  });

  // Handle new connections
  wss.on('connection', (ws: WebSocket, request: IncomingMessage, meta: ConnectionMeta) => {
    void request; // suppress TS6133 unused-parameter
    handleConnection(ws, meta);
  });

  // Start heartbeat checker
  startHeartbeatChecker();

  logger.info('WebSocket server initialized');
  return wss;
}

/**
 * Authenticate WebSocket connection
 */
async function authenticateConnection(request: IncomingMessage): Promise<{
  success: boolean;
  error?: string;
  meta?: ConnectionMeta;
}> {
  try {
    // Parse query parameters
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const botId = url.searchParams.get('botId');
    const sessionId = url.searchParams.get('sessionId');

    if (!botId || !sessionId) {
      return { success: false, error: 'missing_params' };
    }

    // Extract JWT from query parameter (WebSocket in browsers doesn't support custom headers)
    const token = url.searchParams.get('token');
    if (!token) {
      return { success: false, error: 'missing_token' };
    }

    // Verify JWT
    const decoded = verifyWebChatToken(token);
    if (!decoded) {
      return { success: false, error: 'invalid_token' };
    }

    // Validate claims match query params
    if (decoded.botId !== botId || decoded.sessionId !== sessionId) {
      return { success: false, error: 'token_mismatch' };
    }

    // Validate token version
    const versionValid = await validateTokenVersion(botId, decoded.tokenVersion, async () => {
      const { data: settings } = await supabaseAdmin
        .from('bot_widget_settings')
        .select('token_version')
        .eq('bot_id', botId)
        .single();
      return settings?.token_version || 1;
    });
    if (!versionValid) {
      return { success: false, error: 'token_version_mismatch' };
    }

    // Validate session exists and is active
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('web_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('bot_id', botId)
      .single();

    if (sessionError || !session) {
      return { success: false, error: 'session_not_found' };
    }

    if (session.status !== 'active') {
      return { success: false, error: 'session_inactive' };
    }

    // Check session expiry
    const expiresAt = new Date(session.expires_at);
    if (expiresAt < new Date()) {
      return { success: false, error: 'session_expired' };
    }

    // Validate origin matches session origin
    const origin = request.headers.origin || '';
    if (session.origin !== origin) {
      return { success: false, error: 'origin_mismatch' };
    }

    // Get business ID from bot
    const { data: bot } = await supabaseAdmin
      .from('bots')
      .select('business_id')
      .eq('id', botId)
      .single();

    if (!bot) {
      return { success: false, error: 'bot_not_found' };
    }

    // Success - return connection metadata
    return {
      success: true,
      meta: {
        botId,
        sessionId,
        businessId: bot.business_id,
        origin,
        connectedAt: new Date(),
        lastPingAt: new Date(),
      },
    };
  } catch (error) {
    logger.error({ err: String(error) }, 'Error authenticating WebSocket connection');
    return { success: false, error: 'internal_error' };
  }
}

/**
 * Handle new WebSocket connection
 */
function handleConnection(ws: WebSocket, meta: ConnectionMeta): void {
  const { sessionId, botId } = meta;

  logger.info({
    sessionId,
    botId,
    origin: meta.origin
  }, 'WebSocket connection established');

  // Register connection
  connections.set(sessionId, { ws, meta });

  // Send welcome message
  sendEvent(ws, {
    type: 'connected',
    sessionId,
    ts: new Date().toISOString(),
  });

  // Handle incoming messages
  ws.on('message', async (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());
      await handleClientMessage(ws, meta, message);
    } catch (error) {
      logger.error({
        err: String(error),
        sessionId
      }, 'Error handling WebSocket message');

      sendEvent(ws, {
        type: 'error',
        code: 'invalid_message',
        message: 'Failed to process message',
      });
    }
  });

  // Handle connection close
  ws.on('close', () => {
    logger.info({ sessionId, botId }, 'WebSocket connection closed');
    connections.delete(sessionId);
  });

  // Handle errors
  ws.on('error', (error) => {
    logger.error({
      err: String(error),
      sessionId
    }, 'WebSocket error');
    connections.delete(sessionId);
  });
}

/**
 * Handle client message
 */
async function handleClientMessage(
  ws: WebSocket,
  meta: ConnectionMeta,
  message: any
): Promise<void> {
  const { type } = message;

  switch (type) {
    case 'ping':
      // Update last ping time
      meta.lastPingAt = new Date();
      sendEvent(ws, { type: 'pong', ts: new Date().toISOString() });
      break;

    case 'typing':
      // Handle typing indicator (optional - could broadcast to agents)
      logger.debug({
        sessionId: meta.sessionId,
        state: message.state
      }, 'Typing indicator received');
      break;

    case 'user_message':
      // Handle user message - this will be implemented in web-conversation-engine.ts
      await handleUserMessage(ws, meta, message);
      break;

    default:
      logger.warn({
        sessionId: meta.sessionId,
        type
      }, 'Unknown message type');
      sendEvent(ws, {
        type: 'error',
        code: 'unknown_message_type',
        message: `Unknown message type: ${type}`,
      });
  }
}

/**
 * Handle user message (placeholder - will be implemented in web-conversation-engine.ts)
 */
async function handleUserMessage(
  ws: WebSocket,
  meta: ConnectionMeta,
  message: any
): Promise<void> {
  // Send acknowledgment
  if (message.id) {
    sendEvent(ws, { type: 'ack', id: message.id });
  }

  // Import and call web conversation engine
  // This will be implemented in the next file
  const { handleWebMessage } = await import('../services/web-conversation-engine.js');
  await handleWebMessage(meta.sessionId, meta.botId, meta.businessId, message.text);
}

/**
 * Send event to client
 */
export function sendEvent(ws: WebSocket, event: any): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

/**
 * Send event to session
 */
export function sendEventToSession(sessionId: string, event: any): void {
  const connection = connections.get(sessionId);
  if (connection) {
    sendEvent(connection.ws, event);
  }
}

/**
 * Start heartbeat checker
 */
function startHeartbeatChecker(): void {
  setInterval(() => {
    const now = new Date();

    for (const [sessionId, { ws, meta }] of connections.entries()) {
      const timeSinceLastPing = now.getTime() - meta.lastPingAt.getTime();

      if (timeSinceLastPing > HEARTBEAT_TIMEOUT) {
        logger.warn({
          sessionId,
          timeSinceLastPing
        }, 'WebSocket connection timed out');

        ws.close(1000, 'Heartbeat timeout');
        connections.delete(sessionId);
      }
    }
  }, HEARTBEAT_INTERVAL);
}

/**
 * Get active connections count
 */
export function getActiveConnectionsCount(): number {
  return connections.size;
}

/**
 * Get connection by session ID
 */
export function getConnection(sessionId: string): { ws: WebSocket; meta: ConnectionMeta } | undefined {
  return connections.get(sessionId);
}

