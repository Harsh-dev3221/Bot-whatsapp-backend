// WhatsApp Bot Manager using Baileys

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WASocket,
  type ConnectionState,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import QRCode from 'qrcode';
import { supabaseAdmin } from '../db/supabase.js';
import { AIService } from './ai-service.js';
import { BookingService } from './booking-service.js';
import { WorkflowEngine } from './workflow-engine.js';
import { BookingStateManager } from './booking-state-manager.js';
import { MediaService } from './media-service.js';
import { AIContextService } from './ai-context-service.js';
import { WhatsAppAdapter } from '../adapters/whatsapp-adapter.js';

const logger = pino({ level: 'info' });

// Store active bot instances
const activeBots = new Map<string, WASocket>();

// Store pairing codes temporarily
const pairingCodes = new Map<string, string>();

// Store conversation history for AI context
const conversationHistory = new Map<string, string[]>();

// Store bot start timestamps to ignore old messages
const botStartTimestamps = new Map<string, number>();

export class BotManager {
  /**
   * Initialize and auto-start all bots with valid sessions
   */
  static async initializeAllBots(): Promise<void> {
    try {
      logger.info('Initializing all bots with valid sessions...');

      // Get all bots from database
      const { data: bots, error } = await supabaseAdmin
        .from('bots')
        .select('*')
        .in('status', ['connected', 'connecting', 'pairing']);

      if (error) {
        logger.error({ err: String(error) }, 'Error fetching bots for initialization');
        return;
      }

      if (!bots || bots.length === 0) {
        logger.info('No bots to initialize');
        return;
      }

      // Check which bots have valid sessions
      const fs = await import('fs');
      for (const bot of bots) {
        const authPath = `./sessions/${bot.id}`;
        const credsPath = `${authPath}/creds.json`;

        // Check if session exists
        if (fs.existsSync(credsPath)) {
          logger.info(`Auto-starting bot ${bot.id} with existing session`);

          // Start bot in background (don't wait)
          this.startBot(bot.id).catch((error) => {
            logger.error({ err: String(error), botId: bot.id }, 'Error auto-starting bot');
          });
        } else {
          logger.info(`Bot ${bot.id} has no valid session, skipping auto-start`);

          // Update status to disconnected
          await supabaseAdmin
            .from('bots')
            .update({ status: 'disconnected' } as any)
            .eq('id', bot.id);
        }
      }

      logger.info(`Initialized ${bots.length} bots`);
    } catch (error) {
      logger.error({ err: String(error) }, 'Error initializing bots');
    }
  }

  /**
   * Start a WhatsApp bot instance with QR code
   */
  static async startBot(botId: string, usePairingCode: boolean = false, phoneNumber?: string): Promise<{ qrCode?: string; pairingCode?: string; success: boolean }> {
    try {
      // Check if bot is already running
      if (activeBots.has(botId)) {
        logger.info(`Bot ${botId} is already running`);
        return { success: true };
      }

      // Get bot from database
      const { data: bot, error } = await supabaseAdmin
        .from('bots')
        .select('*')
        .eq('id', botId)
        .single();

      if (error || !bot) {
        throw new Error(`Bot ${botId} not found`);
      }

      // Update bot status to connecting
      await supabaseAdmin
        .from('bots')
        .update({ status: 'connecting', qr_code: null } as any)
        .eq('id', botId);

      // Load or create auth state
      const authPath = `./sessions/${botId}`;
      const { state, saveCreds } = await useMultiFileAuthState(authPath);

      // Get latest Baileys version
      const { version } = await fetchLatestBaileysVersion();

      // Create socket connection
      // IMPORTANT: Browser config must be Ubuntu/Chrome/20.0.04 for pairing code to work
      // See: https://github.com/WhiskeySockets/Baileys/issues/1761
      const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        generateHighQualityLinkPreview: true,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
      });

      // Store socket instance
      activeBots.set(botId, sock);

      // Request pairing code if specified
      if (usePairingCode && phoneNumber) {
        try {
          // Check if already registered
          if (state.creds.registered) {
            logger.info(`Bot ${botId} is already registered, skipping pairing code`);
            return { success: true };
          }

          // Wait for connection to be ready (connecting state or QR available)
          // This ensures the socket is fully initialized before requesting pairing code
          await new Promise((resolve) => {
            let resolved = false;

            // Listen for connection update event
            const connectionHandler = (update: any) => {
              if (!resolved && (update.connection === 'connecting' || update.qr)) {
                resolved = true;
                sock.ev.off('connection.update', connectionHandler);
                resolve(true);
              }
            };

            sock.ev.on('connection.update', connectionHandler);

            // Timeout after 10 seconds
            setTimeout(() => {
              if (!resolved) {
                resolved = true;
                sock.ev.off('connection.update', connectionHandler);
                resolve(true); // Continue anyway
              }
            }, 10000);
          });

          const code = await sock.requestPairingCode(phoneNumber);
          pairingCodes.set(botId, code);
          logger.info(`Pairing code generated for bot ${botId}: ${code}`);

          await supabaseAdmin
            .from('bots')
            .update({ status: 'pairing', qr_code: null } as any)
            .eq('id', botId);

          return { success: true, pairingCode: code };
        } catch (error) {
          logger.error({ err: String(error) }, `Error generating pairing code for bot ${botId}`);
          // Don't throw, let connection continue
          await supabaseAdmin
            .from('bots')
            .update({ status: 'failed' } as any)
            .eq('id', botId);
          return { success: false };
        }
      }

      // Handle QR code generation and connection updates
      sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
        const { connection, lastDisconnect, qr, isNewLogin } = update;

        // Generate and save QR code
        if (qr) {
          try {
            const qrCodeDataUrl = await QRCode.toDataURL(qr);
            await supabaseAdmin
              .from('bots')
              .update({ qr_code: qrCodeDataUrl, status: 'connecting' } as any)
              .eq('id', botId);

            logger.info(`QR code generated for bot ${botId}`);
          } catch (error) {
            logger.error({ err: String(error) }, `Error generating QR code for bot ${botId}`);
          }
        }

        // Handle new login (pairing success)
        if (isNewLogin) {
          logger.info(`New login detected for bot ${botId}`);
          pairingCodes.delete(botId);
        }

        // Handle connection status
        if (connection === 'close') {
          const shouldReconnect =
            (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const isRestartRequired = statusCode === DisconnectReason.restartRequired;

          logger.info(`Bot ${botId} connection closed. Status: ${statusCode}, Reconnect: ${shouldReconnect}, RestartRequired: ${isRestartRequired}`);

          if (shouldReconnect) {
            // Remove from active bots before reconnecting
            activeBots.delete(botId);

            // If restart is required (after pairing code), reconnect immediately without pairing code
            if (isRestartRequired) {
              logger.info(`Bot ${botId} restart required after pairing - reconnecting...`);
              setTimeout(() => this.startBot(botId, false), 1000);
            } else {
              // Normal reconnection
              setTimeout(() => this.startBot(botId), 3000);
            }
          } else {
            // Logged out - remove from active bots
            activeBots.delete(botId);
            await supabaseAdmin
              .from('bots')
              .update({ status: 'disconnected', qr_code: null } as any)
              .eq('id', botId);
          }
        } else if (connection === 'open') {
          logger.info(`Bot ${botId} connected successfully`);

          // Clear pairing code if it exists
          pairingCodes.delete(botId);

          await supabaseAdmin
            .from('bots')
            .update({
              status: 'connected',
              qr_code: null,
              last_connected_at: new Date().toISOString(),
            } as any)
            .eq('id', botId);

          // Save session to database
          await this.saveSession(botId, state.creds);

          // Store bot start timestamp AFTER connection is open to ignore old messages
          // This ensures we only reply to messages sent AFTER the bot is fully connected
          botStartTimestamps.set(botId, Date.now());
          logger.info(`Bot ${botId} start timestamp set: ${Date.now()} (${new Date().toISOString()})`);
        }
      });

      // Handle credentials update
      sock.ev.on('creds.update', saveCreds);

      // Handle incoming messages
      sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
          if (!msg.message || msg.key.fromMe) continue;

          await this.handleIncomingMessage(botId, (bot as any).business_id, sock, msg);
        }
      });

      return { success: true };
    } catch (error) {
      logger.error({ err: String(error) }, `Error starting bot ${botId}`);
      await supabaseAdmin
        .from('bots')
        .update({ status: 'failed' } as any)
        .eq('id', botId);

      return { success: false };
    }
  }

  /**
   * Stop a WhatsApp bot instance (temporary pause)
   * This closes the connection but preserves the session
   * Bot can be restarted without re-authentication
   */
  static async stopBot(botId: string): Promise<boolean> {
    try {
      const sock = activeBots.get(botId);
      if (sock) {
        // IMPORTANT: Remove from activeBots FIRST to stop processing messages
        activeBots.delete(botId);
        logger.info(`Bot ${botId} removed from active bots`);

        // Remove start timestamp
        botStartTimestamps.delete(botId);
        logger.info(`Bot ${botId} start timestamp cleared`);

        // Remove all event listeners to stop processing
        sock.ev.removeAllListeners('messages.upsert');
        sock.ev.removeAllListeners('connection.update');
        sock.ev.removeAllListeners('creds.update');
        logger.info(`Bot ${botId} event listeners removed`);

        // Close connection without logging out (preserves session)
        // Using end() instead of logout() keeps the session valid
        sock.end(undefined);
        logger.info(`Bot ${botId} connection closed (session preserved)`);
      }

      await supabaseAdmin
        .from('bots')
        .update({ status: 'disconnected', qr_code: null } as any)
        .eq('id', botId);

      logger.info(`Bot ${botId} stopped (can restart without re-auth)`);
      return true;
    } catch (error) {
      logger.error({ err: String(error) }, `Error stopping bot ${botId}`);
      return false;
    }
  }

  /**
   * Send a message from a bot
   */
  static async sendMessage(
    botId: string,
    toNumber: string,
    content: string,
    messageType: 'text' = 'text'
  ): Promise<boolean> {
    try {
      const sock = activeBots.get(botId);
      if (!sock) {
        throw new Error(`Bot ${botId} is not connected`);
      }

      // Format phone number (add @s.whatsapp.net)
      const jid = toNumber.includes('@') ? toNumber : `${toNumber}@s.whatsapp.net`;

      // Send message
      await sock.sendMessage(jid, { text: content });

      // Save to database
      const { data: bot } = await supabaseAdmin
        .from('bots')
        .select('business_id, phone_number')
        .eq('id', botId)
        .single();

      if (bot) {
        await supabaseAdmin.from('messages').insert({
          bot_id: botId,
          business_id: (bot as any).business_id,
          from_number: (bot as any).phone_number,
          to_number: toNumber,
          message_type: messageType,
          content,
          direction: 'outbound',
          status: 'sent',
        } as any);
      }

      return true;
    } catch (error) {
      logger.error({ err: String(error) }, `Error sending message from bot ${botId}`);
      return false;
    }
  }

  /**
   * Handle incoming messages with AI
   */
  private static async handleIncomingMessage(
    botId: string,
    businessId: string,
    sock: WASocket,
    msg: any
  ) {
    try {
      // Get message timestamp (in seconds, convert to milliseconds)
      const messageTimestamp = (msg.messageTimestamp as number) * 1000;
      const botStartTime = botStartTimestamps.get(botId);

      // Ignore messages that came before bot started (old messages from queue)
      if (botStartTime && messageTimestamp < botStartTime) {
        logger.info({
          botId,
          messageTimestamp: new Date(messageTimestamp).toISOString(),
          botStartTime: new Date(botStartTime).toISOString(),
          timeDifference: `${Math.round((botStartTime - messageTimestamp) / 1000)}s ago`,
        }, 'Ignoring old message (received before bot started)');
        return;
      }

      // Additional safety: If no bot start time is set, ignore the message
      // This shouldn't happen, but it's a safety net
      if (!botStartTime) {
        logger.warn({
          botId,
          messageTimestamp: new Date(messageTimestamp).toISOString(),
        }, 'No bot start timestamp found, ignoring message for safety');
        return;
      }

      const fromNumber = msg.key.remoteJid?.replace('@s.whatsapp.net', '') || '';
      const messageContent =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        '';

      if (!messageContent) return;

      // ====================================================================
      // PRIORITY 1: Check if booking is enabled and handle booking FIRST
      // This ensures booking system takes precedence over workflows
      // ====================================================================
      const bookingEnabled = await BookingService.isBookingEnabled(botId);
      logger.info({ botId, bookingEnabled }, 'Booking enabled check');

      if (bookingEnabled) {
        // Check if user has active booking conversation
        const hasActiveBooking = await BookingStateManager.hasActiveConversation(botId, fromNumber);
        logger.info({ botId, fromNumber, hasActiveBooking }, 'Active booking check');

        if (hasActiveBooking) {
          // User is in booking conversation, handle it
          logger.info({ botId, fromNumber }, 'Handling active booking conversation');

          // Create WhatsAppAdapter for booking service
          const adapter = new WhatsAppAdapter(sock, {
            botId,
            businessId,
            userKey: fromNumber,
          });

          await BookingService.handleBookingMessage(adapter, messageContent);
          return; // Don't process with regular AI or workflow
        }

        // Check if message is a booking trigger (keyword-based)
        const keywords = await BookingService.getBookingKeywords(botId);
        const isBookingTrigger = BookingService.isBookingTrigger(messageContent, keywords);
        logger.info({ botId, messageContent, keywords, isBookingTrigger }, 'Booking trigger check');

        if (isBookingTrigger) {
          // Start booking conversation
          logger.info({ botId, fromNumber }, 'Starting new booking conversation (keyword trigger)');

          // Create WhatsAppAdapter for booking service
          const adapter = new WhatsAppAdapter(sock, {
            botId,
            businessId,
            userKey: fromNumber,
          });

          await BookingService.handleBookingMessage(adapter, messageContent);
          return; // Don't process with regular AI or workflow
        }
      }

      // ====================================================================
      // PRIORITY 2: Try WorkflowEngine for other intents (default ON)
      // This only runs if booking didn't handle the message
      // ====================================================================
      try {
        const adapter = new WhatsAppAdapter(sock, {
          botId,
          businessId,
          userKey: fromNumber,
        });
        const handled = await WorkflowEngine.tryHandle(adapter, messageContent);
        if (handled) return;
      } catch (e) {
        logger.warn({ botId, err: String(e) }, 'WorkflowEngine tryHandle failed, falling back');
      }

      // Save message to database
      await supabaseAdmin.from('messages').insert({
        bot_id: botId,
        business_id: businessId,
        from_number: fromNumber,
        to_number: '',
        message_type: 'text',
        content: messageContent,
        direction: 'inbound',
        status: 'delivered',
      } as any);

      // Get or initialize conversation history
      const historyKey = `${botId}-${fromNumber}`;
      if (!conversationHistory.has(historyKey)) {
        conversationHistory.set(historyKey, []);
      }
      const history = conversationHistory.get(historyKey)!;
      history.push(`User: ${messageContent}`);

      // Keep only last 10 messages
      if (history.length > 10) {
        history.shift();
      }

      // Get bot settings
      const { data: settings } = await supabaseAdmin
        .from('bot_settings')
        .select('*')
        .eq('bot_id', botId)
        .single();

      const aiEnabled = (settings as any)?.ai_enabled !== false; // Default to true
      const autoReplyEnabled = (settings as any)?.auto_reply_enabled;
      const autoReplyMessage = (settings as any)?.auto_reply_message;

      let responseText = '';

      if (aiEnabled) {
        // Use AI to detect intent and generate response
        try {
          // Get business context for AI
          const aiContext = await AIContextService.getBotAIContext(botId);
          const businessContextForAI = aiContext ? {
            name: aiContext.businessName,
            description: aiContext.businessDescription,
            industry: aiContext.businessType,
            services: [], // Can be populated from bot settings if needed
            location: aiContext.businessAddress,
            contact_email: null,
            contact_phone: null,
          } : undefined;

          const intentResult = await AIService.detectIntent(messageContent, botId, history, businessContextForAI);

          logger.info({
            botId,
            fromNumber,
            intent: intentResult.intention,
            confidence: intentResult.confidence,
            sentiment: intentResult.sentiment,
          }, 'AI intent detected');

          // Check if AI detected BOOKING_REQUEST intent
          if (bookingEnabled && intentResult.intention === 'BOOKING_REQUEST' && intentResult.confidence >= 0.7) {
            logger.info({ botId, fromNumber, confidence: intentResult.confidence }, 'Starting booking conversation (AI intent)');

            // Create WhatsAppAdapter for booking service
            const adapter = new WhatsAppAdapter(sock, {
              botId,
              businessId,
              userKey: fromNumber,
            });

            await BookingService.handleBookingMessage(adapter, messageContent);
            return; // Don't process with regular AI
          }

          // Handle OFF_TOPIC - strictly redirect
          if (intentResult.intention === 'OFF_TOPIC') {
            const aiContext = await AIContextService.getBotAIContext(botId);
            const businessType = aiContext?.businessType || 'our business';

            const redirectMessage = `I'm here to help with ${businessType} related inquiries. ` +
              `I can assist you with services, booking, pricing, location, and more. ` +
              `How can I help you today?`;

            await MediaService.sendText(sock, fromNumber, redirectMessage);
            return; // Don't process further
          }

          // Handle location requests
          if (intentResult.intention === 'LOCATION_REQUEST') {
            const media = await AIContextService.getBotMedia(botId, 'location');
            if (media.length > 0) {
              const location = media[0];
              if (location.locationLatitude && location.locationLongitude) {
                await MediaService.sendText(sock, fromNumber, intentResult.suggestedResponse);
                await MediaService.sendLocation(
                  sock,
                  fromNumber,
                  location.locationLatitude,
                  location.locationLongitude,
                  location.locationName || undefined,
                  location.locationAddress || undefined
                );
                return; // Don't send additional text response
              }
            }
          }

          // Handle service inquiries with images
          if (intentResult.intention === 'SERVICE_INQUIRY') {
            const media = await AIContextService.getBotMedia(botId, 'image');
            if (media.length > 0) {
              await MediaService.sendText(sock, fromNumber, intentResult.suggestedResponse);
              for (const image of media.slice(0, 3)) { // Send max 3 images
                if (image.fileUrl) {
                  await MediaService.sendImage(
                    sock,
                    fromNumber,
                    image.fileUrl,
                    image.description || image.title || undefined
                  );
                }
              }
              return; // Don't send additional text response
            }
          }

          // Generate AI response
          responseText = await AIService.generateResponse(
            messageContent,
            intentResult.intention,
            botId,
            history
          );

          // Save intent data
          await supabaseAdmin.from('messages').update({
            metadata: {
              intent: intentResult.intention,
              confidence: intentResult.confidence,
              sentiment: intentResult.sentiment,
            },
          } as any).eq('bot_id', botId).eq('from_number', fromNumber).order('created_at', { ascending: false }).limit(1);

        } catch (aiError) {
          logger.error({ err: String(aiError) }, 'AI processing error, falling back to default');
          responseText = autoReplyMessage || 'Thank you for your message. How can I help you?';
        }
      } else if (autoReplyEnabled && autoReplyMessage) {
        // Use simple auto-reply
        responseText = autoReplyMessage;
      }

      // Send response if we have one
      if (responseText) {
        await sock.sendMessage(msg.key.remoteJid!, {
          text: responseText,
        });

        // Add bot response to history
        history.push(`Bot: ${responseText}`);

        // Save bot response to database
        await supabaseAdmin.from('messages').insert({
          bot_id: botId,
          business_id: businessId,
          from_number: '',
          to_number: fromNumber,
          message_type: 'text',
          content: responseText,
          direction: 'outbound',
          status: 'sent',
        } as any);
      }

      logger.info(`Message processed for bot ${botId} from ${fromNumber}`);
    } catch (error) {
      logger.error({ err: String(error) }, `Error handling incoming message for bot ${botId}`);
    }
  }

  /**
   * Save session data to database
   */
  private static async saveSession(botId: string, creds: any) {
    try {
      await supabaseAdmin
        .from('bot_sessions')
        .upsert({
          bot_id: botId,
          session_data: creds,
        } as any);
    } catch (error) {
      logger.error({ err: String(error) }, `Error saving session for bot ${botId}`);
    }
  }

  /**
   * Get active bot instance
   */
  static getBot(botId: string): WASocket | undefined {
    return activeBots.get(botId);
  }

  /**
   * Check if bot is active
   */
  static isBotActive(botId: string): boolean {
    return activeBots.has(botId);
  }

  /**
   * Get all active bot IDs
   */
  static getActiveBotIds(): string[] {
    return Array.from(activeBots.keys());
  }

  /**
   * Get pairing code for a bot
   */
  static getPairingCode(botId: string): string | undefined {
    return pairingCodes.get(botId);
  }

  /**
   * Request pairing code for existing bot
   */
  static async requestPairingCode(botId: string, phoneNumber: string): Promise<{ success: boolean; pairingCode?: string }> {
    try {
      // Clean phone number - remove +, spaces, dashes
      const cleanPhone = phoneNumber.replace(/[\+\s\-\(\)]/g, '');

      logger.info(`Requesting pairing code for bot ${botId} with phone ${cleanPhone}`);

      // Check if bot is already running
      const existingSock = activeBots.get(botId);
      if (existingSock) {
        // Stop existing connection first
        logger.info(`Stopping existing bot ${botId} before requesting pairing code`);

        // Remove from active bots first
        activeBots.delete(botId);

        // Close connection gracefully without waiting
        try {
          existingSock.end(undefined);
        } catch (e) {
          // Ignore errors
          logger.warn({ err: String(e) }, `Error closing existing connection for bot ${botId}`);
        }

        // Wait for connection to fully close
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Delete existing session to start fresh
      const authPath = `./sessions/${botId}`;
      try {
        const fs = await import('fs');
        if (fs.existsSync(authPath)) {
          logger.info(`Deleting existing session for bot ${botId}`);
          fs.rmSync(authPath, { recursive: true, force: true });
        }
      } catch (e) {
        logger.warn({ err: String(e) }, `Error deleting session for bot ${botId}`);
      }

      // Start bot with pairing code
      return await this.startBot(botId, true, cleanPhone);
    } catch (error) {
      logger.error({ err: String(error) }, `Error requesting pairing code for bot ${botId}`);
      return { success: false };
    }
  }
}

