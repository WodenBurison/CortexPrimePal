/**
 * /campaign — manage campaign-level pools (doom pool, threat pool, etc.).
 *
 * Unlike scene traits, campaign pools persist across scene clears and
 * represent ongoing threats or resources that span multiple sessions.
 *
 * Pools can be rolled by name in /roll (flagged with 🏴 in roll output).
 *
 * Subcommands:
 *   /campaign view                       — show all campaign pools
 *   /campaign pool-add <trait> <die>     — add a die to a campaign pool
 *   /campaign pool-remove <trait> <die>  — remove a die from a campaign pool
 *   /campaign pool-clear <trait>         — remove an entire campaign pool
 *
 * Campaign isolation: scoped to the channel's category as usual.
 */

const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');
const { getCampaignId, getCampaignData, saveCampaignData } = require('../utils/storage');
const { VALID_DICE, DIE_EMOJI } = require('../utils/dice');

const DIE_CHOICES = VALID_DICE.map(d => ({ name: d, value: d }));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('campaign')
    .setDescription('Manage campaign-level pools (doom pool, threat pool, etc.)')

    .addSubcommand(sub => sub
      .setName('view')
      .setDescription('Show all active campaign pools'))

    .addSubcommand(sub => sub
      .setName('pool-add')
      .setDescription('Add dice to a campaign pool')
      .addStringOption(opt => opt
        .setName('pool')
        .setDescription('Pool name (e.g. "Doom Pool", "Threat Pool")')
        .setRequired(true)
        .setAutocomplete(true))
      .addStringOption(opt => opt
        .setName('dice')
        .setDescription('Dice to add (e.g. "d6 d6 d8" or "d6,d8")')
        .setRequired(true)))

    .addSubcommand(sub => sub
      .setName('pool-remove')
      .setDescription('Remove a die from a campaign pool')
      .addStringOption(opt => opt
        .setName('pool')
        .setDescription('Pool name')
        .setRequired(true)
        .setAutocomplete(true))
      .addStringOption(opt => opt
        .setName('die')
        .setDescription('Die size to remove')
        .setRequired(true)
        .addChoices(...DIE_CHOICES)))

    .addSubcommand(sub => sub
      .setName('pool-clear')
      .setDescription('Remove an entire campaign pool')
      .addStringOption(opt => opt
        .setName('pool')
        .setDescription('Pool name to remove entirely')
        .setRequired(true)
        .setAutocomplete(true))),

  // -------------------------------------------------------------------------
  // Autocomplete
  // -------------------------------------------------------------------------
  async autocomplete(interaction) {
    const focused    = interaction.options.getFocused(true);
    const campaignId = getCampaignId(interaction.channel);

    if (focused.name === 'pool') {
      const data   = await getCampaignData(interaction.guild, campaignId);
      const traits = data?.data?.traits ?? {};

      const sub = interaction.options.getSubcommand(false);
      let names = Object.keys(traits);

      // pool-remove only suggests existing pools
      if (sub === 'pool-remove') {
        names = Object.entries(traits)
          .filter(([, v]) => Array.isArray(v))
          .map(([k]) => k);
      }

      const filtered = names
        .filter(n => n.toLowerCase().includes(focused.value.toLowerCase()))
        .slice(0, 25);

      return interaction.respond(filtered.map(n => ({ name: n, value: n })));
    }

    return interaction.respond([]);
  },

  // -------------------------------------------------------------------------
  // Execute
  // -------------------------------------------------------------------------
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'view')        return handleView(interaction);
    if (sub === 'pool-add')    return handlePoolAdd(interaction);
    if (sub === 'pool-remove') return handlePoolRemove(interaction);
    if (sub === 'pool-clear')  return handlePoolClear(interaction);
  }
};

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

async function handleView(interaction) {
  await interaction.deferReply();

  const campaignId = getCampaignId(interaction.channel);
  const data       = await getCampaignData(interaction.guild, campaignId);
  const traits     = data?.data?.traits ?? {};

  const embed = new EmbedBuilder()
    .setTitle('🏴 Campaign Pools')
    .setColor(0xED4245);

  const entries = Object.entries(traits);
  if (entries.length === 0) {
    embed.setDescription('*No campaign pools active. Use `/campaign pool-add` to create one.*');
  } else {
    const lines = entries.map(([t, d]) => formatTrait(t, d));
    embed.setDescription(lines.join('\n'));
    embed.setFooter({ text: 'Campaign pools can be rolled by name in /roll' });
  }

  return interaction.editReply({ embeds: [embed] });
}

async function handlePoolAdd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const poolName   = interaction.options.getString('pool').trim();
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

  const data   = await getCampaignData(interaction.guild, campaignId);
  const traits = { ...(data?.data?.traits ?? {}) };
  const current = traits[poolName];

  if (current === undefined) {
    traits[poolName] = newDice.valid.sort((a, b) => parseInt(b.slice(1)) - parseInt(a.slice(1)));
  } else if (Array.isArray(current)) {
    current.push(...newDice.valid);
    current.sort((a, b) => parseInt(b.slice(1)) - parseInt(a.slice(1)));
  } else {
    traits[poolName] = [current, ...newDice.valid].sort((a, b) => parseInt(b.slice(1)) - parseInt(a.slice(1)));
  }

  await saveCampaignData(interaction.guild, campaignId, { traits });

  const pool = traits[poolName];
  return interaction.editReply(
    `✅ **${poolName}**: ${pool.map(d => `${DIE_EMOJI[d] ?? ''}${d}`).join(' ')}`
  );
}

async function handlePoolRemove(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const poolName   = interaction.options.getString('pool').trim();
  const die        = interaction.options.getString('die');
  const campaignId = getCampaignId(interaction.channel);

  const data = await getCampaignData(interaction.guild, campaignId);
  const pool = data?.data?.traits?.[poolName];

  if (!Array.isArray(pool)) {
    return interaction.editReply(`**${poolName}** is not a campaign pool or doesn't exist.`);
  }

  const idx = pool.indexOf(die);
  if (idx === -1) {
    const display = pool.map(d => `${DIE_EMOJI[d] ?? ''}${d}`).join(' ');
    return interaction.editReply(`No **${die}** in **${poolName}**. Current pool: ${display}`);
  }

  const traits = { ...data.data.traits };
  traits[poolName] = [...pool];
  traits[poolName].splice(idx, 1);

  if (traits[poolName].length === 0) {
    delete traits[poolName];
  }

  await saveCampaignData(interaction.guild, campaignId, { traits });

  const remaining = traits[poolName]
    ? traits[poolName].map(d => `${DIE_EMOJI[d] ?? ''}${d}`).join(' ')
    : '*empty — pool removed*';

  return interaction.editReply(
    `✅ Removed **${die}** from **${poolName}**. Remaining: ${remaining}`
  );
}

async function handlePoolClear(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const poolName   = interaction.options.getString('pool').trim();
  const campaignId = getCampaignId(interaction.channel);

  const data = await getCampaignData(interaction.guild, campaignId);
  if (!data?.data?.traits?.[poolName]) {
    return interaction.editReply(`No campaign pool named **${poolName}** found.`);
  }

  const traits = { ...data.data.traits };
  delete traits[poolName];

  await saveCampaignData(interaction.guild, campaignId, { traits });

  return interaction.editReply(`🗑️ Removed campaign pool **${poolName}**.`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDiceList(input) {
  const parts = input.split(/[\s,]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
  const valid = [], invalid = [];
  for (const p of parts) {
    if (VALID_DICE.includes(p)) valid.push(p);
    else invalid.push(p);
  }
  return { valid, invalid };
}

function formatTrait(name, value) {
  if (Array.isArray(value)) {
    const dice = value.length > 0
      ? value.map(d => `${DIE_EMOJI[d] ?? ''}${d}`).join(' ')
      : '*empty*';
    return `**${name}** 🟡 [${dice}]`;
  }
  return `**${name}** ${DIE_EMOJI[value] ?? ''}${value}`;
}
