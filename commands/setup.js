const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags
} = require('discord.js');
const {
  DATA_CHANNEL_NAME,
  getCampaignId,
  getDataChannel,
  getConfig,
  saveConfig
} = require('../utils/storage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Initialize Cortex Prime bot in this server (creates the data channel)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guild      = interaction.guild;
    const campaignId = getCampaignId(interaction.channel);
    let channel      = await getDataChannel(guild);

    if (!channel) {
      // Create a hidden channel only the bot can see
      channel = await guild.channels.create({
        name: DATA_CHANNEL_NAME,
        type: ChannelType.GuildText,
        reason: 'Cortex Prime bot — data storage channel',
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: ['ViewChannel']
          },
          {
            id: guild.members.me.id,
            allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageMessages']
          }
        ]
      });

      await channel.send(
        '📁 **Cortex Prime — Data Channel**\n' +
        '*Character sheets, configs, and scene traits are stored here as bot messages. ' +
        'Do not delete or manually edit these messages.*'
      );
    }

    // Seed an empty config for this campaign if none exists
    const existing = await getConfig(guild, campaignId);
    if (!existing) {
      await saveConfig(guild, campaignId, { traitSets: {} });
      await interaction.editReply(
        `✅ Set up campaign (ID: \`${campaignId}\`) with data channel <#${channel.id}>.\n\n` +
        `Each Discord **category** is its own campaign — all channels in the same category share characters and config.\n\n` +
        `Next: use \`/config add-traitset\` to define trait sets (e.g. Attributes, Distinctions, Values).`
      );
    } else {
      await interaction.editReply(
        `ℹ️ Campaign \`${campaignId}\` is already set up (data channel: <#${channel.id}>).\n` +
        `Use \`/config show\` to see the current configuration.`
      );
    }
  }
};
