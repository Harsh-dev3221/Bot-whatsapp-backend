-- ============================================
-- Enable Web Chat for Existing Web Bots
-- ============================================
-- Sets enabled=true for all web bots
-- Date: 2025-10-14

-- Enable widget for all web bots (phone_number starts with 'web-')
UPDATE bot_widget_settings
SET enabled = true
WHERE bot_id IN (
  SELECT id FROM bots WHERE phone_number LIKE 'web-%'
);

