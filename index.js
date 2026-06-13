require('dotenv').config();
const { Client, GatewayIntentBits, Collection, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Client setup
// ---------------------------------------------------------------------------

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ]
});

client.commands = new Collection();

// ---------------------------------------------------------------------------
// Load commands from ./commands/
// ---------------------------------------------------------------------------

const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
  } else {
    console.warn(`[warn] ${file} is missing 'data' or 'execute' — skipped.`);
  }
}

// ---------------------------------------------------------------------------
// Event: ready
// ---------------------------------------------------------------------------

client.once('clientReady', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`   Serving ${client.guilds.cache.size} guild(s)`);
});

// ---------------------------------------------------------------------------
// Event: interactionCreate
// ---------------------------------------------------------------------------

client.on('interactionCreate', async interaction => {
  // Autocomplete
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (command?.autocomplete) {
      try {
        await command.autocomplete(interaction);
      } catch (err) {
        console.error(`[autocomplete/${interaction.commandName}]`, err);
        // Autocomplete errors must be responded to or Discord shows nothing
        try { await interaction.respond([]); } catch {}
      }
    }
    return;
  }

  // Button interactions
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('roll_')) {
      const rollCmd = client.commands.get('roll');
      if (rollCmd?.handleButton) {
        try {
          await rollCmd.handleButton(interaction);
        } catch (err) {
          console.error('[button/roll]', err);
          try {
            await interaction.reply({
              content: `❌ Something went wrong: ${err.message}`,
              flags: MessageFlags.Ephemeral
            });
          } catch {}
        }
      }
    }
    return;
  }

  // Slash commands only
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`[command/${interaction.commandName}]`, err);

    const msg = {
      content: `❌ Something went wrong: ${err.message}`,
      flags: MessageFlags.Ephemeral
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
    }
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

if (!process.env.DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKEN not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
