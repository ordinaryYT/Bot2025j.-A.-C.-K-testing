require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, Events, Partials } = require('discord.js');
const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');
const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (_, res) => res.send('Bot is running.'));
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    await pool.query(`
      DROP TABLE IF EXISTS reaction_roles;
      
      CREATE TABLE IF NOT EXISTS birthdays (
        user_id TEXT PRIMARY KEY,
        birthday DATE NOT NULL
      );
      
      CREATE TABLE reaction_roles (
        message_id TEXT,
        emoji TEXT,
        role_id TEXT,
        PRIMARY KEY (message_id, emoji)
      );
    `);
    console.log("Database initialized.");
  } catch (err) {
    console.error("Error initializing database:", err);
  }
})();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const commands = [
  new SlashCommandBuilder()
    .setName('setbirthday')
    .setDescription('Set your birthday')
    .addStringOption(option =>
      option.setName('date').setDescription('Birthday (YYYY-MM-DD)').setRequired(true)),
  new SlashCommandBuilder()
    .setName('clearchannel')
    .setDescription('delete all messages in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('addorremoverole')
    .setDescription('Add or remove a role')
    .addStringOption(option => option.setName('action').setDescription('add/remove').setRequired(true))
    .addStringOption(option => option.setName('userid').setDescription('User ID').setRequired(true))
    .addStringOption(option => option.setName('roleid').setDescription('Role ID').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('reactionrole')
    .setDescription('set a role with reaction')
    .addStringOption(option => option.setName('message').setDescription('The message to display').setRequired(true))
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
(async () => {
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log("Slash commands registered.");
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
})();

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'setbirthday') {
    const dateInput = interaction.options.getString('date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      return interaction.reply({ content: 'Invalid date format. Use YYYY-MM-DD.', flags: 64 });
    }

    try {
      await pool.query(`
        INSERT INTO birthdays (user_id, birthday)
        VALUES ($1, $2)
        ON CONFLICT (user_id) DO UPDATE SET birthday = EXCLUDED.birthday
      `, [interaction.user.id, dateInput]);
      await interaction.reply({ content: `Birthday date saved as: ${dateInput}`, flags: 64 });
    } catch {
      await interaction.reply({ content: 'Error saving birthday.', flags: 64 });
    }
  }

  if (interaction.commandName === 'clearchannel') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'You don’t have permission.', flags: 64 });
    }

    try {
      const messages = await interaction.channel.messages.fetch({ limit: 100 });
      await interaction.channel.bulkDelete(messages, true);
      await interaction.reply({ content: 'Messages deleted.', flags: 64 });
    } catch {
      await interaction.reply({ content: 'Error clearing messages.', flags: 64 });
    }
  }

  if (interaction.commandName === 'addorremoverole') {
    const action = interaction.options.getString('action');
    const userId = interaction.options.getString('userid');
    const roleId = interaction.options.getString('roleid');

    try {
      const member = await interaction.guild.members.fetch(userId);
      if (action === 'add') {
        await member.roles.add(roleId);
        await interaction.reply(`Added role to <@${userId}>`);
      } else if (action === 'remove') {
        await member.roles.remove(roleId);
        await interaction.reply(`Removed role from <@${userId}>`);
      } else {
        await interaction.reply({ content: 'Invalid action.', flags: 64 });
      }
    } catch {
      await interaction.reply({ content: 'Error modifying role.', flags: 64 });
    }
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();

    const emojiKey = reaction.emoji.name;

    const res = await pool.query(
      'SELECT role_id FROM reaction_roles WHERE message_id = $1 AND emoji = $2',
      [reaction.message.id, emojiKey]
    );

    if (res.rows.length > 0) {
      const member = await reaction.message.guild.members.fetch(user.id);
      await member.roles.add(res.rows[0].role_id);
    }
  } catch (error) {
    console.error('Error assigning role:', error);
  }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();

    const emojiKey = reaction.emoji.name;

    const res = await pool.query(
      'SELECT role_id FROM reaction_roles WHERE message_id = $1 AND emoji = $2',
      [reaction.message.id, emojiKey]
    );

    if (res.rows.length > 0) {
      const member = await reaction.message.guild.members.fetch(user.id);
      await member.roles.remove(res.rows[0].role_id);
    }
  } catch (error) {
    console.error('Error removing role:', error);
  }
});

client.on(Events.GuildMemberAdd, async member => {
  const channel = await client.channels.fetch(process.env.WELCOME_CHANNEL_ID);
  if (channel && channel.isTextBased()) {
    channel.send(`Welcome to the server, <@${member.id}>!`);
  }
});

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// --- Twitch (Simplified - No Token Required) ---
const checkTwitchLiveSimple = async (username) => {
  try {
    const res = await axios.get(`https://decapi.me/twitch/status/${username}`);
    const text = res.data.toLowerCase();

    if (!checkTwitchLiveSimple._liveUsers) checkTwitchLiveSimple._liveUsers = new Set();

    const isLive = !text.includes("offline");
    const alreadyAnnounced = checkTwitchLiveSimple._liveUsers.has(username);

    if (isLive && !alreadyAnnounced) {
      const channel = await client.channels.fetch(process.env.NOTIFICATION_CHANNEL_ID);
      channel.send(` **${username}** is now live on Twitch! → https://twitch.tv/${username}`);
      checkTwitchLiveSimple._liveUsers.add(username);
    } else if (!isLive && alreadyAnnounced) {
      checkTwitchLiveSimple._liveUsers.delete(username);
    }

  } catch (err) {
    console.error(`[Twitch] Error checking ${username}:`, err.message);
  }
};

const TWITCH_USERS = (process.env.TWITCH_USERS || '').split(',');
setInterval(() => {
  for (const user of TWITCH_USERS) {
    if (user) checkTwitchLiveSimple(user.trim().toLowerCase());
  }
}, 60000);

// --- TikTok ---
const TIKTOK_USERS = (process.env.TIKTOK_USERS || '').split(',');
for (const username of TIKTOK_USERS) {
  if (!username) continue;

  const tiktokLive = new WebcastPushConnection(username.trim());

  tiktokLive.connect().then(() => {
    console.log(`[TikTok] Monitoring ${username.trim()}`);
  }).catch(err => {
    console.error(`[TikTok] Connection error: ${username.trim()}`, err);
  });

  tiktokLive.on('streamStart', async () => {
    const channel = await client.channels.fetch(process.env.NOTIFICATION_CHANNEL_ID);
    channel.send(` **${username.trim()}** is now LIVE on TikTok! https://tiktok.com/@${username.trim()}/live`);
  });
}

client.login(process.env.DISCORD_TOKEN);
