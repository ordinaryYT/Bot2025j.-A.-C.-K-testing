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
        message_id TEXT PRIMARY KEY,
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
    .setName('clearchannel')
    .setDescription('Clear messages in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('modifyrole')
    .setDescription('Add or remove a role')
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
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  // Memberroles command — required options first, optional last
  (() => {
    const cmd = new SlashCommandBuilder()
      .setName('memberroles')
      .setDescription('Create a reaction role message with custom emojis and roles');

    // Add required emoji1 and role1
    cmd.addStringOption(opt =>
      opt.setName('emoji1')
        .setDescription('Emoji for option 1')
        .setRequired(true)
    );
    cmd.addRoleOption(opt =>
      opt.setName('role1')
        .setDescription('Role for option 1')
        .setRequired(true)
    );

    // Add optional emoji2-emoji10 and role2-role10
    for (let i = 2; i <= 10; i++) {
      cmd.addStringOption(opt =>
        opt.setName(`emoji${i}`)
          .setDescription(`Emoji for option ${i}`)
          .setRequired(false)
      );
      cmd.addRoleOption(opt =>
        opt.setName(`role${i}`)
          .setDescription(`Role for option ${i}`)
          .setRequired(false)
      );
    }

    // Add optional custom text last
    cmd.addStringOption(option =>
      option.setName('text')
        .setDescription('Custom text for the message')
        .setRequired(false)
    );

    return cmd;
  })()
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

  try {
    if (interaction.commandName === 'setbirthday') {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const requiredRoleId = process.env.BIRTHDAY_ROLE_ID;

      if (!member.roles.cache.has(requiredRoleId)) {
        return interaction.reply({ content: 'You do not have permission to set a birthday.', ephemeral: true });
      }

      const dateInput = interaction.options.getString('date');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
        return interaction.reply({ content: 'Invalid date format. Use YYYY-MM-DD.', ephemeral: true });
      }

      await pool.query(
        `INSERT INTO birthdays (user_id, birthday)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET birthday = EXCLUDED.birthday`,
        [interaction.user.id, dateInput]
      );
      await interaction.reply(`Your birthday has been saved as: ${dateInput}`);
    }

    if (interaction.commandName === 'clearchannel') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: 'You do not have permission to clear messages.', ephemeral: true });
      }
      const messages = await interaction.channel.messages.fetch({ limit: 100 });
      await interaction.channel.bulkDelete(messages, true);
      await interaction.reply({ content: 'Messages deleted.', ephemeral: true });
    }

    if (interaction.commandName === 'modifyrole') {
      const action = interaction.options.getString('action');
      const userId = interaction.options.getString('userid');
      const roleId = interaction.options.getString('roleid');

      const member = await interaction.guild.members.fetch(userId);
      if (action === 'add') {
        await member.roles.add(roleId);
        await interaction.reply(`Added role to <@${userId}>`);
      } else if (action === 'remove') {
        await member.roles.remove(roleId);
        await interaction.reply(`Removed role from <@${userId}>`);
      } else {
        await interaction.reply({ content: 'Invalid action. Use add or remove.', ephemeral: true });
      }
    }

    if (interaction.commandName === 'memberroles') {
      const customText = interaction.options.getString('text') || 'Choose your roles:';

      // Collect emoji-role pairs from options (up to 10)
      const options = [];
      for (let i = 1; i <= 10; i++) {
        const emoji = interaction.options.getString(`emoji${i}`);
        const role = interaction.options.getRole(`role${i}`);
        if (!emoji || !role) break; // stop on missing pair
        options.push({ emoji, role });
      }

      let description = `${customText}\n\n`;
      options.forEach(opt => {
        description += `${opt.emoji} → ${opt.role.name}\n`;
      });

      const embed = {
        color: 0x00ff00,
        title: 'Member Roles',
        description
      };

      const message = await interaction.channel.send({ embeds: [embed] });

      // Add reactions and save to DB
      for (const opt of options) {
        try {
          await message.react(opt.emoji);
          // Insert or update reaction_roles table
          await pool.query(
            `INSERT INTO reaction_roles (message_id, emoji, role_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (message_id) DO UPDATE SET emoji = EXCLUDED.emoji, role_id = EXCLUDED.role_id`,
            [message.id, opt.emoji, opt.role.id]
          );
        } catch (err) {
          console.error('Failed to react or save role:', err);
        }
      }

      await interaction.reply({ content: 'Reaction role message created!', ephemeral: true });
    }
  } catch (error) {
    console.error('Error handling command:', error);
    await interaction.reply({ content: 'An error occurred while processing your command.', ephemeral: true });
  }
});

// Reaction role add/remove handlers
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    const res = await pool.query(
      'SELECT role_id FROM reaction_roles WHERE message_id = $1 AND emoji = $2',
      [reaction.message.id, reaction.emoji.identifier || reaction.emoji.name]
    );
    if (res.rowCount === 0) return;
    const roleId = res.rows[0].role_id;
    const member = await reaction.message.guild.members.fetch(user.id);
    await member.roles.add(roleId);
  } catch (err) {
    console.error('Error adding role on reaction:', err);
  }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    const res = await pool.query(
      'SELECT role_id FROM reaction_roles WHERE message_id = $1 AND emoji = $2',
      [reaction.message.id, reaction.emoji.identifier || reaction.emoji.name]
    );
    if (res.rowCount === 0) return;
    const roleId = res.rows[0].role_id;
    const member = await reaction.message.guild.members.fetch(user.id);
    await member.roles.remove(roleId);
  } catch (err) {
    console.error('Error removing role on reaction:', err);
  }
});

// Welcome message on join
client.on(Events.GuildMemberAdd, async member => {
  try {
    const channel = await client.channels.fetch(process.env.WELCOME_CHANNEL_ID);
    if (channel && channel.isTextBased()) {
      channel.send(`Welcome to the server, <@${member.id}>!`);
    }
  } catch (err) {
    console.error('Error sending welcome message:', err);
  }
});

// Birthday check function
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
      channel.send(`Happy birthday <@${row.user_id}>!`);
    }
  } catch (err) {
    console.error('Error checking birthdays:', err);
  }
};

// Schedule birthday checks daily at midnight
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
