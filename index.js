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
        emoji TEXT NOT NULL,
        role_id TEXT NOT NULL
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
      option.setName('date')
        .setDescription('Birthday (YYYY-MM-DD)')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('addreactionrole')
    .setDescription('Create a reaction role message')
    .addStringOption(option =>
      option.setName('text')
        .setDescription('Text content for the message')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('emoji')
        .setDescription('Emoji to react with')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('roleid')
        .setDescription('ID of the role to assign')
        .setRequired(true)
    )
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

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const birthdayRole = process.env.BIRTHDAY_ROLE_ID;

  if (!member.roles.cache.has(birthdayRole)) {
    return interaction.reply({ content: 'error', ephemeral: true });
  }

  if (interaction.commandName === 'setbirthday') {
    const dateInput = interaction.options.getString('date');
    if (!/\d{4}-\d{2}-\d{2}/.test(dateInput)) {
      return interaction.reply({ content: 'error', ephemeral: true });
    }

    try {
      await pool.query(
        `INSERT INTO birthdays (user_id, birthday) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET birthday = EXCLUDED.birthday`,
        [interaction.user.id, dateInput]
      );
      await interaction.reply(`Your birthday has been saved as ${dateInput}.`);
    } catch {
      await interaction.reply({ content: 'error', ephemeral: true });
    }
  }

  if (interaction.commandName === 'addreactionrole') {
    const text = interaction.options.getString('text');
    const emoji = interaction.options.getString('emoji');
    const roleId = interaction.options.getString('roleid');

    try {
      const message = await interaction.channel.send({ content: text });
      await message.react(emoji);
      await pool.query(
        `INSERT INTO reaction_roles (message_id, emoji, role_id) VALUES ($1, $2, $3)`,
        [message.id, emoji, roleId]
      );
      await interaction.reply({ content: 'Reaction role created.', ephemeral: true });
    } catch (err) {
      console.error(err);
      await interaction.reply({ content: 'error', ephemeral: true });
    }
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (reaction.partial) await reaction.fetch();
  if (user.bot) return;

  const res = await pool.query(
    `SELECT role_id FROM reaction_roles WHERE message_id = $1 AND emoji = $2`,
    [reaction.message.id, reaction.emoji.name]
  );

  if (res.rowCount === 0) return;
  const member = await reaction.message.guild.members.fetch(user.id);
  await member.roles.add(res.rows[0].role_id).catch(console.error);
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  if (reaction.partial) await reaction.fetch();
  if (user.bot) return;

  const res = await pool.query(
    `SELECT role_id FROM reaction_roles WHERE message_id = $1 AND emoji = $2`,
    [reaction.message.id, reaction.emoji.name]
  );

  if (res.rowCount === 0) return;
  const member = await reaction.message.guild.members.fetch(user.id);
  await member.roles.remove(res.rows[0].role_id).catch(console.error);
});

client.login(process.env.DISCORD_TOKEN);
