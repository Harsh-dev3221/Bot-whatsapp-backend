// Message management routes

import { Hono } from 'hono';
import { supabaseAdmin } from '../db/supabase.js';
import type { ApiResponse, PaginatedResponse } from '../types/api.js';
import type { Message } from '../types/database.js';

const app = new Hono();

// Get messages with pagination
app.get('/', async (c) => {
  try {
    const businessId = c.req.query('business_id');
    const botId = c.req.query('bot_id');
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('messages')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (businessId) {
      query = query.eq('business_id', businessId);
    }

    if (botId) {
      query = query.eq('bot_id', botId);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    const response: PaginatedResponse<Message> = {
      data: data || [],
      total: count || 0,
      page,
      limit,
      hasMore: (count || 0) > offset + limit,
    };

    return c.json<ApiResponse>({ success: true, data: response });
  } catch (error: any) {
    return c.json<ApiResponse>({ success: false, error: error.message }, 500);
  }
});

// Get message by ID
app.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');

    const { data, error } = await supabaseAdmin
      .from('messages')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;

    return c.json<ApiResponse>({ success: true, data });
  } catch (error: any) {
    return c.json<ApiResponse>({ success: false, error: error.message }, 404);
  }
});

// Get conversation between bot and a number
app.get('/conversation/:botId/:phoneNumber', async (c) => {
  try {
    const botId = c.req.param('botId');
    const phoneNumber = c.req.param('phoneNumber');
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabaseAdmin
      .from('messages')
      .select('*', { count: 'exact' })
      .eq('bot_id', botId)
      .or(`from_number.eq.${phoneNumber},to_number.eq.${phoneNumber}`)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const response: PaginatedResponse<Message> = {
      data: data || [],
      total: count || 0,
      page,
      limit,
      hasMore: (count || 0) > offset + limit,
    };

    return c.json<ApiResponse>({ success: true, data: response });
  } catch (error: any) {
    return c.json<ApiResponse>({ success: false, error: error.message }, 500);
  }
});

// Get message statistics
app.get('/stats/:businessId', async (c) => {
  try {
    const businessId = c.req.param('businessId');

    // Total messages
    const { count: totalMessages } = await supabaseAdmin
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('business_id', businessId);

    // Inbound messages
    const { count: inboundMessages } = await supabaseAdmin
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('direction', 'inbound');

    // Outbound messages
    const { count: outboundMessages } = await supabaseAdmin
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('direction', 'outbound');

    // Messages today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { count: messagesToday } = await supabaseAdmin
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .gte('created_at', today.toISOString());

    return c.json<ApiResponse>({
      success: true,
      data: {
        total: totalMessages || 0,
        inbound: inboundMessages || 0,
        outbound: outboundMessages || 0,
        today: messagesToday || 0,
      },
    });
  } catch (error: any) {
    return c.json<ApiResponse>({ success: false, error: error.message }, 500);
  }
});

// Delete message
app.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id');

    const { error } = await supabaseAdmin
      .from('messages')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return c.json<ApiResponse>({
      success: true,
      message: 'Message deleted successfully',
    });
  } catch (error: any) {
    return c.json<ApiResponse>({ success: false, error: error.message }, 400);
  }
});

export default app;

