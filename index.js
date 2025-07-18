require('dotenv').config();
const { 
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, Events, Partials 
} = require('discord.js');
const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (_, res) => res.send('Bot is running.'));
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
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
        PRIMARY KEY(message_id, emoji)
      );
    `);
    console.log("Database initialized.");
  } catch (err) {
    console.error("Error initializing database:", err);
  }
})();

const commands = [
  new SlashCommandBuilder()
    .setName('setbirthday')
    .setDescription('Set your birthday')
    .addStringOption(opt =>
      opt.setName('date').setDescription('YYYY-MM-DD').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('clearchannel')
    .setDescription('Clear messages in this channel'),
  new SlashCommandBuilder()
    .setName('modifyrole')
    .setDescription('Add or remove a role')
    .addStringOption(opt => opt.setName('action').setDescription('add/remove').setRequired(true))
    .addStringOption(opt => opt.setName('userid').setDescription('User ID').setRequired(true))
    .addStringOption(opt => opt.setName('roleid').setDescription('Role ID').setRequired(true)),
  new SlashCommandBuilder()
    .setName('memberroles')
    .setDescription('Create a reaction role message')
    .addStringOption(opt => opt.setName('text').setDescription('Message text').setRequired(false))
    .addStringOption(opt => opt.setName('emoji1').setDescription('Emoji 1').setRequired(true))
    .addRoleOption(opt => opt.setName('role1').setDescription('Role 1').setRequired(true))
    .addStringOption(opt => opt.setName('emoji2').setDescription('Emoji 2').setRequired(false))
    .addRoleOption(opt => opt.setName('role2').setDescription('Role 2').setRequired(false))
    .addStringOption(opt => opt.setName('emoji3').setDescription('Emoji 3').setRequired(false))
    .addRoleOption(opt => opt.setName('role3').setDescription('Role 3').setRequired(false))
];

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

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const BIRTHDAY_ROLE_ID = process.env.BIRTHDAY_ROLE_ID;
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!member.roles.cache.has(BIRTHDAY_ROLE_ID)) {
    return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
  }

  try {
    if (interaction.commandName === 'setbirthday') {
      const date = interaction.options.getString('date');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return interaction.reply({ content: 'Invalid date format. Use YYYY-MM-DD.', ephemeral: true });
      }
      await pool.query(`
        INSERT INTO birthdays (user_id, birthday)
        VALUES ($1, $2)
        ON CONFLICT (user_id) DO UPDATE SET birthday = $2
      `, [interaction.user.id, date]);
      return interaction.reply({ content: `Birthday set to ${date}`, ephemeral: true });
    }

    if (interaction.commandName === 'clearchannel') {
      const msgs = await interaction.channel.messages.fetch({ limit: 100 });
      await interaction.channel.bulkDelete(msgs, true);
      return interaction.reply({ content: 'Messages cleared.', ephemeral: true });
    }

    if (interaction.commandName === 'modifyrole') {
      const action = interaction.options.getString('action');
      const userId = interaction.options.getString('userid');
      const roleId = interaction.options.getString('roleid');
      const target = await interaction.guild.members.fetch(userId);
      if (action === 'add') await target.roles.add(roleId);
      else if (action === 'remove') await target.roles.remove(roleId);
      return interaction.reply({ content: `Role ${action}ed for <@${userId}>.`, ephemeral: true });
    }

    if (interaction.commandName === 'memberroles') {
      const text = interaction.options.getString('text') || 'Choose your roles:';
      const pairs = [];
      for (let i = 1; i <= 3; i++) {
        const emoji = interaction.options.getString(`emoji${i}`);
        const role = interaction.options.getRole(`role${i}`);
        if (emoji && role) pairs.push({ emoji, role });
      }
      if (!pairs.length) return interaction.reply({ content: 'At least one emoji-role pair required.', ephemeral: true });

      const description = [text, '', ...pairs.map(p => `${p.emoji} → ${p.role}`)].join('\n');
      const message = await interaction.channel.send({ embeds: [{ description }] });

      for (const { emoji, role } of pairs) {
        try {
          await message.react(emoji);
          await pool.query(`
            INSERT INTO reaction_roles (message_id, emoji, role_id)
            VALUES ($1, $2, $3)
            ON CONFLICT DO NOTHING
          `, [message.id, emoji, role.id]);
        } catch (err) {
          console.error('React DB insert failed:', err);
        }
      }

      return interaction.reply({ content: 'Reaction role message posted.', ephemeral: true });
    }

  } catch (err) {
    console.error('Command error:', err);
    return interaction.reply({ content: 'error', ephemeral: true });
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (reaction.partial) try { await reaction.fetch(); } catch { return; }
  if (user.bot) return;

  try {
    const res = await pool.query(`
      SELECT role_id FROM reaction_roles
      WHERE message_id = $1 AND emoji = $2
    `, [reaction.message.id, reaction.emoji.name]);
    if (!res.rowCount) return;
    const member = await reaction.message.guild.members.fetch(user.id);
    await member.roles.add(res.rows[0].role_id);
  } catch (err) {
    console.error('Reaction add error:', err);
  }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  if (reaction.partial) try { await reaction.fetch(); } catch { return; }
  if (user.bot) return;

  try {
    const res = await pool.query(`
      SELECT role_id FROM reaction_roles
      WHERE message_id = $1 AND emoji = $2
    `, [reaction.message.id, reaction.emoji.name]);
    if (!res.rowCount) return;
    const member = await reaction.message.guild.members.fetch(user.id);
    await member.roles.remove(res.rows[0].role_id);
  } catch (err) {
    console.error('Reaction remove error:', err);
  }
});

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
