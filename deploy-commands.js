/**
 * Run this script once to register slash commands with Discord:
 *   node deploy-commands.js
 *
 * You need to re-run this whenever you add, rename, or change commands.
 * Deployment is guild-scoped (instant) by default. To deploy globally,
 * remove the guildId variable and call rest.put with the global route.
 */

require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('❌ DISCORD_TOKEN and CLIENT_ID must be set in your .env file.');
  process.exit(1);
}

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data) {
    commands.push(command.data.toJSON());
    console.log(`  Loaded: /${command.data.name}`);
  }
}

const rest = new REST().setToken(DISCORD_TOKEN);

(async () => {
  try {
    console.log(`\nDeploying ${commands.length} slash command(s)…`);

    let route;
    if (GUILD_ID) {
      // Guild-scoped: updates are instant
      route = Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID);
      console.log(`  Scope: guild ${GUILD_ID}`);
    } else {
      // Global: can take up to 1 hour to propagate
      route = Routes.applicationCommands(CLIENT_ID);
      console.log('  Scope: global (up to 1 hour to update)');
    }

    const data = await rest.put(route, { body: commands });
    console.log(`✅ Successfully deployed ${data.length} command(s).`);
  } catch (err) {
    console.error('❌ Deployment failed:', err);
  }
})();
