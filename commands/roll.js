/**
 * /roll — assemble a Cortex Prime dice pool with fully flexible selection.
 *
 * FLOW
 * ----
 * If the resources field names a pool trait, a PRE-ROLL selection step runs
 * first so the player can pick which pool dice they want to roll:
 *
 *   Phase 1 (preselect) — only appears when pool traits are in resources:
 *     Toggle buttons for each die in the pool → "Roll Selected" button
 *
 *   Phase 2 (select) — always shown after the main roll:
 *     Each die cycles: ◽ Unused → ✅ Total → ⚙️ Effect → ◽ Unused
 *     Resource dice (raw or from pool) toggle on/off in a separate row.
 *     Confirm button finalises the roll.
 *
 * Trait lookup: character sheet → scene traits (🎬)
 */

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require('discord.js');
const { getCampaignId, getSheet, getAllSheets, getScene, getCampaignData } = require('../utils/storage');
const { DIE_EMOJI, isValidDie, normalizeDie, rollPool, parseDiceList } = require('../utils/dice');

// ---------------------------------------------------------------------------
// In-memory roll state  (5-minute TTL)
// ---------------------------------------------------------------------------

const pendingRolls = new Map();
const ROLL_TIMEOUT_MS = 5 * 60 * 1000;

function storePendingRoll(rollId, state) {
  pendingRolls.set(rollId, state);
  setTimeout(() => pendingRolls.delete(rollId), ROLL_TIMEOUT_MS);
}

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll a Cortex Prime dice pool from your character sheet')

    .addStringOption(opt => opt
      .setName('character')
      .setDescription('Your character name (leave blank to roll a free pool)')
      .setRequired(false)
      .setAutocomplete(true))

    .addStringOption(opt => opt
      .setName('traits')
      .setDescription('Static traits or dice to roll — e.g. "Strength, d8, On Fire" (required if no character)')
      .setRequired(false))

    .addStringOption(opt => opt
      .setName('extra')
      .setDescription('Extra dice to add directly (e.g. "d6,d8" for an asset or stunt)')
      .setRequired(false))

    .addStringOption(opt => opt
      .setName('resources')
      .setDescription('Resource/hero dice pool — pick which dice to roll (pool trait name or "d6,d8")')
      .setRequired(false)
      .setAutocomplete(true)),

  // -------------------------------------------------------------------------
  // Autocomplete
  // -------------------------------------------------------------------------
  async autocomplete(interaction) {
    const focused     = interaction.options.getFocused(true);
    const campaignId  = getCampaignId(interaction.channel);

    if (focused.name === 'character') {
      const sheets = await getAllSheets(interaction.guild, campaignId, interaction.user.id);
      const filtered = sheets
        .filter(s => s.data.name.toLowerCase().includes(focused.value.toLowerCase()))
        .slice(0, 25);
      return interaction.respond(filtered.map(s => ({ name: s.data.name, value: s.data.name })));
    }

    if (focused.name === 'resources') {
      const charName = interaction.options.getString('character');
      if (!charName) return interaction.respond([]);

      const sheet = await getSheet(interaction.guild, campaignId, charName, interaction.user.id);
      if (!sheet) return interaction.respond([]);

      // Collect all pool traits (array values) from the sheet
      const pools = [];
      for (const traits of Object.values(sheet.data.traitSets ?? {})) {
        for (const [name, value] of Object.entries(traits)) {
          if (Array.isArray(value)) pools.push(name);
        }
      }

      const filtered = pools
        .filter(n => n.toLowerCase().includes(focused.value.toLowerCase()))
        .slice(0, 25);

      return interaction.respond(filtered.map(n => ({ name: n, value: n })));
    }

    return interaction.respond([]);
  },

  // -------------------------------------------------------------------------
  // Execute — build pool, check for pool trait resources, choose phase
  // -------------------------------------------------------------------------
  async execute(interaction) {
    await interaction.deferReply();

    const charName      = interaction.options.getString('character');
    const traitsInput   = interaction.options.getString('traits');
    const extraInput    = interaction.options.getString('extra');
    const resourceInput = interaction.options.getString('resources');
    const userId        = interaction.user.id;
    const campaignId    = getCampaignId(interaction.channel);

    // Must have either a character or at least some dice/extra to roll
    if (!charName && !traitsInput && !extraInput) {
      return interaction.editReply({
        content: 'Provide a character name, or supply dice in the `traits` or `extra` fields for a free pool roll.',
        flags: MessageFlags.Ephemeral
      });
    }

    // Load character sheet (only if a character was named)
    let sheet = null;
    if (charName) {
      sheet = await getSheet(interaction.guild, campaignId, charName, userId);
      if (!sheet) {
        return interaction.editReply({
          content: `No character named **${charName}** found on your account in this campaign.`,
          flags: MessageFlags.Ephemeral
        });
      }
    }

    // Load active scene traits and campaign pools
    const scene          = await getScene(interaction.guild, campaignId);
    const sceneTraits    = scene?.data?.traits ?? {};
    const campaignData   = await getCampaignData(interaction.guild, campaignId);
    const campaignTraits = campaignData?.data?.traits ?? {};

    // -----------------------------------------------------------------------
    // Build the main pool
    // With a character: look up trait names on the sheet, then scene traits.
    // Without a character: parse raw dice notation and scene trait names only.
    // -----------------------------------------------------------------------
    const requestedTraits = traitsInput
      ? traitsInput.split(',').map(t => t.trim()).filter(Boolean)
      : [];
    const mainPool = [];
    const notFound  = [];

    for (const req of requestedTraits) {
      // Raw die notation — supports plain "d6" and counted "2d6"
      const { valid: freeDice } = parseDiceList(req);
      if (freeDice.length > 0) {
        for (const die of freeDice) mainPool.push({ traitSet: 'Free', traitName: die, die });
        continue;
      }

      // Sheet trait lookup (only when a character is loaded)
      if (sheet) {
        const sheetMatch = findTrait(sheet.data.traitSets, req);
        if (sheetMatch) {
          if (Array.isArray(sheetMatch)) mainPool.push(...sheetMatch);
          else mainPool.push(sheetMatch);
          continue;
        }
      }

      // Scene trait lookup (single-die or pool)
      const sceneMatch = findInTraits(sceneTraits, req, 'Scene');
      if (sceneMatch) {
        if (Array.isArray(sceneMatch)) mainPool.push(...sceneMatch);
        else mainPool.push(sceneMatch);
        continue;
      }

      // Campaign pool lookup
      const campaignMatch = findInTraits(campaignTraits, req, 'Campaign');
      if (campaignMatch) {
        if (Array.isArray(campaignMatch)) mainPool.push(...campaignMatch);
        else mainPool.push(campaignMatch);
        continue;
      }

      notFound.push(req);
    }

    // Extra dice go straight into the main pool
    if (extraInput) {
      for (const part of extraInput.split(',').map(s => s.trim()).filter(Boolean)) {
        const die = normalizeDie(part);
        if (isValidDie(die)) mainPool.push({ traitSet: 'Extra', traitName: die, die });
      }
    }

    if (mainPool.length === 0) {
      const hint = sheet
        ? `Use \`/sheet view ${charName}\` to see your traits, or \`/scene view\` for scene traits.`
        : `Enter dice directly in the traits field, e.g. \`d8, d6, d10\`.`;
      return interaction.editReply({
        content:
          `No dice matched${charName ? ` on **${charName}**'s sheet or the active scene` : ''}.\n` +
          (requestedTraits.length > 0 ? `Requested: ${requestedTraits.map(t => `\`${t}\``).join(', ')}\n\n` : '') +
          hint,
        flags: MessageFlags.Ephemeral
      });
    }

    // -----------------------------------------------------------------------
    // Parse the resources option
    //   rawResources  — dice already known (e.g. "d6,d8"), rolled immediately
    //   poolEntries   — dice from a pool trait, player picks which ones to roll
    // -----------------------------------------------------------------------
    const rawResources = [];   // { traitSet, traitName, die }
    const poolEntries  = [];   // { traitSet, traitName, die, selected }

    if (resourceInput) {
      for (const part of resourceInput.split(',').map(s => s.trim()).filter(Boolean)) {
        const die = normalizeDie(part);
        if (isValidDie(die)) {
          rawResources.push({ traitSet: 'Resource', traitName: die, die });
        } else if (sheet) {
          // Pool trait lookup — only possible with a character sheet
          const match = findTrait(sheet.data.traitSets, part);
          if (match) {
            const entries = Array.isArray(match) ? match : [match];
            for (const e of entries) poolEntries.push({ ...e, selected: false });
          } else {
            notFound.push(part);
          }
        } else {
          notFound.push(part);
        }
      }
    }

    const rollId   = `${userId}-${Date.now()}`;
    const label    = charName ?? 'Free Roll';   // display name for embeds

    // If there are pool trait dice, show the pre-selection UI first
    if (poolEntries.length > 0) {
      const state = {
        phase: 'preselect',
        userId,
        charName: label,
        mainPool,
        rawResources,
        poolEntries,
        notFound
      };
      storePendingRoll(rollId, state);
      const { embed, components } = buildPreselectMessage(rollId, state, interaction.user);
      return interaction.editReply({ embeds: [embed], components });
    }

    // No pool traits — go straight to the roll
    return doRoll(interaction, rollId, { mainPool, rawResources, notFound, userId, charName: label });
  },

  // -------------------------------------------------------------------------
  // Button handler (called from index.js)
  // -------------------------------------------------------------------------
  async handleButton(interaction) {
    const parts  = interaction.customId.split(':');
    const action = parts[0];
    const rollId = parts[1];
    const idx    = parts[2] !== undefined ? parseInt(parts[2], 10) : null;

    const state = pendingRolls.get(rollId);
    if (!state) {
      return interaction.reply({
        content: '⏱️ This roll has expired. Use `/roll` again.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (interaction.user.id !== state.userId) {
      return interaction.reply({
        content: '❌ Only the player who rolled can interact with this.',
        flags: MessageFlags.Ephemeral
      });
    }

    // --------------------------------------------------
    // Phase 1: preselect pool dice
    // --------------------------------------------------
    if (action === 'roll_prepool') {
      state.poolEntries[idx].selected = !state.poolEntries[idx].selected;
      const { embed, components } = buildPreselectMessage(rollId, state, interaction.user);
      return interaction.update({ embeds: [embed], components });
    }

    if (action === 'roll_doroll') {
      const chosen = state.poolEntries.filter(e => e.selected);
      if (chosen.length === 0) {
        return interaction.reply({
          content: 'Select at least one die before rolling.',
          flags: MessageFlags.Ephemeral
        });
      }

      // Move to phase 2 — roll everything
      const resourcePool = [...state.rawResources, ...chosen];
      const results         = rollPool(state.mainPool);
      const resourceResults = rollPool(resourcePool);

      const nextState = {
        phase: 'select',
        userId:         state.userId,
        charName:       state.charName,
        results,
        dieStates:      new Array(results.length).fill(0),
        resourceResults,
        resourceStates: new Array(resourceResults.length).fill(false),
        notFound:       state.notFound
      };

      pendingRolls.set(rollId, nextState);
      clearTimeout(pendingRolls.get(rollId)?._timer);
      setTimeout(() => pendingRolls.delete(rollId), ROLL_TIMEOUT_MS);

      const { embed, components } = buildSelectionMessage(rollId, nextState, interaction.user);
      return interaction.update({ embeds: [embed], components });
    }

    // --------------------------------------------------
    // Phase 2: die selection
    // --------------------------------------------------
    if (action === 'roll_die') {
      state.dieStates[idx] = (state.dieStates[idx] + 1) % 3;
      const { embed, components } = buildSelectionMessage(rollId, state, interaction.user);
      return interaction.update({ embeds: [embed], components });
    }

    if (action === 'roll_res') {
      state.resourceStates[idx] = !state.resourceStates[idx];
      const { embed, components } = buildSelectionMessage(rollId, state, interaction.user);
      return interaction.update({ embeds: [embed], components });
    }

    if (action === 'roll_confirm') {
      const anySelected = state.dieStates.some(s => s > 0) ||
                          state.resourceStates.some(Boolean);
      if (!anySelected) {
        return interaction.reply({
          content: 'Select at least one die first.',
          flags: MessageFlags.Ephemeral
        });
      }
      pendingRolls.delete(rollId);
      const finalEmbed = buildFinalEmbed(state, interaction.user);
      return interaction.update({ embeds: [finalEmbed], components: [] });
    }
  }
};

// ---------------------------------------------------------------------------
// Helper: execute the roll when there are no pool traits to pre-select
// ---------------------------------------------------------------------------
async function doRoll(interaction, rollId, { mainPool, rawResources, notFound, userId, charName }) {
  const results         = rollPool(mainPool);
  const resourceResults = rawResources.length > 0 ? rollPool(rawResources) : [];

  const state = {
    phase: 'select',
    userId,
    charName,
    results,
    dieStates:      new Array(results.length).fill(0),
    resourceResults,
    resourceStates: new Array(resourceResults.length).fill(false),
    notFound
  };

  storePendingRoll(rollId, state);
  const { embed, components } = buildSelectionMessage(rollId, state, interaction.user);
  return interaction.editReply({ embeds: [embed], components });
}

// ---------------------------------------------------------------------------
// Phase 1 UI — pre-roll pool die selection
// ---------------------------------------------------------------------------

function buildPreselectMessage(rollId, state, user) {
  const { charName, poolEntries, rawResources, notFound } = state;

  // Group pool entries by trait name for display
  const byTrait = {};
  for (const e of poolEntries) {
    if (!byTrait[e.traitName]) byTrait[e.traitName] = [];
    byTrait[e.traitName].push(e);
  }

  const traitLines = Object.entries(byTrait).map(([name, entries]) => {
    const dice = entries.map(e =>
      `${e.selected ? '✅' : '◽'} ${DIE_EMOJI[e.die] ?? ''}${e.die}`
    ).join('  ');
    return `**${name}**: ${dice}`;
  });

  const selectedCount = poolEntries.filter(e => e.selected).length;

  const embed = new EmbedBuilder()
    .setTitle(`🎲 ${charName} — Pick Resource Dice`)
    .setColor(0xFEE75C)
    .setDescription(
      'Select which dice from your pool you want to roll, then click **Roll Selected**.\n\n' +
      traitLines.join('\n')
    )
    .setFooter({ text: `Rolled by ${user.username}` });

  if (rawResources.length > 0) {
    embed.addFields({
      name: 'Also rolling',
      value: rawResources.map(r => `${DIE_EMOJI[r.die] ?? ''}${r.die}`).join(' ')
    });
  }

  if (notFound.length > 0) {
    embed.addFields({
      name: '❓ Not Found',
      value: `Skipped: ${notFound.map(t => `\`${t}\``).join(', ')}`
    });
  }

  // One button per pool die
  const dieButtons = poolEntries.map((e, i) => {
    const btn = new ButtonBuilder()
      .setCustomId(`roll_prepool:${rollId}:${i}`)
      .setLabel(`${e.selected ? '✅ ' : ''}${e.die} (${e.traitName})`)
      .setStyle(e.selected ? ButtonStyle.Success : ButtonStyle.Secondary);
    const emoji = parseDieEmoji(e.die);
    if (emoji) btn.setEmoji(emoji);
    return btn;
  });

  const components = [];
  for (let i = 0; i < dieButtons.length; i += 5) {
    components.push(new ActionRowBuilder().addComponents(dieButtons.slice(i, i + 5)));
  }

  // Roll Selected button
  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`roll_doroll:${rollId}`)
        .setLabel(selectedCount > 0 ? `Roll ${selectedCount} Selected` : 'Roll Selected')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(selectedCount === 0)
    )
  );

  return { embed, components };
}

// ---------------------------------------------------------------------------
// Phase 2 UI — die selection after roll
// ---------------------------------------------------------------------------

function buildSelectionMessage(rollId, state, user) {
  const { results, dieStates, charName, notFound, resourceResults, resourceStates } = state;

  const totalDice   = results.filter((_, i) => dieStates[i] === 1);
  const effectDice  = results.filter((_, i) => dieStates[i] === 2);
  const selectedRes = resourceResults.filter((_, i) => resourceStates[i]);
  const mainTotal   = totalDice.reduce((s, r) => s + r.result, 0);
  const resBonus    = selectedRes.reduce((s, r) => s + r.result, 0);
  const total       = mainTotal + resBonus;
  const canConfirm  = dieStates.some(s => s > 0) || resourceStates.some(Boolean);

  const parts = [];
  if (totalDice.length > 0) {
    const resNote = resBonus > 0 ? ` + ${resBonus} (resource) = **${total}**` : ` = **${total}**`;
    parts.push(`✅ **${totalDice.length}** kept for total (${mainTotal}${resNote})`);
  }
  if (effectDice.length > 0) {
    parts.push(`⚙️ **${effectDice.length}** effect ${effectDice.length === 1 ? 'die' : 'dice'}: ${effectDice.map(r => r.die).join(', ')}`);
  }

  const instructions =
    '🖱️ **Click once** → add to total ✅ | **Click again** → set as effect ⚙️ | **Click again** → unselect\n' +
    (parts.length > 0 ? parts.join('  |  ') : '*No dice selected yet.*');

  const resultLines = results.map((r, i) => {
    const s      = dieStates[i];
    const dieTag = `${DIE_EMOJI[r.die] ?? ''}${r.die}`;
    const setTag = r.traitSet === 'Scene' ? ' 🎬' : r.traitSet === 'Campaign' ? ' 📚' : '';
    if (r.result === 1 && s === 0) return `💀 ~~1~~ — ${r.traitName}${setTag} (${dieTag})`;
    if (s === 1) return `✅ **${r.result}** — ${r.traitName}${setTag} (${dieTag})`;
    if (s === 2) return `⚙️ **${r.result}** — ${r.traitName}${setTag} (${dieTag})`;
    return `◽ ${r.result} — ${r.traitName}${setTag} (${dieTag})`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`🎲 ${charName} — Choose Your Dice`)
    .setColor(0x5865F2)
    .setDescription(instructions)
    .addFields({ name: 'Pool', value: resultLines.join('\n') })
    .setFooter({ text: `Rolled by ${user.username}` });

  if (resourceResults.length > 0) {
    const resLines = resourceResults.map((r, i) => {
      const dieTag = `${DIE_EMOJI[r.die] ?? ''}${r.die}`;
      return resourceStates[i]
        ? `➕ **${r.result}** — ${r.traitName} (${dieTag}) ← adding to total`
        : `◽ ${r.result} — ${r.traitName} (${dieTag})`;
    });
    embed.addFields({ name: '💾 Resource / Hero Dice', value: resLines.join('\n') });
  }

  if (notFound.length > 0) {
    embed.addFields({
      name: '❓ Not Found',
      value: `Skipped: ${notFound.map(t => `\`${t}\``).join(', ')}`
    });
  }

  // Main pool buttons
  const diceButtons = results.map((r, i) => {
    const s       = dieStates[i];
    const isHitch = r.result === 1 && s === 0;
    let style     = isHitch ? ButtonStyle.Danger : ButtonStyle.Secondary;
    let label     = `${r.result} (${r.die})`;
    if (s === 1) { style = ButtonStyle.Success; label = `✅ ${r.result} (${r.die})`; }
    if (s === 2) { style = ButtonStyle.Primary;  label = `⚙️ ${r.result} (${r.die})`; }

    return new ButtonBuilder()
      .setCustomId(`roll_die:${rollId}:${i}`)
      .setLabel(label)
      .setStyle(style);
  });

  const components = [];
  for (let i = 0; i < diceButtons.length; i += 5) {
    components.push(new ActionRowBuilder().addComponents(diceButtons.slice(i, i + 5)));
  }

  if (resourceResults.length > 0) {
    const resBtns = resourceResults.map((r, i) =>
      new ButtonBuilder()
        .setCustomId(`roll_res:${rollId}:${i}`)
        .setLabel(resourceStates[i] ? `➕ ${r.result} (${r.die})` : `${r.result} (${r.die})`)
        .setStyle(resourceStates[i] ? ButtonStyle.Success : ButtonStyle.Secondary)
    );
    components.push(new ActionRowBuilder().addComponents(resBtns.slice(0, 5)));
  }

  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`roll_confirm:${rollId}`)
        .setLabel('Confirm Roll')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!canConfirm)
    )
  );

  return { embed, components };
}

// ---------------------------------------------------------------------------
// Final embed
// ---------------------------------------------------------------------------

function buildFinalEmbed(state, user) {
  const { results, dieStates, charName, notFound, resourceResults, resourceStates } = state;

  const totalDice   = results.filter((_, i) => dieStates[i] === 1);
  const effectDice  = results.filter((_, i) => dieStates[i] === 2);
  const selectedRes = resourceResults.filter((_, i) => resourceStates[i]);
  const mainTotal   = totalDice.reduce((s, r) => s + r.result, 0);
  const resBonus    = selectedRes.reduce((s, r) => s + r.result, 0);
  const total       = mainTotal + resBonus;
  const hitches     = results.filter(r => r.result === 1);
  const color       = hitches.length > 0 ? 0xED4245 : total >= 15 ? 0x57F287 : 0x5865F2;

  const resultLines = results.map((r, i) => {
    const s      = dieStates[i];
    const dieTag = `${DIE_EMOJI[r.die] ?? ''}${r.die}`;
    const setTag = r.traitSet === 'Scene' ? ' 🎬' : r.traitSet === 'Campaign' ? ' 📚' : '';
    if (r.result === 1 && s === 0) return `💀 ~~1~~ — ${r.traitName}${setTag} (${dieTag})`;
    if (s === 1) return `✅ **${r.result}** — ${r.traitName}${setTag} (${dieTag}) ← total`;
    if (s === 2) return `⚙️ **${r.result}** — ${r.traitName}${setTag} (${dieTag}) ← effect`;
    return `◽ ${r.result} — ${r.traitName}${setTag} (${dieTag})`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`🎲 ${charName} — Roll Result`)
    .setColor(color)
    .addFields({ name: 'Pool', value: resultLines.join('\n') })
    .setFooter({ text: `Rolled by ${user.username}` })
    .setTimestamp();

  if (resourceResults.length > 0) {
    const resLines = resourceResults.map((r, i) => {
      const dieTag = `${DIE_EMOJI[r.die] ?? ''}${r.die}`;
      return resourceStates[i]
        ? `➕ **${r.result}** — ${r.traitName} (${dieTag}) ← added to total`
        : `◽ ${r.result} — ${r.traitName} (${dieTag})`;
    });
    embed.addFields({ name: '💾 Resource / Hero Dice', value: resLines.join('\n') });
  }

  const totalLabel = resBonus > 0
    ? `**${mainTotal}** + **${resBonus}** (resource) = **${total}**`
    : `**${total}**`;
  embed.addFields({ name: 'Total', value: totalLabel, inline: true });

  const effectLabel = effectDice.length > 0
    ? effectDice.map(r => `⚙️ **${r.die}** *(${r.traitName})*`).join('\n')
    : '*none selected*';
  embed.addFields({
    name: `Effect ${effectDice.length === 1 ? 'Die' : 'Dice'}`,
    value: effectLabel,
    inline: true
  });

  if (hitches.length > 0) {
    embed.addFields({
      name: `⚠️ Hitch${hitches.length > 1 ? 'es' : ''}`,
      value: `${hitches.length} die rolled a 1 — the GM may offer a **Plot Point** for a complication.`
    });
  }

  if (notFound.length > 0) {
    embed.addFields({
      name: '❓ Not Found',
      value: `Skipped: ${notFound.map(t => `\`${t}\``).join(', ')}`
    });
  }

  return embed;
}

// ---------------------------------------------------------------------------
// Emoji helpers
// ---------------------------------------------------------------------------

/**
 * Parse a custom Discord emoji string "<:name:id>" into the object
 * Discord.js button .setEmoji() expects: { name, id }
 * Falls back to null if the string isn't a custom emoji.
 */
function parseDieEmoji(die) {
  const str   = DIE_EMOJI[die];
  if (!str) return null;
  const match = str.match(/^<:(\w+):(\d+)>$/);
  if (!match) return null;
  return { name: match[1], id: match[2] };
}

// ---------------------------------------------------------------------------
// Trait lookup helpers
// ---------------------------------------------------------------------------

function findTrait(traitSets, search) {
  const q = search.toLowerCase();
  for (const [setName, traits] of Object.entries(traitSets)) {
    for (const [traitName, value] of Object.entries(traits)) {
      if (traitName.toLowerCase() === q || traitName.toLowerCase().includes(q)) {
        if (Array.isArray(value)) {
          return value.map(die => ({ traitSet: setName, traitName, die }));
        }
        return { traitSet: setName, traitName, die: value };
      }
    }
  }
  return null;
}

/**
 * Search a flat traits object (scene or campaign) by name.
 * Handles both single-die (string) and pool (array) values.
 * traitSetLabel is 'Scene' or 'Campaign' — used for display in roll output.
 */
function findInTraits(traits, search, traitSetLabel) {
  const q = search.toLowerCase();
  for (const [traitName, value] of Object.entries(traits)) {
    if (traitName.toLowerCase() === q || traitName.toLowerCase().includes(q)) {
      if (Array.isArray(value)) {
        return value.map(die => ({ traitSet: traitSetLabel, traitName, die }));
      }
      return { traitSet: traitSetLabel, traitName, die: value };
    }
  }
  return null;
}
