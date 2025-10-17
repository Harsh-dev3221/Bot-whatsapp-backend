-- Set default password for existing bots
-- This migration sets "test@bot" as the default password for all existing bots

-- Update existing bot credentials to use "test@bot" as default password
UPDATE bot_credentials
SET 
  password_hash = 'test@bot',
  default_password = 'test@bot',
  password_changed = false
WHERE password_changed = false;

-- For any bots that don't have credentials yet, create them with "test@bot"
INSERT INTO bot_credentials (bot_id, password_hash, default_password, password_changed)
SELECT 
  b.id,
  'test@bot',
  'test@bot',
  false
FROM bots b
WHERE NOT EXISTS (
  SELECT 1 FROM bot_credentials bc WHERE bc.bot_id = b.id
)
ON CONFLICT (bot_id) DO NOTHING;

-- Log the changes
DO $$
DECLARE
  updated_count INTEGER;
  created_count INTEGER;
BEGIN
  -- Count updated credentials
  SELECT COUNT(*) INTO updated_count
  FROM bot_credentials
  WHERE default_password = 'test@bot' AND password_changed = false;
  
  RAISE NOTICE 'Updated/Created credentials for % bots with default password "test@bot"', updated_count;
END $$;

