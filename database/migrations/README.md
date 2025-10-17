# Database Migrations

This folder contains SQL migration files for the WhatsApp Bot SaaS application.

## Migration Order

Run migrations in this order:
1. `001_booking_system.sql`
2. `002_fix_time_slots_function.sql`
3. `003_prevent_double_booking.sql`
4. `004_business_context_and_media.sql`
5. `004_bot_dashboard_auth.sql`
6. `005_set_default_passwords_existing_bots.sql`
7. `006_web_chat_channel.sql` ⬅️ **NEW - Run this next!**

---

## Migration Files

### 001_booking_system.sql
**Date**: 2025-10-13
**Purpose**: Initial booking system setup

**Creates**:
- `business_services` table - Service menu items
- `business_time_slots` table - Working hours configuration
- `bookings` table - All booking records
- `booking_conversations` table - Active conversation state
- `get_available_time_slots()` function - Get available time slots
- `cleanup_expired_booking_conversations()` function - Clean up expired conversations
- RLS policies for all tables
- Triggers for `updated_at` columns
- Extensions for bot_settings table

**Usage**:
```sql
-- Run in Supabase SQL Editor
-- Copy and paste the entire file content
```

### 002_fix_time_slots_function.sql
**Date**: 2025-10-13
**Purpose**: Fix `get_available_time_slots` function

**Issue**:
The original function used `generate_series(TIME, TIME, INTERVAL)` which doesn't exist in PostgreSQL.

**Solution**:
Rewrote function to use minute-based generation with TIMESTAMP arithmetic:
- Generate series of minute offsets (0, 30, 60, ...)
- Add minutes to start_time to get each slot
- Cast result to TIME type

**Usage**:
```sql
-- Run in Supabase SQL Editor
-- Copy and paste the entire file content
```

### 003_prevent_double_booking.sql
**Date**: 2025-10-13
**Purpose**: Prevent double booking with race condition protection

**Creates**:
- Unique index on `bookings(business_id, booking_date, booking_time)` for active bookings
- `is_time_slot_available()` function - Check if a time slot is available
- `create_booking_safe()` function - Create booking with race condition protection

**Features**:
- **Unique Constraint**: Prevents multiple bookings for the same time slot
- **Race Condition Protection**: Handles concurrent booking attempts gracefully
- **Atomic Operation**: Uses database-level locking to ensure consistency
- **User-Friendly Errors**: Returns clear error messages when slot is taken

**Usage**:
```sql
-- Run in Supabase SQL Editor
-- Copy and paste the entire file content
```

**How It Works**:
1. Unique index prevents duplicate bookings at database level
2. `create_booking_safe()` checks availability before inserting
3. If two users try to book simultaneously, only one succeeds
4. The other user gets a clear error message and can select another slot

---

### 004_business_context_and_media.sql
**Date**: 2025-10-13
**Purpose**: Add business context for AI and media support

**Creates**:
- Adds columns to `businesses` table:
  - `business_type` - Type of business (hair salon, restaurant, etc.)
  - `business_category` - Category
  - `description` - Business description
  - `address` - Physical address
  - `latitude` / `longitude` - GPS coordinates
  - `website` - Website URL
- `bot_ai_context` table - AI behavior and context per bot
  - `business_context` (REQUIRED) - Business description for AI
  - `system_prompt` - Custom AI system prompt
  - `allowed_topics` - Topics AI can discuss
  - `restricted_topics` - Topics AI should avoid
  - `response_style` - professional/friendly/casual/formal
  - `max_response_length` - Character limit for responses
- `bot_media` table - Media files per bot
  - Supports: images, videos, documents, location, contacts
  - `is_required` - Toggle to make media required
  - `is_active` - Enable/disable media
- `get_bot_ai_context()` function - Get complete AI context for bot
- `get_bot_media_by_type()` function - Get media by type
- RLS policies for new tables
- Triggers for `updated_at` columns

**Features**:
- Business-specific AI responses
- Topic restrictions (e.g., no politics for hair salon bot)
- Media support (send location when user asks "where are you?")
- Per-bot configuration (each bot can have different context)
- Optional/required media toggle

**Usage**:
```sql
-- Run in Supabase SQL Editor
-- Copy and paste the entire file content

-- After running, update your business info:
UPDATE businesses
SET
  business_type = 'Hair Salon',
  description = 'Professional hair salon offering haircuts, coloring, and styling',
  address = '123 Main St, Mumbai, India'
WHERE id = 'YOUR-BUSINESS-ID';

-- Create AI context for your bot:
INSERT INTO bot_ai_context (bot_id, business_id, business_context, allowed_topics, restricted_topics)
VALUES (
  'YOUR-BOT-ID',
  'YOUR-BUSINESS-ID',
  'We are a professional hair salon specializing in modern haircuts, hair coloring, and styling services.',
  ARRAY['services', 'booking', 'pricing', 'location', 'hours'],
  ARRAY['politics', 'religion', 'personal opinions']
);

-- Add location media:
INSERT INTO bot_media (bot_id, business_id, media_type, location_name, location_address, location_latitude, location_longitude, is_active)
VALUES (
  'YOUR-BOT-ID',
  'YOUR-BUSINESS-ID',
  'location',
  'Our Salon',
  '123 Main St, Mumbai, India',
  19.0760,
  72.8777,
  true
);
```

---

## How to Run Migrations

### Option 1: Supabase Dashboard (Recommended)

1. Go to your Supabase project
2. Navigate to **SQL Editor**
3. Click **New Query**
4. Copy the migration file content
5. Paste into the editor
6. Click **Run**

### Option 2: Supabase CLI

```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link to your project
supabase link --project-ref YOUR_PROJECT_REF

# Run migration
supabase db push
```

### Option 3: psql Command Line

```bash
# Connect to your database
psql "postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres"

# Run migration
\i Backend/database/migrations/001_booking_system.sql
\i Backend/database/migrations/002_fix_time_slots_function.sql
```

---

### 006_web_chat_channel.sql
**Date**: 2025-10-14
**Purpose**: Add embeddable web chat channel support

**Creates**:
- `message_channel` enum - Channel type ('whatsapp', 'web')
- `bot_widget_settings` table - Widget configuration per bot
  - `enabled` - Enable/disable web chat
  - `widget_token_hash` - Hashed authentication token
  - `allowed_origins` - Whitelist of allowed domains
  - `theme` - Widget appearance (colors, position, avatar)
  - `greeting` - Initial greeting message
  - `rate_limits` - Session and message rate limits
  - `token_version` - For token rotation/invalidation
- `web_sessions` table - Anonymous web chat sessions
  - `origin` - Domain where chat was initiated
  - `metadata` - UTM params, custom data
  - `status` - active/ended
  - `expires_at` - Session expiry (14 days default)
- Alters `messages` table:
  - `channel` - Message channel (whatsapp/web)
  - `session_id` - Link to web_sessions
  - `origin_url` - Page URL where message was sent
  - `user_agent` - Browser user agent
  - `metadata` - Intent, sentiment, etc.
- Helper functions:
  - `cleanup_expired_web_sessions()` - Clean up expired sessions
  - `get_active_web_sessions_count()` - Count active sessions
- RLS policies for new tables
- Indexes for performance

**Features**:
- Embeddable chat widget for websites
- Independent from WhatsApp (separate channel)
- Reuses same AI + booking logic
- Origin-based security
- Token rotation support
- Session management with expiry

**Usage**:
```sql
-- Run in Supabase SQL Editor
-- Copy and paste the entire file content

-- After running, enable web chat for a bot:
INSERT INTO bot_widget_settings (bot_id, enabled, widget_token_hash, allowed_origins, greeting)
VALUES (
  'YOUR-BOT-ID',
  true,
  'HASHED-TOKEN-HERE',  -- Use bcrypt/argon2 to hash
  ARRAY['https://example.com', 'https://www.example.com'],
  'Hello! How can I help you today?'
);
```

---

## Migration Order

**IMPORTANT**: Run migrations in order!

1. `001_booking_system.sql` - Creates tables and initial function
2. `002_fix_time_slots_function.sql` - Fixes the time slots function
3. `003_prevent_double_booking.sql` - Adds double booking prevention
4. `004_business_context_and_media.sql` - Adds business context and media support
5. `004_bot_dashboard_auth.sql` - Adds bot dashboard authentication
6. `005_set_default_passwords_existing_bots.sql` - Sets default passwords
7. `006_web_chat_channel.sql` - Adds web chat channel support
8. `007_widget_token_plain_text.sql` - Changes widget token to plain text
9. `008_enable_web_bots.sql` - Enables web chat for existing web bots
10. `009_enable_booking_by_default.sql` - ✨ Enables booking by default for all bots

---

## Rollback

To rollback migrations, you need to manually drop the created objects:

### Rollback 002 (Fix Time Slots Function)
```sql
-- Drop the fixed function
DROP FUNCTION IF EXISTS get_available_time_slots(UUID, DATE, INTEGER);

-- Recreate the old function (from 001_booking_system.sql)
-- (Not recommended - the old function doesn't work)
```

### Rollback 001 (Booking System)
```sql
-- WARNING: This will delete all booking data!

-- Drop tables
DROP TABLE IF EXISTS bookings CASCADE;
DROP TABLE IF EXISTS booking_conversations CASCADE;
DROP TABLE IF EXISTS business_time_slots CASCADE;
DROP TABLE IF EXISTS business_services CASCADE;

-- Drop functions
DROP FUNCTION IF EXISTS get_available_time_slots(UUID, DATE, INTEGER);
DROP FUNCTION IF EXISTS cleanup_expired_booking_conversations();
DROP FUNCTION IF EXISTS update_updated_at_column();

-- Remove columns from bot_settings
ALTER TABLE bot_settings 
  DROP COLUMN IF EXISTS booking_enabled,
  DROP COLUMN IF EXISTS booking_trigger_keywords,
  DROP COLUMN IF EXISTS booking_confirmation_message,
  DROP COLUMN IF EXISTS booking_require_gender,
  DROP COLUMN IF EXISTS booking_require_booking_for;
```

---

## Testing Migrations

### Test 001 - Booking System

```sql
-- 1. Check tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('business_services', 'business_time_slots', 'bookings', 'booking_conversations');

-- 2. Check functions exist
SELECT proname FROM pg_proc 
WHERE proname IN ('get_available_time_slots', 'cleanup_expired_booking_conversations', 'update_updated_at_column');

-- 3. Check RLS policies
SELECT tablename, policyname FROM pg_policies 
WHERE tablename IN ('business_services', 'business_time_slots', 'bookings', 'booking_conversations');

-- 4. Check bot_settings columns
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'bot_settings' 
AND column_name LIKE 'booking%';
```

### Test 002 - Time Slots Function

```sql
-- 1. Add test data
INSERT INTO business_time_slots (business_id, day_of_week, start_time, end_time, slot_duration, is_active)
VALUES 
  ('YOUR-BUSINESS-ID', 2, '10:00:00', '20:00:00', 30, true);

-- 2. Test function
SELECT * FROM get_available_time_slots(
  'YOUR-BUSINESS-ID'::UUID,
  CURRENT_DATE + 1,
  2  -- Tuesday
);

-- Expected: List of time slots from 10:00 to 19:30 (30-minute intervals)
```

---

## Troubleshooting

### Issue: "function does not exist"

**Solution**: Run the migration again

### Issue: "permission denied"

**Solution**: Grant permissions
```sql
GRANT EXECUTE ON FUNCTION get_available_time_slots(UUID, DATE, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_available_time_slots(UUID, DATE, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION get_available_time_slots(UUID, DATE, INTEGER) TO anon;
```

### Issue: "table already exists"

**Solution**: Migration already run. Check if you need to update instead:
```sql
-- Check if table exists
SELECT * FROM business_services LIMIT 1;
```

### Issue: "trigger already exists"

**Solution**: Add `DROP TRIGGER IF EXISTS` before creating trigger (already in migration)

---

## Best Practices

1. **Always backup** before running migrations
2. **Test in development** before production
3. **Run migrations in order**
4. **Don't modify old migrations** - create new ones instead
5. **Document changes** in this README
6. **Test rollback procedures** before deploying

---

## Support

If you encounter issues:
1. Check the error message in Supabase logs
2. Verify migration order
3. Check permissions
4. Review this README
5. Check the main project documentation

