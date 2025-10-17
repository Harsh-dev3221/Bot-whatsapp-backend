-- Bot Dashboard Authentication Migration
-- This adds authentication for bot-specific dashboards

-- 1. Bot Credentials Table
-- Stores unique passwords for each bot dashboard
CREATE TABLE IF NOT EXISTS bot_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bot_id UUID UNIQUE NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  password_hash VARCHAR(255) NOT NULL,
  default_password VARCHAR(50), -- Store temporarily for first-time setup
  password_changed BOOLEAN DEFAULT false,
  last_login_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_bot_credentials_bot_id ON bot_credentials(bot_id);

-- 2. Function to generate random password
CREATE OR REPLACE FUNCTION generate_bot_password()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- Exclude similar looking chars
  result TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 3. Function to create bot credentials automatically
CREATE OR REPLACE FUNCTION create_bot_credentials()
RETURNS TRIGGER AS $$
DECLARE
  default_pwd TEXT;
BEGIN
  -- Generate a random default password
  default_pwd := generate_bot_password();
  
  -- Insert credentials with default password
  -- Note: In production, password_hash should be bcrypt hashed
  -- For now, we'll handle hashing in the application layer
  INSERT INTO bot_credentials (bot_id, password_hash, default_password, password_changed)
  VALUES (NEW.id, default_pwd, default_pwd, false);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Trigger to auto-create credentials when bot is created
DROP TRIGGER IF EXISTS trigger_create_bot_credentials ON bots;
CREATE TRIGGER trigger_create_bot_credentials
  AFTER INSERT ON bots
  FOR EACH ROW
  EXECUTE FUNCTION create_bot_credentials();

-- 5. Create credentials for existing bots with default password "test@bot"
DO $$
DECLARE
  bot_record RECORD;
BEGIN
  FOR bot_record IN SELECT id FROM bots WHERE id NOT IN (SELECT bot_id FROM bot_credentials)
  LOOP
    INSERT INTO bot_credentials (bot_id, password_hash, default_password, password_changed)
    VALUES (bot_record.id, 'test@bot', 'test@bot', false)
    ON CONFLICT (bot_id) DO NOTHING;
  END LOOP;

  RAISE NOTICE 'Created credentials for existing bots with default password "test@bot"';
END $$;

-- 6. Row Level Security
ALTER TABLE bot_credentials ENABLE ROW LEVEL SECURITY;

-- Bot credentials can only be accessed by the bot owner
CREATE POLICY "Bot owners can view their bot credentials"
  ON bot_credentials FOR SELECT
  USING (bot_id IN (
    SELECT b.id FROM bots b
    JOIN businesses bus ON b.business_id = bus.id
    JOIN users u ON u.business_id = bus.id
    WHERE u.id = auth.uid()
  ));

CREATE POLICY "Bot owners can update their bot credentials"
  ON bot_credentials FOR UPDATE
  USING (bot_id IN (
    SELECT b.id FROM bots b
    JOIN businesses bus ON b.business_id = bus.id
    JOIN users u ON u.business_id = bus.id
    WHERE u.id = auth.uid()
  ));

-- 7. Add updated_at trigger
CREATE OR REPLACE FUNCTION update_bot_credentials_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_bot_credentials_updated_at ON bot_credentials;
CREATE TRIGGER trigger_update_bot_credentials_updated_at
  BEFORE UPDATE ON bot_credentials
  FOR EACH ROW
  EXECUTE FUNCTION update_bot_credentials_updated_at();

-- 8. Add indexes for bookings analytics queries
CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at);
CREATE INDEX IF NOT EXISTS idx_bookings_customer_status ON bookings(customer_phone, status);
CREATE INDEX IF NOT EXISTS idx_bookings_bot_status_date ON bookings(bot_id, status, booking_date);

