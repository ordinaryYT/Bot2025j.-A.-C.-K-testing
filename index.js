require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, Events, Partials } = require('discord.js');
const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (_, res) => res.send('Bot is running.'));
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));

// PostgreSQL setup
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
    console.log("Database initialized.");
  } catch (err) {
    console.error("Error initializing database:", err);
  }
})();

// Discord client setup
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

// Slash commands
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
    .setName('clearchannel')
    .setDescription('Clear messages in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('modifyroles')
    .setDescription('Add or remove a role')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option.setName('action')
        .setDescription('add/remove')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('userid')
        .setDescription('User ID')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('roleid')
        .setDescription('Role ID')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('give role')
    .setDescription('Create a reaction role message with custom emojis and roles')
    .addStringOption(option =>
      option.setName('emoji1')
        .setDescription('Emoji for option 1')
        .setRequired(true)
    )
    .addRoleOption(option =>
      option.setName('role1')
        .setDescription('Role for option 1')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('emoji2')
        .setDescription('Emoji for option 2')
        .setRequired(true)
    )
    .addRoleOption(option =>
      option.setName('role2')
        .setDescription('Role for option 2')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('emoji3')
        .setDescription('Emoji for option 3')
        .setRequired(true)
    )
    .addRoleOption(option =>
      option.setName('role3')
        .setDescription('Role for option 3')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('emoji4')
        .setDescription('Emoji for option 4')
        .setRequired(true)
    )
    .addRoleOption(option =>
      option.setName('role4')
        .setDescription('Role for option 4')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('text')
        .setDescription('Optional custom message')
        .setRequired(false)
    )
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

  if (interaction.commandName === 'setbirthday') {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const requiredRoleId = process.env.BIRTHDAY_ROLE_ID;

    if (!member.roles.cache.has(requiredRoleId)) {
      return interaction.reply({ content: 'You do not have the required role.', ephemeral: true });
    }

    const dateInput = interaction.options.getString('date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      return interaction.reply({ content: 'Invalid date format. Use YYYY-MM-DD.', ephemeral: true });
    }

    try {
      await pool.query(`
        INSERT INTO birthdays (user_id, birthday)
        VALUES ($1, $2)
        ON CONFLICT (user_id) DO UPDATE SET birthday = EXCLUDED.birthday
      `, [interaction.user.id, dateInput]);
      await interaction.reply(`Birthday saved: ${dateInput}`);
    } catch {
      await interaction.reply({ content: 'Error saving birthday.', ephemeral: true });
    }
  }

  if (interaction.commandName === 'clearchannel') {
    try {
      const messages = await interaction.channel.messages.fetch({ limit: 100 });
      await interaction.channel.bulkDelete(messages, true);
      await interaction.reply({ content: 'Messages deleted.', ephemeral: true });
    } catch {
      await interaction.reply({ content: 'Error clearing messages.', ephemeral: true });
    }
  }

  if (interaction.commandName === 'modifyrole') {
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
        await interaction.reply({ content: 'Invalid action.', ephemeral: true });
      }
    } catch {
      await interaction.reply({ content: 'Error modifying role.', ephemeral: true });
    }
  }

  if (interaction.commandName === 'memberroles') {
    const customText = interaction.options.getString('text') || 'Choose your roles:';

    const options = [];
    for (let i = 1; i <= 4; i++) {
      const emoji = interaction.options.getString(`emoji${i}`);
      const role = interaction.options.getRole(`role${i}`);
      options.push({ emoji, role });
    }

    let description = `${customText}\n\n`;
    options.forEach(opt => {
      description += `${opt.emoji} → ${opt.role}\n`;
    });

    const embed = {
      color: 0x00ff00,
      title: 'Reaction Roles',
      description
    };

    const message = await interaction.channel.send({ embeds: [embed] });

    for (const opt of options) {
      try {
        await message.react(opt.emoji);
      } catch (err) {
        console.error(`Failed to react with ${opt.emoji}:`, err.message);
      }
    }

    if (!global.roleMappings) global.roleMappings = {};
    global.roleMappings[message.id] = options;

    await interaction.reply({ content: 'Reaction role message created.', ephemeral: true });
  }
});

// Birthday announcements
const checkBirthdays = async () => {
  const today = new Date().toISOString().slice(5, 10); // MM-DD
  try {
    const res = await pool.query(`
      SELECT user_id FROM birthdays
      WHERE TO_CHAR(birthday, 'MM-DD') = $1
    `, [today]);

    if (res.rows.length === 0) return;

    const channel = await client.channels.fetch(process.env.BIRTHDAY_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) return;

    for (const row of res.rows) {
      const mention = `<@${row.user_id}>`;
      channel.send(`🎉 Happy birthday ${mention}! `);
    }
  } catch {
    console.error('Error checking birthdays.');
  }
};

// Reaction role logic
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (reaction.partial) await reaction.fetch();
  if (user.bot) return;

  const mapping = global.roleMappings?.[reaction.message.id];
  if (!mapping) return;

  const opt = mapping.find(opt => opt.emoji === reaction.emoji.name);
  if (!opt) return;

  const member = await reaction.message.guild.members.fetch(user.id);
  member.roles.add(opt.role).catch(console.error);
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  if (reaction.partial) await reaction.fetch();
  if (user.bot) return;

  const mapping = global.roleMappings?.[reaction.message.id];
  if (!mapping) return;

  const opt = mapping.find(opt => opt.emoji === reaction.emoji.name);
  if (!opt) return;

  const member = await reaction.message.guild.members.fetch(user.id);
  member.roles.remove(opt.role).catch(console.error);
});

// Welcome message
client.on(Events.GuildMemberAdd, async member => {
  const channel = await client.channels.fetch(process.env.WELCOME_CHANNEL_ID);
  if (channel && channel.isTextBased()) {
    channel.send(`👋 Welcome to the server, <@${member.id}>!`);
  }
});

// Ready
client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  checkBirthdays();

  const now = new Date();
  const millisUntilMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1
  ).getTime() - now.getTime();

  setTimeout(() => {
    checkBirthdays();
    setInterval(checkBirthdays, 24 * 60 * 60 * 1000);
  }, millisUntilMidnight);
});

client.login(process.env.DISCORD_TOKEN);
