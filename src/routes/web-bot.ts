/**
 * Web Chat Management Routes
 *
 * Enables web chat channel for existing WhatsApp bots
 * Both channels share the same bot_settings (AI, booking, business context)
 */

import { Hono } from 'hono';
import { supabaseAdmin } from '../db/supabase.js';
import { logger } from '../utils/logger.js';
import crypto from 'crypto';
import { z } from 'zod';

const app = new Hono();

// Validation schema for enabling web chat
const enableWebChatSchema = z.object({
  theme: z.object({
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    botName: z.string().min(1).max(50),
  }).optional(),
  greeting: z.string().max(500).optional(),
  allowed_origins: z.array(z.string().url()).optional(),
});

/**
 * Enable web chat for an existing bot
 * POST /api/web-bot/:botId/enable
 *
 * This creates widget settings for the bot, allowing it to be embedded on websites
 * The bot shares the same bot_settings (AI, booking) with the WhatsApp channel
 */
app.post('/:botId/enable', async (c) => {
  const botId = c.req.param('botId');
  try {
    const body = await c.req.json();
    const validated = enableWebChatSchema.parse(body);

    // Check if bot exists
    const { data: bot, error: botError } = await supabaseAdmin
      .from('bots')
      .select('id, name, business_id')
      .eq('id', botId)
      .single();

    if (botError || !bot) {
      logger.error({ err: botError, botId }, 'Bot not found');
      return c.json({ error: { code: 'bot_not_found', message: 'Bot not found' } }, 404);
    }

    // Check if web chat is already enabled
    const { data: existing } = await supabaseAdmin
      .from('bot_widget_settings')
      .select('*')
      .eq('bot_id', botId)
      .single();

    if (existing) {
      logger.info({ botId }, 'Web chat already enabled');
      return c.json({ error: { code: 'already_enabled', message: 'Web chat is already enabled for this bot' } }, 400);
    }

    // Generate widget token (64 character hex string) - stored in plain text like API keys
    const widgetToken = crypto.randomBytes(32).toString('hex');

    // Default configuration
    const theme = validated.theme || {
      primaryColor: '#5A3EF0',
      botName: bot.name,
    };

    const greeting = validated.greeting || `Hello! I'm ${bot.name}. How can I help you today? 👋`;

    const allowedOrigins = validated.allowed_origins || [
      'http://localhost:5173',
      'http://localhost:3000',
    ];

    // Create widget settings
    const { error: widgetError } = await supabaseAdmin
      .from('bot_widget_settings')
      .insert({
        bot_id: botId,
        enabled: true,
        widget_token: widgetToken, // Store in plain text like API keys
        allowed_origins: allowedOrigins,
        theme,
        greeting,
        token_version: 1,
      });

    if (widgetError) {
      logger.error({ err: widgetError }, 'Error creating widget settings');
      return c.json({ error: { code: 'widget_creation_failed', message: widgetError.message } }, 500);
    }

    // Get API base URL from environment or request
    const apiBase = process.env.API_BASE_URL || `${c.req.url.split('/api')[0]}`;
    const wsBase = apiBase.replace('http://', 'ws://').replace('https://', 'wss://');

    // Generate embed code
    const embedCode = generateEmbedCode({
      botId,
      widgetToken,
      apiBase,
      theme,
    });

    // Generate React component code
    const reactCode = generateReactCode({
      botId,
      widgetToken,
      apiBase,
      theme,
    });

    // Generate HTML snippet
    const htmlSnippet = generateHTMLSnippet({
      botId,
      widgetToken,
      apiBase,
      theme,
    });

    logger.info({ botId, businessId: bot.business_id }, 'Web chat enabled successfully');

    return c.json({
      success: true,
      message: 'Web chat enabled successfully',
      bot: {
        id: botId,
        name: bot.name,
        business_id: bot.business_id,
      },
      widget: {
        token: widgetToken,
        theme,
        greeting,
        allowed_origins: allowedOrigins,
      },
      integration: {
        apiBase,
        wsUrl: `${wsBase}/api/webview/ws`,
        embedCode,
        reactCode,
        htmlSnippet,
      },
      instructions: {
        step1: 'Copy the embed code below',
        step2: 'Paste it into your website HTML (before closing </body> tag)',
        step3: 'The chat widget will appear on your website',
        step4: 'Customize theme and greeting in bot settings',
      },
    }, 201);

  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return c.json({ error: { code: 'invalid_request', message: error.issues[0].message } }, 400);
    }
    logger.error({ err: String(error) }, 'Error in POST /create');
    return c.json({ error: { code: 'server_error', message: 'Internal server error' } }, 500);
  }
});

/**
 * Disable web chat for a bot
 * POST /api/web-bot/:botId/disable
 */
app.post('/:botId/disable', async (c) => {
  const botId = c.req.param('botId');
  try {
    // Check if web chat is enabled
    const { data: existing } = await supabaseAdmin
      .from('bot_widget_settings')
      .select('*')
      .eq('bot_id', botId)
      .single();

    if (!existing) {
      return c.json({ error: { code: 'not_enabled', message: 'Web chat is not enabled for this bot' } }, 400);
    }

    // Disable web chat (soft delete - keep settings but mark as disabled)
    const { error } = await supabaseAdmin
      .from('bot_widget_settings')
      .update({ enabled: false })
      .eq('bot_id', botId);

    if (error) {
      logger.error({ err: error }, 'Error disabling web chat');
      return c.json({ error: { code: 'disable_failed', message: error.message } }, 500);
    }

    logger.info({ botId }, 'Web chat disabled successfully');

    return c.json({
      success: true,
      message: 'Web chat disabled successfully',
    });

  } catch (error: any) {
    logger.error({ err: String(error) }, 'Error in disable web chat');
    return c.json({ error: { code: 'internal_error', message: error.message } }, 500);
  }
});

/**
 * Get web bot details and embed code
 */
app.get('/:botId', async (c) => {
  try {
    const botId = c.req.param('botId');

    // Get bot details
    const { data: bot, error: botError } = await supabaseAdmin
      .from('bots')
      .select('*')
      .eq('id', botId)
      .single();

    if (botError || !bot) {
      return c.json({ error: { code: 'bot_not_found', message: 'Bot not found' } }, 404);
    }

    // Get widget settings
    const { data: widget, error: widgetError } = await supabaseAdmin
      .from('bot_widget_settings')
      .select('*')
      .eq('bot_id', botId)
      .single();

    if (widgetError || !widget) {
      return c.json({ error: { code: 'widget_not_found', message: 'Widget settings not found' } }, 404);
    }

    const apiBase = process.env.API_BASE_URL || `${c.req.url.split('/api')[0]}`;
    const wsBase = apiBase.replace('http://', 'ws://').replace('https://', 'wss://');

    // Return the actual token (admins can view/copy it anytime)
    const embedCode = generateEmbedCode({
      botId,
      widgetToken: widget.widget_token,
      apiBase,
      theme: widget.theme,
    });

    return c.json({
      success: true,
      bot: {
        id: bot.id,
        name: bot.name,
        business_id: bot.business_id,
        status: bot.status,
        created_at: bot.created_at,
      },
      widget: {
        token: widget.widget_token, // Return plain text token (like API keys)
        theme: widget.theme,
        greeting: widget.greeting,
        allowed_origins: widget.allowed_origins,
        token_version: widget.token_version,
      },
      integration: {
        apiBase,
        wsUrl: `${wsBase}/api/webview/ws`,
        embedCode,
      },
    });

  } catch (error: any) {
    logger.error({ err: String(error) }, 'Error in GET /:botId');
    return c.json({ error: { code: 'server_error', message: 'Internal server error' } }, 500);
  }
});

/**
 * Refresh widget token (invalidates old token)
 * Admins can use this to regenerate the token for security
 */
app.post('/:botId/refresh-token', async (c) => {
  try {
    const botId = c.req.param('botId');

    // Verify bot exists and is a web bot
    const { data: bot, error: botError } = await supabaseAdmin
      .from('bots')
      .select('*')
      .eq('id', botId)
      .single();

    if (botError || !bot) {
      return c.json({ error: { code: 'bot_not_found', message: 'Bot not found' } }, 404);
    }

    if (!bot.phone_number?.startsWith('web-')) {
      return c.json({ error: { code: 'invalid_bot_type', message: 'Not a web bot' } }, 400);
    }

    // Generate new widget token
    const newWidgetToken = crypto.randomBytes(32).toString('hex');

    // Update widget settings with new token and increment version
    const { data: widget, error: widgetError } = await supabaseAdmin
      .from('bot_widget_settings')
      .update({
        widget_token: newWidgetToken,
        token_version: supabaseAdmin.rpc('increment', { x: 1 }), // Increment version to invalidate old JWTs
        rotated_at: new Date().toISOString(),
      })
      .eq('bot_id', botId)
      .select()
      .single();

    if (widgetError || !widget) {
      logger.error({ err: widgetError }, 'Error refreshing widget token');
      return c.json({ error: { code: 'token_refresh_failed', message: 'Failed to refresh token' } }, 500);
    }

    return c.json({
      success: true,
      token: newWidgetToken,
      token_version: widget.token_version,
      rotated_at: widget.rotated_at,
      message: 'Token refreshed successfully. Old token is now invalid.',
    });

  } catch (error: any) {
    logger.error({ err: String(error) }, 'Error in POST /:botId/refresh-token');
    return c.json({ error: { code: 'server_error', message: 'Internal server error' } }, 500);
  }
});

/**
 * Update web bot settings
 */
app.patch('/:botId', async (c) => {
  try {
    const botId = c.req.param('botId');
    const body = await c.req.json();

    const updateSchema = z.object({
      name: z.string().min(1).max(100).optional(),
      theme: z.object({
        primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
        botName: z.string().min(1).max(50),
      }).optional(),
      greeting: z.string().max(500).optional(),
      allowed_origins: z.array(z.string().url()).optional(),
    });

    const validated = updateSchema.parse(body);

    // Update bot name if provided
    if (validated.name) {
      const { error: botError } = await supabaseAdmin
        .from('bots')
        .update({ name: validated.name })
        .eq('id', botId);

      if (botError) {
        return c.json({ error: { code: 'update_failed', message: botError.message } }, 500);
      }
    }

    // Update widget settings
    const widgetUpdates: any = {};
    if (validated.theme) widgetUpdates.theme = validated.theme;
    if (validated.greeting) widgetUpdates.greeting = validated.greeting;
    if (validated.allowed_origins) widgetUpdates.allowed_origins = validated.allowed_origins;

    if (Object.keys(widgetUpdates).length > 0) {
      widgetUpdates.updated_at = new Date().toISOString();

      const { error: widgetError } = await supabaseAdmin
        .from('bot_widget_settings')
        .update(widgetUpdates)
        .eq('bot_id', botId);

      if (widgetError) {
        return c.json({ error: { code: 'update_failed', message: widgetError.message } }, 500);
      }
    }

    return c.json({ success: true, message: 'Web bot updated successfully' });

  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return c.json({ error: { code: 'invalid_request', message: error.issues[0].message } }, 400);
    }
    logger.error({ err: String(error) }, 'Error in PATCH /:botId');
    return c.json({ error: { code: 'server_error', message: 'Internal server error' } }, 500);
  }
});

// Helper functions to generate embed codes

function generateEmbedCode(config: { botId: string; widgetToken: string; apiBase: string; theme: any }) {
  return `<!-- Web Chat Widget -->
<script>
  (function(){
    const s = document.createElement('script');
    s.src = '${config.apiBase}/widget.js';
    s.async = true;
    s.onload = function(){
      window.BotChat.init({
        botId: '${config.botId}',
        token: '${config.widgetToken}',
        apiBase: '${config.apiBase}',
        theme: ${JSON.stringify(config.theme, null, 2)}
      });
    };
    document.head.appendChild(s);
  })();
</script>`;
}

function generateReactCode(config: { botId: string; widgetToken: string; apiBase: string; theme: any }) {
  return `import { WebChatWidget } from './components/WebChatWidget';

function App() {
  return (
    <div>
      {/* Your app content */}
      
      <WebChatWidget
        botId="${config.botId}"
        widgetToken="${config.widgetToken}"
        apiBase="${config.apiBase}"
        theme={${JSON.stringify(config.theme, null, 2)}}
      />
    </div>
  );
}`;
}

function generateHTMLSnippet(config: { botId: string; widgetToken: string; apiBase: string; theme: any }) {
  return `<!-- Add this before closing </body> tag -->
<div id="webchat-widget" 
     data-bot-id="${config.botId}"
     data-token="${config.widgetToken}"
     data-api-base="${config.apiBase}"
     data-theme='${JSON.stringify(config.theme)}'>
</div>
<script src="${config.apiBase}/widget.js"></script>`;
}

export default app;

