-- Migration 003: Prevent Double Booking
-- Date: 2025-10-13
-- Purpose: Add unique constraint to prevent multiple bookings for the same time slot
-- Also add a function to check slot availability before booking

-- 1. Add unique constraint to prevent double booking
-- This ensures only one booking can exist for a specific business, date, and time
-- Excludes cancelled bookings from the constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_unique_slot 
ON bookings(business_id, booking_date, booking_time) 
WHERE status IN ('pending', 'confirmed');

-- 2. Create function to check if a time slot is available
CREATE OR REPLACE FUNCTION is_time_slot_available(
  p_business_id UUID,
  p_booking_date DATE,
  p_booking_time TIME
)
RETURNS BOOLEAN AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Check if there's already a booking for this slot
  SELECT COUNT(*) INTO v_count
  FROM bookings
  WHERE business_id = p_business_id
    AND booking_date = p_booking_date
    AND booking_time = p_booking_time
    AND status IN ('pending', 'confirmed');
  
  -- Return true if no bookings found (slot is available)
  RETURN v_count = 0;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION is_time_slot_available(UUID, DATE, TIME) TO authenticated;
GRANT EXECUTE ON FUNCTION is_time_slot_available(UUID, DATE, TIME) TO service_role;
GRANT EXECUTE ON FUNCTION is_time_slot_available(UUID, DATE, TIME) TO anon;

-- 3. Create function to safely create a booking (with race condition protection)
CREATE OR REPLACE FUNCTION create_booking_safe(
  p_business_id UUID,
  p_bot_id UUID,
  p_customer_name VARCHAR,
  p_customer_phone VARCHAR,
  p_booking_for VARCHAR,
  p_gender VARCHAR,
  p_service_id UUID,
  p_service_name VARCHAR,
  p_service_price DECIMAL,
  p_booking_date DATE,
  p_booking_time TIME,
  p_duration INTEGER,
  p_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  booking_id UUID,
  error_message TEXT
) AS $$
DECLARE
  v_booking_id UUID;
  v_is_available BOOLEAN;
BEGIN
  -- Check if slot is available
  v_is_available := is_time_slot_available(p_business_id, p_booking_date, p_booking_time);
  
  IF NOT v_is_available THEN
    -- Slot is already booked
    RETURN QUERY SELECT false, NULL::UUID, 'This time slot is no longer available. Please select another time.'::TEXT;
    RETURN;
  END IF;
  
  -- Try to insert the booking
  BEGIN
    INSERT INTO bookings (
      business_id,
      bot_id,
      customer_name,
      customer_phone,
      booking_for,
      gender,
      service_id,
      service_name,
      service_price,
      booking_date,
      booking_time,
      duration,
      status,
      notes
    ) VALUES (
      p_business_id,
      p_bot_id,
      p_customer_name,
      p_customer_phone,
      p_booking_for,
      p_gender,
      p_service_id,
      p_service_name,
      p_service_price,
      p_booking_date,
      p_booking_time,
      p_duration,
      'pending',
      p_notes
    )
    RETURNING id INTO v_booking_id;
    
    -- Success
    RETURN QUERY SELECT true, v_booking_id, NULL::TEXT;
    
  EXCEPTION
    WHEN unique_violation THEN
      -- Another booking was created at the same time (race condition)
      RETURN QUERY SELECT false, NULL::UUID, 'This time slot was just booked by someone else. Please select another time.'::TEXT;
    WHEN OTHERS THEN
      -- Other error
      RETURN QUERY SELECT false, NULL::UUID, ('Error creating booking: ' || SQLERRM)::TEXT;
  END;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION create_booking_safe(UUID, UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR, UUID, VARCHAR, DECIMAL, DATE, TIME, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION create_booking_safe(UUID, UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR, UUID, VARCHAR, DECIMAL, DATE, TIME, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION create_booking_safe(UUID, UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR, UUID, VARCHAR, DECIMAL, DATE, TIME, INTEGER, TEXT) TO anon;

-- 4. Add comment to explain the constraint
COMMENT ON INDEX idx_bookings_unique_slot IS 'Prevents double booking by ensuring only one active booking per time slot';

-- Test queries (optional - comment out if not needed)
-- 
-- -- Test 1: Check if a slot is available
-- SELECT is_time_slot_available(
--   'YOUR-BUSINESS-ID'::UUID,
--   CURRENT_DATE + 1,
--   '10:00:00'::TIME
-- );
-- 
-- -- Test 2: Try to create a booking
-- SELECT * FROM create_booking_safe(
--   'YOUR-BUSINESS-ID'::UUID,
--   'YOUR-BOT-ID'::UUID,
--   'John Doe',
--   '1234567890',
--   'self',
--   'male',
--   'YOUR-SERVICE-ID'::UUID,
--   'Haircut',
--   500.00,
--   CURRENT_DATE + 1,
--   '10:00:00'::TIME,
--   30,
--   NULL
-- );
-- 
-- -- Test 3: Try to create duplicate booking (should fail)
-- SELECT * FROM create_booking_safe(
--   'YOUR-BUSINESS-ID'::UUID,
--   'YOUR-BOT-ID'::UUID,
--   'Jane Doe',
--   '0987654321',
--   'self',
--   'female',
--   'YOUR-SERVICE-ID'::UUID,
--   'Haircut',
--   500.00,
--   CURRENT_DATE + 1,
--   '10:00:00'::TIME,
--   30,
--   NULL
-- );

