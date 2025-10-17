// Bot management routes

import { Hono } from 'hono';
import { supabaseAdmin } from '../db/supabase.js';
import { BotManager } from '../services/bot-manager.js';
import { createBotSchema, updateBotSchema } from '../types/api.js';
import type { ApiResponse } from '../types/api.js';

const app = new Hono();

// Get all bots
app.get('/', async (c) => {
  try {
    const businessId = c.req.query('business_id');

    let query = supabaseAdmin
      .from('bots')
      .select('*, bot_widget_settings(enabled)')
      .order('created_at', { ascending: false });

    if (businessId) {
      query = query.eq('business_id', businessId);
    }

    const { data, error } = await query;

    if (error) throw error;

    // Add web_chat_enabled flag to each bot
    const botsWithWebChat = (data || []).map((bot: any) => ({
      ...bot,
      web_chat_enabled: bot.bot_widget_settings?.enabled || false,
    }));

    return c.json<ApiResponse>({ success: true, data: botsWithWebChat });
  } catch (error: any) {
    return c.json<ApiResponse>({ success: false, error: error.message }, 500);
  }
});

// Get bot by ID
app.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');

    const { data, error } = await supabaseAdmin
      .from('bots')
      .select('*, bot_settings(*)')
      .eq('id', id)
      .single();

    if (error) throw error;

    // Add active status
    const isActive = BotManager.isBotActive(id);
    const result = { ...(data as any), is_active: isActive };

    return c.json<ApiResponse>({ success: true, data: result });
  } catch (error: any) {
    return c.json<ApiResponse>({ success: false, error: error.message }, 404);
  }
});

// Create new bot
app.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const validated = createBotSchema.parse(body);

    const { data: bot, error } = await supabaseAdmin
      .from('bots')
      .insert(validated as any)
      .select()
      .single();

    if (error) throw error;

    // Create default bot settings with booking + workflows enabled by default
    await supabaseAdmin.from('bot_settings').insert({
      bot_id: (bot as any).id,
      auto_reply_enabled: false,
      business_hours_enabled: false,
      booking_enabled: true, // keep booking for backward-compat
      booking_trigger_keywords: ['book', 'booking', 'appointment', 'schedule', 'reserve'],
      booking_confirmation_message: 'Your booking has been confirmed! We look forward to seeing you.',
      booking_cancellation_message: 'Your booking has been cancelled. Feel free to book again anytime!',
      booking_require_gender: true,
      booking_require_booking_for: true,
      workflow_enabled: true,
      workflow_setup_required: true,
    } as any);

    // If initial_workflows provided, create them now and clear setup_required when published exists
    if (Array.isArray((body as any).initial_workflows) && (body as any).initial_workflows.length > 0) {
      const workflowsPayload = (body as any).initial_workflows.map((wf: any) => ({
        ...wf,
        bot_id: (bot as any).id,
      }));
      const { data: createdWf, error: wfErr } = await supabaseAdmin
        .from('workflows')
        .insert(workflowsPayload as any)
        .select();
      if (wfErr) throw wfErr;
      const hasPublished = (createdWf || []).some((w: any) => w.status === 'published' && w.is_active);
      if (hasPublished) {
        await supabaseAdmin
          .from('bot_settings')
          .update({ workflow_setup_required: false } as any)
          .eq('bot_id', (bot as any).id);
      }
    }

    // Optional: initial knowledge base
    if (Array.isArray((body as any).knowledge_base) && (body as any).knowledge_base.length > 0) {
      const kbPayload = (body as any).knowledge_base.map((kb: any) => ({
        ...kb,
        bot_id: (bot as any).id,
      }));
      await supabaseAdmin.from('knowledge_base').insert(kbPayload as any);
    }

    return c.json<ApiResponse>({
      success: true,
      data: bot,
      message: 'Bot created successfully',
    }, 201);
  } catch (error: any) {
    return c.json<ApiResponse>({ success: false, error: error.message }, 400);
  }
});

// Update bot
app.put('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const validated = updateBotSchema.parse(body);

    const { data, error } = await supabaseAdmin
      .from('bots')
      .update(validated as any)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return c.json<ApiResponse>({
      success: true,
      data,
      message: 'Bot updated successfully',
    });
  } catch (error: any) {
    return c.json<ApiResponse>({ success: false, error: error.message }, 400);
  }
});

// Delete bot
app.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id');

    // Stop bot if running
    await BotManager.stopBot(id);

    const { error } = await supabaseAdmin
      .from('bots')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return c.json<ApiResponse>({
      success: true,
      message: 'Bot deleted successfully',
    });
  } catch (error: any) {
    return c.json<ApiResponse>({ success: false, error: error.message }, 400);
  }
});

// Start bot (connect to WhatsApp)
app.post('/:id/start', async (c) => {
  try {
    const id = c.req.param('id');

    const result = await BotManager.startBot(id);

    return c.json<ApiResponse>({
      success: result.success,
      data: { qrCode: result.qrCode },
      message: result.success ? 'Bot started successfully' : 'Failed to start bot',
    });
  } catch (error: any) {
    return c.json<ApiResponse>({ success: false, error: error.message }, 500);
  }
});

// Stop bot (disconnect from WhatsApp)
app.post('/:id/stop', async (c) => {
  try {
    const id = c.req.param('id');

    const success = await BotManager.stopBot(id);

    return c.json<ApiResponse>({
      success,
      message: success ? 'Bot stopped successfully' : 'Failed to stop bot',
    });
  } catch (error: any) {
    return c.json<ApiResponse>({ success: false, error: error.message }, 500);
  }
});

// Get bot QR code
app.get('/:id/qr', async (c) => {
  try {
    const id = c.req.param('id');

    const { data, error } = await supabaseAdmin
      .from('bots')
      .select('qr_code, status')
      .eq('id', id)
      .single();

    if (error) throw error;

    return c.json<ApiResponse>({ success: true, data });
  } catch (error: any) {
    return c.json<ApiResponse>({ success: false, error: error.message }, 404);
  }
});

// Send message from bot
app.post('/:id/send', async (c) => {
  try {
    const id = c.req.param('id');
    const { to_number, content } = await c.req.json();

    if (!to_number || !content) {
      throw new Error('to_number and content are required');
    }

    const success = await BotManager.sendMessage(id, to_number, content);

    return c.json<ApiResponse>({
      success,
      message: success ? 'Message sent successfully' : 'Failed to send message',
    });
  } catch (error: any) {
    return c.json<ApiResponse>({ success: false, error: error.message }, 400);
  }
});

// Get bot settings
app.get('/:id/settings', async (c) => {
  try {
    const id = c.req.param('id');

    const { data, error } = await supabaseAdmin
      .from('bot_settings')
      .select('*')
      .eq('bot_id', id)
      .single();

    if (error) throw error;

    return c.json<ApiResponse>({ success: true, data });
  } catch (error: any) {
    return c.json<ApiResponse>({ success: false, error: error.message }, 404);
  }
});

// Update bot settings
app.put('/:id/settings', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();

    const { data, error } = await supabaseAdmin
      .from('bot_settings')
      .update(body as any)
      .eq('bot_id', id)
      .select()
      .single();

    if (error) throw error;

    return c.json<ApiResponse>({
      success: true,
      data,
      message: 'Bot settings updated successfully',
    });
  } catch (error: any) {
    return c.json<ApiResponse>({ success: false, error: error.message }, 400);
  }
});

// Request pairing code
app.post('/:id/pairing-code', async (c) => {
  try {
    const id = c.req.param('id');
    const { phone_number } = await c.req.json();

    if (!phone_number) {
      return c.json<ApiResponse>({ success: false, error: 'Phone number is required' }, 400);
    }

    const result = await BotManager.requestPairingCode(id, phone_number);

    return c.json<ApiResponse>({
      success: result.success,
      data: { pairingCode: result.pairingCode },
      message: result.success ? 'Pairing code generated successfully' : 'Failed to generate pairing code',
    });
  } catch (error: any) {
    return c.json<ApiResponse>({ success: false, error: error.message }, 500);
  }
});

// Get pairing code
app.get('/:id/pairing-code', async (c) => {
  try {
    const id = c.req.param('id');
    const pairingCode = BotManager.getPairingCode(id);

    if (!pairingCode) {
      return c.json<ApiResponse>({ success: false, error: 'No pairing code found' }, 404);
    }

    return c.json<ApiResponse>({ success: true, data: { pairingCode } });
  } catch (error: any) {
    return c.json<ApiResponse>({ success: false, error: error.message }, 500);
  }
});

// Get bot dashboard credentials (for admin use)
app.get('/:id/credentials', async (c) => {
  try {
    const id = c.req.param('id');

    // Get bot info
    const { data: bot, error: botError } = await supabaseAdmin
      .from('bots')
      .select('id, name, phone_number')
      .eq('id', id)
      .single();

    if (botError || !bot) {
      return c.json<ApiResponse>({ success: false, error: 'Bot not found' }, 404);
    }

    // Get credentials
    const { data: credentials, error: credError } = await supabaseAdmin
      .from('bot_credentials')
      .select('default_password, password_changed, last_login_at')
      .eq('bot_id', id)
      .single();

    if (credError || !credentials) {
      return c.json<ApiResponse>({ success: false, error: 'Credentials not found' }, 404);
    }

    return c.json<ApiResponse>({
      success: true,
      data: {
        botId: bot.id,
        botName: bot.name,
        username: bot.phone_number,
        defaultPassword: credentials.default_password,
        passwordChanged: credentials.password_changed,
        lastLoginAt: credentials.last_login_at,
        dashboardUrl: `/bot-dashboard/${bot.id}`,
      },
    });
  } catch (error: any) {
    return c.json<ApiResponse>({ success: false, error: error.message }, 500);
  }
});

export default app;

