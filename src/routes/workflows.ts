import { Hono } from 'hono';
import { supabaseAdmin } from '../db/supabase.js';
import type { ApiResponse } from '../types/api.js';

const app = new Hono();

// List workflows for a bot
app.get('/:botId', async (c) => {
  try {
    const botId = c.req.param('botId');
    const { data, error } = await supabaseAdmin
      .from('workflows')
      .select('*')
      .eq('bot_id', botId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return c.json<ApiResponse>({ success: true, data });
  } catch (e: any) {
    return c.json<ApiResponse>({ success: false, error: e.message }, 500);
  }
});

// Create workflow for a bot
app.post('/:botId', async (c) => {
  try {
    const botId = c.req.param('botId');
    const body = await c.req.json();
    const payload = { ...body, bot_id: botId };
    const { data, error } = await supabaseAdmin
      .from('workflows')
      .insert(payload as any)
      .select()
      .single();
    if (error) throw error;
    return c.json<ApiResponse>({ success: true, data, message: 'Workflow created' }, 201);
  } catch (e: any) {
    return c.json<ApiResponse>({ success: false, error: e.message }, 400);
  }
});

// Update workflow
app.put('/:botId/:workflowId', async (c) => {
  try {
    const botId = c.req.param('botId');
    const workflowId = c.req.param('workflowId');
    const body = await c.req.json();
    const { data, error } = await supabaseAdmin
      .from('workflows')
      .update(body as any)
      .eq('id', workflowId)
      .eq('bot_id', botId)
      .select()
      .single();
    if (error) throw error;
    return c.json<ApiResponse>({ success: true, data, message: 'Workflow updated' });
  } catch (e: any) {
    return c.json<ApiResponse>({ success: false, error: e.message }, 400);
  }
});

// Delete workflow
app.delete('/:botId/:workflowId', async (c) => {
  try {
    const botId = c.req.param('botId');
    const workflowId = c.req.param('workflowId');
    const { error } = await supabaseAdmin
      .from('workflows')
      .delete()
      .eq('id', workflowId)
      .eq('bot_id', botId);
    if (error) throw error;
    return c.json<ApiResponse>({ success: true, message: 'Workflow deleted' });
  } catch (e: any) {
    return c.json<ApiResponse>({ success: false, error: e.message }, 400);
  }
});

export default app;

