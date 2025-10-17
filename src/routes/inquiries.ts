import { Hono } from 'hono';
import { supabaseAdmin } from '../db/supabase.js';
import type { ApiResponse } from '../types/api.js';

const app = new Hono();

// List inquiries for a bot
app.get('/:botId', async (c) => {
  try {
    const botId = c.req.param('botId');
    const status = c.req.query('status');
    let q = supabaseAdmin
      .from('inquiries')
      .select('*')
      .eq('bot_id', botId)
      .order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return c.json<ApiResponse>({ success: true, data });
  } catch (e: any) {
    return c.json<ApiResponse>({ success: false, error: e.message }, 500);
  }
});

// Get inquiry by ID
app.get('/:botId/:inquiryId', async (c) => {
  try {
    const botId = c.req.param('botId');
    const inquiryId = c.req.param('inquiryId');
    const { data, error } = await supabaseAdmin
      .from('inquiries')
      .select('*')
      .eq('id', inquiryId)
      .eq('bot_id', botId)
      .single();
    if (error) throw error;
    return c.json<ApiResponse>({ success: true, data });
  } catch (e: any) {
    return c.json<ApiResponse>({ success: false, error: e.message }, 404);
  }
});

// Update inquiry status
app.put('/:botId/:inquiryId/status', async (c) => {
  try {
    const botId = c.req.param('botId');
    const inquiryId = c.req.param('inquiryId');
    const { status } = await c.req.json();
    const { data, error } = await supabaseAdmin
      .from('inquiries')
      .update({ status } as any)
      .eq('id', inquiryId)
      .eq('bot_id', botId)
      .select()
      .single();
    if (error) throw error;
    return c.json<ApiResponse>({ success: true, data, message: 'Inquiry status updated' });
  } catch (e: any) {
    return c.json<ApiResponse>({ success: false, error: e.message }, 400);
  }
});

export default app;

