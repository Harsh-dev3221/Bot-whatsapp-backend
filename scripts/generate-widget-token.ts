/**
 * Generate Widget Token Script
 * 
 * Creates a widget token for a bot and stores it in the database
 * Usage: bun run scripts/generate-widget-token.ts <botId>
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import bcrypt from 'bcrypt';

// Load environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function generateWidgetToken(botId: string) {
  try {
    console.log(`\n🔧 Generating widget token for bot: ${botId}\n`);

    // Check if bot exists
    const { data: bot, error: botError } = await supabase
      .from('bots')
      .select('id, business_id, phone_number')
      .eq('id', botId)
      .single();

    if (botError || !bot) {
      console.error('❌ Bot not found:', botError?.message || 'No bot with this ID');
      process.exit(1);
    }

    console.log(`✅ Found bot: ${bot.phone_number}`);

    // Generate random token (32 bytes = 64 hex characters)
    const token = crypto.randomBytes(32).toString('hex');
    
    // Hash the token for storage
    const tokenHash = await bcrypt.hash(token, 10);

    // Default configuration
    const allowedOrigins = [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://localhost:5174',
    ];

    const theme = {
      primaryColor: '#5A3EF0',
      botName: 'AI Assistant',
      position: 'bottom-right',
    };

    const greeting = 'Hello! How can I help you today? 👋';

    // Check if widget settings already exist
    const { data: existing } = await supabase
      .from('bot_widget_settings')
      .select('id')
      .eq('bot_id', botId)
      .single();

    if (existing) {
      // Update existing settings
      const { error: updateError } = await supabase
        .from('bot_widget_settings')
        .update({
          widget_token_hash: tokenHash,
          allowed_origins: allowedOrigins,
          theme,
          greeting,
          token_version: 1,
          updated_at: new Date().toISOString(),
        })
        .eq('bot_id', botId);

      if (updateError) {
        console.error('❌ Error updating widget settings:', updateError.message);
        process.exit(1);
      }

      console.log('✅ Updated existing widget settings');
    } else {
      // Insert new settings
      const { error: insertError } = await supabase
        .from('bot_widget_settings')
        .insert({
          bot_id: botId,
          widget_token_hash: tokenHash,
          allowed_origins: allowedOrigins,
          theme,
          greeting,
          token_version: 1,
        });

      if (insertError) {
        console.error('❌ Error creating widget settings:', insertError.message);
        process.exit(1);
      }

      console.log('✅ Created new widget settings');
    }

    // Display results
    console.log('\n' + '='.repeat(80));
    console.log('🎉 Widget Token Generated Successfully!');
    console.log('='.repeat(80));
    console.log('\n📋 Configuration:');
    console.log(`   Bot ID:        ${botId}`);
    console.log(`   Phone Number:  ${bot.phone_number}`);
    console.log(`   Widget Token:  ${token}`);
    console.log('\n🌐 Allowed Origins:');
    allowedOrigins.forEach(origin => console.log(`   - ${origin}`));
    console.log('\n🎨 Theme:');
    console.log(`   Primary Color: ${theme.primaryColor}`);
    console.log(`   Bot Name:      ${theme.botName}`);
    console.log(`   Position:      ${theme.position}`);
    console.log('\n💬 Greeting:');
    console.log(`   "${greeting}"`);
    console.log('\n' + '='.repeat(80));
    console.log('\n📝 Next Steps:');
    console.log('   1. Navigate to: http://localhost:5173/webchat-demo');
    console.log(`   2. Enter Bot ID: ${botId}`);
    console.log(`   3. Enter Widget Token: ${token}`);
    console.log('   4. Click "Start Widget" to test');
    console.log('\n' + '='.repeat(80));
    console.log('\n⚠️  IMPORTANT: Save this token securely!');
    console.log('   This is the only time you will see the plain token.');
    console.log('   The database only stores the hashed version.');
    console.log('\n' + '='.repeat(80) + '\n');

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  }
}

// Main execution
const botId = process.argv[2];

if (!botId) {
  console.log('\n📖 Usage: bun run scripts/generate-widget-token.ts <botId>\n');
  console.log('Example:');
  console.log('  bun run scripts/generate-widget-token.ts 123e4567-e89b-12d3-a456-426614174000\n');
  process.exit(1);
}

generateWidgetToken(botId);

