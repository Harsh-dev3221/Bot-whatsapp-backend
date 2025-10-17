import { supabaseAdmin } from '../db/supabase.js';
import { logger } from '../utils/logger.js';
import type { MessagingAdapter } from '../adapters/messaging-adapter.js';
import { AIService } from './ai-service.js';
import { AIContextService } from './ai-context-service.js';
import { BookingService } from './booking-service.js';

// Minimal WorkflowEngine (Phase 1)
// - Trigger match on keywords
// - Maintain conversation in workflow_conversations
// - Send prompt for first step; collect_field will just prompt for now
// - ai_response delegates to AIService.generateResponse

export type WorkflowStepType = 'collect_field' | 'ai_response' | 'show_options' | 'share_media' | 'conditional' | 'start_booking';

interface WorkflowRecord {
  id: string;
  bot_id: string;
  name: string;
  status: 'draft' | 'published';
  is_active: boolean;
  trigger: any;
  steps: Array<any>;
  actions: Array<any>;
}

export class WorkflowEngine {
  static async tryHandle(adapter: MessagingAdapter, message: string): Promise<boolean> {
    try {
      const botId = adapter.getBotId();
      const userKey = adapter.getUserKey();

      // Check if workflow is enabled (default true)
      const { data: settings } = await supabaseAdmin
        .from('bot_settings')
        .select('workflow_enabled')
        .eq('bot_id', botId)
        .single();

      const workflowEnabled = (settings as any)?.workflow_enabled !== false;
      if (!workflowEnabled) return false;

      // Check for active conversation
      const { data: convo } = await supabaseAdmin
        .from('workflow_conversations')
        .select('*')
        .eq('bot_id', botId)
        .eq('user_key', userKey)
        .eq('is_completed', false)
        .maybeSingle();

      if (convo) {
        return await this.continueConversation(adapter, message, convo);
      }

      // Find a published active workflow whose trigger matches
      const { data: workflows, error } = await supabaseAdmin
        .from('workflows')
        .select('*')
        .eq('bot_id', botId)
        .eq('is_active', true)
        .eq('status', 'published');

      if (error || !workflows || workflows.length === 0) return false;

      const lower = message.toLowerCase();
      const matched = (workflows as WorkflowRecord[]).find(wf => {
        const keywords: string[] = wf.trigger?.keywords || [];
        if (!keywords || keywords.length === 0) return false;
        return keywords.some(k => lower.includes(String(k).toLowerCase()));
      });

      if (!matched) return false;

      // Start conversation at first step
      const firstStep = (matched.steps || [])[0];
      if (!firstStep) return false;

      await supabaseAdmin.from('workflow_conversations').insert({
        bot_id: botId,
        user_key: userKey,
        workflow_id: matched.id,
        current_step_id: firstStep.id || 'step1',
        state: {},
        is_completed: false,
        channel: adapter.channel(),
      } as any);

      // Send initial prompt or media depending on step type
      const prompt = firstStep.prompt_message || 'How can I help you?';

      // Handle start_booking step - hand off to booking system
      if (firstStep.type === 'start_booking') {
        // Mark workflow conversation as completed
        await supabaseAdmin
          .from('workflow_conversations')
          .update({ is_completed: true })
          .eq('bot_id', botId)
          .eq('user_key', userKey)
          .eq('workflow_id', matched.id);

        // Start the booking conversation using existing booking system
        await BookingService.handleBookingMessage(adapter, message);
        return true;
      }

      if (firstStep.type === 'share_media') {
        const media = await AIContextService.getBotMedia(adapter.getBotId());
        const items = media.filter((m: any) => ['image', 'video', 'document'].includes(m.mediaType));

        if (items.length > 0) {
          // Send prompt first
          await adapter.sendText({ text: prompt });

          // Send each media file properly based on type
          for (const item of items) {
            if (!item.fileUrl || !item.fileName) continue;

            try {
              if (item.mediaType === 'document') {
                // Send as document
                if (adapter.sendDocument) {
                  await adapter.sendDocument({
                    url: item.fileUrl,
                    fileName: item.fileName,
                    caption: item.title || undefined,
                    title: item.title || undefined,
                  });
                } else {
                  // Fallback: send as text with link
                  await adapter.sendText({ text: `📄 ${item.title || item.fileName}\n${item.fileUrl}` });
                }
              } else if (item.mediaType === 'image') {
                // Send as image
                if (adapter.sendRich) {
                  await adapter.sendRich({
                    components: {
                      image: { url: item.fileUrl },
                      caption: item.title || '',
                    }
                  });
                }
              } else if (item.mediaType === 'video') {
                // Send as video
                if (adapter.sendRich) {
                  await adapter.sendRich({
                    components: {
                      video: { url: item.fileUrl },
                      caption: item.title || '',
                    }
                  });
                }
              }
            } catch (err) {
              logger.error({ err: String(err), mediaType: item.mediaType, fileUrl: item.fileUrl }, 'Error sending media in workflow');
            }
          }
        } else {
          await adapter.sendText({ text: prompt });
        }
        const nextId = firstStep.next;
        if (nextId) {
          await supabaseAdmin
            .from('workflow_conversations')
            .update({ current_step_id: nextId })
            .eq('bot_id', adapter.getBotId())
            .eq('user_key', adapter.getUserKey())
            .eq('is_completed', false);
          const next = (matched.steps || []).find((s: any) => (s.id || 'step1') === nextId);
          if (next) {
            const nextPrompt = next.prompt_message || 'Please continue...';
            if (next.type === 'show_options' && next.options_config?.options?.length) {
              const opts = next.options_config.options.map((o: any, i: number) => `${i + 1}. ${o.label}`).join('\n');
              await adapter.sendText({ text: `${nextPrompt}\n\n${opts}` });
            } else {
              await adapter.sendText({ text: nextPrompt });
            }
          }
        }
        return true;
      }

      if (firstStep.type === 'show_options' && firstStep.options_config?.options?.length) {
        // For now, send text list of options (rich UI can be added per channel)
        const opts = firstStep.options_config.options
          .map((o: any, idx: number) => `${idx + 1}. ${o.label}`)
          .join('\n');
        await adapter.sendText({ text: `${prompt}\n\n${opts}` });
        return true;
      }

      // Default: send the prompt
      await adapter.sendText({ text: prompt });
      return true;
    } catch (err) {
      logger.error({ err: String(err) }, 'WorkflowEngine.tryHandle error');
      return false;
    }
  }
  private static async continueConversation(adapter: MessagingAdapter, message: string, convo: any): Promise<boolean> {
    const botId = adapter.getBotId();
    try {
      // Load workflow
      const { data: workflow } = await supabaseAdmin
        .from('workflows')
        .select('*')
        .eq('id', convo.workflow_id)
        .single();
      if (!workflow) return false;

      const steps: any[] = workflow.steps || [];
      const idx = steps.findIndex((s: any) => (s.id || 'step1') === convo.current_step_id);
      const step = idx >= 0 ? steps[idx] : steps[0];
      if (!step) return false;

      // Shallow clone state
      const state = { ...(convo.state || {}) } as Record<string, any>;

      // Handle start_booking step - hand off to booking system
      if (step.type === 'start_booking') {
        // Mark workflow conversation as completed
        await supabaseAdmin
          .from('workflow_conversations')
          .update({ is_completed: true })
          .eq('id', convo.id);

        // Start the booking conversation using existing booking system
        await BookingService.handleBookingMessage(adapter, message);
        return true;
      }

      // Handle step types
      if (step.type === 'collect_field') {
        const key = step.collect_config?.field_key || step.id || `field_${idx + 1}`;
        state[key] = message;
      }

      if (step.type === 'show_options') {
        const options = step.options_config?.options || [];
        const choice = this.parseOption(message, options);
        if (choice !== undefined) {
          const key = step.options_config?.field_key || step.id || `choice_${idx + 1}`;
          state[key] = options[choice]?.value ?? options[choice]?.label ?? String(choice);
        }
      }

      if (step.type === 'ai_response') {
        const reply = await AIService.generateResponse(message, 'UNKNOWN', botId, []);
        await adapter.sendText({ text: reply });
      }

      if (step.type === 'share_media') {
        const prompt = step.prompt_message || 'Here are our items:';
        const media = await AIContextService.getBotMedia(botId);
        const items = media.filter((m: any) => ['image', 'video', 'document'].includes(m.mediaType));

        if (items.length > 0) {
          // Send prompt first
          await adapter.sendText({ text: prompt });

          // Send each media file properly based on type
          for (const item of items) {
            if (!item.fileUrl || !item.fileName) continue;

            try {
              if (item.mediaType === 'document') {
                // Send as document
                if (adapter.sendDocument) {
                  await adapter.sendDocument({
                    url: item.fileUrl,
                    fileName: item.fileName,
                    caption: item.title || undefined,
                    title: item.title || undefined,
                  });
                } else {
                  // Fallback: send as text with link
                  await adapter.sendText({ text: `📄 ${item.title || item.fileName}\n${item.fileUrl}` });
                }
              } else if (item.mediaType === 'image') {
                // Send as image
                if (adapter.sendRich) {
                  await adapter.sendRich({
                    components: {
                      image: { url: item.fileUrl },
                      caption: item.title || '',
                    }
                  });
                }
              } else if (item.mediaType === 'video') {
                // Send as video
                if (adapter.sendRich) {
                  await adapter.sendRich({
                    components: {
                      video: { url: item.fileUrl },
                      caption: item.title || '',
                    }
                  });
                }
              }
            } catch (err) {
              logger.error({ err: String(err), mediaType: item.mediaType, fileUrl: item.fileUrl }, 'Error sending media in workflow');
            }
          }
        } else {
          await adapter.sendText({ text: prompt });
        }
      }

      // Decide next step
      const nextId = step.next || steps[idx + 1]?.id;

      if (!nextId) {
        // Complete conversation
        await supabaseAdmin
          .from('workflow_conversations')
          .update({ is_completed: true, state })
          .eq('id', convo.id);

        // Execute simple actions: save_to_database -> inquiries
        const actions: any[] = workflow.actions || [];
        const shouldSave = actions.some(a => a.type === 'save_to_database');
        if (shouldSave) {
          await supabaseAdmin.from('inquiries').insert({
            bot_id: botId,
            workflow_id: workflow.id,
            customer_data: {},
            inquiry_data: state,
            status: 'pending',
            source: adapter.channel(),
            customer_phone: adapter.channel() === 'whatsapp' ? adapter.getUserKey() : null,
          } as any);
        }

        await adapter.sendText({ text: 'Thank you! Your information has been recorded.' });
        return true;
      }

      // Move to next step
      await supabaseAdmin
        .from('workflow_conversations')
        .update({ current_step_id: nextId, state })
        .eq('id', convo.id);

      const next = steps.find((s: any) => (s.id || 'step1') === nextId) || steps[idx + 1];
      if (!next) return true;

      // Handle start_booking step when moving to next
      if (next.type === 'start_booking') {
        // Mark workflow conversation as completed
        await supabaseAdmin
          .from('workflow_conversations')
          .update({ is_completed: true, state })
          .eq('id', convo.id);

        // Start the booking conversation using existing booking system
        await BookingService.handleBookingMessage(adapter, message);
        return true;
      }

      const prompt = next.prompt_message || 'Please continue...';
      if (next.type === 'show_options' && next.options_config?.options?.length) {
        const opts = next.options_config.options
          .map((o: any, i: number) => `${i + 1}. ${o.label}`)
          .join('\n');
        await adapter.sendText({ text: `${prompt}\n\n${opts}` });
        return true;
      }

      await adapter.sendText({ text: prompt });
      return true;
    } catch (err) {
      logger.error({ err: String(err), botId }, 'continueConversation error');
      return false;
    }
  }

  private static parseOption(message: string, options: any[]): number | undefined {
    const trimmed = message.trim().toLowerCase();
    const num = Number(trimmed);
    if (!Number.isNaN(num) && num >= 1 && num <= options.length) return num - 1;
    const idx = options.findIndex((o: any) => String(o.label || '').toLowerCase() === trimmed);
    return idx >= 0 ? idx : undefined;
  }

}

