-- WhatsApp Bot SaaS Database Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Businesses table
CREATE TABLE IF NOT EXISTS businesses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(50) NOT NULL,
  subscription_status VARCHAR(20) DEFAULT 'trial' CHECK (subscription_status IN ('trial', 'active', 'inactive', 'cancelled')),
  subscription_plan VARCHAR(20) DEFAULT 'free' CHECK (subscription_plan IN ('free', 'basic', 'pro', 'enterprise')),
  trial_ends_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '14 days'),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bots table
CREATE TABLE IF NOT EXISTS bots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  phone_number VARCHAR(50) UNIQUE NOT NULL,
  status VARCHAR(20) DEFAULT 'disconnected' CHECK (status IN ('disconnected', 'connecting', 'connected', 'failed')),
  qr_code TEXT,
  last_connected_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bot sessions table (stores Baileys auth data)
CREATE TABLE IF NOT EXISTS bot_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bot_id UUID UNIQUE NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  session_data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bot settings table
CREATE TABLE IF NOT EXISTS bot_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bot_id UUID UNIQUE NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  greeting_message TEXT,
  auto_reply_enabled BOOLEAN DEFAULT false,
  auto_reply_message TEXT,
  business_hours_enabled BOOLEAN DEFAULT false,
  business_hours_start TIME,
  business_hours_end TIME,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  from_number VARCHAR(50) NOT NULL,
  to_number VARCHAR(50) NOT NULL,
  message_type VARCHAR(20) DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'video', 'audio', 'document')),
  content TEXT NOT NULL,
  media_url TEXT,
  direction VARCHAR(10) CHECK (direction IN ('inbound', 'outbound')),
  status VARCHAR(20) DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Users table (admin users)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_bots_business_id ON bots(business_id);
CREATE INDEX IF NOT EXISTS idx_bots_status ON bots(status);
CREATE INDEX IF NOT EXISTS idx_messages_bot_id ON messages(bot_id);
CREATE INDEX IF NOT EXISTS idx_messages_business_id ON messages(business_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_business_id ON users(business_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Row Level Security (RLS) Policies
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE bots ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Businesses: Users can only see their own business
CREATE POLICY "Users can view their own business"
  ON businesses FOR SELECT
  USING (id IN (SELECT business_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can update their own business"
  ON businesses FOR UPDATE
  USING (id IN (SELECT business_id FROM users WHERE id = auth.uid()));

-- Bots: Users can only see bots from their business
CREATE POLICY "Users can view their business bots"
  ON bots FOR SELECT
  USING (business_id IN (SELECT business_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can create bots for their business"
  ON bots FOR INSERT
  WITH CHECK (business_id IN (SELECT business_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can update their business bots"
  ON bots FOR UPDATE
  USING (business_id IN (SELECT business_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can delete their business bots"
  ON bots FOR DELETE
  USING (business_id IN (SELECT business_id FROM users WHERE id = auth.uid()));

-- Bot sessions: Users can only access sessions for their bots
CREATE POLICY "Users can view their bot sessions"
  ON bot_sessions FOR SELECT
  USING (bot_id IN (SELECT id FROM bots WHERE business_id IN (SELECT business_id FROM users WHERE id = auth.uid())));

CREATE POLICY "Users can manage their bot sessions"
  ON bot_sessions FOR ALL
  USING (bot_id IN (SELECT id FROM bots WHERE business_id IN (SELECT business_id FROM users WHERE id = auth.uid())));

-- Bot settings: Users can only access settings for their bots
CREATE POLICY "Users can view their bot settings"
  ON bot_settings FOR SELECT
  USING (bot_id IN (SELECT id FROM bots WHERE business_id IN (SELECT business_id FROM users WHERE id = auth.uid())));

CREATE POLICY "Users can manage their bot settings"
  ON bot_settings FOR ALL
  USING (bot_id IN (SELECT id FROM bots WHERE business_id IN (SELECT business_id FROM users WHERE id = auth.uid())));

-- Messages: Users can only see messages from their business
CREATE POLICY "Users can view their business messages"
  ON messages FOR SELECT
  USING (business_id IN (SELECT business_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can create messages for their business"
  ON messages FOR INSERT
  WITH CHECK (business_id IN (SELECT business_id FROM users WHERE id = auth.uid()));

-- Users: Users can view other users in their business
CREATE POLICY "Users can view users in their business"
  ON users FOR SELECT
  USING (business_id IN (SELECT business_id FROM users WHERE id = auth.uid()));

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_businesses_updated_at BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bots_updated_at BEFORE UPDATE ON bots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bot_sessions_updated_at BEFORE UPDATE ON bot_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bot_settings_updated_at BEFORE UPDATE ON bot_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

