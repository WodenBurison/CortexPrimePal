/**
 * Cortex Prime dice mechanics.
 *
 * Standard roll:
 *   1. Assemble a pool of dice from traits (each trait contributes its die).
 *   2. Roll every die in the pool.
 *   3. Keep the two highest results — their sum is the TOTAL.
 *   4. The highest die NOT in the kept pair is the EFFECT DIE.
 *      (If only 1-2 dice were rolled, the lowest kept die is the effect die.)
 *   5. Any die that rolled a 1 is a HITCH — the GM can offer a Plot Point
 *      to introduce a complication.
 */

const VALID_DICE = ['d4', 'd6', 'd8', 'd10', 'd12'];

// Custom server emoji for each die size
const DIE_EMOJI = {
  d4:  '<:d4:1515342501836361908>',
  d6:  '<:d6:1515342549701759058>',
  d8:  '<:d8:1515342565442982048>',
  d10: '<:d10:1515342584665608274>',
  d12: '<:d12:1515342596854255736>'
};

function isValidDie(die) {
  return VALID_DICE.includes(die?.toLowerCase());
}

function normalizeDie(die) {
  return die?.toLowerCase();
}

function dieSides(die) {
  return parseInt(die.slice(1), 10);
}

/** Roll a single die, returning an integer in [1, sides]. */
function rollDie(die) {
  return Math.floor(Math.random() * dieSides(die)) + 1;
}

/**
 * Roll a pool of dice descriptors.
 *
 * @param {Array<{ traitSet: string, traitName: string, die: string }>} pool
 * @returns {Array<{ traitSet, traitName, die, result }>}
 */
function rollPool(pool) {
  return pool.map(entry => ({
    ...entry,
    result: rollDie(entry.die)
  }));
}

/**
 * Evaluate a rolled pool per Cortex Prime rules.
 *
 * Returns:
 *   kept      — the two highest-result entries (or all if fewer than 3)
 *   effect    — the highest-result entry NOT in kept (null if pool ≤ 2)
 *   total     — sum of kept results
 *   hitches   — entries that rolled a 1
 */
function evaluatePool(results) {
  // Sort descending by result; tie-break by die size (larger die wins ties)
  const sorted = [...results].sort((a, b) => {
    if (b.result !== a.result) return b.result - a.result;
    return dieSides(b.die) - dieSides(a.die);
  });

  const kept = sorted.slice(0, 2);
  const rest = sorted.slice(2);

  // Effect die: best remaining die by size (not result), per standard Cortex
  // convention. If no remaining dice, use the smaller of the kept pair.
  let effect = null;
  if (rest.length > 0) {
    effect = rest.reduce((best, cur) =>
      dieSides(cur.die) > dieSides(best.die) ? cur : best
    , rest[0]);
  } else if (kept.length >= 2) {
    // Only two dice — smaller kept die becomes the effect die
    effect = dieSides(kept[0].die) >= dieSides(kept[1].die) ? kept[1] : kept[0];
  } else if (kept.length === 1) {
    effect = kept[0];
  }

  const total = kept.reduce((sum, r) => sum + r.result, 0);
  const hitches = results.filter(r => r.result === 1);

  return { kept, effect, rest, total, hitches };
}

/**
 * Build a rich embed description string for a dice roll result.
 *
 * @param {Array} pool   — original pool descriptors
 * @param {Array} results — rolled results
 * @param {object} evaluation — from evaluatePool()
 */
function formatRollEmbed(evaluation) {
  const { kept, effect, rest, total, hitches } = evaluation;

  // Build pool display lines
  const allResults = [...kept, ...rest];

  const lines = allResults.map(r => {
    const isKept = kept.includes(r);
    const isHitch = r.result === 1;
    const dieLabel = `${DIE_EMOJI[r.die] ?? ''}${r.die}`;
    const traitLabel = r.traitName ? `${r.traitName} (${dieLabel})` : dieLabel;

    if (isHitch) return `~~**1**~~ 💀 ${traitLabel}`;
    if (isKept)  return `**${r.result}** ✅ ${traitLabel}`;
    return `${r.result} ${traitLabel}`;
  });

  let out = lines.join('\n');

  out += `\n\n**Total:** ${total}`;

  if (effect) {
    const effectLabel = effect.traitName
      ? `${effect.traitName} → ${effect.die}`
      : effect.die;
    out += `\n**Effect Die:** ${effect.die} *(${effectLabel})*`;
  }

  if (hitches.length > 0) {
    out += `\n\n⚠️ **Hitch${hitches.length > 1 ? 'es' : ''}!** ${hitches.length} die rolled a 1 — the GM may offer a Plot Point for a complication.`;
  }

  return out;
}

/**
 * Parse a dice string into individual die sizes.
 * Accepts counted notation ("2d6 1d8"), plain ("d6 d6 d8"), or mixed.
 * Commas are optional separators.
 * Returns { valid: string[], invalid: string[] }
 */
function parseDiceList(input) {
  const parts   = input.split(/[\s,]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
  const valid   = [];
  const invalid = [];

  for (const p of parts) {
    const counted = p.match(/^(\d+)(d\d+)$/);
    if (counted) {
      const count = parseInt(counted[1], 10);
      const die   = counted[2];
      if (VALID_DICE.includes(die)) {
        for (let i = 0; i < count; i++) valid.push(die);
      } else {
        invalid.push(p);
      }
      continue;
    }
    if (VALID_DICE.includes(p)) valid.push(p);
    else invalid.push(p);
  }

  return { valid, invalid };
}

module.exports = {
  VALID_DICE,
  DIE_EMOJI,
  isValidDie,
  normalizeDie,
  dieSides,
  rollDie,
  rollPool,
  evaluatePool,
  formatRollEmbed,
  parseDiceList
};
