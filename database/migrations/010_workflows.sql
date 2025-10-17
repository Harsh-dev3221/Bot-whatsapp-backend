-- Workflows + Inquiries + Knowledge Base (additive)
-- Run in Supabase SQL Editor

-- 0) Safety
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1) Alter bot_settings: workflow_enabled default true, workflow_setup_required
DO $$ BEGIN
  ALTER TABLE bot_settings
    ADD COLUMN IF NOT EXISTS workflow_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS workflow_setup_required BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN undefined_table THEN
  -- bot_settings may be created in a separate migration; skip if missing
  RAISE NOTICE 'bot_settings table not found, skipping column additions';
END $$;

-- 2) Workflows
CREATE TABLE IF NOT EXISTS workflows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  workflow_type VARCHAR(50) NOT NULL DEFAULT 'custom',
  status VARCHAR(20) NOT NULL DEFAULT 'published', -- 'draft' | 'published'
  trigger JSONB NOT NULL DEFAULT '{}',
  steps JSONB NOT NULL DEFAULT '[]',
  actions JSONB NOT NULL DEFAULT '[]',
  ai_context JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflows_bot ON workflows(bot_id);
CREATE INDEX IF NOT EXISTS idx_workflows_active ON workflows(bot_id, is_active);
CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);

-- 3) Workflow Conversations (state per user)
CREATE TABLE IF NOT EXISTS workflow_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  user_key VARCHAR(255) NOT NULL, -- phone for WA or sessionId for Web
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  current_step_id VARCHAR(100) NOT NULL,
  state JSONB NOT NULL DEFAULT '{}',
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  channel VARCHAR(20) NOT NULL DEFAULT 'whatsapp', -- 'whatsapp' | 'web'
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wf_convo_lookup ON workflow_conversations(bot_id, user_key) WHERE is_completed = FALSE;
CREATE INDEX IF NOT EXISTS idx_wf_convo_bot ON workflow_conversations(bot_id);

-- 4) Inquiries (generic capture for non-booking outcomes)
CREATE TABLE IF NOT EXISTS inquiries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  workflow_id UUID REFERENCES workflows(id) ON DELETE SET NULL,
  customer_data JSONB NOT NULL DEFAULT '{}',
  inquiry_data JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending/contacted/completed/cancelled
  source VARCHAR(50) DEFAULT 'whatsapp', -- whatsapp/web
  customer_phone VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inquiries_bot ON inquiries(bot_id);
CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries(status);

-- 5) Knowledge Base (per-bot categories)
CREATE TABLE IF NOT EXISTS knowledge_base (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  category VARCHAR(100) NOT NULL, -- 'product_catalog','services','faqs','policies'
  items JSONB,       -- array of products/services
  qa_pairs JSONB,    -- array of {question, answer}
  policy_text TEXT,
  files JSONB,       -- array of {name,url,type}
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kb_bot_category ON knowledge_base(bot_id, category);

-- 6) Triggers to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER set_timestamp_workflows
    BEFORE UPDATE ON workflows
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER set_timestamp_wf_conversations
    BEFORE UPDATE ON workflow_conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER set_timestamp_inquiries
    BEFORE UPDATE ON inquiries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER set_timestamp_kb
    BEFORE UPDATE ON knowledge_base
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

