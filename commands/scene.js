/**
 * /scene — manage free-form scene traits (complications, assets, crisis pools).
 *
 * Traits can be single-die ("On Fire" d6) or pools ("Crisis Pool" [d6, d8]).
 * Scene traits are shared across all players in a campaign and are cleared
 * when the scene ends. They can be rolled by name in /roll.
 *
 * Subcommands:
 *   /scene view                         — show all active scene traits
 *   /scene set <trait> <die>            — add/update a single-die scene trait
 *   /scene remove <trait>               — remove any scene trait (single or pool)
 *   /scene clear                        — wipe all scene traits
 *   /scene pool-add <trait> <die>       — add a die to a scene pool
 *   /scene pool-remove <trait> <die>    — remove a die from a scene pool
 *
 * Campaign isolation: scene is scoped to the channel's category.
 */

const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');
const { getCampaignId, getScene, saveScene, clearScene } = require('../utils/storage');
const { VALID_DICE, DIE_EMOJI, parseDiceList } = require('../utils/dice');

const DIE_CHOICES = VALID_DICE.map(d => ({ name: d, value: d }));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('scene')
    .setDescription('Manage active scene traits (complications, assets, crisis pools, etc.)')

    .addSubcommand(sub => sub
      .setName('view')
      .setDescription('Show all active scene traits'))

    .addSubcommand(sub => sub
      .setName('set')
      .setDescription('Add or update a static scene trait')
      .addStringOption(opt => opt
        .setName('trait')
        .setDescription('Scene trait name (e.g. "On Fire", "Panicked Crowd")')
        .setRequired(true))
      .addStringOption(opt => opt
        .setName('die')
        .setDescription('Die rating for this trait')
        .setRequired(true)
        .addChoices(...DIE_CHOICES)))

    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove a scene trait (static or pool trait)')
      .addStringOption(opt => opt
        .setName('trait')
        .setDescription('Scene trait to remove')
        .setRequired(true)
        .setAutocomplete(true)))

    .addSubcommand(sub => sub
      .setName('clear')
      .setDescription('Clear all scene traits (use when a scene ends)')
      .addBooleanOption(opt => opt
        .setName('confirm')
        .setDescription('Set to true to confirm clearing all traits')
        .setRequired(true)))

    .addSubcommand(sub => sub
      .setName('pool-add')
      .setDescription('Add dice to a scene pool (e.g. Crisis Pool, Panic Pool)')
      .addStringOption(opt => opt
        .setName('trait')
        .setDescription('Pool name (e.g. "Crisis Pool")')
        .setRequired(true)
        .setAutocomplete(true))
      .addStringOption(opt => opt
        .setName('dice')
        .setDescription('Dice to add (e.g. "d6 d6 d8" or "d6,d8")')
        .setRequired(true)))

    .addSubcommand(sub => sub
      .setName('pool-remove')
      .setDescription('Remove a die from a scene pool')
      .addStringOption(opt => opt
        .setName('trait')
        .setDescription('Pool name')
        .setRequired(true)
        .setAutocomplete(true))
      .addStringOption(opt => opt
        .setName('die')
        .setDescription('Die size to remove')
        .setRequired(true)
        .addChoices(...DIE_CHOICES))),

  // -------------------------------------------------------------------------
  // Autocomplete
  // -------------------------------------------------------------------------
  async autocomplete(interaction) {
    const sub        = interaction.options.getSubcommand(false);
    const focused    = interaction.options.getFocused(true);
    const campaignId = getCampaignId(interaction.channel);

    if (focused.name === 'trait') {
      const scene  = await getScene(interaction.guild, campaignId);
      const traits = scene?.data?.traits ?? {};

      let names = Object.keys(traits);

      // pool-remove: only suggest existing pool traits
      if (sub === 'pool-remove') {
        names = Object.entries(traits)
          .filter(([, v]) => Array.isArray(v))
          .map(([k]) => k);
      }

      const filtered = names
        .filter(t => t.toLowerCase().includes(focused.value.toLowerCase()))
        .slice(0, 25);

      return interaction.respond(filtered.map(t => ({ name: t, value: t })));
    }

    return interaction.respond([]);
  },

  // -------------------------------------------------------------------------
  // Execute
  // -------------------------------------------------------------------------
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'view')        return handleView(interaction);
    if (sub === 'set')         return handleSet(interaction);
    if (sub === 'remove')      return handleRemove(interaction);
    if (sub === 'clear')       return handleClear(interaction);
    if (sub === 'pool-add')    return handlePoolAdd(interaction);
    if (sub === 'pool-remove') return handlePoolRemove(interaction);
  }
};

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

async function handleView(interaction) {
  await interaction.deferReply();

  const campaignId = getCampaignId(interaction.channel);
  const scene      = await getScene(interaction.guild, campaignId);
  const traits     = scene?.data?.traits ?? {};

  const embed = new EmbedBuilder()
    .setTitle('🎬 Active Scene Traits')
    .setColor(0xFEE75C);

  const entries = Object.entries(traits);
  if (entries.length === 0) {
    embed.setDescription('*No scene traits active. Use `/scene set` or `/scene pool-add`.*');
  } else {
    const lines = entries.map(([t, d]) => formatTrait(t, d));
    embed.setDescription(lines.join('\n'));
    embed.setFooter({ text: 'Players can include scene traits in /roll by name' });
  }

  return interaction.editReply({ embeds: [embed] });
}

async function handleSet(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const traitName  = interaction.options.getString('trait').trim();
  const die        = interaction.options.getString('die');
  const campaignId = getCampaignId(interaction.channel);

  const scene  = await getScene(interaction.guild, campaignId);
  const traits = { ...(scene?.data?.traits ?? {}) };

  // If a pool already exists with this name, warn rather than overwrite silently
  if (Array.isArray(traits[traitName])) {
    return interaction.editReply(
      `**${traitName}** is already a pool trait. Use \`/scene pool-add\` or \`/scene remove\` it first.`
    );
  }

  const isUpdate = traitName in traits;
  traits[traitName] = die;
  await saveScene(interaction.guild, campaignId, { traits });

  return interaction.editReply(
    `${isUpdate ? '✏️ Updated' : '✅ Added'} scene trait **${traitName}** ${DIE_EMOJI[die] ?? ''}${die}`
  );
}

async function handleRemove(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const traitName  = interaction.options.getString('trait');
  const campaignId = getCampaignId(interaction.channel);

  const scene = await getScene(interaction.guild, campaignId);
  if (!scene?.data?.traits?.[traitName]) {
    return interaction.editReply(`No scene trait named **${traitName}** found.`);
  }

  const traits = { ...scene.data.traits };
  delete traits[traitName];

  if (Object.keys(traits).length === 0) {
    await clearScene(interaction.guild, campaignId);
  } else {
    await saveScene(interaction.guild, campaignId, { traits });
  }

  return interaction.editReply(`🗑️ Removed scene trait **${traitName}**.`);
}

async function handleClear(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!interaction.options.getBoolean('confirm')) {
    return interaction.editReply('Set `confirm: True` to clear all scene traits.');
  }

  const campaignId = getCampaignId(interaction.channel);
  const cleared    = await clearScene(interaction.guild, campaignId);

  return interaction.editReply(
    cleared
      ? '🗑️ All scene traits cleared. Ready for the next scene!'
      : 'No scene traits to clear — the scene is already empty.'
  );
}

async function handlePoolAdd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const traitName  = interaction.options.getString('trait').trim();
  const diceInput  = interaction.options.getString('dice');
  const campaignId = getCampaignId(interaction.channel);

  const newDice = parseDiceList(diceInput);
  if (newDice.invalid.length > 0) {
    return interaction.editReply(
      `Invalid dice: ${newDice.invalid.map(d => `\`${d}\``).join(', ')}. Valid sizes: ${VALID_DICE.join(', ')}.`
    );
  }
  if (newDice.valid.length === 0) {
    return interaction.editReply(`No valid dice found in "${diceInput}". Try something like \`d6 d6 d8\`.`);
  }

  const scene  = await getScene(interaction.guild, campaignId);
  const traits = { ...(scene?.data?.traits ?? {}) };
  const current = traits[traitName];

  if (current === undefined) {
    traits[traitName] = newDice.valid.sort((a, b) => parseInt(b.slice(1)) - parseInt(a.slice(1)));
  } else if (Array.isArray(current)) {
    current.push(...newDice.valid);
    current.sort((a, b) => parseInt(b.slice(1)) - parseInt(a.slice(1)));
  } else {
    return interaction.editReply(
      `**${traitName}** is a static trait. Use \`/scene set\` to change it, or \`/scene remove\` first.`
    );
  }

  await saveScene(interaction.guild, campaignId, { traits });

  const pool = traits[traitName];
  return interaction.editReply(
    `✅ **${traitName}**: ${pool.map(d => `${DIE_EMOJI[d] ?? ''}${d}`).join(' ')}`
  );
}

async function handlePoolRemove(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const traitName  = interaction.options.getString('trait').trim();
  const die        = interaction.options.getString('die');
  const campaignId = getCampaignId(interaction.channel);

  const scene = await getScene(interaction.guild, campaignId);
  const pool  = scene?.data?.traits?.[traitName];

  if (!Array.isArray(pool)) {
    return interaction.editReply(`**${traitName}** is not a pool trait. Use \`/scene remove\` for static traits.`);
  }

  const idx = pool.indexOf(die);
  if (idx === -1) {
    const display = pool.map(d => `${DIE_EMOJI[d] ?? ''}${d}`).join(' ');
    return interaction.editReply(`No **${die}** in **${traitName}**. Current pool: ${display}`);
  }

  const traits = { ...scene.data.traits };
  traits[traitName] = [...pool];
  traits[traitName].splice(idx, 1);

  if (traits[traitName].length === 0) {
    delete traits[traitName];
  }

  if (Object.keys(traits).length === 0) {
    await clearScene(interaction.guild, campaignId);
  } else {
    await saveScene(interaction.guild, campaignId, { traits });
  }

  const remaining = traits[traitName]
    ? traits[traitName].map(d => `${DIE_EMOJI[d] ?? ''}${d}`).join(' ')
    : '*empty — trait removed*';

  return interaction.editReply(
    `✅ Removed **${die}** from **${traitName}**. Remaining: ${remaining}`
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTrait(name, value) {
  if (Array.isArray(value)) {
    const dice = value.length > 0
      ? value.map(d => `${DIE_EMOJI[d] ?? ''}${d}`).join(' ')
      : '*empty*';
    return `**${name}** 💾 [${dice}]`;
  }
  return `**${name}** ${DIE_EMOJI[value] ?? ''}${value}`;
}
