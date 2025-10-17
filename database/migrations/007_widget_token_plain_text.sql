-- ============================================
-- Migration: Widget Token Plain Text Storage
-- ============================================
-- Changes widget_token_hash to widget_token (plain text)
-- This allows admins to view/copy/refresh tokens like API keys
-- Date: 2025-10-14

-- Step 1: Add new column for plain text token
ALTER TABLE bot_widget_settings 
ADD COLUMN IF NOT EXISTS widget_token TEXT;

-- Step 2: For existing rows, generate new tokens (old hashed tokens cannot be recovered)
-- Admins will need to refresh tokens for existing bots
UPDATE bot_widget_settings 
SET widget_token = encode(gen_random_bytes(32), 'hex')
WHERE widget_token IS NULL;

-- Step 3: Make widget_token NOT NULL
ALTER TABLE bot_widget_settings 
ALTER COLUMN widget_token SET NOT NULL;

-- Step 4: Drop the old hashed column
ALTER TABLE bot_widget_settings 
DROP COLUMN IF EXISTS widget_token_hash;

-- ============================================
-- NOTES:
-- ============================================
-- 1. Existing widget tokens will be regenerated
-- 2. Admins need to update their embed codes with new tokens
-- 3. Tokens are now stored in plain text (like API keys)
-- 4. Admins can view/copy tokens anytime from bot settings
-- 5. Admins can refresh tokens using POST /api/web-bot/:botId/refresh-token

