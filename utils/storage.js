/**
 * Discord-as-database storage layer.
 *
 * All data lives as bot messages in a channel named "cortex-data".
 * Each message is prefixed with a type tag so the bot can identify it:
 *
 *   CORTEX:CONFIG:  <json>   — one per campaign, holds trait set definitions
 *   CORTEX:SHEET:   <json>   — one per character sheet
 *   CORTEX:SCENE:   <json>   — one per campaign, holds active scene traits
 *   CORTEX:PP:      <json>   — one per player per campaign, holds plot point count
 *                              userId '__GM__' holds the GM's plot point pool
 *   CORTEX:CAMPAIGN:<json>   — one per campaign, holds persistent campaign-level pools
 *                              (doom pool, threat pool, etc.) that survive scene clears
 *
 * CAMPAIGN ISOLATION
 * ------------------
 * Each campaign is identified by a campaignId derived from the Discord channel
 * the command is run in:
 *   - If the channel belongs to a category → campaignId = category ID
 *   - Otherwise → campaignId = channel ID
 *
 * This means all channels in the same category share one campaign, while
 * channels outside any category each have their own isolated campaign.
 */

const { ChannelType } = require('discord.js');

const DATA_CHANNEL_NAME = 'cortex-data';
const CONFIG_PREFIX     = 'CORTEX:CONFIG:';
const SHEET_PREFIX      = 'CORTEX:SHEET:';
const SCENE_PREFIX      = 'CORTEX:SCENE:';
const PP_PREFIX         = 'CORTEX:PP:';
const CAMPAIGN_PREFIX   = 'CORTEX:CAMPAIGN:';
const GM_USER_ID        = '__GM__';

// ---------------------------------------------------------------------------
// Campaign helpers
// ---------------------------------------------------------------------------

/**
 * Derive the campaign ID from a Discord channel.
 * Uses the parent category ID if one exists, otherwise the channel's own ID.
 */
function getCampaignId(channel) {
  return channel.parentId ?? channel.id;
}

// ---------------------------------------------------------------------------
// Simple in-memory cache — keeps autocomplete well under Discord's 3s limit.
// Reads use cached data if fresh; writes invalidate immediately.
// ---------------------------------------------------------------------------
const _cache = new Map(); // key: guildId → { messages, timestamp }
const CACHE_TTL_MS = 10_000;

function _cacheKey(guild)     { return guild.id; }
function _getCached(guild)    {
  const entry = _cache.get(_cacheKey(guild));
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) return entry.messages;
  return null;
}
function _setCached(guild, messages) {
  _cache.set(_cacheKey(guild), { messages, timestamp: Date.now() });
}
function _invalidate(guild)   { _cache.delete(_cacheKey(guild)); }

// ---------------------------------------------------------------------------
// Channel helpers
// ---------------------------------------------------------------------------

/** Find the cortex-data channel in a guild (text channels only). */
async function getDataChannel(guild) {
  await guild.channels.fetch();
  return guild.channels.cache.find(
    c => c.name === DATA_CHANNEL_NAME && c.isTextBased()
  ) ?? null;
}

/**
 * Fetch every message in a channel, paging through Discord's 100-message
 * limit as needed. Results are cached per guild for CACHE_TTL_MS.
 */
async function fetchAllDataMessages(channel, guild = null) {
  if (guild) {
    const cached = _getCached(guild);
    if (cached) return cached;
  }

  const messages = [];
  let lastId = null;

  while (true) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;

    const batch = await channel.messages.fetch(options);
    if (batch.size === 0) break;

    messages.push(...batch.values());
    lastId = batch.last().id;

    if (batch.size < 100) break;
  }

  if (guild) _setCached(guild, messages);
  return messages;
}

// ---------------------------------------------------------------------------
// Config (trait set definitions, per campaign)
// ---------------------------------------------------------------------------

/**
 * Returns { message, data } for the campaign's config, or null if none exists.
 *
 * Config shape:
 * {
 *   campaignId: "...",
 *   traitSets: {
 *     "Attributes": { freeForm: false, traits: ["Strength", "Agility"] },
 *     "Distinctions": { freeForm: true, traits: [] }
 *   }
 * }
 */
async function getConfig(guild, campaignId) {
  const channel = await getDataChannel(guild);
  if (!channel) return null;

  const messages = await fetchAllDataMessages(channel, guild);
  const msg = messages.find(m => {
    if (!m.author.bot || !m.content.startsWith(CONFIG_PREFIX)) return false;
    try {
      const d = JSON.parse(m.content.slice(CONFIG_PREFIX.length));
      return d.campaignId === campaignId;
    } catch { return false; }
  });
  if (!msg) return null;

  try {
    return { message: msg, data: JSON.parse(msg.content.slice(CONFIG_PREFIX.length)) };
  } catch { return null; }
}

/** Create or update the campaign config message. */
async function saveConfig(guild, campaignId, configData) {
  const channel = await getDataChannel(guild);
  if (!channel) throw new Error('No cortex-data channel found. Run `/setup` first.');

  _invalidate(guild);
  const payload = { ...configData, campaignId };
  const content = CONFIG_PREFIX + JSON.stringify(payload);

  const existing = await getConfig(guild, campaignId);
  if (existing) {
    await existing.message.edit(content);
  } else {
    await channel.send(content);
  }
  _invalidate(guild);
}

// ---------------------------------------------------------------------------
// Character sheets (per campaign)
// ---------------------------------------------------------------------------

/**
 * Find a character sheet by name (case-insensitive) within a campaign.
 * If userId is provided, only returns sheets owned by that user.
 * Returns { message, data } or null.
 *
 * Sheet data shape:
 * {
 *   campaignId: "...",
 *   name: "Aria Voss",
 *   ownerId: "123456789",
 *   ownerTag: "PlayerName",
 *   traitSets: {
 *     "Attributes": { "Strength": "d8" },          // single-die trait
 *     "Resources":  { "Gold": ["d6", "d6", "d8"] } // pool trait
 *   },
 *   updatedAt: "ISO timestamp"
 * }
 */
async function getSheet(guild, campaignId, charName, userId = null) {
  const channel = await getDataChannel(guild);
  if (!channel) return null;

  const messages = await fetchAllDataMessages(channel, guild);

  for (const msg of messages) {
    if (!msg.author.bot || !msg.content.startsWith(SHEET_PREFIX)) continue;
    try {
      const data = JSON.parse(msg.content.slice(SHEET_PREFIX.length));
      if (data.campaignId !== campaignId) continue;
      const nameMatch  = data.name.toLowerCase() === charName.toLowerCase();
      const ownerMatch = !userId || data.ownerId === userId;
      if (nameMatch && ownerMatch) return { message: msg, data };
    } catch { continue; }
  }

  return null;
}

/**
 * Returns all sheets in a campaign, optionally filtered by owner.
 */
async function getAllSheets(guild, campaignId, userId = null) {
  const channel = await getDataChannel(guild);
  if (!channel) return [];

  const messages = await fetchAllDataMessages(channel, guild);
  const sheets = [];

  for (const msg of messages) {
    if (!msg.author.bot || !msg.content.startsWith(SHEET_PREFIX)) continue;
    try {
      const data = JSON.parse(msg.content.slice(SHEET_PREFIX.length));
      if (data.campaignId !== campaignId) continue;
      if (!userId || data.ownerId === userId) sheets.push({ message: msg, data });
    } catch { continue; }
  }

  return sheets;
}

/** Create a new sheet message. Does NOT check for duplicates — caller must. */
async function createSheet(guild, campaignId, sheetData) {
  const channel = await getDataChannel(guild);
  if (!channel) throw new Error('No cortex-data channel found. Run `/setup` first.');

  _invalidate(guild);
  const payload = { ...sheetData, campaignId };
  const msg = await channel.send(SHEET_PREFIX + JSON.stringify(payload));
  _invalidate(guild);
  return msg;
}

/** Update an existing sheet message in place. */
async function updateSheet(guild, existingMessage, sheetData) {
  _invalidate(guild);
  const content = SHEET_PREFIX + JSON.stringify(sheetData);
  const fresh = await existingMessage.channel.messages.fetch(existingMessage.id);
  const result = await fresh.edit(content);
  _invalidate(guild);
  return result;
}

/** Delete a sheet. Returns true if found and deleted, false otherwise. */
async function deleteSheet(guild, campaignId, charName, userId) {
  const sheet = await getSheet(guild, campaignId, charName, userId);
  if (!sheet) return false;
  _invalidate(guild);
  await sheet.message.delete();
  _invalidate(guild);
  return true;
}

// ---------------------------------------------------------------------------
// Scene traits (per campaign — one active scene at a time)
// ---------------------------------------------------------------------------

/**
 * Returns { message, data } for the campaign's active scene, or null.
 *
 * Scene data shape:
 * {
 *   campaignId: "...",
 *   traits: {
 *     "On Fire":         "d6",   // single-die scene trait
 *     "Unstable Ground": "d8"
 *   }
 * }
 */
async function getScene(guild, campaignId) {
  const channel = await getDataChannel(guild);
  if (!channel) return null;

  const messages = await fetchAllDataMessages(channel, guild);
  const msg = messages.find(m => {
    if (!m.author.bot || !m.content.startsWith(SCENE_PREFIX)) return false;
    try {
      const d = JSON.parse(m.content.slice(SCENE_PREFIX.length));
      return d.campaignId === campaignId;
    } catch { return false; }
  });
  if (!msg) return null;

  try {
    return { message: msg, data: JSON.parse(msg.content.slice(SCENE_PREFIX.length)) };
  } catch { return null; }
}

/** Create or update the active scene. */
async function saveScene(guild, campaignId, sceneData) {
  const channel = await getDataChannel(guild);
  if (!channel) throw new Error('No cortex-data channel found. Run `/setup` first.');

  _invalidate(guild);
  const payload = { ...sceneData, campaignId };
  const content = SCENE_PREFIX + JSON.stringify(payload);

  const existing = await getScene(guild, campaignId);
  if (existing) {
    const fresh = await existing.message.channel.messages.fetch(existing.message.id);
    await fresh.edit(content);
  } else {
    await channel.send(content);
  }
  _invalidate(guild);
}

/** Delete the active scene for this campaign. Returns true if one existed. */
async function clearScene(guild, campaignId) {
  const scene = await getScene(guild, campaignId);
  if (!scene) return false;
  _invalidate(guild);
  await scene.message.delete();
  _invalidate(guild);
  return true;
}

// ---------------------------------------------------------------------------
// Campaign-level data (doom pools, threat pools — persist across scene clears)
// ---------------------------------------------------------------------------

/**
 * Returns { message, data } for campaign-level pools, or null.
 *
 * Campaign data shape:
 * {
 *   campaignId: "...",
 *   traits: {
 *     "Doom Pool":   ["d6", "d8", "d10"],   // pool
 *     "Threat Pool": "d6"                   // single-die (less common but supported)
 *   }
 * }
 */
async function getCampaignData(guild, campaignId) {
  const channel = await getDataChannel(guild);
  if (!channel) return null;

  const messages = await fetchAllDataMessages(channel, guild);
  const msg = messages.find(m => {
    if (!m.author.bot || !m.content.startsWith(CAMPAIGN_PREFIX)) return false;
    try {
      const d = JSON.parse(m.content.slice(CAMPAIGN_PREFIX.length));
      return d.campaignId === campaignId;
    } catch { return false; }
  });
  if (!msg) return null;

  try {
    return { message: msg, data: JSON.parse(msg.content.slice(CAMPAIGN_PREFIX.length)) };
  } catch { return null; }
}

/** Create or update the campaign-level data message. */
async function saveCampaignData(guild, campaignId, campaignData) {
  const channel = await getDataChannel(guild);
  if (!channel) throw new Error('No cortex-data channel found. Run `/setup` first.');

  _invalidate(guild);
  const payload = { ...campaignData, campaignId };
  const content = CAMPAIGN_PREFIX + JSON.stringify(payload);

  const existing = await getCampaignData(guild, campaignId);
  if (existing) {
    const fresh = await existing.message.channel.messages.fetch(existing.message.id);
    await fresh.edit(content);
  } else {
    await channel.send(content);
  }
  _invalidate(guild);
}

// ---------------------------------------------------------------------------
// Plot points (per player per campaign; GM pool uses userId GM_USER_ID)
// ---------------------------------------------------------------------------

/**
 * Get the current PP count for a user (or GM pool).
 * Returns 0 if no record exists yet.
 */
async function getPP(guild, campaignId, userId) {
  const channel = await getDataChannel(guild);
  if (!channel) return 0;

  const messages = await fetchAllDataMessages(channel, guild);
  for (const msg of messages) {
    if (!msg.author.bot || !msg.content.startsWith(PP_PREFIX)) continue;
    try {
      const d = JSON.parse(msg.content.slice(PP_PREFIX.length));
      if (d.campaignId === campaignId && d.userId === userId) return d.points ?? 0;
    } catch { continue; }
  }
  return 0;
}

/**
 * Set the PP count for a user (or GM pool). Creates the record if it doesn't exist.
 * Points are clamped to >= 0.
 */
async function setPP(guild, campaignId, userId, points) {
  const channel = await getDataChannel(guild);
  if (!channel) throw new Error('No cortex-data channel found. Run `/setup` first.');

  const clamped = Math.max(0, points);
  const content = PP_PREFIX + JSON.stringify({ campaignId, userId, points: clamped });

  _invalidate(guild);
  const messages = await fetchAllDataMessages(channel, guild);
  const existing = messages.find(m => {
    if (!m.author.bot || !m.content.startsWith(PP_PREFIX)) return false;
    try {
      const d = JSON.parse(m.content.slice(PP_PREFIX.length));
      return d.campaignId === campaignId && d.userId === userId;
    } catch { return false; }
  });

  if (existing) {
    const fresh = await existing.channel.messages.fetch(existing.id);
    await fresh.edit(content);
  } else {
    await channel.send(content);
  }
  _invalidate(guild);
  return clamped;
}

/**
 * Returns all PP records for a campaign as an array of { userId, points }.
 * The GM pool entry (userId === GM_USER_ID) is included if it exists.
 */
async function getAllPP(guild, campaignId) {
  const channel = await getDataChannel(guild);
  if (!channel) return [];

  const messages = await fetchAllDataMessages(channel, guild);
  const records  = [];

  for (const msg of messages) {
    if (!msg.author.bot || !msg.content.startsWith(PP_PREFIX)) continue;
    try {
      const d = JSON.parse(msg.content.slice(PP_PREFIX.length));
      if (d.campaignId === campaignId) records.push({ userId: d.userId, points: d.points ?? 0 });
    } catch { continue; }
  }

  return records;
}

module.exports = {
  DATA_CHANNEL_NAME,
  GM_USER_ID,
  getCampaignId,
  getDataChannel,
  getConfig,
  saveConfig,
  getSheet,
  getAllSheets,
  createSheet,
  updateSheet,
  deleteSheet,
  getScene,
  saveScene,
  clearScene,
  getPP,
  setPP,
  getAllPP,
  getCampaignData,
  saveCampaignData
};
