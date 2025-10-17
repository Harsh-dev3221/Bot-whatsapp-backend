// Business management routes

import { Hono } from 'hono';
import { supabaseAdmin } from '../db/supabase.js';
import { createBusinessSchema, updateBusinessSchema } from '../types/api.js';
import type { ApiResponse } from '../types/api.js';

const app = new Hono();

// Get all businesses
app.get('/', async (c) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('businesses')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return c.json<ApiResponse>({ success: true, data });
  } catch (error: any) {
    return c.json<ApiResponse>({ success: false, error: error.message }, 500);
  }
});

// Get business by ID
app.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');

    const { data, error } = await supabaseAdmin
      .from('businesses')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;

    return c.json<ApiResponse>({ success: true, data });
  } catch (error: any) {
    return c.json<ApiResponse>({ success: false, error: error.message }, 404);
  }
});

// Create new business
app.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const validated = createBusinessSchema.parse(body);

    const { data, error } = await supabaseAdmin
      .from('businesses')
      .insert(validated as any)
      .select()
      .single();

    if (error) throw error;

    // Create default bot settings
    return c.json<ApiResponse>({
      success: true,
      data,
      message: 'Business created successfully',
    }, 201);
  } catch (error: any) {
    return c.json<ApiResponse>({ success: false, error: error.message }, 400);
  }
});

// Update business
app.put('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const validated = updateBusinessSchema.parse(body);

    const { data, error } = await supabaseAdmin
      .from('businesses')
      .update(validated as any)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return c.json<ApiResponse>({
      success: true,
      data,
      message: 'Business updated successfully',
    });
  } catch (error: any) {
    return c.json<ApiResponse>({ success: false, error: error.message }, 400);
  }
});

// Delete business
app.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id');

    const { error } = await supabaseAdmin
      .from('businesses')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return c.json<ApiResponse>({
      success: true,
      message: 'Business deleted successfully',
    });
  } catch (error: any) {
    return c.json<ApiResponse>({ success: false, error: error.message }, 400);
  }
});

// Get business statistics
app.get('/:id/stats', async (c) => {
  try {
    const id = c.req.param('id');

    // Get bot count
    const { count: botCount } = await supabaseAdmin
      .from('bots')
      .select('*', { count: 'exact', head: true })
      .eq('business_id', id);

    // Get message count
    const { count: messageCount } = await supabaseAdmin
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('business_id', id);

    // Get active bots count
    const { count: activeBotCount } = await supabaseAdmin
      .from('bots')
      .select('*', { count: 'exact', head: true })
      .eq('business_id', id)
      .eq('status', 'connected');

    return c.json<ApiResponse>({
      success: true,
      data: {
        totalBots: botCount || 0,
        activeBots: activeBotCount || 0,
        totalMessages: messageCount || 0,
      },
    });
  } catch (error: any) {
    return c.json<ApiResponse>({ success: false, error: error.message }, 500);
  }
});

export default app;

