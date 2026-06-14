# Cortex Prime Pal

A Discord bot for running Cortex Prime TTRPG games. Add it to your server: https://discord.com/oauth2/authorize?client_id=1515793107944341644

---

## How campaigns work

The bot uses Discord categories to separate campaigns. Every channel inside the same category shares the same campaign — characters, scene traits, plot points, and campaign pools are all scoped to that category. If a channel has no category, it runs as its own standalone campaign.

You can run multiple Cortex games in one Discord server without them interfering with each other. Just put each campaign's channels in their own category.

---

## First time setup

Run `/setup` in any channel in your campaign category. This creates a hidden `cortex-data` channel where the bot stores all data. Don't delete it.

Next, define the trait sets your game uses with `/config add-traitset`. Cortex Prime games vary a lot here — a Marvel game might have Affiliations, Distinctions, and Power Sets; a Firefly game might use Attributes, Distinctions, and Skills. Add as many trait sets as your game needs.

```
/config add-traitset name:Attributes traits:Physical,Mental,Social
/config add-traitset name:Distinctions
/config add-traitset name:Values traits:Duty,Glory,Justice,Love,Power,Truth
```

The `traits` field is optional. Leave it blank and players can name their own traits freely. Provide trait names and they'll show up as autocomplete suggestions when players fill in their sheets.

`/setup` requires Manage Server permission and only needs to be run once by the server owner.

---

## Character sheets

**Creating a sheet**

```
/sheet create name:Frank
```

Each player creates their own sheet. Sheets are tied to the player who created them.

**Setting static traits**

Static traits hold a single die rating.

```
/sheet set character:Frank traitset:Attributes trait:Mental die:d6
/sheet set character:Frank traitset:Distinctions trait:Retired Soldier die:d8
```

**Pool traits**

Pool traits hold multiple dice, for things like resource pools or hero dice. Use `pool-add` to add dice to them.

```
/sheet pool-add character:Frank traitset:Resources trait:Charlie dice:d6 d6
```

You can add multiple dice at once. `2d6`, `d6 d6`, `d6 d8 d10` all work in the `dice` field.

To spend a die from a pool (remove one die):

```
/sheet pool-remove character:Frank traitset:Resources trait:Charlie die:d6
```

To remove a trait entirely:

```
/sheet remove-trait character:Frank traitset:Attributes trait:Mental
```

**Viewing a sheet**

```
/sheet view name:Frank
/sheet view name:Frank player:@someone
```

**Listing all sheets in the campaign**

```
/sheet list
```

---

## Rolling dice

The `/roll` command builds a dice pool from your sheet, the active scene, campaign pools, or raw dice. It doesn't roll your whole sheet — you tell it which traits you want to include.

**Rolling with a character**

```
/roll character:Frank traits:Mental, Retired Soldier, Duty
```

Separate traits with commas. The bot looks them up on your sheet first, then checks active scene traits, then campaign pools.

**Rolling without a character**

You can roll a free pool without a sheet. Put dice directly in the `traits` field.

```
/roll traits:d8 d6 d10
/roll traits:2d8 1d6
```

**Extra dice**

The `extra` field adds dice that don't come from any trait — good for assets or any die the GM awards you mid-scene.

```
/roll character:Frank traits:Mental, Duty extra:d6
```

**Resource pools**

If your character has pool traits (resource dice, hero dice, etc.), put the pool's name in the `resources` field. The bot shows you the pool and lets you pick which dice to bring into the roll.

```
/roll character:Frank traits:Mental, Duty resources:Charlie
```

**After rolling**

Click each die button to cycle it: unselected, added to total (green), set as effect die (blue). Click Confirm when you're done. Any dice not confirmed are discarded.

Scene trait dice show 🎬 in the roll output. Campaign pool dice show 📚.

---

## Scene traits

Scene traits are shared across everyone in the campaign and cleared at the end of a scene.

**Static scene traits** (single die rating):

```
/scene set trait:On Fire die:d6
/scene remove trait:On Fire
```

**Scene pool traits** (like a Crisis Pool):

```
/scene pool-add trait:Crisis Pool dice:d6 d8
/scene pool-remove trait:Crisis Pool die:d6
```

View all active scene traits:

```
/scene view
```

Clear everything when the scene ends:

```
/scene clear confirm:True
```

---

## Campaign pools

Campaign pools persist across scenes — good for doom pools, threat pools, or any long-running GM resource.

```
/campaign pool-add pool:Doom Pool dice:2d6
/campaign pool-remove pool:Doom Pool die:d6
/campaign pool-clear pool:Doom Pool
/campaign view
```

Campaign pool dice can be included in `/roll` the same way as scene traits — just type the pool name in the `traits` field.

---

## Plot points

Players each have their own plot point balance. The GM has a separate pool.

**Player commands:**

```
/pp view                        — your current balance (visible only to you)
/pp earn                        — gain 1 PP
/pp earn amount:2               — gain more than 1
/pp spend                       — spend 1 PP
/pp give player:@someone        — give a PP to another player
/pp all                         — show everyone's PP balances
```

**GM commands:**

```
/pp gm-view
/pp gm-add
/pp gm-spend
/pp set player:@someone amount:3
```

---

## Config reference

Config commands can be run by anyone in the campaign.

```
/config show
/config add-traitset name:Skills traits:Fight,Drive,Know
/config set-traits name:Skills traits:Fight,Drive,Know,Sneak
/config remove-traitset name:Skills
```

---

## Data storage

Everything is stored in the `cortex-data` channel as bot messages. Don't delete that channel or the messages inside it. The bot needs Read Message History permission there to function. Players never need to see or interact with that channel directly — it gets hidden from everyone on creation.
