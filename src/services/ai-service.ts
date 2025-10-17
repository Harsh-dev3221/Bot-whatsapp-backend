// AI Service using Langchain and Google Gemini
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { z } from 'zod';
import { env } from '../config/env.js';
import pino from 'pino';
import { AIContextService } from './ai-context-service.js';

const logger = pino({ level: 'info' });

// Initialize Gemini model
// Using gemini-2.0-flash-exp (latest experimental model) or gemini-1.5-pro as fallback
const model = new ChatGoogleGenerativeAI({
  model: 'gemini-2.0-flash-exp',
  apiKey: env.ai.geminiApiKey,
  temperature: 0.7,
});

// Define intent schema with additional intents
const intentSchema = z.object({
  intention: z.enum([
    'GREETING',
    'QUESTION',
    'SUPPORT',
    'SALES',
    'COMPLAINT',
    'CLOSURE',
    'LOCATION_REQUEST',
    'SERVICE_INQUIRY',
    'OFF_TOPIC',
    'UNKNOWN'
  ]).describe('Categorize the user message into one of the predefined intentions'),
  confidence: z.number().min(0).max(1)
    .describe('Confidence score of the intent classification (0-1)'),
  sentiment: z.enum(['POSITIVE', 'NEUTRAL', 'NEGATIVE'])
    .describe('Sentiment of the user message'),
  suggestedResponse: z.string()
    .describe('A suggested response based on the intent and context'),
});

type IntentResult = z.infer<typeof intentSchema>;

export class AIService {
  /**
   * Detect intent from user message with business context
   */
  static async detectIntent(
    message: string,
    botId: string,
    conversationHistory: string[] = []
  ): Promise<IntentResult> {
    try {
      if (!env.ai.geminiApiKey) {
        logger.warn('Gemini API key not configured, returning default intent');
        return {
          intention: 'UNKNOWN',
          confidence: 0,
          sentiment: 'NEUTRAL',
          suggestedResponse: 'Thank you for your message. How can I help you today?',
        };
      }

      // Get bot AI context
      const aiContext = await AIContextService.getBotAIContext(botId);

      // Build system prompt with business context
      let systemPrompt = 'You are an intelligent WhatsApp chatbot assistant. Your role is to:\n';
      systemPrompt += '1. Analyze user messages and detect their intent\n';
      systemPrompt += '2. Understand the sentiment of the message\n';
      systemPrompt += '3. Provide appropriate, helpful responses\n\n';

      if (aiContext) {
        systemPrompt += `Business Context:\n${aiContext.businessContext}\n\n`;

        if (aiContext.businessType) {
          systemPrompt += `Business Type: ${aiContext.businessType}\n`;
        }

        if (aiContext.allowedTopics.length > 0) {
          systemPrompt += `Allowed Topics: ${aiContext.allowedTopics.join(', ')}\n`;
        }

        // Always enforce restricted topics
        const restrictedTopics = aiContext.restrictedTopics.length > 0
          ? aiContext.restrictedTopics
          : AIContextService.getDefaultRestrictedTopics();

        systemPrompt += `\nSTRICTLY FORBIDDEN Topics (NEVER discuss these):\n`;
        restrictedTopics.forEach(topic => {
          systemPrompt += `- ${topic}\n`;
        });
        systemPrompt += '\n';
      }

      systemPrompt += 'Intent Categories:\n';
      systemPrompt += '- GREETING: User is greeting or starting a conversation\n';
      systemPrompt += '- QUESTION: User is asking a question about products, services, or information\n';
      systemPrompt += '- SUPPORT: User needs help or technical support\n';
      systemPrompt += '- SALES: User is interested in purchasing or inquiring about products/services\n';
      systemPrompt += '- COMPLAINT: User is expressing dissatisfaction or reporting an issue\n';
      systemPrompt += '- CLOSURE: User is ending the conversation\n';
      systemPrompt += '- LOCATION_REQUEST: User is asking about location or address\n';
      systemPrompt += '- SERVICE_INQUIRY: User is asking about specific services\n';
      systemPrompt += '- OFF_TOPIC: User is asking about FORBIDDEN topics or topics not related to the business\n';
      systemPrompt += '- UNKNOWN: Intent is unclear or doesn\'t fit other categories\n\n';

      systemPrompt += `Always be ${aiContext?.responseStyle || 'professional'} and helpful in your suggested responses.\n\n`;
      systemPrompt += 'IMPORTANT RULES:\n';
      systemPrompt += '1. If user asks about ANY forbidden topic, immediately classify as OFF_TOPIC\n';
      systemPrompt += '2. Politely but firmly redirect to business-related topics\n';
      systemPrompt += '3. Do NOT engage with forbidden topics even if user insists\n';
      systemPrompt += '4. Keep responses focused on business services and offerings';

      // Create prompt template with business context
      const contextualIntentPrompt = ChatPromptTemplate.fromMessages([
        ['system', systemPrompt],
        ['human', 'Analyze this message and provide intent, confidence, sentiment, and a suggested response:\n\nMessage: {message}\n\nConversation History:\n{history}'],
      ]);

      // Format conversation history
      const history = conversationHistory.length > 0
        ? conversationHistory.slice(-5).join('\n')
        : 'No previous conversation';

      // Create structured output model
      const structuredModel = model.withStructuredOutput(intentSchema);

      // Invoke the model
      const chain = contextualIntentPrompt.pipe(structuredModel);
      const result = await chain.invoke({
        message,
        history,
      });

      logger.info({ intent: result.intention, confidence: result.confidence, botId }, 'Intent detected');
      return result as IntentResult;
    } catch (error) {
      logger.error({ err: String(error), botId }, 'Error detecting intent');
      return {
        intention: 'UNKNOWN',
        confidence: 0,
        sentiment: 'NEUTRAL',
        suggestedResponse: 'I apologize, but I encountered an error. Could you please rephrase your message?',
      };
    }
  }

  /**
   * Generate a response based on intent and business context
   */
  static async generateResponse(
    message: string,
    intent: string,
    botId: string,
    conversationHistory: string[] = []
  ): Promise<string> {
    try {
      if (!env.ai.geminiApiKey) {
        return this.getDefaultResponse(intent);
      }

      // Get bot AI context
      const aiContext = await AIContextService.getBotAIContext(botId);

      // Build system prompt
      let systemPrompt = '';
      if (aiContext) {
        systemPrompt = AIContextService.buildSystemPrompt(aiContext);
      } else {
        systemPrompt = 'You are a helpful WhatsApp chatbot assistant.';
      }

      systemPrompt += `\n\nProvide a natural, conversational response based on the user's intent: ${intent}`;

      // Add max length constraint
      if (aiContext?.maxResponseLength) {
        systemPrompt += `\n\nKeep your response under ${aiContext.maxResponseLength} characters.`;
      }

      const contextPrompt = ChatPromptTemplate.fromMessages([
        ['system', systemPrompt],
        ['human', 'User message: {message}\n\nConversation history:\n{history}\n\nProvide a helpful response:'],
      ]);

      const history = conversationHistory.length > 0
        ? conversationHistory.slice(-5).join('\n')
        : 'No previous conversation';

      const chain = contextPrompt.pipe(model);
      const response = await chain.invoke({
        message,
        history,
      });

      return response.content as string;
    } catch (error) {
      logger.error({ err: String(error), botId }, 'Error generating response');
      return this.getDefaultResponse(intent);
    }
  }

  /**
   * Get default response based on intent
   */
  private static getDefaultResponse(intent: string): string {
    const responses: Record<string, string> = {
      GREETING: 'Hello! Welcome to our service. How can I assist you today?',
      QUESTION: 'Thank you for your question. Let me help you with that.',
      SUPPORT: 'I understand you need support. Let me connect you with our team.',
      SALES: 'Thank you for your interest! I\'d be happy to help you with information about our products and services.',
      COMPLAINT: 'I apologize for any inconvenience. Your feedback is important to us. Let me help resolve this issue.',
      CLOSURE: 'Thank you for contacting us! Have a great day!',
      LOCATION_REQUEST: 'Let me share our location with you.',
      SERVICE_INQUIRY: 'Let me tell you about our services.',
      OFF_TOPIC: 'I\'m here to help with our services. How can I assist you today?',
      UNKNOWN: 'Thank you for your message. How can I help you today?',
    };

    return responses[intent] || responses.UNKNOWN;
  }

  /**
   * Analyze conversation sentiment
   */
  static async analyzeSentiment(messages: string[]): Promise<{
    overallSentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
    score: number;
  }> {
    try {
      if (!env.ai.geminiApiKey || messages.length === 0) {
        return { overallSentiment: 'NEUTRAL', score: 0.5 };
      }

      const sentimentPrompt = ChatPromptTemplate.fromMessages([
        ['system', 'Analyze the overall sentiment of this conversation. Respond with a JSON object containing "sentiment" (POSITIVE, NEUTRAL, or NEGATIVE) and "score" (0-1).'],
        ['human', 'Conversation:\n{conversation}'],
      ]);

      const chain = sentimentPrompt.pipe(model);
      const response = await chain.invoke({
        conversation: messages.join('\n'),
      });

      const content = response.content as string;
      const parsed = JSON.parse(content);

      return {
        overallSentiment: parsed.sentiment || 'NEUTRAL',
        score: parsed.score || 0.5,
      };
    } catch (error) {
      logger.error({ err: String(error) }, 'Error analyzing sentiment');
      return { overallSentiment: 'NEUTRAL', score: 0.5 };
    }
  }

  /**
   * Extract key information from message
   */
  static async extractInformation(message: string): Promise<{
    phoneNumbers: string[];
    emails: string[];
    keywords: string[];
  }> {
    try {
      // Basic regex extraction
      const phoneNumbers = message.match(/\+?\d{10,15}/g) || [];
      const emails = message.match(/[\w.-]+@[\w.-]+\.\w+/g) || [];

      // Use AI for keyword extraction if available
      let keywords: string[] = [];
      if (env.ai.geminiApiKey) {
        const keywordPrompt = ChatPromptTemplate.fromMessages([
          ['system', 'Extract the main keywords and topics from this message. Return only a comma-separated list of keywords.'],
          ['human', '{message}'],
        ]);

        const chain = keywordPrompt.pipe(model);
        const response = await chain.invoke({ message });
        keywords = (response.content as string).split(',').map(k => k.trim());
      }

      return { phoneNumbers, emails, keywords };
    } catch (error) {
      logger.error({ err: String(error) }, 'Error extracting information');
      return { phoneNumbers: [], emails: [], keywords: [] };
    }
  }
}

