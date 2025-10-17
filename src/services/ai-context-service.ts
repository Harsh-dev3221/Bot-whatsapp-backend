import { supabaseAdmin } from '../db/supabase.js';
import { logger } from '../utils/logger.js';

export interface BotAIContext {
  botId: string;
  businessId: string;
  businessName: string;
  businessType: string | null;
  businessCategory: string | null;
  businessDescription: string | null;
  businessAddress: string | null;
  businessContext: string;
  systemPrompt: string | null;
  allowedTopics: string[];
  restrictedTopics: string[];
  responseStyle: string;
  maxResponseLength: number;
}

export interface BotMedia {
  id: string;
  mediaType: 'image' | 'video' | 'document' | 'location' | 'contact';
  title: string | null;
  description: string | null;
  fileUrl: string | null;
  fileName: string | null;
  locationName: string | null;
  locationAddress: string | null;
  locationLatitude: number | null;
  locationLongitude: number | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  contactVcard: string | null;
  isRequired: boolean;
  isActive: boolean;
}

/**
 * AI Context Service
 * Manages AI context and media for bots
 */
export class AIContextService {
  /**
   * Get bot AI context
   */
  static async getBotAIContext(botId: string): Promise<BotAIContext | null> {
    try {
      const { data, error } = await supabaseAdmin.rpc('get_bot_ai_context', {
        p_bot_id: botId,
      });

      if (error) {
        logger.error({ err: JSON.stringify(error), botId }, 'Error getting bot AI context');
        return null;
      }

      if (!data || data.length === 0) {
        logger.warn({ botId }, 'No AI context found for bot');
        return null;
      }

      const context = data[0];

      return {
        botId: context.bot_id,
        businessId: context.business_id,
        businessName: context.business_name,
        businessType: context.business_type,
        businessCategory: context.business_category,
        businessDescription: context.business_description,
        businessAddress: context.business_address,
        businessContext: context.business_context || '',
        systemPrompt: context.system_prompt,
        allowedTopics: context.allowed_topics || [],
        restrictedTopics: context.restricted_topics || [],
        responseStyle: context.response_style || 'professional',
        maxResponseLength: context.max_response_length || 500,
      };
    } catch (error) {
      logger.error({ err: String(error), botId }, 'Error in getBotAIContext');
      return null;
    }
  }

  /**
   * Get bot media by type
   */
  static async getBotMedia(
    botId: string,
    mediaType?: 'image' | 'video' | 'document' | 'location' | 'contact'
  ): Promise<BotMedia[]> {
    try {
      const { data, error } = await supabaseAdmin.rpc('get_bot_media_by_type', {
        p_bot_id: botId,
        p_media_type: mediaType || null,
      });

      if (error) {
        logger.error({ err: JSON.stringify(error), botId, mediaType }, 'Error getting bot media');
        return [];
      }

      if (!data || data.length === 0) {
        return [];
      }

      return data.map((media: any) => ({
        id: media.id,
        mediaType: media.media_type,
        title: media.title,
        description: media.description,
        fileUrl: media.file_url,
        fileName: media.file_name,
        locationName: media.location_name,
        locationAddress: media.location_address,
        locationLatitude: media.location_latitude,
        locationLongitude: media.location_longitude,
        contactName: media.contact_name,
        contactPhone: media.contact_phone,
        contactEmail: media.contact_email,
        contactVcard: media.contact_vcard,
        isRequired: media.is_required,
        isActive: media.is_active,
      }));
    } catch (error) {
      logger.error({ err: String(error), botId, mediaType }, 'Error in getBotMedia');
      return [];
    }
  }

  /**
   * Build system prompt from context
   */
  static buildSystemPrompt(context: BotAIContext): string {
    // If custom system prompt exists, use it
    if (context.systemPrompt) {
      return context.systemPrompt;
    }

    // Build default system prompt
    let prompt = `You are a WhatsApp chatbot for ${context.businessName}`;

    if (context.businessType) {
      prompt += `, a ${context.businessType}`;
    }

    prompt += '.\n\n';

    // Add business context (REQUIRED)
    prompt += `Business Context:\n${context.businessContext}\n\n`;

    // Add business description if available
    if (context.businessDescription) {
      prompt += `Business Description:\n${context.businessDescription}\n\n`;
    }

    // Add address if available
    if (context.businessAddress) {
      prompt += `Location: ${context.businessAddress}\n\n`;
    }

    // Add role and behavior
    prompt += `Your role:\n`;
    prompt += `- Answer questions about ${context.businessType || 'our'} services\n`;
    prompt += `- Help customers with inquiries\n`;
    prompt += `- Be ${context.responseStyle} and helpful\n`;
    prompt += `- Keep responses under ${context.maxResponseLength} characters\n\n`;

    // Add allowed topics
    if (context.allowedTopics.length > 0) {
      prompt += `Topics you can discuss:\n`;
      context.allowedTopics.forEach((topic) => {
        prompt += `- ${topic}\n`;
      });
      prompt += '\n';
    }

    // Add restricted topics
    if (context.restrictedTopics.length > 0) {
      prompt += `Topics you should NOT discuss:\n`;
      context.restrictedTopics.forEach((topic) => {
        prompt += `- ${topic}\n`;
      });
      prompt += '\n';
    }

    // Add instructions for staying on topic
    prompt += `Important:\n`;
    prompt += `- Stay focused on ${context.businessType || 'business'} related topics\n`;
    prompt += `- If asked about unrelated topics, politely redirect to ${context.businessType || 'business'} services\n`;
    prompt += `- If user asks about location, mention: "${context.businessAddress || 'our location'}"\n`;
    prompt += `- Always maintain a ${context.responseStyle} tone\n`;

    return prompt;
  }

  /**
   * Check if AI context exists for bot
   */
  static async hasAIContext(botId: string): Promise<boolean> {
    try {
      const { data, error } = await supabaseAdmin
        .from('bot_ai_context')
        .select('id')
        .eq('bot_id', botId)
        .single();

      return !error && !!data;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get default restricted topics
   */
  static getDefaultRestrictedTopics(): string[] {
    return [
      'politics',
      'religion',
      'personal opinions',
      'medical advice',
      'legal advice',
      'financial advice',
      'controversial topics',
      'personal life',
      'gossip',
      'rumors',
    ];
  }

  /**
   * Create default AI context for bot
   */
  static async createDefaultAIContext(
    botId: string,
    businessId: string,
    businessName: string
  ): Promise<void> {
    try {
      const { error } = await supabaseAdmin.from('bot_ai_context').insert({
        bot_id: botId,
        business_id: businessId,
        business_context: `This is a WhatsApp chatbot for ${businessName}. We help customers with inquiries and bookings.`,
        system_prompt: null,
        allowed_topics: ['services', 'booking', 'pricing', 'location', 'hours'],
        restricted_topics: this.getDefaultRestrictedTopics(),
        response_style: 'professional',
        max_response_length: 500,
      });

      if (error) {
        logger.error({ err: JSON.stringify(error), botId }, 'Error creating default AI context');
      } else {
        logger.info({ botId }, 'Default AI context created');
      }
    } catch (error) {
      logger.error({ err: String(error), botId }, 'Error in createDefaultAIContext');
    }
  }
}

