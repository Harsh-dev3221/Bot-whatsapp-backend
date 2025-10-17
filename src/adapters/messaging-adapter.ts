/**
 * MessagingAdapter Interface
 * 
 * Abstraction layer for different messaging channels (WhatsApp, Web, etc.)
 * Allows the same AI + booking logic to work across multiple transports
 * 
 * Architecture: docs/WEB_CHAT_ARCHITECTURE.txt Section 4
 */

export type MessageChannel = 'whatsapp' | 'web';

export interface SendTextOptions {
  text: string;
  metadata?: Record<string, any>;
}

export interface SendRichOptions {
  components: any; // Rich content structure (buttons, cards, etc.)
  metadata?: Record<string, any>;
}

export interface SendDocumentOptions {
  url: string;
  fileName?: string;
  mimeType?: string;
  caption?: string;
  title?: string;
}

export interface SendErrorOptions {
  code: string;
  message: string;
}

export type TypingState = 'start' | 'stop';

/**
 * MessagingAdapter Interface
 * 
 * All messaging channels must implement this interface to work with
 * the unified conversation engine (AI + Booking services)
 */
export interface MessagingAdapter {
  /**
   * Send a text message
   */
  sendText(options: SendTextOptions): Promise<void>;

  /**
   * Send a document/file attachment (optional)
   */
  sendDocument?(options: SendDocumentOptions): Promise<void>;

  /**
   * Send rich content (optional - not all channels support this)
   */
  sendRich?(options: SendRichOptions): Promise<void>;

  /**
   * Send typing indicator (optional)
   */
  sendTyping?(state: TypingState): Promise<void>;

  /**
   * Send error message to user
   */
  sendError?(options: SendErrorOptions): Promise<void>;

  /**
   * Get the channel type
   */
  channel(): MessageChannel;

  /**
   * Get the user identifier (phone number for WhatsApp, sessionId for Web)
   */
  getUserKey(): string;

  /**
   * Get the bot ID
   */
  getBotId(): string;

  /**
   * Get the business ID
   */
  getBusinessId(): string;
}

/**
 * Base adapter context that all adapters need
 */
export interface AdapterContext {
  botId: string;
  businessId: string;
  userKey: string; // phoneNumber for WhatsApp, sessionId for Web
}

