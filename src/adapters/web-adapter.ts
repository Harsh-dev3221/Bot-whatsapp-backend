/**
 * WebAdapter
 * 
 * Implements MessagingAdapter for Web channel using WebSocket
 * Sends JSON events over WebSocket connection to browser client
 * 
 * Architecture: docs/WEB_CHAT_ARCHITECTURE.txt Section 4 & 7
 */

import { logger } from '../utils/logger.js';
import { supabaseAdmin } from '../db/supabase.js';
import { sendEventToSession } from '../websocket/ws-server.js';
import type {
  MessagingAdapter,
  SendTextOptions,
  SendRichOptions,
  SendErrorOptions,
  TypingState,
  AdapterContext,
} from './messaging-adapter.js';

/**
 * WebSocket event types (Server → Client)
 */
export interface WebSocketEvent {
  type: 'bot_message' | 'typing' | 'error' | 'ended' | 'ack' | 'pong';
  id?: string;
  text?: string;
  ts?: string;
  partial?: boolean;
  final?: boolean;
  state?: TypingState;
  code?: string;
  message?: string;
  reason?: string;
}

/**
 * WebSocket connection interface
 * This will be implemented by the actual WebSocket server
 */
export interface WebSocketConnection {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export class WebAdapter implements MessagingAdapter {
  private context: AdapterContext;
  private sessionId: string;

  constructor(sessionId: string, context: AdapterContext) {
    this.sessionId = sessionId;
    this.context = context;
  }

  /**
   * Send a text message via WebSocket
   */
  async sendText(options: SendTextOptions): Promise<void> {
    try {
      const event: WebSocketEvent = {
        type: 'bot_message',
        id: this.generateMessageId(),
        text: options.text,
        ts: new Date().toISOString(),
        final: true,
      };

      this.sendEvent(event);

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
          sessionId: this.sessionId,
          text: options.text.substring(0, 50)
        },
        'Web text sent'
      );
    } catch (error) {
      logger.error(
        {
          err: String(error),
          botId: this.context.botId,
          sessionId: this.sessionId
        },
        'Error sending web text'
      );
      throw error;
    }
  }

  /**
   * Send rich content via WebSocket
   * For web, this could be custom components, quick replies, etc.
   */
  async sendRich(options: SendRichOptions): Promise<void> {
    try {
      // For now, we'll send rich content as a special bot_message
      // In the future, this could be extended to support custom component types
      const event: WebSocketEvent = {
        type: 'bot_message',
        id: this.generateMessageId(),
        text: JSON.stringify(options.components),
        ts: new Date().toISOString(),
        final: true,
      };

      this.sendEvent(event);

      logger.info(
        {
          botId: this.context.botId,
          sessionId: this.sessionId
        },
        'Web rich content sent'
      );
    } catch (error) {
      logger.error(
        {
          err: String(error),
          botId: this.context.botId,
          sessionId: this.sessionId
        },
        'Error sending web rich content'
      );
      throw error;
    }
  }

  /**
   * Send typing indicator via WebSocket
   */
  async sendTyping(state: TypingState): Promise<void> {
    try {
      const event: WebSocketEvent = {
        type: 'typing',
        state,
      };

      this.sendEvent(event);

      logger.debug(
        {
          botId: this.context.botId,
          sessionId: this.sessionId,
          state
        },
        'Web typing indicator sent'
      );
    } catch (error) {
      logger.error(
        {
          err: String(error),
          botId: this.context.botId,
          sessionId: this.sessionId
        },
        'Error sending web typing indicator'
      );
      // Don't throw - typing indicators are non-critical
    }
  }

  /**
   * Send error message to user via WebSocket
   */
  async sendError(options: SendErrorOptions): Promise<void> {
    try {
      const event: WebSocketEvent = {
        type: 'error',
        code: options.code,
        message: options.message,
      };

      this.sendEvent(event);

      logger.warn(
        {
          botId: this.context.botId,
          sessionId: this.sessionId,
          code: options.code
        },
        'Web error message sent'
      );
    } catch (error) {
      logger.error(
        {
          err: String(error),
          botId: this.context.botId,
          sessionId: this.sessionId
        },
        'Error sending web error message'
      );
      // Don't throw - error messages are best-effort
    }
  }

  /**
   * Get the channel type
   */
  channel(): 'whatsapp' | 'web' {
    return 'web';
  }

  /**
   * Get the user identifier (sessionId)
   */
  getUserKey(): string {
    return this.sessionId;
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
   * Send streaming text (for progressive AI responses)
   * This is a web-specific feature
   */
  async sendStreamingText(text: string, partial: boolean = true): Promise<void> {
    try {
      const event: WebSocketEvent = {
        type: 'bot_message',
        id: this.generateMessageId(),
        text,
        ts: new Date().toISOString(),
        partial,
        final: !partial,
      };

      this.sendEvent(event);

      logger.debug(
        {
          botId: this.context.botId,
          sessionId: this.sessionId,
          partial
        },
        'Web streaming text sent'
      );
    } catch (error) {
      logger.error(
        {
          err: String(error),
          botId: this.context.botId,
          sessionId: this.sessionId
        },
        'Error sending web streaming text'
      );
      throw error;
    }
  }

  /**
   * End the session
   */
  async endSession(reason: string = 'session_ended'): Promise<void> {
    try {
      const event: WebSocketEvent = {
        type: 'ended',
        reason,
      };

      this.sendEvent(event);

      // Update session status in database
      await supabaseAdmin
        .from('web_sessions')
        .update({
          status: 'ended',
          last_seen_at: new Date().toISOString(),
        } as any)
        .eq('id', this.sessionId);

      logger.info(
        {
          botId: this.context.botId,
          sessionId: this.sessionId,
          reason
        },
        'Web session ended'
      );
    } catch (error) {
      logger.error(
        {
          err: String(error),
          botId: this.context.botId,
          sessionId: this.sessionId
        },
        'Error ending web session'
      );
      throw error;
    }
  }

  /**
   * Helper: Send WebSocket event
   */
  private sendEvent(event: WebSocketEvent): void {
    try {
      sendEventToSession(this.sessionId, event);
    } catch (error) {
      logger.error(
        {
          err: String(error),
          botId: this.context.botId,
          sessionId: this.sessionId
        },
        'Error sending WebSocket event'
      );
      throw error;
    }
  }

  /**
   * Helper: Generate unique message ID
   */
  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
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
      // Get session info for origin_url and user_agent
      const { data: session } = await supabaseAdmin
        .from('web_sessions')
        .select('origin_url, user_agent')
        .eq('id', this.sessionId)
        .single();

      await supabaseAdmin.from('messages').insert({
        bot_id: this.context.botId,
        business_id: this.context.businessId,
        from_number: params.direction === 'outbound' ? 'bot' : 'web_user',
        to_number: params.direction === 'outbound' ? 'web_user' : 'bot',
        message_type: params.messageType,
        content: params.content,
        direction: params.direction,
        status: 'sent',
        channel: 'web',
        session_id: this.sessionId,
        origin_url: session?.origin_url || null,
        user_agent: session?.user_agent || null,
        metadata: params.metadata || null,
      } as any);
    } catch (error) {
      logger.error(
        {
          err: String(error),
          botId: this.context.botId,
          sessionId: this.sessionId
        },
        'Error saving web message to database'
      );
      // Don't throw - database save is non-critical for message delivery
    }
  }

  /**
   * Send document file via WebSocket
   */
  async sendDocument(options: { url: string; fileName?: string; mimeType?: string; caption?: string; title?: string }): Promise<void> {
    try {
      // Send document as a message with file metadata at the top level
      const event: WebSocketEvent & { messageType?: string; fileUrl?: string; fileName?: string; mimeType?: string } = {
        type: 'bot_message',
        id: this.generateMessageId(),
        text: options.caption || options.title || '',
        ts: new Date().toISOString(),
        final: true,
        messageType: 'document',
        fileUrl: options.url,
        fileName: options.fileName || 'document.pdf',
        mimeType: options.mimeType || 'application/pdf',
      };

      this.sendEvent(event as any);

      // Save to database
      await this.saveMessage({
        content: options.caption || `Document: ${options.fileName || 'document.pdf'}`,
        messageType: 'document',
        direction: 'outbound',
        metadata: {
          url: options.url,
          fileName: options.fileName,
          mimeType: options.mimeType,
        },
      });

      logger.info(
        {
          botId: this.context.botId,
          sessionId: this.sessionId,
          documentUrl: options.url,
          fileName: options.fileName,
        },
        'Web document sent'
      );
    } catch (error) {
      logger.error(
        {
          err: String(error),
          botId: this.context.botId,
          sessionId: this.sessionId,
          documentUrl: options.url,
        },
        'Error sending web document'
      );
      throw error;
    }
  }
}

