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

// Initialize tables
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
    .addStringOption(opt =>
      opt.setName('date')
        .setDescription('Your birthday (YYYY-MM-DD)')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('clearchannel')
    .setDescription('Clear messages in this channel (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('modifyrole')
    .setDescription('Add or remove a role from a user (Admin only)')
    .addStringOption(opt =>
      opt.setName('action')
        .setDescription('add or remove')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('userid')
        .setDescription('User ID')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('roleid')
        .setDescription('Role ID')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('memberroles')
    .setDescription('Create a reaction role message (Birthday role required)')
    .addStringOption(opt =>
      opt.setName('text')
        .setDescription('Custom message text')
        .setRequired(true)
    )
    .addStringOption(opt => opt.setName('emoji1').setDescription('Emoji 1').setRequired(true))
    .addRoleOption(opt => opt.setName('role1').setDescription('Role 1').setRequired(true))
    .addStringOption(opt => opt.setName('emoji2').setDescription('Emoji 2').setRequired(false))
    .addRoleOption(opt => opt.setName('role2').setDescription('Role 2').setRequired(false))
    .addStringOption(opt => opt.setName('emoji3').setDescription('Emoji 3').setRequired(false))
    .addRoleOption(opt => opt.setName('role3').setDescription('Role 3').setRequired(false))
    .addStringOption(opt => opt.setName('emoji4').setDescription('Emoji 4').setRequired(false))
    .addRoleOption(opt => opt.setName('role4').setDescription('Role 4').setRequired(false))
].map(cmd => cmd.toJSON());

// Register commands
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

// Command handler
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const hasBirthdayRole = member.roles.cache.has(process.env.BIRTHDAY_ROLE_ID);
  if (!hasBirthdayRole) {
    return interaction.reply({ content: "error", ephemeral: true });
  }

  const cmd = interaction.commandName;

  if (cmd === 'setbirthday') {
    const dateInput = interaction.options.getString('date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      return interaction.reply({ content: "error", ephemeral: true });
    }

    try {
      await pool.query(
        `INSERT INTO birthdays (user_id, birthday)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET birthday = EXCLUDED.birthday`,
        [interaction.user.id, dateInput]
      );
      await interaction.reply(`Birthday saved: ${dateInput}`);
    } catch {
      await interaction.reply({ content: "error", ephemeral: true });
    }
  }

  if (cmd === 'clearchannel') {
    try {
      const messages = await interaction.channel.messages.fetch({ limit: 100 });
      await interaction.channel.bulkDelete(messages, true);
      await interaction.reply({ content: "Messages deleted.", ephemeral: true });
    } catch {
      await interaction.reply({ content: "error", ephemeral: true });
    }
  }

  if (cmd === 'modifyrole') {
    const action = interaction.options.getString('action');
    const userId = interaction.options.getString('userid');
    const roleId = interaction.options.getString('roleid');

    try {
      const target = await interaction.guild.members.fetch(userId);
      if (action === 'add') {
        await target.roles.add(roleId);
        await interaction.reply(`Added role to <@${userId}>`);
      } else if (action === 'remove') {
        await target.roles.remove(roleId);
        await interaction.reply(`Removed role from <@${userId}>`);
      } else {
        await interaction.reply({ content: "error", ephemeral: true });
      }
    } catch {
      await interaction.reply({ content: "error", ephemeral: true });
    }
  }

  if (cmd === 'memberroles') {
    const text = interaction.options.getString('text');

    const options = [];
    for (let i = 1; i <= 4; i++) {
      const emoji = interaction.options.getString(`emoji${i}`);
      const role = interaction.options.getRole(`role${i}`);
      if (emoji && role) options.push({ emoji, role });
    }

    if (!options.length) {
      return interaction.reply({ content: "error", ephemeral: true });
    }

    let description = `${text}\n\n`;
    for (const { emoji, role } of options) {
      description += `${emoji} → ${role}\n`;
    }

    const embed = {
      description,
      color: 0x00ff00
    };

    try {
      const message = await interaction.channel.send({ embeds: [embed] });

      for (const { emoji } of options) {
        await message.react(emoji).catch(() => {});
      }

      const insertValues = options.map(({ emoji, role }) =>
        pool.query(
          `INSERT INTO reaction_roles (message_id, emoji, role_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (message_id, emoji) DO NOTHING`,
          [message.id, emoji, role.id]
        )
      );
      await Promise.all(insertValues);

      await interaction.reply({ content: "Reaction role message created.", ephemeral: true });
    } catch {
      await interaction.reply({ content: "error", ephemeral: true });
    }
  }
});

// Reaction handling
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (reaction.partial) await reaction.fetch();
  if (user.bot) return;

  try {
    const res = await pool.query(
      `SELECT role_id FROM reaction_roles WHERE message_id = $1 AND emoji = $2`,
      [reaction.message.id, reaction.emoji.name]
    );
    if (!res.rows.length) return;

    const member = await reaction.message.guild.members.fetch(user.id);
    await member.roles.add(res.rows[0].role_id).catch(console.error);
  } catch (err) {
    console.error("Error adding role on reaction:", err);
  }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  if (reaction.partial) await reaction.fetch();
  if (user.bot) return;

  try {
    const res = await pool.query(
      `SELECT role_id FROM reaction_roles WHERE message_id = $1 AND emoji = $2`,
      [reaction.message.id, reaction.emoji.name]
    );
    if (!res.rows.length) return;

    const member = await reaction.message.guild.members.fetch(user.id);
    await member.roles.remove(res.rows[0].role_id).catch(console.error);
  } catch (err) {
    console.error("Error removing role on reaction:", err);
  }
});

// Birthday check on bot ready
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// Login
client.login(process.env.DISCORD_TOKEN);
