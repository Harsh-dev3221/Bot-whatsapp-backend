// Main server entry point

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import pino from 'pino';
import { env, validateEnv } from './config/env.js';

// Import routes
import businessesRoutes from './routes/businesses.js';
import botsRoutes from './routes/bots.js';
import messagesRoutes from './routes/messages.js';
import bookingSettingsRoutes from './routes/booking-settings.js';
import botContextRoutes from './routes/bot-context.js';
import botDashboardRoutes from './routes/bot-dashboard.js';
import webviewRoutes from './routes/webview.js';
import webBotRoutes from './routes/web-bot.js';
import { BotManager } from './services/bot-manager.js';
import { initWebSocketServer } from './websocket/ws-server.js';

const log = pino({ level: 'info' });

// Validate environment variables
try {
  validateEnv();
  log.info('Environment variables validated successfully');
} catch (error: any) {
  log.error(error.message);
  process.exit(1);
}

// Create Hono app
const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors());

// Serve widget.js static file
app.get('/widget.js', async (c) => {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const widgetPath = path.join(process.cwd(), 'public', 'widget.js');

    if (!fs.existsSync(widgetPath)) {
      return c.text('Widget file not found', 404);
    }

    const widgetContent = fs.readFileSync(widgetPath, 'utf-8');
    c.header('Content-Type', 'application/javascript');
    c.header('Cache-Control', 'no-cache, no-store, must-revalidate'); // No cache during development
    c.header('Pragma', 'no-cache');
    c.header('Expires', '0');
    return c.text(widgetContent);
  } catch (error) {
    log.error({ err: String(error) }, 'Error serving widget.js');
    return c.text('Error loading widget', 500);
  }
});

// Health check
app.get('/', (c) => {
  return c.json({
    status: 'ok',
    message: 'WhatsApp Bot SaaS API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (c) => {
  return c.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// API routes
app.route('/api/businesses', businessesRoutes);
app.route('/api/businesses', bookingSettingsRoutes);
app.route('/api/bots', botsRoutes);
app.route('/api/bots', botContextRoutes);
app.route('/api/messages', messagesRoutes);
app.route('/api/bot-dashboard', botDashboardRoutes);
app.route('/api/webview', webviewRoutes);
app.route('/api/web-bot', webBotRoutes);

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not Found', path: c.req.path }, 404);
});

// Error handler
app.onError((err, c) => {
  log.error({ err: err.message }, 'Server error');
  return c.json({
    error: 'Internal Server Error',
    message: err.message,
  }, 500);
});

// Start server
const port = env.server.port;

log.info(`Starting server on port ${port}...`);

// Create HTTP server using Hono's serve
const httpServer = serve({
  fetch: app.fetch,
  port,
}, (info) => {
  log.info(`🚀 Server running at http://localhost:${info.port}`);
  log.info(`📊 Environment: ${env.server.nodeEnv}`);
  log.info(`🔗 Supabase URL: ${env.supabase.url}`);
  log.info(`🔌 WebSocket server initialized at ws://localhost:${port}/api/webview/ws`);

  // Initialize all bots with valid sessions
  BotManager.initializeAllBots().catch((error) => {
    log.error({ err: String(error) }, 'Error initializing bots');
  });
});

// Initialize WebSocket server
initWebSocketServer(httpServer as any);

// Graceful shutdown
process.on('SIGINT', () => {
  log.info('Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  log.info('Shutting down gracefully...');
  process.exit(0);
});

