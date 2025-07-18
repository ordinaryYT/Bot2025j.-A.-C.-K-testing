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
    // Create tables if not exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS birthdays (
        user_id TEXT PRIMARY KEY,
        birthday DATE NOT NULL
      );
    `);
    await pool.query(`
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
        .setDescription('add or remove')
        .setRequired(true)
        .addChoices(
          { name: 'add', value: 'add' },
          { name: 'remove', value: 'remove' }
        )
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

  new SlashCommandBuilder()
    .setName('memberroles')
    .setDescription('Create a reaction role message with custom emojis and roles')
    .addStringOption(option =>
      option.setName('text')
        .setDescription('Custom text for the message')
        .setRequired(false)
    )
    // Four emoji+role pairs, all optional except emoji & role must come in pairs if used
    .addStringOption(option => option.setName('emoji1').setDescription('Emoji for option 1').setRequired(false))
    .addRoleOption(option => option.setName('role1').setDescription('Role for option 1').setRequired(false))
    .addStringOption(option => option.setName('emoji2').setDescription('Emoji for option 2').setRequired(false))
    .addRoleOption(option => option.setName('role2').setDescription('Role for option 2').setRequired(false))
    .addStringOption(option => option.setName('emoji3').setDescription('Emoji for option 3').setRequired(false))
    .addRoleOption(option => option.setName('role3').setDescription('Role for option 3').setRequired(false))
    .addStringOption(option => option.setName('emoji4').setDescription('Emoji for option 4').setRequired(false))
    .addRoleOption(option => option.setName('role4').setDescription('Role for option 4').setRequired(false))
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
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const requiredRoleId = process.env.BIRTHDAY_ROLE_ID;

    if (!member.roles.cache.has(requiredRoleId)) {
      return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    const dateInput = interaction.options.getString('date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      return interaction.reply({ content: 'Please provide the date in YYYY-MM-DD format.', ephemeral: true });
    }

    try {
      await pool.query(
        `INSERT INTO birthdays (user_id, birthday)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET birthday = EXCLUDED.birthday`,
        [interaction.user.id, dateInput]
      );
      await interaction.reply(`Your birthday has been saved as ${dateInput}.`);
    } catch (err) {
      console.error(err);
      await interaction.reply({ content: 'An error occurred while saving your birthday.', ephemeral: true });
    }
  }

  if (interaction.commandName === 'clearchannel') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    try {
      const messages = await interaction.channel.messages.fetch({ limit: 100 });
      await interaction.channel.bulkDelete(messages, true);
      await interaction.reply({ content: 'Messages deleted.', ephemeral: true });
    } catch {
      await interaction.reply({ content: 'An error occurred while deleting messages.', ephemeral: true });
    }
  }

  if (interaction.commandName === 'modifyrole') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    const action = interaction.options.getString('action');
    const userId = interaction.options.getString('userid');
    const roleId = interaction.options.getString('roleid');

    try {
      const member = await interaction.guild.members.fetch(userId);
      if (action === 'add') {
        await member.roles.add(roleId);
        await interaction.reply(`Added role to <@${userId}>.`);
      } else if (action === 'remove') {
        await member.roles.remove(roleId);
        await interaction.reply(`Removed role from <@${userId}>.`);
      } else {
        await interaction.reply({ content: 'Invalid action. Use "add" or "remove".', ephemeral: true });
      }
    } catch {
      await interaction.reply({ content: 'An error occurred while modifying the role.', ephemeral: true });
    }
  }

  if (interaction.commandName === 'memberroles') {
    const customText = interaction.options.getString('text') || 'Choose your roles:';

    const options = [];
    for (let i = 1; i <= 4; i++) {
      const emoji = interaction.options.getString(`emoji${i}`);
      const role = interaction.options.getRole(`role${i}`);

      // only add pairs where both emoji and role are present
      if (emoji && role) {
        options.push({ emoji, roleId: role.id, roleName: role.name });
      }
    }

    if (options.length === 0) {
      return interaction.reply({ content: 'You must provide at least one emoji and role pair.', ephemeral: true });
    }

    let description = `${customText}\n\n`;
    options.forEach(opt => {
      description += `${opt.emoji} → @${opt.roleName}\n`;
    });

    const embed = {
      color: 0x00ff00,
      description: description
    };

    try {
      const message = await interaction.channel.send({ embeds: [embed] });

      // Add reactions
      for (const opt of options) {
        await message.react(opt.emoji).catch(err => console.error('Invalid emoji:', opt.emoji, err));
      }

      // Save reaction roles in DB for persistence
      await pool.query('DELETE FROM reaction_roles WHERE message_id = $1', [message.id]);
      for (const opt of options) {
        await pool.query(
          'INSERT INTO reaction_roles (message_id, emoji, role_id) VALUES ($1, $2, $3)',
          [message.id, opt.emoji, opt.roleId]
        );
      }

      await interaction.reply({ content: 'Reaction role message created!', ephemeral: true });
    } catch (err) {
      console.error(err);
      await interaction.reply({ content: 'An error occurred creating the reaction role message.', ephemeral: true });
    }
  }
});

const checkBirthdays = async () => {
  const today = new Date().toISOString().slice(5, 10); // MM-DD format

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
      channel.send(`Happy birthday ${mention}!`);
    }
  } catch (err) {
    console.error('Error checking birthdays:', err);
  }
};

// Reaction role add/remove events
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (reaction.partial) await reaction.fetch();
  if (user.bot) return;

  const emojiId = reaction.emoji.identifier || reaction.emoji.toString();

  try {
    const res = await pool.query(
      'SELECT role_id FROM reaction_roles WHERE message_id = $1 AND emoji = $2',
      [reaction.message.id, emojiId]
    );
    if (res.rowCount === 0) return;

    const roleId = res.rows[0].role_id;
    const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
    if (!member) return;

    await member.roles.add(roleId).catch(console.error);
  } catch (err) {
    console.error('Error adding role on reaction:', err);
  }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  if (reaction.partial) await reaction.fetch();
  if (user.bot) return;

  const emojiId = reaction.emoji.identifier || reaction.emoji.toString();

  try {
    const res = await pool.query(
      'SELECT role_id FROM reaction_roles WHERE message_id = $1 AND emoji = $2',
      [reaction.message.id, emojiId]
    );
    if (res.rowCount === 0) return;

    const roleId = res.rows[0].role_id;
    const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
    if (!member) return;

    await member.roles.remove(roleId).catch(console.error);
  } catch (err) {
    console.error('Error removing role on reaction:', err);
  }
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  checkBirthdays();
  // Optionally schedule checkBirthdays daily here with setInterval or cron job
});

client.login(process.env.DISCORD_TOKEN);
