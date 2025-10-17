/**
 * Web Conversation Engine
 *
 * Handles incoming messages from web chat channel
 * Mirrors the logic of WhatsApp message handling but uses WebAdapter
 *
 * Architecture: docs/WEB_CHAT_ARCHITECTURE.txt Section 4
 */

import { logger } from '../utils/logger.js';
import { supabaseAdmin } from '../db/supabase.js';
import { AIService } from './ai-service.js';
import { BookingService } from './booking-service.js';
import { BookingStateManager } from './booking-state-manager.js';
import { WebAdapter } from '../adapters/web-adapter.js';
import { sendEventToSession } from '../websocket/ws-server.js';
import { WorkflowEngine } from './workflow-engine.js';


// Store conversation history for AI context (in-memory)
const conversationHistory = new Map<string, string[]>();

/**
 * Handle incoming message from web chat
 */
export async function handleWebMessage(
  sessionId: string,
  botId: string,
  businessId: string,
  messageContent: string
): Promise<void> {
  try {
    if (!messageContent || messageContent.trim() === '') {
      return;
    }

    // Create WebAdapter for this conversation
    const adapter = new WebAdapter(sessionId, {
      botId,
      businessId,
      userKey: sessionId, // For web chat, userKey is sessionId
    });

    // Save incoming message to database
    await supabaseAdmin.from('messages').insert({
      bot_id: botId,
      business_id: businessId,
      from_number: '', // Web chat doesn't have phone number
      to_number: '',
      message_type: 'text',
      content: messageContent,
      direction: 'inbound',
      status: 'received',
      channel: 'web',
      session_id: sessionId,
    } as any);

    logger.info({
      botId,
      sessionId,
      message: messageContent.substring(0, 50)
    }, 'Web message received');

    // Try WorkflowEngine first (default ON)
    try {
      const handled = await WorkflowEngine.tryHandle(adapter, messageContent);
      if (handled) return;
    } catch (e) {
      logger.warn({ botId, err: String(e) }, 'WorkflowEngine tryHandle failed (web), falling back');
    }

    // Check if booking is enabled and handle booking conversation
    const bookingEnabled = await BookingService.isBookingEnabled(botId);
    logger.info({ botId, bookingEnabled }, 'Booking enabled check (web)');

    if (bookingEnabled) {
      // Check if user has active booking conversation
      const hasActiveBooking = await BookingStateManager.hasActiveConversation(botId, sessionId);
      logger.info({ botId, sessionId, hasActiveBooking }, 'Active booking check (web)');

      if (hasActiveBooking) {
        // User is in booking conversation, handle it
        logger.info({ botId, sessionId }, 'Handling active booking conversation (web)');

        // Send typing indicator
        await adapter.sendTyping('start');

        await BookingService.handleBookingMessage(adapter, messageContent);

        await adapter.sendTyping('stop');
        return; // Don't process with regular AI
      }

      // Check if message is a booking trigger
      const keywords = await BookingService.getBookingKeywords(botId);
      const isBookingTrigger = BookingService.isBookingTrigger(messageContent, keywords);
      logger.info({ botId, messageContent, keywords, isBookingTrigger }, 'Booking trigger check (web)');

      if (isBookingTrigger) {
        // Start booking conversation
        logger.info({ botId, sessionId }, 'Starting new booking conversation (web)');

        // Send typing indicator
        await adapter.sendTyping('start');

        await BookingService.handleBookingMessage(adapter, messageContent);

        await adapter.sendTyping('stop');
        return; // Don't process with regular AI
      }
    }

    // Get bot, widget settings, and business context (web bots use widget_settings, not bot_settings)
    const { data: bot } = await supabaseAdmin
      .from('bots')
      .select('*, bot_widget_settings(*)')
      .eq('id', botId)
      .single();

    if (!bot || !bot.bot_widget_settings) {
      logger.error({ botId }, 'Bot or widget settings not found');
      await adapter.sendError({
        code: 'bot_not_configured',
        message: 'Bot is not properly configured. Please contact support.',
      });
      return;
    }


    // Get business context
    const { data: business } = await supabaseAdmin
      .from('businesses')
      .select('name, description, industry, services')
      .eq('id', businessId)
      .single();

    // Build context for AI
    const businessContext = business
      ? `Business: ${business.name}\nDescription: ${business.description || 'N/A'}\nIndustry: ${business.industry || 'N/A'}\nServices: ${business.services?.join(', ') || 'N/A'}`
      : 'No business context available';


    // Get or initialize conversation history
    const historyKey = `${botId}-${sessionId}`;
    if (!conversationHistory.has(historyKey)) {
      conversationHistory.set(historyKey, []);
    }
    const history = conversationHistory.get(historyKey)!;
    history.push(`User: ${messageContent}`);

    // Keep only last 10 messages
    if (history.length > 10) {
      history.shift();
    }

    // Send typing indicator
    await adapter.sendTyping('start');

    // Detect intent (disabled for web bots by default, can be enabled later)
    let intentResult = null;
    const intentDetectionEnabled = false; // TODO: Add to widget settings if needed
    if (intentDetectionEnabled) {
      try {
        intentResult = await AIService.detectIntent(
          messageContent,
          businessContext,
          history
        );

        logger.info({
          botId,
          sessionId,
          intent: intentResult.intention,
          confidence: intentResult.confidence,
        }, 'Intent detected (web)');

        // Save intent data
        await supabaseAdmin.from('messages').update({
          metadata: {
            intent: intentResult.intention,
            confidence: intentResult.confidence,
            sentiment: intentResult.sentiment,
          },
        } as any)
          .eq('bot_id', botId)
          .eq('session_id', sessionId)
          .eq('content', messageContent)
          .eq('direction', 'inbound')
          .order('created_at', { ascending: false })
          .limit(1);
      } catch (error) {
        logger.error({ err: String(error) }, 'Error detecting intent (web)');
      }
    }

    // Generate AI response
    try {
      // For web bots, use a simple intent based on business context
      const intent = `general_inquiry`;

      const responseText = await AIService.generateResponse(
        messageContent,
        intent,
        botId, // ✅ Pass botId, not aiInstructions!
        history
      );

      logger.info({
        botId,
        sessionId,
        response: responseText.substring(0, 50),
      }, 'AI response generated (web)');

      // Add bot response to history
      history.push(`Bot: ${responseText}`);

      // Send response
      if (responseText) {
        await adapter.sendText({ text: responseText });
      }

      // Stop typing indicator
      await adapter.sendTyping('stop');
    } catch (error) {
      logger.error({ err: String(error) }, 'Error generating AI response (web)');

      await adapter.sendTyping('stop');
      await adapter.sendError({
        code: 'ai_error',
        message: 'Sorry, I encountered an error processing your message. Please try again.',
      });
    }
  } catch (error) {
    logger.error({
      err: String(error),
      sessionId,
      botId
    }, 'Error handling web message');

    // Try to send error to client
    try {
      sendEventToSession(sessionId, {
        type: 'error',
        code: 'internal_error',
        message: 'An unexpected error occurred. Please try again.',
      });
    } catch (sendError) {
      logger.error({ err: String(sendError) }, 'Error sending error event');
    }
  }
}

/**
 * End a web chat session
 */
export async function endWebSession(sessionId: string, botId: string): Promise<void> {
  try {
    // Update session status
    await supabaseAdmin
      .from('web_sessions')
      .update({ status: 'ended' } as any)
      .eq('id', sessionId)
      .eq('bot_id', botId);

    // Clear any active booking conversation
    await BookingStateManager.completeConversation(botId, sessionId);

    // Send ended event to client
    sendEventToSession(sessionId, {
      type: 'ended',
      sessionId,
      ts: new Date().toISOString(),
    });

    logger.info({ sessionId, botId }, 'Web session ended');
  } catch (error) {
    logger.error({
      err: String(error),
      sessionId,
      botId
    }, 'Error ending web session');
    throw error;
  }
}

