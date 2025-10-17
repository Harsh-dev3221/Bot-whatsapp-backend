// Booking settings routes - Manage services and time slots

import { Hono } from 'hono';
import { supabaseAdmin } from '../db/supabase.js';
import pino from 'pino';

const logger = pino({ level: 'info' });
const app = new Hono();

// ============================================
// SERVICES ROUTES
// ============================================

/**
 * GET /api/businesses/:businessId/services
 * Get all services for a business
 */
app.get('/:businessId/services', async (c) => {
  try {
    const businessId = c.req.param('businessId');

    const { data: services, error } = await supabaseAdmin
      .from('business_services')
      .select('*')
      .eq('business_id', businessId)
      .order('display_order', { ascending: true });

    if (error) {
      logger.error({ err: String(error) }, 'Error fetching services');
      return c.json({ error: 'Failed to fetch services' }, 500);
    }

    return c.json({ services });
  } catch (error) {
    logger.error({ err: String(error) }, 'Error in GET /services');
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * POST /api/businesses/:businessId/services
 * Create a new service
 */
app.post('/:businessId/services', async (c) => {
  try {
    const businessId = c.req.param('businessId');
    const body = await c.req.json();

    const { name, description, price, duration, category, display_order } = body;

    if (!name) {
      return c.json({ error: 'Service name is required' }, 400);
    }

    const { data: service, error } = await supabaseAdmin
      .from('business_services')
      .insert({
        business_id: businessId,
        name,
        description: description || null,
        price: price || null,
        duration: duration || 30,
        category: category || null,
        display_order: display_order || 0,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      logger.error({ err: String(error) }, 'Error creating service');
      return c.json({ error: 'Failed to create service' }, 500);
    }

    return c.json({ service }, 201);
  } catch (error) {
    logger.error({ err: String(error) }, 'Error in POST /services');
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * PUT /api/businesses/:businessId/services/:serviceId
 * Update a service
 */
app.put('/:businessId/services/:serviceId', async (c) => {
  try {
    const businessId = c.req.param('businessId');
    const serviceId = c.req.param('serviceId');
    const body = await c.req.json();

    const { name, description, price, duration, category, display_order, is_active } = body;

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (price !== undefined) updateData.price = price;
    if (duration !== undefined) updateData.duration = duration;
    if (category !== undefined) updateData.category = category;
    if (display_order !== undefined) updateData.display_order = display_order;
    if (is_active !== undefined) updateData.is_active = is_active;

    const { data: service, error } = await supabaseAdmin
      .from('business_services')
      .update(updateData)
      .eq('id', serviceId)
      .eq('business_id', businessId)
      .select()
      .single();

    if (error) {
      logger.error({ err: String(error) }, 'Error updating service');
      return c.json({ error: 'Failed to update service' }, 500);
    }

    return c.json({ service });
  } catch (error) {
    logger.error({ err: String(error) }, 'Error in PUT /services/:serviceId');
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * DELETE /api/businesses/:businessId/services/:serviceId
 * Delete a service
 */
app.delete('/:businessId/services/:serviceId', async (c) => {
  try {
    const businessId = c.req.param('businessId');
    const serviceId = c.req.param('serviceId');

    const { error } = await supabaseAdmin
      .from('business_services')
      .delete()
      .eq('id', serviceId)
      .eq('business_id', businessId);

    if (error) {
      logger.error({ err: String(error) }, 'Error deleting service');
      return c.json({ error: 'Failed to delete service' }, 500);
    }

    return c.json({ success: true });
  } catch (error) {
    logger.error({ err: String(error) }, 'Error in DELETE /services/:serviceId');
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// ============================================
// TIME SLOTS ROUTES
// ============================================

/**
 * GET /api/businesses/:businessId/time-slots
 * Get all time slots for a business
 */
app.get('/:businessId/time-slots', async (c) => {
  try {
    const businessId = c.req.param('businessId');

    const { data: timeSlots, error } = await supabaseAdmin
      .from('business_time_slots')
      .select('*')
      .eq('business_id', businessId)
      .order('day_of_week', { ascending: true });

    if (error) {
      logger.error({ err: String(error) }, 'Error fetching time slots');
      return c.json({ error: 'Failed to fetch time slots' }, 500);
    }

    return c.json({ timeSlots });
  } catch (error) {
    logger.error({ err: String(error) }, 'Error in GET /time-slots');
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * POST /api/businesses/:businessId/time-slots
 * Create a new time slot
 */
app.post('/:businessId/time-slots', async (c) => {
  try {
    const businessId = c.req.param('businessId');
    const body = await c.req.json();

    const { day_of_week, start_time, end_time, slot_duration } = body;

    if (day_of_week === undefined || !start_time || !end_time) {
      return c.json({ error: 'day_of_week, start_time, and end_time are required' }, 400);
    }

    const { data: timeSlot, error } = await supabaseAdmin
      .from('business_time_slots')
      .insert({
        business_id: businessId,
        day_of_week,
        start_time,
        end_time,
        slot_duration: slot_duration || 30,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      logger.error({ err: String(error) }, 'Error creating time slot');
      return c.json({ error: 'Failed to create time slot' }, 500);
    }

    return c.json({ timeSlot }, 201);
  } catch (error) {
    logger.error({ err: String(error) }, 'Error in POST /time-slots');
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * PUT /api/businesses/:businessId/time-slots/:slotId
 * Update a time slot
 */
app.put('/:businessId/time-slots/:slotId', async (c) => {
  try {
    const businessId = c.req.param('businessId');
    const slotId = c.req.param('slotId');
    const body = await c.req.json();

    const { day_of_week, start_time, end_time, slot_duration, is_active } = body;

    const updateData: any = {};
    if (day_of_week !== undefined) updateData.day_of_week = day_of_week;
    if (start_time !== undefined) updateData.start_time = start_time;
    if (end_time !== undefined) updateData.end_time = end_time;
    if (slot_duration !== undefined) updateData.slot_duration = slot_duration;
    if (is_active !== undefined) updateData.is_active = is_active;

    const { data: timeSlot, error } = await supabaseAdmin
      .from('business_time_slots')
      .update(updateData)
      .eq('id', slotId)
      .eq('business_id', businessId)
      .select()
      .single();

    if (error) {
      logger.error({ err: String(error) }, 'Error updating time slot');
      return c.json({ error: 'Failed to update time slot' }, 500);
    }

    return c.json({ timeSlot });
  } catch (error) {
    logger.error({ err: String(error) }, 'Error in PUT /time-slots/:slotId');
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * DELETE /api/businesses/:businessId/time-slots/:slotId
 * Delete a time slot
 */
app.delete('/:businessId/time-slots/:slotId', async (c) => {
  try {
    const businessId = c.req.param('businessId');
    const slotId = c.req.param('slotId');

    const { error } = await supabaseAdmin
      .from('business_time_slots')
      .delete()
      .eq('id', slotId)
      .eq('business_id', businessId);

    if (error) {
      logger.error({ err: String(error) }, 'Error deleting time slot');
      return c.json({ error: 'Failed to delete time slot' }, 500);
    }

    return c.json({ success: true });
  } catch (error) {
    logger.error({ err: String(error) }, 'Error in DELETE /time-slots/:slotId');
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default app;

