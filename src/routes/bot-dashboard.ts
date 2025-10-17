// Bot Dashboard Routes - Booking management for bot owners
// Secured with bot-specific authentication

import { Hono } from 'hono';
import { supabaseAdmin } from '../db/supabase.js';
import bcrypt from 'bcryptjs';
import pino from 'pino';

const logger = pino({ level: 'info' });
const app = new Hono();

/**
 * Authentication middleware for bot dashboard
 * Username: bot phone number
 * Password: bot-specific password
 */
const botAuthMiddleware = async (c: any, next: any) => {
  const botId = c.req.param('botId');

  if (!botId) {
    return c.json({ error: 'Bot ID is required' }, 400);
  }

  // Get authorization header
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  // Decode basic auth
  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [username, password] = credentials.split(':');

  try {
    // Get bot and credentials
    const { data: bot, error: botError } = await supabaseAdmin
      .from('bots')
      .select('id, phone_number, business_id')
      .eq('id', botId)
      .single();

    if (botError || !bot) {
      return c.json({ error: 'Bot not found' }, 404);
    }

    // Verify username matches bot phone number
    if (username !== bot.phone_number) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    // Get bot credentials
    const { data: credentials, error: credError } = await supabaseAdmin
      .from('bot_credentials')
      .select('password_hash, default_password, password_changed')
      .eq('bot_id', botId)
      .single();

    if (credError || !credentials) {
      return c.json({ error: 'Bot credentials not found' }, 404);
    }

    // Verify password
    let isValid = false;
    if (credentials.password_changed) {
      // Use bcrypt for changed passwords
      isValid = await bcrypt.compare(password, credentials.password_hash);
    } else {
      // For default passwords, compare directly
      isValid = password === credentials.default_password;
    }

    if (!isValid) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    // Update last login
    await supabaseAdmin
      .from('bot_credentials')
      .update({ last_login_at: new Date().toISOString() })
      .eq('bot_id', botId);

    // Store bot info in context
    c.set('bot', bot);
    c.set('botId', botId);
    c.set('businessId', bot.business_id);

    await next();
  } catch (error: any) {
    logger.error({ err: String(error) }, 'Auth middleware error');
    return c.json({ error: 'Authentication failed' }, 500);
  }
};

// ============================================
// AUTHENTICATION ROUTES
// ============================================

/**
 * POST /api/bot-dashboard/:botId/login
 * Verify credentials and return bot info
 */
app.post('/:botId/login', async (c) => {
  const botId = c.req.param('botId');
  const { username, password } = await c.req.json();

  if (!username || !password) {
    return c.json({ error: 'Username and password are required' }, 400);
  }

  try {
    // Get bot and credentials
    const { data: bot, error: botError } = await supabaseAdmin
      .from('bots')
      .select('id, name, phone_number, business_id, status')
      .eq('id', botId)
      .single();

    if (botError || !bot) {
      return c.json({ error: 'Bot not found' }, 404);
    }

    // Verify username
    if (username !== bot.phone_number) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    // Get credentials
    const { data: credentials, error: credError } = await supabaseAdmin
      .from('bot_credentials')
      .select('password_hash, default_password, password_changed')
      .eq('bot_id', botId)
      .single();

    if (credError || !credentials) {
      return c.json({ error: 'Bot credentials not found' }, 404);
    }

    // Verify password
    let isValid = false;
    if (credentials.password_changed) {
      isValid = await bcrypt.compare(password, credentials.password_hash);
    } else {
      isValid = password === credentials.default_password;
    }

    if (!isValid) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    // Update last login
    await supabaseAdmin
      .from('bot_credentials')
      .update({ last_login_at: new Date().toISOString() })
      .eq('bot_id', botId);

    return c.json({
      success: true,
      data: {
        botId: bot.id,
        botName: bot.name,
        phoneNumber: bot.phone_number,
        status: bot.status,
        needsPasswordChange: !credentials.password_changed,
      },
    });
  } catch (error: any) {
    logger.error({ err: String(error) }, 'Login error');
    return c.json({ error: 'Login failed' }, 500);
  }
});

/**
 * PUT /api/bot-dashboard/:botId/change-password
 * Change bot dashboard password
 */
app.put('/:botId/change-password', botAuthMiddleware, async (c) => {
  const botId = c.req.param('botId');
  const { currentPassword, newPassword } = await c.req.json();

  if (!currentPassword || !newPassword) {
    return c.json({ error: 'Current and new passwords are required' }, 400);
  }

  if (newPassword.length < 8) {
    return c.json({ error: 'New password must be at least 8 characters' }, 400);
  }

  try {
    // Get current credentials
    const { data: credentials, error } = await supabaseAdmin
      .from('bot_credentials')
      .select('password_hash, default_password, password_changed')
      .eq('bot_id', botId)
      .single();

    if (error || !credentials) {
      return c.json({ error: 'Credentials not found' }, 404);
    }

    // Verify current password
    let isValid = false;
    if (credentials.password_changed) {
      isValid = await bcrypt.compare(currentPassword, credentials.password_hash);
    } else {
      isValid = currentPassword === credentials.default_password;
    }

    if (!isValid) {
      return c.json({ error: 'Current password is incorrect' }, 401);
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await supabaseAdmin
      .from('bot_credentials')
      .update({
        password_hash: hashedPassword,
        password_changed: true,
        default_password: null, // Clear default password
      })
      .eq('bot_id', botId);

    return c.json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error: any) {
    logger.error({ err: String(error) }, 'Change password error');
    return c.json({ error: 'Failed to change password' }, 500);
  }
});

// ============================================
// BOOKING MANAGEMENT ROUTES (Protected)
// ============================================

/**
 * GET /api/bot-dashboard/:botId/bookings
 * Get all bookings for the bot with filters
 */
app.get('/:botId/bookings', botAuthMiddleware, async (c) => {
  const botId = c.req.param('botId');
  const status = c.req.query('status'); // pending, confirmed, completed, cancelled, no_show
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');
  const search = c.req.query('search'); // Search by customer name or phone
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '50');

  try {
    let query = supabaseAdmin
      .from('bookings')
      .select('*', { count: 'exact' })
      .eq('bot_id', botId)
      .order('booking_date', { ascending: false })
      .order('booking_time', { ascending: false });

    // Apply filters
    if (status) {
      query = query.eq('status', status);
    }

    if (startDate) {
      query = query.gte('booking_date', startDate);
    }

    if (endDate) {
      query = query.lte('booking_date', endDate);
    }

    if (search) {
      query = query.or(`customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%`);
    }

    // Pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data: bookings, error, count } = await query;

    if (error) {
      logger.error({ err: String(error) }, 'Error fetching bookings');
      return c.json({ error: 'Failed to fetch bookings' }, 500);
    }

    return c.json({
      success: true,
      data: {
        data: bookings,
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limit),
        },
      },
    });
  } catch (error: any) {
    logger.error({ err: String(error) }, 'Error in GET /bookings');
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /api/bot-dashboard/:botId/bookings/stats
 * Get booking statistics
 * NOTE: This must come BEFORE /:bookingId route to avoid matching "stats" as an ID
 */
app.get('/:botId/bookings/stats', botAuthMiddleware, async (c) => {
  const botId = c.req.param('botId');

  try {
    // Total bookings
    const { count: totalBookings } = await supabaseAdmin
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('bot_id', botId);

    // Pending bookings
    const { count: pendingBookings } = await supabaseAdmin
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('bot_id', botId)
      .eq('status', 'pending');

    // Confirmed bookings
    const { count: confirmedBookings } = await supabaseAdmin
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('bot_id', botId)
      .eq('status', 'confirmed');

    // Completed bookings
    const { count: completedBookings } = await supabaseAdmin
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('bot_id', botId)
      .eq('status', 'completed');

    // Cancelled bookings
    const { count: cancelledBookings } = await supabaseAdmin
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('bot_id', botId)
      .eq('status', 'cancelled');

    // Today's bookings
    const today = new Date().toISOString().split('T')[0];
    const { count: todayBookings } = await supabaseAdmin
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('bot_id', botId)
      .gte('booking_date', today)
      .lte('booking_date', today);

    // Upcoming bookings (confirmed, date >= today)
    const { count: upcomingBookings } = await supabaseAdmin
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('bot_id', botId)
      .eq('status', 'confirmed')
      .gte('booking_date', today);

    // Total revenue (completed bookings)
    const { data: completedBookingsData } = await supabaseAdmin
      .from('bookings')
      .select('price')
      .eq('bot_id', botId)
      .eq('status', 'completed');

    const totalRevenue = completedBookingsData?.reduce((sum, booking) => sum + (booking.price || 0), 0) || 0;

    return c.json({
      success: true,
      data: {
        total: totalBookings || 0,
        pending: pendingBookings || 0,
        confirmed: confirmedBookings || 0,
        completed: completedBookings || 0,
        cancelled: cancelledBookings || 0,
        today: todayBookings || 0,
        upcoming: upcomingBookings || 0,
        totalRevenue,
      },
    });
  } catch (error: any) {
    logger.error({ err: String(error) }, 'Error fetching booking stats');
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /api/bot-dashboard/:botId/bookings/:bookingId
 * Get single booking details
 */
app.get('/:botId/bookings/:bookingId', botAuthMiddleware, async (c) => {
  const botId = c.req.param('botId');
  const bookingId = c.req.param('bookingId');

  try {
    const { data: booking, error } = await supabaseAdmin
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .eq('bot_id', botId)
      .single();

    if (error || !booking) {
      return c.json({ error: 'Booking not found' }, 404);
    }

    return c.json({
      success: true,
      data: booking,
    });
  } catch (error: any) {
    logger.error({ err: String(error) }, 'Error fetching booking');
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * PUT /api/bot-dashboard/:botId/bookings/:bookingId/status
 * Update booking status
 */
app.put('/:botId/bookings/:bookingId/status', botAuthMiddleware, async (c) => {
  const botId = c.req.param('botId');
  const bookingId = c.req.param('bookingId');
  const { status, notes } = await c.req.json();

  const validStatuses = ['pending', 'confirmed', 'cancelled', 'completed', 'no_show'];
  if (!status || !validStatuses.includes(status)) {
    return c.json({ error: 'Invalid status. Must be one of: ' + validStatuses.join(', ') }, 400);
  }

  try {
    const updateData: any = { status };
    if (notes !== undefined) {
      updateData.notes = notes;
    }

    const { data: booking, error } = await supabaseAdmin
      .from('bookings')
      .update(updateData)
      .eq('id', bookingId)
      .eq('bot_id', botId)
      .select()
      .single();

    if (error || !booking) {
      return c.json({ error: 'Booking not found or update failed' }, 404);
    }

    return c.json({
      success: true,
      data: booking,
      message: 'Booking status updated successfully',
    });
  } catch (error: any) {
    logger.error({ err: String(error) }, 'Error updating booking status');
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /api/bot-dashboard/:botId/analytics/customers
 * Get customer retention analytics
 */
app.get('/:botId/analytics/customers', botAuthMiddleware, async (c) => {
  const botId = c.req.param('botId');

  try {
    // Get all bookings grouped by customer
    const { data: bookings, error } = await supabaseAdmin
      .from('bookings')
      .select('customer_phone, customer_name, status, booking_date, created_at')
      .eq('bot_id', botId)
      .order('created_at', { ascending: true });

    if (error) {
      logger.error({ err: String(error) }, 'Error fetching customer analytics');
      return c.json({ error: 'Failed to fetch analytics' }, 500);
    }

    // Group by customer phone
    const customerMap = new Map<string, any>();

    bookings?.forEach((booking) => {
      const phone = booking.customer_phone;
      if (!customerMap.has(phone)) {
        customerMap.set(phone, {
          customerPhone: phone,
          customerName: booking.customer_name,
          totalBookings: 0,
          completedBookings: 0,
          cancelledBookings: 0,
          firstBooking: booking.created_at,
          lastBooking: booking.created_at,
        });
      }

      const customer = customerMap.get(phone);
      customer.totalBookings++;
      if (booking.status === 'completed') customer.completedBookings++;
      if (booking.status === 'cancelled') customer.cancelledBookings++;
      if (new Date(booking.created_at) > new Date(customer.lastBooking)) {
        customer.lastBooking = booking.created_at;
      }
    });

    // Convert to array and sort by total bookings
    const customers = Array.from(customerMap.values())
      .sort((a, b) => b.totalBookings - a.totalBookings);

    // Calculate retention metrics
    const totalCustomers = customers.length;
    const repeatCustomers = customers.filter(c => c.totalBookings > 1).length;
    const retentionRate = totalCustomers > 0 ? (repeatCustomers / totalCustomers) * 100 : 0;

    // Top customers (top 10)
    const topCustomers = customers.slice(0, 10);

    return c.json({
      success: true,
      data: {
        totalCustomers,
        repeatCustomers,
        retentionRate: Math.round(retentionRate * 100) / 100,
        topCustomers,
        allCustomers: customers,
      },
    });
  } catch (error: any) {
    logger.error({ err: String(error) }, 'Error in customer analytics');
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /api/bot-dashboard/:botId/analytics/trends
 * Get booking trends over time
 */
app.get('/:botId/analytics/trends', botAuthMiddleware, async (c) => {
  const botId = c.req.param('botId');
  const days = parseInt(c.req.query('days') || '30');

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data: bookings, error } = await supabaseAdmin
      .from('bookings')
      .select('booking_date, status, created_at')
      .eq('bot_id', botId)
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: true });

    if (error) {
      logger.error({ err: String(error) }, 'Error fetching trends');
      return c.json({ error: 'Failed to fetch trends' }, 500);
    }

    // Group by date
    const trendMap = new Map<string, any>();

    bookings?.forEach((booking) => {
      const date = booking.created_at.split('T')[0];
      if (!trendMap.has(date)) {
        trendMap.set(date, {
          date,
          total: 0,
          pending: 0,
          confirmed: 0,
          completed: 0,
          cancelled: 0,
        });
      }

      const trend = trendMap.get(date);
      trend.total++;
      trend[booking.status]++;
    });

    const trends = Array.from(trendMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    return c.json({
      success: true,
      data: trends,
    });
  } catch (error: any) {
    logger.error({ err: String(error) }, 'Error in trends analytics');
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default app;

