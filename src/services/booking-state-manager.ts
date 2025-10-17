// Booking conversation state management

import { supabaseAdmin } from '../db/supabase.js';
import { BookingState, ConversationState, conversationStateSchema } from './booking-validator.js';
import pino from 'pino';

const logger = pino({ level: 'info' });

export class BookingStateManager {
  /**
   * Get or create conversation state for a customer
   */
  static async getOrCreateState(
    botId: string,
    businessId: string,
    customerPhone: string
  ): Promise<ConversationState> {
    try {
      // Try to get existing active conversation
      const { data: existing, error } = await supabaseAdmin
        .from('booking_conversations')
        .select('*')
        .eq('bot_id', botId)
        .eq('customer_phone', customerPhone)
        .eq('is_completed', false)
        .single();

      if (existing && !error) {
        // Parse and return existing state
        return conversationStateSchema.parse({
          currentStep: existing.current_step,
          collectedData: existing.conversation_state,
          validationErrors: [],
          retryCount: 0,
        });
      }

      // Create new conversation state
      const initialState: ConversationState = {
        currentStep: BookingState.IDLE,
        collectedData: {
          customerPhone,
        },
        validationErrors: [],
        retryCount: 0,
      };

      const { error: createError } = await supabaseAdmin
        .from('booking_conversations')
        .insert({
          bot_id: botId,
          business_id: businessId,
          customer_phone: customerPhone,
          conversation_state: initialState.collectedData,
          current_step: initialState.currentStep,
          is_completed: false,
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 minutes
        })
        .select()
        .single();

      if (createError) {
        logger.error({ err: String(createError) }, 'Error creating conversation state');
        throw createError;
      }

      return initialState;
    } catch (error) {
      logger.error({ err: String(error) }, 'Error in getOrCreateState');
      throw error;
    }
  }

  /**
   * Update conversation state
   */
  static async updateState(
    botId: string,
    customerPhone: string,
    state: ConversationState
  ): Promise<void> {
    try {
      const { error } = await supabaseAdmin
        .from('booking_conversations')
        .update({
          conversation_state: state.collectedData,
          current_step: state.currentStep,
          updated_at: new Date().toISOString(),
        })
        .eq('bot_id', botId)
        .eq('customer_phone', customerPhone)
        .eq('is_completed', false);

      if (error) {
        logger.error({ err: String(error) }, 'Error updating conversation state');
        throw error;
      }
    } catch (error) {
      logger.error({ err: String(error) }, 'Error in updateState');
      throw error;
    }
  }

  /**
   * Complete conversation (mark as done)
   */
  static async completeConversation(botId: string, customerPhone: string): Promise<void> {
    try {
      const { error } = await supabaseAdmin
        .from('booking_conversations')
        .update({
          is_completed: true,
          current_step: BookingState.COMPLETED,
          updated_at: new Date().toISOString(),
        })
        .eq('bot_id', botId)
        .eq('customer_phone', customerPhone)
        .eq('is_completed', false);

      if (error) {
        logger.error({ err: String(error) }, 'Error completing conversation');
        throw error;
      }

      logger.info({ botId, customerPhone }, 'Booking conversation completed');
    } catch (error) {
      logger.error({ err: String(error) }, 'Error in completeConversation');
      throw error;
    }
  }

  /**
   * Cancel conversation (mark as completed without booking)
   */
  static async cancelConversation(botId: string, customerPhone: string): Promise<void> {
    try {
      const { error } = await supabaseAdmin
        .from('booking_conversations')
        .update({
          is_completed: true,
          current_step: BookingState.IDLE,
          updated_at: new Date().toISOString(),
        })
        .eq('bot_id', botId)
        .eq('customer_phone', customerPhone)
        .eq('is_completed', false);

      if (error) {
        logger.error({ err: String(error) }, 'Error cancelling conversation');
        throw error;
      }

      logger.info({ botId, customerPhone }, 'Booking conversation cancelled');
    } catch (error) {
      logger.error({ err: String(error) }, 'Error in cancelConversation');
      throw error;
    }
  }

  /**
   * Check if customer has active booking conversation
   */
  static async hasActiveConversation(botId: string, customerPhone: string): Promise<boolean> {
    try {
      const { data, error } = await supabaseAdmin
        .from('booking_conversations')
        .select('id')
        .eq('bot_id', botId)
        .eq('customer_phone', customerPhone)
        .eq('is_completed', false)
        .single();

      return !error && !!data;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get current state without creating new one
   */
  static async getState(botId: string, customerPhone: string): Promise<ConversationState | null> {
    try {
      const { data, error } = await supabaseAdmin
        .from('booking_conversations')
        .select('*')
        .eq('bot_id', botId)
        .eq('customer_phone', customerPhone)
        .eq('is_completed', false)
        .single();

      if (error || !data) {
        return null;
      }

      return conversationStateSchema.parse({
        currentStep: data.current_step,
        collectedData: data.conversation_state,
        validationErrors: [],
        retryCount: 0,
      });
    } catch (error) {
      logger.error({ err: String(error) }, 'Error in getState');
      return null;
    }
  }

  /**
   * Clean up expired conversations (call periodically)
   */
  static async cleanupExpiredConversations(): Promise<number> {
    try {
      const { data, error } = await supabaseAdmin
        .from('booking_conversations')
        .update({ is_completed: true })
        .lt('expires_at', new Date().toISOString())
        .eq('is_completed', false)
        .select('id');

      if (error) {
        logger.error({ err: String(error) }, 'Error cleaning up expired conversations');
        return 0;
      }

      const count = data?.length || 0;
      if (count > 0) {
        logger.info({ count }, 'Cleaned up expired booking conversations');
      }

      return count;
    } catch (error) {
      logger.error({ err: String(error) }, 'Error in cleanupExpiredConversations');
      return 0;
    }
  }

  /**
   * Extend conversation expiry (reset timeout)
   */
  static async extendExpiry(botId: string, customerPhone: string, minutes: number = 30): Promise<void> {
    try {
      const { error } = await supabaseAdmin
        .from('booking_conversations')
        .update({
          expires_at: new Date(Date.now() + minutes * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('bot_id', botId)
        .eq('customer_phone', customerPhone)
        .eq('is_completed', false);

      if (error) {
        logger.error({ err: String(error) }, 'Error extending conversation expiry');
      }
    } catch (error) {
      logger.error({ err: String(error) }, 'Error in extendExpiry');
    }
  }
}

// Start periodic cleanup (every 5 minutes)
setInterval(() => {
  BookingStateManager.cleanupExpiredConversations().catch((error) => {
    logger.error({ err: String(error) }, 'Error in periodic cleanup');
  });
}, 5 * 60 * 1000);

