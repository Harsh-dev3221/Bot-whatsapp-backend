/**
 * WhatsAppAdapter
 * 
 * Implements MessagingAdapter for WhatsApp channel using Baileys WASocket
 * Wraps existing WhatsApp send logic into the unified adapter interface
 * 
 * Architecture: docs/WEB_CHAT_ARCHITECTURE.txt Section 4
 */

import type { WASocket } from '@whiskeysockets/baileys';
import { logger } from '../utils/logger.js';
import { supabaseAdmin } from '../db/supabase.js';
import type {
  MessagingAdapter,
  SendTextOptions,
  SendRichOptions,
  SendErrorOptions,
  TypingState,
  AdapterContext,
} from './messaging-adapter.js';

export class WhatsAppAdapter implements MessagingAdapter {
  private sock: WASocket;
  private context: AdapterContext;
  private jid: string; // WhatsApp JID (e.g., "1234567890@s.whatsapp.net")

  constructor(sock: WASocket, context: AdapterContext) {
    this.sock = sock;
    this.context = context;
    
    // Format phone number to JID
    const phoneNumber = context.userKey;
    this.jid = phoneNumber.includes('@') 
      ? phoneNumber 
      : `${phoneNumber}@s.whatsapp.net`;
  }

  /**
   * Send a text message via WhatsApp
   */
  async sendText(options: SendTextOptions): Promise<void> {
    try {
      await this.sock.sendMessage(this.jid, {
        text: options.text,
      });

      // Save to database
      await this.saveMessage({
        content: options.text,
        messageType: 'text',
        direction: 'outbound',
        metadata: options.metadata,
      });

      logger.info(
        { 
          botId: this.context.botId, 
          to: this.context.userKey, 
          text: options.text.substring(0, 50) 
        }, 
        'WhatsApp text sent'
      );
    } catch (error) {
      logger.error(
        { 
          err: String(error), 
          botId: this.context.botId, 
          to: this.context.userKey 
        }, 
        'Error sending WhatsApp text'
      );
      throw error;
    }
  }

  /**
   * Send rich content (buttons, lists, etc.) via WhatsApp
   * Note: WhatsApp has specific formats for rich content
   */
  async sendRich(options: SendRichOptions): Promise<void> {
    try {
      // Send the rich content components
      await this.sock.sendMessage(this.jid, options.components);

      logger.info(
        { 
          botId: this.context.botId, 
          to: this.context.userKey 
        }, 
        'WhatsApp rich content sent'
      );
    } catch (error) {
      logger.error(
        { 
          err: String(error), 
          botId: this.context.botId, 
          to: this.context.userKey 
        }, 
        'Error sending WhatsApp rich content'
      );
      throw error;
    }
  }

  /**
   * Send typing indicator
   * WhatsApp supports composing/paused states
   */
  async sendTyping(state: TypingState): Promise<void> {
    try {
      await this.sock.sendPresenceUpdate(
        state === 'start' ? 'composing' : 'paused',
        this.jid
      );

      logger.debug(
        { 
          botId: this.context.botId, 
          to: this.context.userKey, 
          state 
        }, 
        'WhatsApp typing indicator sent'
      );
    } catch (error) {
      logger.error(
        { 
          err: String(error), 
          botId: this.context.botId, 
          to: this.context.userKey 
        }, 
        'Error sending WhatsApp typing indicator'
      );
      // Don't throw - typing indicators are non-critical
    }
  }

  /**
   * Send error message to user
   */
  async sendError(options: SendErrorOptions): Promise<void> {
    try {
      const errorText = `⚠️ ${options.message}`;
      await this.sendText({ text: errorText });

      logger.warn(
        { 
          botId: this.context.botId, 
          to: this.context.userKey, 
          code: options.code 
        }, 
        'WhatsApp error message sent'
      );
    } catch (error) {
      logger.error(
        { 
          err: String(error), 
          botId: this.context.botId, 
          to: this.context.userKey 
        }, 
        'Error sending WhatsApp error message'
      );
      // Don't throw - error messages are best-effort
    }
  }

  /**
   * Get the channel type
   */
  channel(): 'whatsapp' | 'web' {
    return 'whatsapp';
  }

  /**
   * Get the user identifier (phone number)
   */
  getUserKey(): string {
    return this.context.userKey;
  }

  /**
   * Get the bot ID
   */
  getBotId(): string {
    return this.context.botId;
  }

  /**
   * Get the business ID
   */
  getBusinessId(): string {
    return this.context.businessId;
  }

  /**
   * Helper: Save message to database
   */
  private async saveMessage(params: {
    content: string;
    messageType: 'text' | 'image' | 'video' | 'audio' | 'document';
    direction: 'inbound' | 'outbound';
    metadata?: Record<string, any>;
  }): Promise<void> {
    try {
      // Get bot phone number for from_number field
      const { data: bot } = await supabaseAdmin
        .from('bots')
        .select('phone_number')
        .eq('id', this.context.botId)
        .single();

      await supabaseAdmin.from('messages').insert({
        bot_id: this.context.botId,
        business_id: this.context.businessId,
        from_number: params.direction === 'outbound' ? (bot?.phone_number || '') : this.context.userKey,
        to_number: params.direction === 'outbound' ? this.context.userKey : (bot?.phone_number || ''),
        message_type: params.messageType,
        content: params.content,
        direction: params.direction,
        status: 'sent',
        channel: 'whatsapp',
        metadata: params.metadata || null,
      } as any);
    } catch (error) {
      logger.error(
        { 
          err: String(error), 
          botId: this.context.botId 
        }, 
        'Error saving WhatsApp message to database'
      );
      // Don't throw - database save is non-critical for message delivery
    }
  }

  /**
   * Helper: Send media (image, video, document, etc.)
   * This can be used by services that need to send media
   */
  async sendImage(imageUrl: string, caption?: string): Promise<void> {
    try {
      await this.sock.sendMessage(this.jid, {
        image: { url: imageUrl },
        caption: caption || '',
      });

      logger.info(
        { 
          botId: this.context.botId, 
          to: this.context.userKey, 
          imageUrl 
        }, 
        'WhatsApp image sent'
      );
    } catch (error) {
      logger.error(
        { 
          err: String(error), 
          botId: this.context.botId, 
          to: this.context.userKey 
        }, 
        'Error sending WhatsApp image'
      );
      throw error;
    }
  }

  async sendLocation(
    latitude: number,
    longitude: number,
    name?: string,
    address?: string
  ): Promise<void> {
    try {
      await this.sock.sendMessage(this.jid, {
        location: {
          degreesLatitude: latitude,
          degreesLongitude: longitude,
          name: name || 'Location',
          address: address || '',
        },
      });

      logger.info(
        { 
          botId: this.context.botId, 
          to: this.context.userKey, 
          latitude, 
          longitude 
        }, 
        'WhatsApp location sent'
      );
    } catch (error) {
      logger.error(
        { 
          err: String(error), 
          botId: this.context.botId, 
          to: this.context.userKey 
        }, 
        'Error sending WhatsApp location'
      );
      throw error;
    }
  }
}

