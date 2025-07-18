// index.js
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

      CREATE TABLE IF NOT EXISTS reaction_roles (
        message_id TEXT NOT NULL,
        emoji TEXT NOT NULL,
        role_id TEXT NOT NULL,
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
    .setName('memberroles')
    .setDescription('Create a reaction role message with emojis and roles')
    .addStringOption(option => option.setName('text').setDescription('Optional message').setRequired(false))
    .addStringOption(option => option.setName('emoji1').setDescription('Emoji 1').setRequired(true))
    .addRoleOption(option => option.setName('role1').setDescription('Role 1').setRequired(true))
    .addStringOption(option => option.setName('emoji2').setDescription('Emoji 2').setRequired(true))
    .addRoleOption(option => option.setName('role2').setDescription('Role 2').setRequired(true))
    .addStringOption(option => option.setName('emoji3').setDescription('Emoji 3').setRequired(true))
    .addRoleOption(option => option.setName('role3').setDescription('Role 3').setRequired(true))
    .addStringOption(option => option.setName('emoji4').setDescription('Emoji 4').setRequired(true))
    .addRoleOption(option => option.setName('role4').setDescription('Role 4').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
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

function emojiMatch(reactedEmoji, storedEmoji) {
  if (!reactedEmoji.id) return reactedEmoji.name === storedEmoji;
  return `<:${reactedEmoji.name}:${reactedEmoji.id}>` === storedEmoji;
}

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'memberroles') return;

  const customText = interaction.options.getString('text') || 'Choose your roles:';
  const options = [];

  for (let i = 1; i <= 4; i++) {
    const emoji = interaction.options.getString(`emoji${i}`);
    const role = interaction.options.getRole(`role${i}`);
    options.push({ emoji, roleId: role.id });
  }

  let description = `${customText}\n\n`;
  options.forEach(opt => {
    description += `${opt.emoji} → <@&${opt.roleId}>\n`;
  });

  const embed = {
    color: 0x00ff00,
    description
  };

  const message = await interaction.channel.send({ embeds: [embed] });

  for (const opt of options) {
    try {
      await message.react(opt.emoji);
      await pool.query(
        `INSERT INTO reaction_roles (message_id, emoji, role_id) VALUES ($1, $2, $3)`,
        [message.id, opt.emoji, opt.roleId]
      );
    } catch (err) {
      console.error(`Reaction error (${opt.emoji}):`, err.message);
    }
  }

  await interaction.reply({ content: 'Reaction role message created!', ephemeral: true });
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (reaction.partial) await reaction.fetch();
  if (user.bot) return;

  try {
    const res = await pool.query(
      `SELECT role_id FROM reaction_roles WHERE message_id = $1`,
      [reaction.message.id]
    );

    for (const row of res.rows) {
      if (emojiMatch(reaction.emoji, row.emoji)) {
        const member = await reaction.message.guild.members.fetch(user.id);
        await member.roles.add(row.role_id);
        break;
      }
    }
  } catch (err) {
    console.error('Add role error:', err.message);
  }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  if (reaction.partial) await reaction.fetch();
  if (user.bot) return;

  try {
    const res = await pool.query(
      `SELECT role_id FROM reaction_roles WHERE message_id = $1`,
      [reaction.message.id]
    );

    for (const row of res.rows) {
      if (emojiMatch(reaction.emoji, row.emoji)) {
        const member = await reaction.message.guild.members.fetch(user.id);
        await member.roles.remove(row.role_id);
        break;
      }
    }
  } catch (err) {
    console.error('Remove role error:', err.message);
  }
});

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
