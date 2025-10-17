-- Migration 002: Fix get_available_time_slots function
-- Date: 2025-10-13
-- Issue: generate_series with TIME parameters doesn't exist in PostgreSQL
-- Solution: Use minute-based generation with TIMESTAMP arithmetic

-- Drop the old function
DROP FUNCTION IF EXISTS get_available_time_slots(UUID, DATE, INTEGER);

-- Create the fixed function
CREATE OR REPLACE FUNCTION get_available_time_slots(
  p_business_id UUID,
  p_date DATE,
  p_day_of_week INTEGER
)
RETURNS TABLE (
  slot_time TIME,
  is_available BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  WITH time_config AS (
    -- Get time configuration for the business and day
    SELECT 
      bts.start_time,
      bts.end_time,
      bts.slot_duration
    FROM business_time_slots bts
    WHERE bts.business_id = p_business_id
      AND bts.day_of_week = p_day_of_week
      AND bts.is_active = true
    LIMIT 1
  ),
  time_slots AS (
    -- Generate time slots by adding minutes to start_time
    -- Example: If start=10:00, end=20:00, duration=30
    -- Generates: 0, 30, 60, 90, ... minutes
    -- Then adds to start_time: 10:00, 10:30, 11:00, 11:30, ...
    SELECT 
      (p_date + tc.start_time + (n || ' minutes')::INTERVAL)::TIME AS slot_time
    FROM time_config tc
    CROSS JOIN generate_series(
      0,  -- Start at 0 minutes
      EXTRACT(EPOCH FROM (tc.end_time - tc.start_time))::INTEGER / 60 - tc.slot_duration,  -- End before last slot
      tc.slot_duration  -- Step by slot duration
    ) AS n
  ),
  booked_slots AS (
    -- Get already booked slots for this date
    SELECT booking_time
    FROM bookings
    WHERE business_id = p_business_id
      AND booking_date = p_date
      AND status IN ('pending', 'confirmed')
  )
  -- Join time slots with bookings to mark availability
  SELECT 
    ts.slot_time,
    CASE WHEN bs.booking_time IS NULL THEN true ELSE false END AS is_available
  FROM time_slots ts
  LEFT JOIN booked_slots bs ON ts.slot_time = bs.booking_time
  ORDER BY ts.slot_time;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions for the function
GRANT EXECUTE ON FUNCTION get_available_time_slots(UUID, DATE, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_available_time_slots(UUID, DATE, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION get_available_time_slots(UUID, DATE, INTEGER) TO anon;

-- Test the function (optional - comment out if not needed)
-- SELECT * FROM get_available_time_slots(
--   'YOUR-BUSINESS-ID'::UUID,
--   CURRENT_DATE + 1,
--   EXTRACT(DOW FROM CURRENT_DATE + 1)::INTEGER
-- );

