/**
 * Run this once to clear all globally-deployed slash commands.
 * Use when switching from global to guild-scoped deployment during development.
 *
 *   node clear-global-commands.js
 */

require('dotenv').config();
const { REST, Routes } = require('discord.js');

const { DISCORD_TOKEN, CLIENT_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('❌ DISCORD_TOKEN and CLIENT_ID must be set in your .env file.');
  process.exit(1);
}

const rest = new REST().setToken(DISCORD_TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
    console.log('✅ Cleared all global slash commands.');
  } catch (err) {
    console.error('❌ Failed:', err);
  }
})();
