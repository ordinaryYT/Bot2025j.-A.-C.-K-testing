require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, Events, Partials } = require('discord.js');
const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (_, res) => res.send('Bot is running.'));
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS birthdays (
      user_id TEXT PRIMARY KEY,
      birthday DATE NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reaction_roles (
      message_id TEXT,
      emoji TEXT,
      role_id TEXT,
      PRIMARY KEY (message_id, emoji)
    );
  `);
  console.log("Database initialized.");
})();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const birthdayRoleId = process.env.BIRTHDAY_ROLE_ID;

const commands = [
  new SlashCommandBuilder()
    .setName('setbirthday')
    .setDescription('Set your birthday')
    .addStringOption(option =>
      option.setName('date')
        .setDescription('Birthday in YYYY-MM-DD format')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('reactionroles')
    .setDescription('Create a reaction role message (max 5)')
    .addStringOption(opt => opt.setName('title').setDescription('Message title').setRequired(false))
    .addStringOption(opt => opt.setName('text').setDescription('Optional text above the list').setRequired(false))
    .addStringOption(opt => opt.setName('emoji1').setDescription('Emoji 1').setRequired(true))
    .addStringOption(opt => opt.setName('roleid1').setDescription('Role ID 1').setRequired(true))
    .addStringOption(opt => opt.setName('rolename1').setDescription('Role Name 1').setRequired(true))
    .addStringOption(opt => opt.setName('emoji2').setDescription('Emoji 2').setRequired(false))
    .addStringOption(opt => opt.setName('roleid2').setDescription('Role ID 2').setRequired(false))
    .addStringOption(opt => opt.setName('rolename2').setDescription('Role Name 2').setRequired(false))
    .addStringOption(opt => opt.setName('emoji3').setDescription('Emoji 3').setRequired(false))
    .addStringOption(opt => opt.setName('roleid3').setDescription('Role ID 3').setRequired(false))
    .addStringOption(opt => opt.setName('rolename3').setDescription('Role Name 3').setRequired(false))
    .addStringOption(opt => opt.setName('emoji4').setDescription('Emoji 4').setRequired(false))
    .addStringOption(opt => opt.setName('roleid4').setDescription('Role ID 4').setRequired(false))
    .addStringOption(opt => opt.setName('rolename4').setDescription('Role Name 4').setRequired(false))
    .addStringOption(opt => opt.setName('emoji5').setDescription('Emoji 5').setRequired(false))
    .addStringOption(opt => opt.setName('roleid5').setDescription('Role ID 5').setRequired(false))
    .addStringOption(opt => opt.setName('rolename5').setDescription('Role Name 5').setRequired(false)),

  new SlashCommandBuilder()
    .setName('clearchannel')
    .setDescription('Clear recent messages in this channel')
    .addIntegerOption(opt => opt.setName('amount').setDescription('Number of messages to delete (max 100)').setRequired(true)),

  new SlashCommandBuilder()
    .setName('modifyrole')
    .setDescription('Add or remove a role from a user')
    .addStringOption(opt => opt.setName('action').setDescription('add/remove').setRequired(true))
    .addStringOption(opt => opt.setName('userid').setDescription('User ID').setRequired(true))
    .addStringOption(opt => opt.setName('roleid').setDescription('Role ID').setRequired(true))
].map(c => c.toJSON());

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
  if (!interaction.member.roles.cache.has(birthdayRoleId)) return interaction.reply({ content: 'error', ephemeral: true });

  const { commandName, options } = interaction;

  if (commandName === 'setbirthday') {
    const date = options.getString('date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return interaction.reply({ content: 'error', ephemeral: true });

    await pool.query(`
      INSERT INTO birthdays (user_id, birthday) VALUES ($1, $2)
      ON CONFLICT (user_id) DO UPDATE SET birthday = EXCLUDED.birthday
    `, [interaction.user.id, date]);

    await interaction.reply(`Birthday saved as ${date}`);
  }

  if (commandName === 'reactionroles') {
    const title = options.getString('title') || '';
    const text = options.getString('text') || '';

    let description = text + '\n\n';
    const rows = [];

    for (let i = 1; i <= 5; i++) {
      const emoji = options.getString(`emoji${i}`);
      const roleId = options.getString(`roleid${i}`);
      const roleName = options.getString(`rolename${i}`);
      if (!emoji || !roleId || !roleName) continue;
      description += `${emoji} = ${roleName}\n`;
      rows.push({ emoji, roleId });
    }

    const msg = await interaction.channel.send({
      embeds: [{ title, description, color: 0x00ff00 }]
    });

    for (const { emoji, roleId } of rows) {
      await msg.react(emoji).catch(() => {});
      await pool.query(
        `INSERT INTO reaction_roles (message_id, emoji, role_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [msg.id, emoji, roleId]
      );
    }

    await interaction.reply({ content: 'Reaction role message created', ephemeral: true });
  }

  if (commandName === 'clearchannel') {
    const amount = options.getInteger('amount');
    if (amount < 1 || amount > 100) return interaction.reply({ content: 'error', ephemeral: true });
    const messages = await interaction.channel.messages.fetch({ limit: amount });
    await interaction.channel.bulkDelete(messages, true);
    await interaction.reply({ content: 'Messages deleted', ephemeral: true });
  }

  if (commandName === 'modifyrole') {
    const action = options.getString('action');
    const userId = options.getString('userid');
    const roleId = options.getString('roleid');
    const member = await interaction.guild.members.fetch(userId);

    if (action === 'add') await member.roles.add(roleId);
    else if (action === 'remove') await member.roles.remove(roleId);
    else return interaction.reply({ content: 'error', ephemeral: true });

    await interaction.reply(`Role ${action}ed for <@${userId}>`);
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (reaction.partial) await reaction.fetch();
  if (user.bot) return;
  const res = await pool.query(
    'SELECT role_id FROM reaction_roles WHERE message_id = $1 AND emoji = $2',
    [reaction.message.id, reaction.emoji.name]
  );
  if (res.rowCount === 0) return;
  const roleId = res.rows[0].role_id;
  const member = await reaction.message.guild.members.fetch(user.id);
  await member.roles.add(roleId).catch(() => {});
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  if (reaction.partial) await reaction.fetch();
  if (user.bot) return;
  const res = await pool.query(
    'SELECT role_id FROM reaction_roles WHERE message_id = $1 AND emoji = $2',
    [reaction.message.id, reaction.emoji.name]
  );
  if (res.rowCount === 0) return;
  const roleId = res.rows[0].role_id;
  const member = await reaction.message.guild.members.fetch(user.id);
  await member.roles.remove(roleId).catch(() => {});
});

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
