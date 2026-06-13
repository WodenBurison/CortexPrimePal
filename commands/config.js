/**
 * /config — manage per-campaign trait set configuration.
 *
 * Subcommands:
 *   /config show                          — display current trait sets
 *   /config add-traitset <name> [traits]  — add/replace a trait set
 *   /config remove-traitset <name>        — delete a trait set
 *   /config set-traits <name> <traits>    — update the trait list for a set
 *
 * Campaign isolation: config is scoped to the Discord category the command
 * is run in (or the channel itself if it has no category).
 */

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');
const { getCampaignId, getConfig, saveConfig } = require('../utils/storage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure trait sets for this campaign')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand(sub => sub
      .setName('show')
      .setDescription('Show the current campaign configuration'))

    .addSubcommand(sub => sub
      .setName('add-traitset')
      .setDescription('Add (or replace) a trait set')
      .addStringOption(opt => opt
        .setName('name')
        .setDescription('Trait set name, e.g. "Attributes", "Values", "Distinctions"')
        .setRequired(true))
      .addStringOption(opt => opt
        .setName('traits')
        .setDescription('Comma-separated trait names (leave blank for free-form/player-named traits)')
        .setRequired(false)))

    .addSubcommand(sub => sub
      .setName('remove-traitset')
      .setDescription('Remove a trait set')
      .addStringOption(opt => opt
        .setName('name')
        .setDescription('Trait set name to remove')
        .setRequired(true)
        .setAutocomplete(true)))

    .addSubcommand(sub => sub
      .setName('set-traits')
      .setDescription('Update the predefined trait list for a trait set')
      .addStringOption(opt => opt
        .setName('name')
        .setDescription('Trait set name')
        .setRequired(true)
        .setAutocomplete(true))
      .addStringOption(opt => opt
        .setName('traits')
        .setDescription('New comma-separated trait list (leave blank to make free-form)')
        .setRequired(false))),

  async autocomplete(interaction) {
    const focused    = interaction.options.getFocused(true);
    if (focused.name !== 'name') return interaction.respond([]);

    const campaignId = getCampaignId(interaction.channel);
    const cfg        = await getConfig(interaction.guild, campaignId);
    if (!cfg) return interaction.respond([]);

    const names = Object.keys(cfg.data.traitSets)
      .filter(n => n.toLowerCase().includes(focused.value.toLowerCase()))
      .slice(0, 25);

    return interaction.respond(names.map(n => ({ name: n, value: n })));
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'show')           return handleShow(interaction);
    if (sub === 'add-traitset')   return handleAdd(interaction);
    if (sub === 'remove-traitset') return handleRemove(interaction);
    if (sub === 'set-traits')     return handleSetTraits(interaction);
  }
};

// ---------------------------------------------------------------------------

async function handleShow(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const campaignId = getCampaignId(interaction.channel);
  const cfg        = await getConfig(interaction.guild, campaignId);

  if (!cfg || Object.keys(cfg.data.traitSets).length === 0) {
    return interaction.editReply(
      'No trait sets configured for this campaign yet. Use `/config add-traitset` to add some.\n' +
      `*(Campaign ID: \`${campaignId}\`)*`
    );
  }

  const embed = new EmbedBuilder()
    .setTitle('Campaign Configuration — Trait Sets')
    .setColor(0x5865F2)
    .setFooter({ text: `Campaign: ${campaignId}` });

  for (const [name, def] of Object.entries(cfg.data.traitSets)) {
    const value = def.freeForm
      ? '*Free-form — players name their own traits*'
      : def.traits.map(t => `\`${t}\``).join(', ') || '*No traits defined*';
    embed.addFields({ name, value });
  }

  return interaction.editReply({ embeds: [embed] });
}

async function handleAdd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const name       = interaction.options.getString('name').trim();
  const traitsRaw  = interaction.options.getString('traits');
  const campaignId = getCampaignId(interaction.channel);

  const cfg = await getConfig(interaction.guild, campaignId);
  if (!cfg) {
    return interaction.editReply('Campaign not set up. Run `/setup` first.');
  }

  const freeForm = !traitsRaw || traitsRaw.trim() === '';
  const traits   = freeForm
    ? []
    : traitsRaw.split(',').map(t => t.trim()).filter(Boolean);

  const configData = cfg.data;
  configData.traitSets[name] = { freeForm, traits };
  await saveConfig(interaction.guild, campaignId, configData);

  const desc = freeForm
    ? 'Free-form (players name their own traits)'
    : `Predefined traits: ${traits.map(t => `\`${t}\``).join(', ')}`;

  return interaction.editReply(`✅ Trait set **${name}** saved.\n${desc}`);
}

async function handleRemove(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const name       = interaction.options.getString('name');
  const campaignId = getCampaignId(interaction.channel);

  const cfg = await getConfig(interaction.guild, campaignId);
  if (!cfg) return interaction.editReply('Campaign not set up. Run `/setup` first.');

  if (!cfg.data.traitSets[name]) {
    return interaction.editReply(`No trait set named **${name}** found.`);
  }

  delete cfg.data.traitSets[name];
  await saveConfig(interaction.guild, campaignId, cfg.data);

  return interaction.editReply(`✅ Removed trait set **${name}**.`);
}

async function handleSetTraits(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const name       = interaction.options.getString('name');
  const traitsRaw  = interaction.options.getString('traits');
  const campaignId = getCampaignId(interaction.channel);

  const cfg = await getConfig(interaction.guild, campaignId);
  if (!cfg) return interaction.editReply('Campaign not set up. Run `/setup` first.');
  if (!cfg.data.traitSets[name]) {
    return interaction.editReply(`No trait set named **${name}**. Use \`/config add-traitset\` first.`);
  }

  const freeForm = !traitsRaw || traitsRaw.trim() === '';
  const traits   = freeForm
    ? []
    : traitsRaw.split(',').map(t => t.trim()).filter(Boolean);

  cfg.data.traitSets[name] = { freeForm, traits };
  await saveConfig(interaction.guild, campaignId, cfg.data);

  const desc = freeForm ? 'Now free-form.' : `Traits: ${traits.map(t => `\`${t}\``).join(', ')}`;
  return interaction.editReply(`✅ Updated **${name}**. ${desc}`);
}
