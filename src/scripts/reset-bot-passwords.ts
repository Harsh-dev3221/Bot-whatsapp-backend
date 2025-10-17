// Script to reset bot passwords to default "test@bot"
// Usage: bun run src/scripts/reset-bot-passwords.ts

import { supabaseAdmin } from '../db/supabase.js';
import pino from 'pino';

const logger = pino({ level: 'info' });

async function resetBotPasswords() {
  try {
    logger.info('Starting password reset for existing bots...');

    // Get all bots
    const { data: bots, error: botsError } = await supabaseAdmin
      .from('bots')
      .select('id, name, phone_number');

    if (botsError) {
      throw botsError;
    }

    if (!bots || bots.length === 0) {
      logger.info('No bots found in the system');
      return;
    }

    logger.info(`Found ${bots.length} bots`);

    let updated = 0;
    let created = 0;
    let errors = 0;

    for (const bot of bots) {
      try {
        // Check if credentials exist
        const { data: existing, error: checkError } = await supabaseAdmin
          .from('bot_credentials')
          .select('id, password_changed')
          .eq('bot_id', bot.id)
          .single();

        if (checkError && checkError.code !== 'PGRST116') {
          // PGRST116 is "not found" error
          throw checkError;
        }

        if (existing) {
          // Update existing credentials
          const { error: updateError } = await supabaseAdmin
            .from('bot_credentials')
            .update({
              password_hash: 'test@bot',
              default_password: 'test@bot',
              password_changed: false,
            })
            .eq('bot_id', bot.id);

          if (updateError) {
            throw updateError;
          }

          updated++;
          logger.info(`✓ Updated password for bot: ${bot.name} (${bot.phone_number})`);
        } else {
          // Create new credentials
          const { error: insertError } = await supabaseAdmin
            .from('bot_credentials')
            .insert({
              bot_id: bot.id,
              password_hash: 'test@bot',
              default_password: 'test@bot',
              password_changed: false,
            });

          if (insertError) {
            throw insertError;
          }

          created++;
          logger.info(`✓ Created credentials for bot: ${bot.name} (${bot.phone_number})`);
        }
      } catch (error: any) {
        errors++;
        logger.error(`✗ Error processing bot ${bot.name}: ${error.message}`);
      }
    }

    logger.info('\n=== Summary ===');
    logger.info(`Total bots: ${bots.length}`);
    logger.info(`Updated: ${updated}`);
    logger.info(`Created: ${created}`);
    logger.info(`Errors: ${errors}`);
    logger.info('\nDefault password for all bots: test@bot');
    logger.info('Username for each bot: <bot phone number>');

    // Display bot credentials
    logger.info('\n=== Bot Credentials ===');
    for (const bot of bots) {
      logger.info(`Bot: ${bot.name}`);
      logger.info(`  Username: ${bot.phone_number}`);
      logger.info(`  Password: test@bot`);
      logger.info(`  Dashboard URL: /bot-dashboard/${bot.id}`);
      logger.info('');
    }

  } catch (error: any) {
    logger.error('Fatal error:', error.message);
    process.exit(1);
  }
}

// Run the script
resetBotPasswords()
  .then(() => {
    logger.info('Password reset completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Script failed:', error);
    process.exit(1);
  });

