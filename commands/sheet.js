/**
 * /sheet — create, view, edit, and delete character sheets.
 *
 * Subcommands:
 *   /sheet create <name>                               — new sheet
 *   /sheet view <name>                                 — display sheet embed
 *   /sheet set <character> <traitset> <trait> <die>    — set a trait value
 *   /sheet remove-trait <character> <traitset> <trait> — remove a trait
 *   /sheet pool-add <character> <traitset> <trait> <die>    — add die to pool
 *   /sheet pool-remove <character> <traitset> <trait> <die> — spend die from pool
 *   /sheet delete <name>                               — delete the sheet
 *   /sheet list                                        — list campaign sheets
 *
 * Campaign isolation: all lookups are scoped by the channel's category ID
 * (or channel ID if no category). Sheets from other campaigns won't appear.
 */

const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');
const {
  getCampaignId,
  getConfig,
  getSheet,
  getAllSheets,
  createSheet,
  updateSheet,
  deleteSheet
} = require('../utils/storage');
const { VALID_DICE, DIE_EMOJI, parseDiceList } = require('../utils/dice');

const DIE_CHOICES = VALID_DICE.map(d => ({ name: d, value: d }));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sheet')
    .setDescription('Manage character sheets')

    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('Create a new character sheet')
      .addStringOption(opt => opt
        .setName('name')
        .setDescription('Character name')
        .setRequired(true)))

    .addSubcommand(sub => sub
      .setName('view')
      .setDescription('Display a character sheet')
      .addStringOption(opt => opt
        .setName('name')
        .setDescription('Character name')
        .setRequired(true)
        .setAutocomplete(true))
      .addUserOption(opt => opt
        .setName('player')
        .setDescription('View another player\'s character (leave blank for yours)')
        .setRequired(false)))

    .addSubcommand(sub => sub
      .setName('set')
      .setDescription('Set a trait value on your character sheet')
      .addStringOption(opt => opt
        .setName('character')
        .setDescription('Your character name')
        .setRequired(true)
        .setAutocomplete(true))
      .addStringOption(opt => opt
        .setName('traitset')
        .setDescription('Trait set (e.g. Attributes)')
        .setRequired(true)
        .setAutocomplete(true))
      .addStringOption(opt => opt
        .setName('trait')
        .setDescription('Trait name')
        .setRequired(true)
        .setAutocomplete(true))
      .addStringOption(opt => opt
        .setName('die')
        .setDescription('Die rating')
        .setRequired(true)
        .addChoices(...DIE_CHOICES)))

    .addSubcommand(sub => sub
      .setName('remove-trait')
      .setDescription('Remove a trait from your character sheet')
      .addStringOption(opt => opt
        .setName('character')
        .setDescription('Your character name')
        .setRequired(true)
        .setAutocomplete(true))
      .addStringOption(opt => opt
        .setName('traitset')
        .setDescription('Trait set')
        .setRequired(true)
        .setAutocomplete(true))
      .addStringOption(opt => opt
        .setName('trait')
        .setDescription('Trait to remove')
        .setRequired(true)
        .setAutocomplete(true)))

    .addSubcommand(sub => sub
      .setName('pool-add')
      .setDescription('Add a die to a pool trait (resources, hero dice, growth pool, etc.)')
      .addStringOption(opt => opt
        .setName('character')
        .setDescription('Your character name')
        .setRequired(true)
        .setAutocomplete(true))
      .addStringOption(opt => opt
        .setName('traitset')
        .setDescription('Trait set name')
        .setRequired(true)
        .setAutocomplete(true))
      .addStringOption(opt => opt
        .setName('trait')
        .setDescription('Pool trait name')
        .setRequired(true)
        .setAutocomplete(true))
      .addStringOption(opt => opt
        .setName('dice')
        .setDescription('Dice to add (e.g. "d6 d6 d8" or "d6,d8")')
        .setRequired(true)))

    .addSubcommand(sub => sub
      .setName('pool-remove')
      .setDescription('Remove a die from a pool trait (spend a resource, hero die, etc.)')
      .addStringOption(opt => opt
        .setName('character')
        .setDescription('Your character name')
        .setRequired(true)
        .setAutocomplete(true))
      .addStringOption(opt => opt
        .setName('traitset')
        .setDescription('Trait set name')
        .setRequired(true)
        .setAutocomplete(true))
      .addStringOption(opt => opt
        .setName('trait')
        .setDescription('Pool trait name (pool traits only)')
        .setRequired(true)
        .setAutocomplete(true))
      .addStringOption(opt => opt
        .setName('die')
        .setDescription('Die size to remove')
        .setRequired(true)
        .addChoices(...DIE_CHOICES)))

    .addSubcommand(sub => sub
      .setName('delete')
      .setDescription('Permanently delete a character sheet')
      .addStringOption(opt => opt
        .setName('name')
        .setDescription('Character name')
        .setRequired(true)
        .setAutocomplete(true)))

    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List character sheets in this campaign')),

  // -------------------------------------------------------------------------
  // Autocomplete
  // -------------------------------------------------------------------------
  async autocomplete(interaction) {
    const sub        = interaction.options.getSubcommand(false);
    const focused    = interaction.options.getFocused(true);
    const userId     = interaction.user.id;
    const guild      = interaction.guild;
    const campaignId = getCampaignId(interaction.channel);

    // Character name autocomplete
    if (focused.name === 'name' || focused.name === 'character') {
      // view: can see any sheet in campaign; others: only own sheets
      const filterUserId = (focused.name === 'name' && sub === 'view') ? null : userId;
      const sheets = await getAllSheets(guild, campaignId, filterUserId);
      const filtered = sheets
        .filter(s => s.data.name.toLowerCase().includes(focused.value.toLowerCase()))
        .slice(0, 25);
      return interaction.respond(filtered.map(s => ({ name: s.data.name, value: s.data.name })));
    }

    // Trait set autocomplete
    if (focused.name === 'traitset') {
      const cfg = await getConfig(guild, campaignId);
      if (!cfg) return interaction.respond([]);
      const names = Object.keys(cfg.data.traitSets)
        .filter(n => n.toLowerCase().includes(focused.value.toLowerCase()))
        .slice(0, 25);
      return interaction.respond(names.map(n => ({ name: n, value: n })));
    }

    // Trait name autocomplete
    if (focused.name === 'trait') {
      const traitSetName = interaction.options.getString('traitset');
      const charName     = interaction.options.getString('character');
      if (!traitSetName) return interaction.respond([]);

      const cfg    = await getConfig(guild, campaignId);
      const setDef = cfg?.data?.traitSets?.[traitSetName];

      let suggestions = [];

      if (sub === 'pool-remove') {
        // Only existing pool traits on this sheet
        if (charName) {
          const sheet = await getSheet(guild, campaignId, charName, userId);
          const setTraits = sheet?.data?.traitSets?.[traitSetName] ?? {};
          suggestions = Object.entries(setTraits)
            .filter(([, v]) => Array.isArray(v))
            .map(([k]) => k);
        }
      } else {
        // set / pool-add / remove-trait: predefined + existing on sheet
        if (setDef && !setDef.freeForm && setDef.traits.length > 0) {
          suggestions = setDef.traits;
        }
        if (charName) {
          const sheet = await getSheet(guild, campaignId, charName, userId);
          if (sheet?.data?.traitSets?.[traitSetName]) {
            const sheetTraits = Object.keys(sheet.data.traitSets[traitSetName]);
            suggestions = [...new Set([...suggestions, ...sheetTraits])];
          }
        }
      }

      const filtered = suggestions
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

    if (sub === 'create')       return handleCreate(interaction);
    if (sub === 'view')         return handleView(interaction);
    if (sub === 'set')          return handleSet(interaction);
    if (sub === 'remove-trait') return handleRemoveTrait(interaction);
    if (sub === 'pool-add')     return handlePoolAdd(interaction);
    if (sub === 'pool-remove')  return handlePoolRemove(interaction);
    if (sub === 'delete')       return handleDelete(interaction);
    if (sub === 'list')         return handleList(interaction);
  }
};

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

async function handleCreate(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const name       = interaction.options.getString('name').trim();
  const userId     = interaction.user.id;
  const campaignId = getCampaignId(interaction.channel);

  const existing = await getSheet(interaction.guild, campaignId, name, userId);
  if (existing) {
    return interaction.editReply(
      `You already have a character named **${name}** in this campaign. ` +
      `Use \`/sheet set\` to edit it or \`/sheet view\` to see it.`
    );
  }

  const cfg = await getConfig(interaction.guild, campaignId);
  if (!cfg) return interaction.editReply('Campaign not set up. Run `/setup` first.');

  // Build empty trait sets based on current config
  const traitSets = {};
  for (const setName of Object.keys(cfg.data.traitSets)) {
    traitSets[setName] = {};
  }

  await createSheet(interaction.guild, campaignId, {
    name,
    ownerId:  userId,
    ownerTag: interaction.user.username,
    traitSets,
    updatedAt: new Date().toISOString()
  });

  return interaction.editReply(
    `✅ Created sheet for **${name}**!\n` +
    `Use \`/sheet set\` to fill in your traits, then \`/sheet view\` to see the full sheet.`
  );
}

async function handleView(interaction) {
  await interaction.deferReply();

  const name       = interaction.options.getString('name');
  const targetUser = interaction.options.getUser('player') ?? interaction.user;
  const campaignId = getCampaignId(interaction.channel);

  // For view, search by name only (not restricted to owner) so GM can view any sheet
  const sheet = await getSheet(interaction.guild, campaignId, name, null);
  if (!sheet) {
    return interaction.editReply({
      content: `No character named **${name}** found in this campaign.`
    });
  }

  return interaction.editReply({ embeds: [buildSheetEmbed(sheet.data)] });
}

async function handleSet(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const charName     = interaction.options.getString('character');
  const traitSetName = interaction.options.getString('traitset');
  const traitName    = interaction.options.getString('trait').trim();
  const die          = interaction.options.getString('die');
  const userId       = interaction.user.id;
  const campaignId   = getCampaignId(interaction.channel);

  const cfg = await getConfig(interaction.guild, campaignId);
  if (!cfg) return interaction.editReply('Campaign not set up. Run `/setup` first.');

  const setDef = cfg.data.traitSets[traitSetName];
  if (!setDef) {
    return interaction.editReply(
      `No trait set **${traitSetName}** in this campaign's config. ` +
      `An admin needs to add it with \`/config add-traitset\`.`
    );
  }

  if (!setDef.freeForm && setDef.traits.length > 0) {
    const valid = setDef.traits.map(t => t.toLowerCase());
    if (!valid.includes(traitName.toLowerCase())) {
      return interaction.editReply(
        `**${traitName}** is not a valid trait in **${traitSetName}**.\n` +
        `Valid traits: ${setDef.traits.map(t => `\`${t}\``).join(', ')}`
      );
    }
  }

  const sheet = await getSheet(interaction.guild, campaignId, charName, userId);
  if (!sheet) {
    return interaction.editReply(
      `No character named **${charName}** found on your account in this campaign. ` +
      `Use \`/sheet create\` first.`
    );
  }

  if (!sheet.data.traitSets[traitSetName]) sheet.data.traitSets[traitSetName] = {};
  sheet.data.traitSets[traitSetName][traitName] = die;
  sheet.data.updatedAt = new Date().toISOString();

  await updateSheet(interaction.guild, sheet.message, sheet.data);

  return interaction.editReply(
    `✅ **${charName}** — ${traitSetName} / ${traitName} set to ${DIE_EMOJI[die] ?? ''}**${die}**`
  );
}

async function handleRemoveTrait(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const charName     = interaction.options.getString('character');
  const traitSetName = interaction.options.getString('traitset');
  const traitName    = interaction.options.getString('trait');
  const userId       = interaction.user.id;
  const campaignId   = getCampaignId(interaction.channel);

  const sheet = await getSheet(interaction.guild, campaignId, charName, userId);
  if (!sheet) return interaction.editReply(`No character named **${charName}** found on your account.`);

  if (!sheet.data.traitSets?.[traitSetName]?.[traitName]) {
    return interaction.editReply(
      `**${charName}** doesn't have a trait **${traitName}** in **${traitSetName}**.`
    );
  }

  delete sheet.data.traitSets[traitSetName][traitName];
  sheet.data.updatedAt = new Date().toISOString();
  await updateSheet(interaction.guild, sheet.message, sheet.data);

  return interaction.editReply(`✅ Removed **${traitName}** from **${charName}**'s ${traitSetName}.`);
}

async function handlePoolAdd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const charName     = interaction.options.getString('character');
  const traitSetName = interaction.options.getString('traitset');
  const traitName    = interaction.options.getString('trait').trim();
  const diceInput    = interaction.options.getString('dice');
  const userId       = interaction.user.id;
  const campaignId   = getCampaignId(interaction.channel);

  const newDice = parseDiceList(diceInput);
  if (newDice.invalid.length > 0) {
    return interaction.editReply(
      `Invalid dice: ${newDice.invalid.map(d => `\`${d}\``).join(', ')}. Valid sizes: ${VALID_DICE.join(', ')}.`
    );
  }
  if (newDice.valid.length === 0) {
    return interaction.editReply(`No valid dice found in "${diceInput}". Try something like \`d6 d6 d8\`.`);
  }

  const sheet = await getSheet(interaction.guild, campaignId, charName, userId);
  if (!sheet) return interaction.editReply(`No character named **${charName}** found on your account.`);

  if (!sheet.data.traitSets[traitSetName]) sheet.data.traitSets[traitSetName] = {};

  const current = sheet.data.traitSets[traitSetName][traitName];

  if (current === undefined) {
    sheet.data.traitSets[traitSetName][traitName] = newDice.valid.sort((a, b) => parseInt(b.slice(1)) - parseInt(a.slice(1)));
  } else if (Array.isArray(current)) {
    current.push(...newDice.valid);
    current.sort((a, b) => parseInt(b.slice(1)) - parseInt(a.slice(1)));
  } else {
    return interaction.editReply(
      `**${traitName}** is a single-die trait. Use \`/sheet set\` to change its rating, or \`/sheet remove-trait\` first to convert it to a pool.`
    );
  }

  sheet.data.updatedAt = new Date().toISOString();
  await updateSheet(interaction.guild, sheet.message, sheet.data);

  const pool = sheet.data.traitSets[traitSetName][traitName];
  return interaction.editReply(
    `✅ **${charName}** — ${traitSetName} / **${traitName}**: ${pool.map(d => `${DIE_EMOJI[d] ?? ''}${d}`).join(' ')}`
  );
}

async function handlePoolRemove(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const charName     = interaction.options.getString('character');
  const traitSetName = interaction.options.getString('traitset');
  const traitName    = interaction.options.getString('trait').trim();
  const die          = interaction.options.getString('die');
  const userId       = interaction.user.id;
  const campaignId   = getCampaignId(interaction.channel);

  const sheet = await getSheet(interaction.guild, campaignId, charName, userId);
  if (!sheet) return interaction.editReply(`No character named **${charName}** found on your account.`);

  const pool = sheet.data.traitSets[traitSetName]?.[traitName];

  if (!Array.isArray(pool)) {
    return interaction.editReply(`**${traitName}** is not a pool trait. Use \`/sheet remove-trait\` for single-die traits.`);
  }

  const idx = pool.indexOf(die);
  if (idx === -1) {
    const display = pool.map(d => `${DIE_EMOJI[d] ?? ''}${d}`).join(' ');
    return interaction.editReply(`No **${die}** in **${traitName}**. Current pool: ${display}`);
  }

  pool.splice(idx, 1);
  sheet.data.updatedAt = new Date().toISOString();
  await updateSheet(interaction.guild, sheet.message, sheet.data);

  const remaining = pool.length > 0
    ? pool.map(d => `${DIE_EMOJI[d] ?? ''}${d}`).join(' ')
    : '*empty*';
  return interaction.editReply(
    `✅ Spent **${die}** from **${charName}**'s ${traitName}. Remaining: ${remaining}`
  );
}

async function handleDelete(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const name       = interaction.options.getString('name');
  const userId     = interaction.user.id;
  const campaignId = getCampaignId(interaction.channel);

  const deleted = await deleteSheet(interaction.guild, campaignId, name, userId);
  if (!deleted) return interaction.editReply(`No character named **${name}** found on your account.`);

  return interaction.editReply(`🗑️ Deleted **${name}**.`);
}

async function handleList(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const userId     = interaction.user.id;
  const campaignId = getCampaignId(interaction.channel);
  const isAdmin    = interaction.memberPermissions?.has('ManageGuild');

  const sheets = await getAllSheets(interaction.guild, campaignId, isAdmin ? null : userId);

  if (sheets.length === 0) {
    return interaction.editReply(
      isAdmin
        ? 'No character sheets exist in this campaign yet.'
        : 'You have no characters in this campaign. Use `/sheet create` to make one.'
    );
  }

  const lines = sheets.map(s => {
    const sets = Object.entries(s.data.traitSets)
      .map(([k, v]) => `${k}: ${Object.keys(v).length}`)
      .join(', ');
    return `• **${s.data.name}** (${s.data.ownerTag}) — ${sets || 'no traits yet'}`;
  });

  return interaction.editReply(`**Characters in this campaign**\n${lines.join('\n')}`);
}

// ---------------------------------------------------------------------------
// Embed builder
// ---------------------------------------------------------------------------

function buildSheetEmbed(data) {
  const embed = new EmbedBuilder()
    .setTitle(`📋 ${data.name}`)
    .setColor(0x5865F2)
    .setFooter({ text: `Player: ${data.ownerTag}` })
    .setTimestamp(new Date(data.updatedAt));

  const traitSets = data.traitSets ?? {};
  const setNames  = Object.keys(traitSets);

  if (setNames.length === 0) {
    embed.setDescription('*No trait sets configured. Ask your GM to run `/config add-traitset`.*');
    return embed;
  }

  let hasAnyTraits = false;

  for (const setName of setNames) {
    const traits  = traitSets[setName];
    const entries = Object.entries(traits);

    if (entries.length === 0) {
      embed.addFields({ name: setName, value: '*—*', inline: true });
    } else {
      hasAnyTraits = true;
      const value  = entries
        .map(([t, d]) => {
          if (Array.isArray(d)) {
            const dice = d.length > 0
              ? d.map(die => `${DIE_EMOJI[die] ?? ''}${die}`).join(' ')
              : '*empty*';
            return `**${t}** 💾 [${dice}]`;
          }
          return `**${t}** ${DIE_EMOJI[d] ?? ''}${d}`;
        })
        .join('\n');
      embed.addFields({ name: setName, value, inline: true });
    }
  }

  if (!hasAnyTraits) {
    embed.setDescription('*Sheet is empty — use `/sheet set` to add traits.*');
  }

  return embed;
}
