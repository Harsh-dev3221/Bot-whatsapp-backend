-- ============================================
-- Enable Booking by Default for All Bots
-- ============================================
-- Date: 2025-10-17
-- Purpose: Set booking_enabled=true for all existing bots
--          and ensure all future bots have booking enabled by default

-- 1. Enable booking for ALL existing bots
UPDATE bot_settings
SET 
  booking_enabled = true,
  booking_trigger_keywords = COALESCE(booking_trigger_keywords, ARRAY['book', 'booking', 'appointment', 'schedule', 'reserve']),
  booking_confirmation_message = COALESCE(booking_confirmation_message, 'Your booking has been confirmed! We look forward to seeing you.'),
  booking_cancellation_message = COALESCE(booking_cancellation_message, 'Your booking has been cancelled. Feel free to book again anytime!'),
  booking_require_gender = COALESCE(booking_require_gender, true),
  booking_require_booking_for = COALESCE(booking_require_booking_for, true);

-- 2. Create bot_settings for bots that don't have settings yet (if any)
INSERT INTO bot_settings (bot_id, booking_enabled, auto_reply_enabled, business_hours_enabled, booking_trigger_keywords, booking_confirmation_message, booking_cancellation_message, booking_require_gender, booking_require_booking_for)
SELECT 
  b.id,
  true, -- booking_enabled = true by default
  false, -- auto_reply_enabled
  false, -- business_hours_enabled
  ARRAY['book', 'booking', 'appointment', 'schedule', 'reserve'], -- booking_trigger_keywords
  'Your booking has been confirmed! We look forward to seeing you.', -- booking_confirmation_message
  'Your booking has been cancelled. Feel free to book again anytime!', -- booking_cancellation_message
  true, -- booking_require_gender
  true  -- booking_require_booking_for
FROM bots b
WHERE NOT EXISTS (
  SELECT 1 FROM bot_settings bs WHERE bs.bot_id = b.id
)
ON CONFLICT (bot_id) DO NOTHING;

-- 3. Update the default value for booking_enabled column
ALTER TABLE bot_settings 
  ALTER COLUMN booking_enabled SET DEFAULT true;

-- 4. Log the changes
DO $$
DECLARE
  updated_count INTEGER;
  created_count INTEGER;
  total_bots INTEGER;
BEGIN
  -- Count updated settings
  SELECT COUNT(*) INTO updated_count
  FROM bot_settings
  WHERE booking_enabled = true;

  -- Count total bots
  SELECT COUNT(*) INTO total_bots
  FROM bots;

  RAISE NOTICE '============================================';
  RAISE NOTICE 'Migration Complete: Enable Booking by Default';
  RAISE NOTICE '============================================';
  RAISE NOTICE 'Total bots: %', total_bots;
  RAISE NOTICE 'Bots with booking enabled: %', updated_count;
  RAISE NOTICE 'Default booking_enabled changed to: TRUE';
  RAISE NOTICE '============================================';
END $$;

-- 5. Verify the changes
SELECT 
  COUNT(*) as total_bots,
  SUM(CASE WHEN bs.booking_enabled = true THEN 1 ELSE 0 END) as booking_enabled_count
FROM bots b
LEFT JOIN bot_settings bs ON b.id = bs.bot_id;
