-- Migration 004: Business Context and Media Support
-- Date: 2025-10-13
-- Purpose: Add business context for AI and media support

-- 1. Add business context columns to businesses table
ALTER TABLE businesses 
  ADD COLUMN IF NOT EXISTS business_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS business_category VARCHAR(100),
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS website VARCHAR(255);

-- 2. Create bot_ai_context table
CREATE TABLE IF NOT EXISTS bot_ai_context (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bot_id UUID UNIQUE NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  
  -- AI Context (REQUIRED)
  business_context TEXT NOT NULL,
  system_prompt TEXT,
  
  -- Topic Control
  allowed_topics TEXT[] DEFAULT ARRAY[]::TEXT[],
  restricted_topics TEXT[] DEFAULT ARRAY[]::TEXT[],
  
  -- Response Style
  response_style VARCHAR(50) DEFAULT 'professional' CHECK (response_style IN ('professional', 'friendly', 'casual', 'formal')),
  max_response_length INTEGER DEFAULT 500,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Create bot_media table (per-bot media, not business-wide)
CREATE TABLE IF NOT EXISTS bot_media (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  
  -- Media Type
  media_type VARCHAR(20) NOT NULL CHECK (media_type IN ('image', 'video', 'document', 'location', 'contact')),
  
  -- Media Info
  title VARCHAR(255),
  description TEXT,
  
  -- File Info (for image/video/document)
  file_url TEXT,
  file_name VARCHAR(255),
  file_size INTEGER,
  mime_type VARCHAR(100),
  
  -- Location Info (for location type)
  location_name VARCHAR(255),
  location_address TEXT,
  location_latitude DECIMAL(10, 8),
  location_longitude DECIMAL(11, 8),
  
  -- Contact Info (for contact type)
  contact_name VARCHAR(255),
  contact_phone VARCHAR(50),
  contact_email VARCHAR(255),
  contact_vcard TEXT,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  -- Settings
  is_required BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Create indexes
CREATE INDEX IF NOT EXISTS idx_bot_ai_context_bot_id ON bot_ai_context(bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_ai_context_business_id ON bot_ai_context(business_id);
CREATE INDEX IF NOT EXISTS idx_bot_media_bot_id ON bot_media(bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_media_business_id ON bot_media(business_id);
CREATE INDEX IF NOT EXISTS idx_bot_media_type ON bot_media(media_type);
CREATE INDEX IF NOT EXISTS idx_bot_media_active ON bot_media(is_active);

-- 5. Create updated_at trigger function (if not exists)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Add triggers for updated_at
DROP TRIGGER IF EXISTS update_bot_ai_context_updated_at ON bot_ai_context;
CREATE TRIGGER update_bot_ai_context_updated_at
  BEFORE UPDATE ON bot_ai_context
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_bot_media_updated_at ON bot_media;
CREATE TRIGGER update_bot_media_updated_at
  BEFORE UPDATE ON bot_media
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 7. Enable RLS
ALTER TABLE bot_ai_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_media ENABLE ROW LEVEL SECURITY;

-- 8. Create RLS policies for bot_ai_context
DROP POLICY IF EXISTS "Users can view their bot AI context" ON bot_ai_context;
CREATE POLICY "Users can view their bot AI context"
  ON bot_ai_context FOR SELECT
  USING (business_id IN (SELECT business_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can insert their bot AI context" ON bot_ai_context;
CREATE POLICY "Users can insert their bot AI context"
  ON bot_ai_context FOR INSERT
  WITH CHECK (business_id IN (SELECT business_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can update their bot AI context" ON bot_ai_context;
CREATE POLICY "Users can update their bot AI context"
  ON bot_ai_context FOR UPDATE
  USING (business_id IN (SELECT business_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can delete their bot AI context" ON bot_ai_context;
CREATE POLICY "Users can delete their bot AI context"
  ON bot_ai_context FOR DELETE
  USING (business_id IN (SELECT business_id FROM users WHERE id = auth.uid()));

-- 9. Create RLS policies for bot_media
DROP POLICY IF EXISTS "Users can view their bot media" ON bot_media;
CREATE POLICY "Users can view their bot media"
  ON bot_media FOR SELECT
  USING (business_id IN (SELECT business_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can insert their bot media" ON bot_media;
CREATE POLICY "Users can insert their bot media"
  ON bot_media FOR INSERT
  WITH CHECK (business_id IN (SELECT business_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can update their bot media" ON bot_media;
CREATE POLICY "Users can update their bot media"
  ON bot_media FOR UPDATE
  USING (business_id IN (SELECT business_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can delete their bot media" ON bot_media;
CREATE POLICY "Users can delete their bot media"
  ON bot_media FOR DELETE
  USING (business_id IN (SELECT business_id FROM users WHERE id = auth.uid()));

-- 10. Add comments
COMMENT ON TABLE bot_ai_context IS 'Stores AI context and behavior settings for each bot';
COMMENT ON TABLE bot_media IS 'Stores media files (images, videos, documents, location, contacts) for each bot';
COMMENT ON COLUMN bot_ai_context.business_context IS 'REQUIRED: Business description and context for AI to understand the business';
COMMENT ON COLUMN bot_media.is_required IS 'If true, this media must be sent in certain scenarios';

-- 11. Create function to get bot AI context
CREATE OR REPLACE FUNCTION get_bot_ai_context(p_bot_id UUID)
RETURNS TABLE (
  bot_id UUID,
  business_id UUID,
  business_name VARCHAR,
  business_type VARCHAR,
  business_category VARCHAR,
  business_description TEXT,
  business_address TEXT,
  business_context TEXT,
  system_prompt TEXT,
  allowed_topics TEXT[],
  restricted_topics TEXT[],
  response_style VARCHAR,
  max_response_length INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    b.id as bot_id,
    b.business_id,
    bu.name as business_name,
    bu.business_type,
    bu.business_category,
    bu.description as business_description,
    bu.address as business_address,
    bac.business_context,
    bac.system_prompt,
    bac.allowed_topics,
    bac.restricted_topics,
    bac.response_style,
    bac.max_response_length
  FROM bots b
  JOIN businesses bu ON b.business_id = bu.id
  LEFT JOIN bot_ai_context bac ON b.id = bac.bot_id
  WHERE b.id = p_bot_id;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_bot_ai_context(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_bot_ai_context(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION get_bot_ai_context(UUID) TO anon;

-- 12. Create function to get bot media by type
CREATE OR REPLACE FUNCTION get_bot_media_by_type(
  p_bot_id UUID,
  p_media_type VARCHAR DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  media_type VARCHAR,
  title VARCHAR,
  description TEXT,
  file_url TEXT,
  file_name VARCHAR,
  location_name VARCHAR,
  location_address TEXT,
  location_latitude DECIMAL,
  location_longitude DECIMAL,
  contact_name VARCHAR,
  contact_phone VARCHAR,
  contact_email VARCHAR,
  contact_vcard TEXT,
  is_required BOOLEAN,
  is_active BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    bm.id,
    bm.media_type,
    bm.title,
    bm.description,
    bm.file_url,
    bm.file_name,
    bm.location_name,
    bm.location_address,
    bm.location_latitude,
    bm.location_longitude,
    bm.contact_name,
    bm.contact_phone,
    bm.contact_email,
    bm.contact_vcard,
    bm.is_required,
    bm.is_active
  FROM bot_media bm
  WHERE bm.bot_id = p_bot_id
    AND bm.is_active = true
    AND (p_media_type IS NULL OR bm.media_type = p_media_type)
  ORDER BY bm.display_order, bm.created_at;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_bot_media_by_type(UUID, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_bot_media_by_type(UUID, VARCHAR) TO service_role;
GRANT EXECUTE ON FUNCTION get_bot_media_by_type(UUID, VARCHAR) TO anon;

