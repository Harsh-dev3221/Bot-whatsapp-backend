-- Web Chat Channel Migration
-- Date: 2025-10-14
-- Purpose: Add embeddable web chat channel support alongside WhatsApp
-- Architecture: docs/WEB_CHAT_ARCHITECTURE.txt

-- ============================================
-- 1. CREATE MESSAGE CHANNEL ENUM
-- ============================================

-- Create enum for message channels
DO $$ BEGIN
  CREATE TYPE message_channel AS ENUM ('whatsapp', 'web');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ============================================
-- 2. CREATE BOT_WIDGET_SETTINGS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS bot_widget_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bot_id UUID UNIQUE NOT NULL REFERENCES bots(id) ON DELETE CASCADE,

  -- Widget Configuration
  enabled BOOLEAN NOT NULL DEFAULT false,
  widget_token TEXT NOT NULL, -- Stored in plain text like API keys
  allowed_origins TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  
  -- Theme & Appearance
  theme JSONB NOT NULL DEFAULT '{
    "primaryColor": "#5A3EF0",
    "position": "bottom-right",
    "avatarUrl": null,
    "bubbleText": "Chat with us"
  }'::JSONB,
  
  -- Greeting Message
  greeting TEXT DEFAULT 'Hello! How can I help you today?',
  
  -- Rate Limits
  rate_limits JSONB NOT NULL DEFAULT '{
    "sessionPerMin": 10,
    "messagePerMin": 60
  }'::JSONB,
  
  -- Token Management
  token_version INTEGER NOT NULL DEFAULT 1,
  rotated_at TIMESTAMP WITH TIME ZONE,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for bot_widget_settings
CREATE INDEX IF NOT EXISTS idx_bot_widget_settings_bot_id ON bot_widget_settings(bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_widget_settings_enabled ON bot_widget_settings(enabled) WHERE enabled = true;

-- GIN index for allowed_origins array searches
CREATE INDEX IF NOT EXISTS idx_bot_widget_settings_origins ON bot_widget_settings USING GIN(allowed_origins);

-- ============================================
-- 3. CREATE WEB_SESSIONS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS web_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  
  -- Session Info
  origin TEXT NOT NULL,
  origin_url TEXT,
  user_agent TEXT,
  
  -- Metadata (UTM params, custom data from website)
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  
  -- Session State
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '14 days'),
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for web_sessions
CREATE INDEX IF NOT EXISTS idx_web_sessions_bot_id_created ON web_sessions(bot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_web_sessions_bot_id_origin ON web_sessions(bot_id, origin);
CREATE INDEX IF NOT EXISTS idx_web_sessions_expires_at ON web_sessions(expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_web_sessions_status ON web_sessions(status);

-- ============================================
-- 4. ALTER MESSAGES TABLE
-- ============================================

-- Add channel column (default to 'whatsapp' for existing messages)
DO $$ BEGIN
  ALTER TABLE messages ADD COLUMN channel message_channel NOT NULL DEFAULT 'whatsapp';
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;

-- Add session_id for web channel messages
DO $$ BEGIN
  ALTER TABLE messages ADD COLUMN session_id UUID REFERENCES web_sessions(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;

-- Add origin_url for web channel messages
DO $$ BEGIN
  ALTER TABLE messages ADD COLUMN origin_url TEXT;
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;

-- Add user_agent for web channel messages
DO $$ BEGIN
  ALTER TABLE messages ADD COLUMN user_agent TEXT;
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;

-- Add metadata column for intent, sentiment, etc.
DO $$ BEGIN
  ALTER TABLE messages ADD COLUMN metadata JSONB DEFAULT '{}'::JSONB;
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;

-- Indexes for messages table (channel-aware)
CREATE INDEX IF NOT EXISTS idx_messages_channel_created ON messages(bot_id, channel, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id, created_at ASC) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);

-- ============================================
-- 5. BACKFILL EXISTING MESSAGES
-- ============================================

-- Set channel to 'whatsapp' for all existing messages (if not already set)
UPDATE messages SET channel = 'whatsapp' WHERE channel IS NULL;

-- ============================================
-- 6. TRIGGERS FOR UPDATED_AT
-- ============================================

-- Trigger function for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for bot_widget_settings
DROP TRIGGER IF EXISTS trigger_bot_widget_settings_updated_at ON bot_widget_settings;
CREATE TRIGGER trigger_bot_widget_settings_updated_at
  BEFORE UPDATE ON bot_widget_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 7. ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on new tables
ALTER TABLE bot_widget_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for bot_widget_settings
-- Bot owners can view their widget settings
CREATE POLICY "Bot owners can view widget settings"
  ON bot_widget_settings FOR SELECT
  USING (bot_id IN (
    SELECT b.id FROM bots b
    JOIN businesses bus ON b.business_id = bus.id
    JOIN users u ON u.business_id = bus.id
    WHERE u.id = auth.uid()
  ));

-- Bot owners can update their widget settings
CREATE POLICY "Bot owners can update widget settings"
  ON bot_widget_settings FOR UPDATE
  USING (bot_id IN (
    SELECT b.id FROM bots b
    JOIN businesses bus ON b.business_id = bus.id
    JOIN users u ON u.business_id = bus.id
    WHERE u.id = auth.uid()
  ));

-- Bot owners can insert widget settings
CREATE POLICY "Bot owners can insert widget settings"
  ON bot_widget_settings FOR INSERT
  WITH CHECK (bot_id IN (
    SELECT b.id FROM bots b
    JOIN businesses bus ON b.business_id = bus.id
    JOIN users u ON u.business_id = bus.id
    WHERE u.id = auth.uid()
  ));

-- RLS Policies for web_sessions
-- Bot owners can view their web sessions
CREATE POLICY "Bot owners can view web sessions"
  ON web_sessions FOR SELECT
  USING (bot_id IN (
    SELECT b.id FROM bots b
    JOIN businesses bus ON b.business_id = bus.id
    JOIN users u ON u.business_id = bus.id
    WHERE u.id = auth.uid()
  ));

-- Service role can manage all web sessions (for API)
CREATE POLICY "Service role can manage web sessions"
  ON web_sessions FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- ============================================
-- 8. HELPER FUNCTIONS
-- ============================================

-- Function to cleanup expired web sessions
CREATE OR REPLACE FUNCTION cleanup_expired_web_sessions()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM web_sessions
  WHERE status = 'active'
    AND expires_at < NOW();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get active web sessions count for a bot
CREATE OR REPLACE FUNCTION get_active_web_sessions_count(p_bot_id UUID)
RETURNS INTEGER AS $$
DECLARE
  session_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO session_count
  FROM web_sessions
  WHERE bot_id = p_bot_id
    AND status = 'active'
    AND (expires_at IS NULL OR expires_at > NOW());
  
  RETURN session_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 9. COMMENTS FOR DOCUMENTATION
-- ============================================

COMMENT ON TABLE bot_widget_settings IS 'Configuration for embeddable web chat widget per bot';
COMMENT ON TABLE web_sessions IS 'Anonymous web chat sessions with metadata and expiry';
COMMENT ON COLUMN messages.channel IS 'Message channel: whatsapp or web';
COMMENT ON COLUMN messages.session_id IS 'Web session ID for web channel messages';
COMMENT ON COLUMN messages.metadata IS 'Additional message metadata (intent, sentiment, etc.)';

-- ============================================
-- MIGRATION COMPLETE
-- ============================================

-- Log migration completion
DO $$
BEGIN
  RAISE NOTICE 'Migration 006_web_chat_channel.sql completed successfully';
  RAISE NOTICE 'Created: message_channel enum, bot_widget_settings table, web_sessions table';
  RAISE NOTICE 'Updated: messages table with channel, session_id, origin_url, user_agent, metadata columns';
  RAISE NOTICE 'Next steps: Update TypeScript types in Backend/src/types/database.ts';
END $$;

