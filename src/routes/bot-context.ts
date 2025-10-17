import { Hono } from 'hono';
import { supabaseAdmin } from '../db/supabase.js';
import { logger } from '../utils/logger.js';
import { z } from 'zod';
import { Buffer } from 'node:buffer';

const app = new Hono();

// Validation schemas
const aiContextSchema = z.object({
  business_context: z.string().min(10, 'Business context must be at least 10 characters'),
  system_prompt: z.string().optional().nullable(),
  allowed_topics: z.array(z.string()).default([]),
  restricted_topics: z.array(z.string()).default([]),
  response_style: z.enum(['professional', 'friendly', 'casual', 'formal']).default('professional'),
  max_response_length: z.number().min(100).max(2000).default(500),
});

const botMediaSchema = z.object({
  media_type: z.enum(['image', 'video', 'document', 'location', 'contact']),
  title: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  file_url: z.string().url().optional().nullable(),
  file_name: z.string().optional().nullable(),
  file_size: z.number().optional().nullable(),
  mime_type: z.string().optional().nullable(),
  location_name: z.string().optional().nullable(),
  location_address: z.string().optional().nullable(),
  location_latitude: z.number().min(-90).max(90).optional().nullable(),
  location_longitude: z.number().min(-180).max(180).optional().nullable(),
  contact_name: z.string().optional().nullable(),
  contact_phone: z.string().optional().nullable(),
  contact_email: z.string().email().optional().nullable(),
  contact_vcard: z.string().optional().nullable(),
  is_required: z.boolean().default(false),
  is_active: z.boolean().default(true),
  display_order: z.number().default(0),
});

// Get bot AI context
app.get('/:botId/context', async (c) => {
  try {
    const botId = c.req.param('botId');

    const { data, error } = await supabaseAdmin.rpc('get_bot_ai_context', {
      p_bot_id: botId,
    });

    if (error) {
      logger.error({ err: JSON.stringify(error), botId }, 'Error getting bot AI context');
      return c.json({ error: 'Failed to get AI context' }, 500);
    }

    if (!data || data.length === 0) {
      return c.json({ context: null });
    }

    return c.json({ context: data[0] });
  } catch (error) {
    logger.error({ err: String(error) }, 'Error in GET /context');
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Create or update bot AI context
app.post('/:botId/context', async (c) => {
  try {
    const botId = c.req.param('botId');
    const body = await c.req.json();

    // Validate input
    const validated = aiContextSchema.parse(body);

    // Get bot and business_id
    const { data: bot, error: botError } = await supabaseAdmin
      .from('bots')
      .select('business_id')
      .eq('id', botId)
      .single();

    if (botError || !bot) {
      return c.json({ error: 'Bot not found' }, 404);
    }

    // Check if context exists
    const { data: existing } = await supabaseAdmin
      .from('bot_ai_context')
      .select('id')
      .eq('bot_id', botId)
      .single();

    let result;
    if (existing) {
      // Update existing
      result = await supabaseAdmin
        .from('bot_ai_context')
        .update({
          ...validated,
          updated_at: new Date().toISOString(),
        })
        .eq('bot_id', botId)
        .select()
        .single();
    } else {
      // Create new
      result = await supabaseAdmin
        .from('bot_ai_context')
        .insert({
          bot_id: botId,
          business_id: bot.business_id,
          ...validated,
        })
        .select()
        .single();
    }

    if (result.error) {
      logger.error({ err: JSON.stringify(result.error), botId }, 'Error saving AI context');
      return c.json({ error: 'Failed to save AI context' }, 500);
    }

    logger.info({ botId }, 'AI context saved');
    return c.json({ context: result.data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Validation error', details: error.issues }, 400);
    }
    logger.error({ err: String(error) }, 'Error in POST /context');
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Get bot media
app.get('/:botId/media', async (c) => {
  try {
    const botId = c.req.param('botId');
    const mediaType = c.req.query('type');

    const { data, error } = await supabaseAdmin.rpc('get_bot_media_by_type', {
      p_bot_id: botId,
      p_media_type: mediaType || null,
    });

    if (error) {
      logger.error({ err: JSON.stringify(error), botId }, 'Error getting bot media');
      return c.json({ error: 'Failed to get media' }, 500);
    }

    return c.json({ media: data || [] });
  } catch (error) {
    logger.error({ err: String(error) }, 'Error in GET /media');
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Create bot media
app.post('/:botId/media', async (c) => {
  try {
    const botId = c.req.param('botId');
    const body = await c.req.json();

    // Validate input
    const validated = botMediaSchema.parse(body);

    // Get bot and business_id
    const { data: bot, error: botError } = await supabaseAdmin
      .from('bots')
      .select('business_id')
      .eq('id', botId)
      .single();

    if (botError || !bot) {
      return c.json({ error: 'Bot not found' }, 404);
    }

    // Create media
    const { data, error } = await supabaseAdmin
      .from('bot_media')
      .insert({
        bot_id: botId,
        business_id: bot.business_id,
        ...validated,
      })
      .select()
      .single();

    if (error) {
      logger.error({ err: JSON.stringify(error), botId }, 'Error creating bot media');
      return c.json({ error: 'Failed to create media' }, 500);
    }

    logger.info({ botId, mediaId: data.id }, 'Bot media created');
    return c.json({ media: data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Validation error', details: error.issues }, 400);
    }
    logger.error({ err: String(error) }, 'Error in POST /media');
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Update bot media
app.put('/:botId/media/:mediaId', async (c) => {
  try {
    const botId = c.req.param('botId');
    const mediaId = c.req.param('mediaId');
    const body = await c.req.json();

    // Validate input
    const validated = botMediaSchema.partial().parse(body);

    // Update media
    const { data, error } = await supabaseAdmin
      .from('bot_media')
      .update({
        ...validated,
        updated_at: new Date().toISOString(),
      })
      .eq('id', mediaId)
      .eq('bot_id', botId)
      .select()
      .single();

    if (error) {
      logger.error({ err: JSON.stringify(error), botId, mediaId }, 'Error updating bot media');
      return c.json({ error: 'Failed to update media' }, 500);
    }

    logger.info({ botId, mediaId }, 'Bot media updated');
    return c.json({ media: data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Validation error', details: error.issues }, 400);
    }
    logger.error({ err: String(error) }, 'Error in PUT /media');
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Delete bot media
app.delete('/:botId/media/:mediaId', async (c) => {
  try {
    const botId = c.req.param('botId');
    const mediaId = c.req.param('mediaId');

    const { error } = await supabaseAdmin
      .from('bot_media')
      .delete()
      .eq('id', mediaId)
      .eq('bot_id', botId);

    if (error) {
      logger.error({ err: JSON.stringify(error), botId, mediaId }, 'Error deleting bot media');
      return c.json({ error: 'Failed to delete media' }, 500);
    }

    logger.info({ botId, mediaId }, 'Bot media deleted');
    return c.json({ success: true });
  } catch (error) {
    logger.error({ err: String(error) }, 'Error in DELETE /media');
    return c.json({ error: 'Internal server error' }, 500);
  }
});


// Upload media via JSON (base64) and store in Supabase Storage
app.post('/:botId/media/upload-json', async (c) => {
  try {
    const botId = c.req.param('botId');
    const body = await c.req.json();

    const schema = z.object({
      file_name: z.string().min(1),
      mime_type: z.string().min(1),
      base64: z.string().min(10),
      title: z.string().optional(),
      description: z.string().optional(),
    });
    const parsed = schema.parse(body);

    // Determine media_type from mime
    const mime = parsed.mime_type.toLowerCase();
    let mediaType: 'image' | 'video' | 'document' = 'document';
    if (mime.startsWith('image/')) mediaType = 'image';
    else if (mime.startsWith('video/')) mediaType = 'video';

    // Get bot and business
    const { data: bot, error: botErr } = await supabaseAdmin
      .from('bots')
      .select('business_id')
      .eq('id', botId)
      .single();
    if (botErr || !bot) return c.json({ error: 'Bot not found' }, 404);

    // Resolve Storage bucket name
    let bucketName = (process.env.SUPABASE_MEDIA_BUCKET || 'media').trim();
    try {
      const { data: buckets } = await (supabaseAdmin.storage as any).listBuckets?.();
      const list = Array.isArray(buckets) ? buckets : [];
      const hasPreferred = list.some((b: any) => b.name === bucketName);
      if (!hasPreferred) {
        if (list.length > 0) {
          bucketName = list[0].name; // fall back to first available bucket
        } else if ((supabaseAdmin.storage as any).createBucket) {
          await (supabaseAdmin.storage as any).createBucket(bucketName, { public: true });
        }
      }
    } catch (e) {
      logger.warn({ err: String(e) }, 'Bucket discovery/create failed (continuing with default)');
    }

    // Upload to Supabase Storage bucket under botId/
    const arrayBuffer = Buffer.from(parsed.base64, 'base64');
    const filePath = `${botId}/${Date.now()}_${parsed.file_name}`;
    const { error: uploadErr } = await supabaseAdmin.storage
      .from(bucketName)
      .upload(filePath, arrayBuffer, {
        contentType: parsed.mime_type,
        upsert: false,
      });
    if (uploadErr) {
      logger.error({ err: JSON.stringify(uploadErr) }, 'Storage upload error');
      return c.json({ error: 'Failed to upload to storage' }, 500);
    }

    // Get public URL
    const { data: pub } = supabaseAdmin.storage.from(bucketName).getPublicUrl(filePath);
    const publicUrl = pub?.publicUrl || null;

    // Insert into bot_media
    const { data: saved, error: saveErr } = await supabaseAdmin
      .from('bot_media')
      .insert({
        bot_id: botId,
        business_id: (bot as any).business_id,
        media_type: mediaType,
        title: parsed.title || parsed.file_name,
        description: parsed.description || null,
        file_url: publicUrl,
        file_name: parsed.file_name,
        file_size: arrayBuffer.byteLength,
        mime_type: parsed.mime_type,
        is_active: true,
      } as any)
      .select()
      .single();

    if (saveErr) {
      logger.error({ err: JSON.stringify(saveErr) }, 'Failed to save bot_media');
      return c.json({ error: 'Failed to save media record' }, 500);
    }

    return c.json({ media: saved });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Validation error', details: error.issues }, 400);
    }
    logger.error({ err: String(error) }, 'Error in POST /media/upload-json');
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default app;

