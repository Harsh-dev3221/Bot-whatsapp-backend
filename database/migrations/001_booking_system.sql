-- Booking System Database Migration
-- Run this in Supabase SQL Editor

-- 1. Business Services Table
CREATE TABLE IF NOT EXISTS business_services (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(10, 2),
  duration INTEGER DEFAULT 30, -- in minutes
  category VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_business_services_business_id ON business_services(business_id);
CREATE INDEX IF NOT EXISTS idx_business_services_active ON business_services(is_active);

-- 2. Business Time Slots Table
CREATE TABLE IF NOT EXISTS business_time_slots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL, -- 0=Sunday, 1=Monday, ..., 6=Saturday
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  slot_duration INTEGER DEFAULT 30, -- in minutes
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_day_of_week CHECK (day_of_week >= 0 AND day_of_week <= 6),
  CONSTRAINT valid_time_range CHECK (end_time > start_time)
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_business_time_slots_business_id ON business_time_slots(business_id);
CREATE INDEX IF NOT EXISTS idx_business_time_slots_day ON business_time_slots(day_of_week);

-- 3. Bookings Table
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  customer_name VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(50) NOT NULL,
  booking_for VARCHAR(255), -- person name or "self"
  gender VARCHAR(20),
  service_id UUID REFERENCES business_services(id) ON DELETE SET NULL,
  service_name VARCHAR(255) NOT NULL, -- denormalized for history
  service_price DECIMAL(10, 2),
  booking_date DATE NOT NULL,
  booking_time TIME NOT NULL,
  duration INTEGER DEFAULT 30, -- in minutes
  status VARCHAR(50) DEFAULT 'pending', -- pending, confirmed, cancelled, completed, no_show
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_status CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed', 'no_show'))
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_bookings_business_id ON bookings(business_id);
CREATE INDEX IF NOT EXISTS idx_bookings_bot_id ON bookings(bot_id);
CREATE INDEX IF NOT EXISTS idx_bookings_customer_phone ON bookings(customer_phone);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(booking_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_date_time ON bookings(booking_date, booking_time);

-- 4. Booking Conversations Table (for state management)
CREATE TABLE IF NOT EXISTS booking_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_phone VARCHAR(50) NOT NULL,
  conversation_state JSONB NOT NULL DEFAULT '{}', -- stores current step, collected data
  current_step VARCHAR(50) NOT NULL DEFAULT 'idle',
  is_completed BOOLEAN DEFAULT false,
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '30 minutes'),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(bot_id, customer_phone, is_completed) -- Only one active conversation per customer per bot
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_booking_conversations_bot_phone ON booking_conversations(bot_id, customer_phone);
CREATE INDEX IF NOT EXISTS idx_booking_conversations_active ON booking_conversations(is_completed) WHERE is_completed = false;
CREATE INDEX IF NOT EXISTS idx_booking_conversations_expires ON booking_conversations(expires_at);

-- 5. Extend bot_settings table with booking configuration
ALTER TABLE bot_settings 
  ADD COLUMN IF NOT EXISTS booking_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS booking_trigger_keywords TEXT[] DEFAULT ARRAY['book', 'booking', 'appointment', 'schedule', 'reserve'],
  ADD COLUMN IF NOT EXISTS booking_confirmation_message TEXT DEFAULT 'Your booking has been confirmed! We look forward to seeing you.',
  ADD COLUMN IF NOT EXISTS booking_cancellation_message TEXT DEFAULT 'Your booking has been cancelled. Feel free to book again anytime!',
  ADD COLUMN IF NOT EXISTS booking_require_gender BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS booking_require_booking_for BOOLEAN DEFAULT true;

-- 6. Create function to clean up expired conversations
CREATE OR REPLACE FUNCTION cleanup_expired_booking_conversations()
RETURNS void AS $$
BEGIN
  UPDATE booking_conversations
  SET is_completed = true
  WHERE expires_at < NOW() AND is_completed = false;
END;
$$ LANGUAGE plpgsql;

-- 7. Create function to get available time slots
-- Fixed version: generate_series with TIME doesn't work in PostgreSQL
-- Using minute-based generation instead
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
    SELECT
      (p_date + tc.start_time + (n || ' minutes')::INTERVAL)::TIME AS slot_time
    FROM time_config tc
    CROSS JOIN generate_series(
      0,
      EXTRACT(EPOCH FROM (tc.end_time - tc.start_time))::INTEGER / 60 - tc.slot_duration,
      tc.slot_duration
    ) AS n
  ),
  booked_slots AS (
    SELECT booking_time
    FROM bookings
    WHERE business_id = p_business_id
      AND booking_date = p_date
      AND status IN ('pending', 'confirmed')
  )
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

-- 8. Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 9. Add triggers for updated_at (drop if exists first)
DROP TRIGGER IF EXISTS update_business_services_updated_at ON business_services;
CREATE TRIGGER update_business_services_updated_at
  BEFORE UPDATE ON business_services
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_business_time_slots_updated_at ON business_time_slots;
CREATE TRIGGER update_business_time_slots_updated_at
  BEFORE UPDATE ON business_time_slots
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_bookings_updated_at ON bookings;
CREATE TRIGGER update_bookings_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_booking_conversations_updated_at ON booking_conversations;
CREATE TRIGGER update_booking_conversations_updated_at
  BEFORE UPDATE ON booking_conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 10. Insert sample data for testing (optional)
-- Uncomment to add sample services for a business

/*
INSERT INTO business_services (business_id, name, description, price, duration, category, display_order)
VALUES 
  ((SELECT id FROM businesses LIMIT 1), 'Haircut', 'Professional haircut service', 500.00, 30, 'Hair', 1),
  ((SELECT id FROM businesses LIMIT 1), 'Hair Color', 'Full hair coloring service', 2000.00, 90, 'Hair', 2),
  ((SELECT id FROM businesses LIMIT 1), 'Facial', 'Relaxing facial treatment', 1500.00, 60, 'Skin', 3),
  ((SELECT id FROM businesses LIMIT 1), 'Manicure', 'Professional manicure service', 800.00, 45, 'Nails', 4),
  ((SELECT id FROM businesses LIMIT 1), 'Pedicure', 'Professional pedicure service', 900.00, 50, 'Nails', 5);

INSERT INTO business_time_slots (business_id, day_of_week, start_time, end_time, slot_duration)
VALUES
  -- Monday to Friday: 10:00 AM - 8:00 PM
  ((SELECT id FROM businesses LIMIT 1), 1, '10:00:00', '20:00:00', 30),
  ((SELECT id FROM businesses LIMIT 1), 2, '10:00:00', '20:00:00', 30),
  ((SELECT id FROM businesses LIMIT 1), 3, '10:00:00', '20:00:00', 30),
  ((SELECT id FROM businesses LIMIT 1), 4, '10:00:00', '20:00:00', 30),
  ((SELECT id FROM businesses LIMIT 1), 5, '10:00:00', '20:00:00', 30),
  -- Saturday: 10:00 AM - 6:00 PM
  ((SELECT id FROM businesses LIMIT 1), 6, '10:00:00', '18:00:00', 30);
  -- Sunday: Closed (no entry)
*/

-- 11. Enable Row Level Security (RLS)
ALTER TABLE business_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_conversations ENABLE ROW LEVEL SECURITY;

-- 12. Create RLS Policies (drop if exists first)

-- Business Services: Allow service role full access (for backend)
DROP POLICY IF EXISTS "Service role has full access to business_services" ON business_services;
CREATE POLICY "Service role has full access to business_services"
  ON business_services
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Business Time Slots: Allow service role full access (for backend)
DROP POLICY IF EXISTS "Service role has full access to business_time_slots" ON business_time_slots;
CREATE POLICY "Service role has full access to business_time_slots"
  ON business_time_slots
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Bookings: Allow service role full access (for backend)
DROP POLICY IF EXISTS "Service role has full access to bookings" ON bookings;
CREATE POLICY "Service role has full access to bookings"
  ON bookings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Booking Conversations: Allow service role full access (for backend)
DROP POLICY IF EXISTS "Service role has full access to booking_conversations" ON booking_conversations;
CREATE POLICY "Service role has full access to booking_conversations"
  ON booking_conversations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Optional: Add authenticated user policies if you want frontend access
-- Uncomment these if you need authenticated users to access data directly

/*
-- Business Services: Authenticated users can read
CREATE POLICY "Authenticated users can read business_services"
  ON business_services
  FOR SELECT
  TO authenticated
  USING (true);

-- Bookings: Users can read their own bookings
CREATE POLICY "Users can read their own bookings"
  ON bookings
  FOR SELECT
  TO authenticated
  USING (customer_phone = auth.jwt() ->> 'phone');

-- Bookings: Users can create their own bookings
CREATE POLICY "Users can create their own bookings"
  ON bookings
  FOR INSERT
  TO authenticated
  WITH CHECK (customer_phone = auth.jwt() ->> 'phone');
*/

-- 13. Grant permissions to service role (backend)
GRANT ALL ON business_services TO service_role;
GRANT ALL ON business_time_slots TO service_role;
GRANT ALL ON bookings TO service_role;
GRANT ALL ON booking_conversations TO service_role;

-- Grant usage on sequences
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Migration complete!
-- Run this SQL in Supabase SQL Editor to create all tables and functions
-- RLS is enabled and configured for service role (backend) access

