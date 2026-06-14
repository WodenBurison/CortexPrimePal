/**
 * /pp — track Plot Points for players and the GM.
 *
 * Display format: N<:plotpoint:id>  (number directly followed by emoji)
 *
 * Player subcommands (anyone):
 *   /pp view                  — your current PP balance (ephemeral)
 *   /pp earn [amount]         — gain PP (default 1)
 *   /pp spend [amount]        — spend PP (default 1); errors if insufficient
 *   /pp give <player> [amount] — give your PP to another player
 *   /pp all                   — show everyone's PP in this campaign
 *
 * GM subcommands (Manage Guild only):
 *   /pp gm-view               — GM pool balance
 *   /pp gm-add [amount]       — add to GM pool
 *   /pp gm-spend [amount]     — spend from GM pool
 *   /pp set <player> <amount> — set a player's PP to an exact value
 *
 * Campaign isolation: PP is scoped by campaignId like everything else.
 */

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');
const {
  getCampaignId,
  GM_USER_ID,
  getPP,
  setPP,
  getAllPP
} = require('../utils/storage');

const PP_EMOJI = '<:plotpoint:1515796693440794734>';
const pp = (n) => `${n} ${PP_EMOJI}`;  // e.g. 3 <:plotpoint:...>

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pp')
    .setDescription('Manage Plot Points')

    // ---- player commands ----
    .addSubcommand(sub => sub
      .setName('view')
      .setDescription('See your current Plot Point balance'))

    .addSubcommand(sub => sub
      .setName('earn')
      .setDescription('Earn Plot Points')
      .addIntegerOption(opt => opt
        .setName('amount')
        .setDescription('How many to earn (default 1)')
        .setMinValue(1)
        .setRequired(false)))

    .addSubcommand(sub => sub
      .setName('spend')
      .setDescription('Spend Plot Points')
      .addIntegerOption(opt => opt
        .setName('amount')
        .setDescription('How many to spend (default 1)')
        .setMinValue(1)
        .setRequired(false)))

    .addSubcommand(sub => sub
      .setName('give')
      .setDescription('Give some of your Plot Points to another player')
      .addUserOption(opt => opt
        .setName('player')
        .setDescription('The player to give PP to')
        .setRequired(true))
      .addIntegerOption(opt => opt
        .setName('amount')
        .setDescription('How many to give (default 1)')
        .setMinValue(1)
        .setRequired(false)))

    .addSubcommand(sub => sub
      .setName('all')
      .setDescription('Show Plot Point balances for everyone in this campaign'))

    // ---- GM commands ----
    .addSubcommand(sub => sub
      .setName('gm-view')
      .setDescription('See the GM Plot Point pool'))

    .addSubcommand(sub => sub
      .setName('gm-add')
      .setDescription('Add to the GM Plot Point pool')
      .addIntegerOption(opt => opt
        .setName('amount')
        .setDescription('How many to add (default 1)')
        .setMinValue(1)
        .setRequired(false)))

    .addSubcommand(sub => sub
      .setName('gm-spend')
      .setDescription('Spend from the GM Plot Point pool')
      .addIntegerOption(opt => opt
        .setName('amount')
        .setDescription('How many to spend (default 1)')
        .setMinValue(1)
        .setRequired(false)))

    .addSubcommand(sub => sub
      .setName('set')
      .setDescription('(GM) Set a player\'s Plot Points to an exact value')
      .addUserOption(opt => opt
        .setName('player')
        .setDescription('The player whose PP to set')
        .setRequired(true))
      .addIntegerOption(opt => opt
        .setName('amount')
        .setDescription('New PP total')
        .setMinValue(0)
        .setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'view')     return handleView(interaction);
    if (sub === 'earn')     return handleEarn(interaction);
    if (sub === 'spend')    return handleSpend(interaction);
    if (sub === 'give')     return handleGive(interaction);
    if (sub === 'all')      return handleAll(interaction);
    if (sub === 'gm-view')  return handleGmView(interaction);
    if (sub === 'gm-add')   return handleGmAdd(interaction);
    if (sub === 'gm-spend') return handleGmSpend(interaction);
    if (sub === 'set')      return handleSet(interaction);
  }
};

// ---------------------------------------------------------------------------
// Player handlers
// ---------------------------------------------------------------------------

async function handleView(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const campaignId = getCampaignId(interaction.channel);
  const current    = await getPP(interaction.guild, campaignId, interaction.user.id);

  return interaction.editReply(`You have ${pp(current)}`);
}

async function handleEarn(interaction) {
  await interaction.deferReply();

  const amount     = interaction.options.getInteger('amount') ?? 1;
  const campaignId = getCampaignId(interaction.channel);
  const userId     = interaction.user.id;

  const current = await getPP(interaction.guild, campaignId, userId);
  const next    = await setPP(interaction.guild, campaignId, userId, current + amount);

  return interaction.editReply(
    `${interaction.user} earned ${pp(amount)} and now has ${pp(next)}`
  );
}

async function handleSpend(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const amount     = interaction.options.getInteger('amount') ?? 1;
  const campaignId = getCampaignId(interaction.channel);
  const userId     = interaction.user.id;

  const current = await getPP(interaction.guild, campaignId, userId);
  if (current < amount) {
    return interaction.editReply(
      `You only have ${pp(current)} — not enough to spend ${pp(amount)}.`
    );
  }

  const next = await setPP(interaction.guild, campaignId, userId, current - amount);
  return interaction.editReply(`Spent ${pp(amount)}. You now have ${pp(next)}`);
}

async function handleGive(interaction) {
  await interaction.deferReply();

  const target     = interaction.options.getUser('player');
  const amount     = interaction.options.getInteger('amount') ?? 1;
  const campaignId = getCampaignId(interaction.channel);
  const giverId    = interaction.user.id;

  if (target.id === giverId) {
    return interaction.editReply({ content: 'You can\'t give PP to yourself.', flags: MessageFlags.Ephemeral });
  }
  if (target.bot) {
    return interaction.editReply({ content: 'You can\'t give PP to a bot.', flags: MessageFlags.Ephemeral });
  }

  const giverPP = await getPP(interaction.guild, campaignId, giverId);
  if (giverPP < amount) {
    return interaction.editReply({
      content: `You only have ${pp(giverPP)} — not enough to give ${pp(amount)}.`,
      flags: MessageFlags.Ephemeral
    });
  }

  const [giverNext, targetCurrent] = await Promise.all([
    setPP(interaction.guild, campaignId, giverId,   giverPP - amount),
    getPP(interaction.guild, campaignId, target.id)
  ]);
  const targetNext = await setPP(interaction.guild, campaignId, target.id, targetCurrent + amount);

  return interaction.editReply(
    `${interaction.user} gave ${pp(amount)} to ${target}.\n` +
    `${interaction.user.username}: ${pp(giverNext)} | ${target.username}: ${pp(targetNext)}`
  );
}

async function handleAll(interaction) {
  await interaction.deferReply();

  const campaignId = getCampaignId(interaction.channel);
  const records    = await getAllPP(interaction.guild, campaignId);

  // Separate GM pool from player records
  const gmRecord      = records.find(r => r.userId === GM_USER_ID);
  const playerRecords = records.filter(r => r.userId !== GM_USER_ID);

  if (records.length === 0) {
    return interaction.editReply('No Plot Points have been tracked in this campaign yet.');
  }

  const embed = new EmbedBuilder()
    .setTitle(`${PP_EMOJI} Plot Points`)
    .setColor(0xFEE75C);

  if (playerRecords.length > 0) {
    // Resolve display names for each userId
    const lines = await Promise.all(
      playerRecords
        .sort((a, b) => b.points - a.points)
        .map(async r => {
          let name;
          try {
            const member = await interaction.guild.members.fetch(r.userId);
            name = member.displayName;
          } catch {
            name = `<@${r.userId}>`;
          }
          return `${name} — ${pp(r.points)}`;
        })
    );
    embed.addFields({ name: 'Players', value: lines.join('\n') });
  }

  if (gmRecord) {
    embed.addFields({ name: 'GM Pool', value: pp(gmRecord.points) });
  }

  return interaction.editReply({ embeds: [embed] });
}

// ---------------------------------------------------------------------------
// GM handlers
// ---------------------------------------------------------------------------

async function handleGmView(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const campaignId = getCampaignId(interaction.channel);
  const current    = await getPP(interaction.guild, campaignId, GM_USER_ID);

  return interaction.editReply(`GM pool: ${pp(current)}`);
}

async function handleGmAdd(interaction) {
  if (!interaction.memberPermissions?.has('ManageGuild')) {
    return interaction.reply({
      content: 'Only GMs (Manage Guild permission) can add to the GM pool.',
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferReply();

  const amount     = interaction.options.getInteger('amount') ?? 1;
  const campaignId = getCampaignId(interaction.channel);

  const current = await getPP(interaction.guild, campaignId, GM_USER_ID);
  const next    = await setPP(interaction.guild, campaignId, GM_USER_ID, current + amount);

  return interaction.editReply(`GM pool: ${pp(current)} → ${pp(next)}`);
}

async function handleGmSpend(interaction) {
  if (!interaction.memberPermissions?.has('ManageGuild')) {
    return interaction.reply({
      content: 'Only GMs (Manage Guild permission) can spend from the GM pool.',
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const amount     = interaction.options.getInteger('amount') ?? 1;
  const campaignId = getCampaignId(interaction.channel);

  const current = await getPP(interaction.guild, campaignId, GM_USER_ID);
  if (current < amount) {
    return interaction.editReply(
      `GM pool only has ${pp(current)} — not enough to spend ${pp(amount)}.`
    );
  }

  const next = await setPP(interaction.guild, campaignId, GM_USER_ID, current - amount);
  return interaction.editReply(`Spent ${pp(amount)} from GM pool. Remaining: ${pp(next)}`);
}

async function handleSet(interaction) {
  if (!interaction.memberPermissions?.has('ManageGuild')) {
    return interaction.reply({
      content: 'Only GMs (Manage Guild permission) can set PP directly.',
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const target     = interaction.options.getUser('player');
  const amount     = interaction.options.getInteger('amount');
  const campaignId = getCampaignId(interaction.channel);

  await setPP(interaction.guild, campaignId, target.id, amount);
  return interaction.editReply(`Set ${target.username}'s PP to ${pp(amount)}`);
}
