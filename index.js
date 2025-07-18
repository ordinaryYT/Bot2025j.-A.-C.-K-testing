const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.User],
});

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
const port = 10000;
const app = express();

const DB_PATH = './database.sqlite';
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS birthdays (
      user_id TEXT PRIMARY KEY,
      birthday TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS reaction_roles (
      message_id TEXT PRIMARY KEY,
      emoji TEXT NOT NULL,
      role_id TEXT NOT NULL
    )
  `);
});

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});

async function registerCommands() {
  const commands = [
    // birthday command - original
    new SlashCommandBuilder()
      .setName('birthday')
      .setDescription('Set your birthday')
      .addStringOption(option =>
        option.setName('date')
          .setDescription('Your birthday in YYYY-MM-DD format')
          .setRequired(true)
      ),

    // memberroles command updated (emoji + role, show mapping in message)
    new SlashCommandBuilder()
      .setName('memberroles')
      .setDescription('Create reaction role message')
      .addStringOption(option => option.setName('emoji1').setDescription('Emoji 1').setRequired(true))
      .addStringOption(option => option.setName('role1').setDescription('Role name 1').setRequired(true))
      .addStringOption(option => option.setName('emoji2').setDescription('Emoji 2').setRequired(true))
      .addStringOption(option => option.setName('role2').setDescription('Role name 2').setRequired(true))
      .addStringOption(option => option.setName('emoji3').setDescription('Emoji 3').setRequired(true))
      .addStringOption(option => option.setName('role3').setDescription('Role name 3').setRequired(true))
      .addStringOption(option => option.setName('emoji4').setDescription('Emoji 4').setRequired(true))
      .addStringOption(option => option.setName('role4').setDescription('Role name 4').setRequired(true))
      .addStringOption(option => option.setName('text').setDescription('Optional custom text').setRequired(false)),

    // modifyrole command original - assumed as in your previous code, using subcommands or whatever old structure you used
    // I will put a placeholder here — please replace with your original modifyrole command if needed.
    // If you want me to revert exactly the previous modifyrole code you had, send it or say so.
    new SlashCommandBuilder()
      .setName('modifyrole')
      .setDescription('Add or remove roles from users'),

    // clear messages command original
    new SlashCommandBuilder()
      .setName('clear')
      .setDescription('Delete messages in this channel')
      .addIntegerOption(opt => opt.setName('count').setDescription('Number of messages to delete (1-100)').setRequired(true)),
  ].map(cmd => cmd.toJSON());

  try {
    console.log('Registering commands...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('Commands registered successfully.');
  } catch (error) {
    console.error('Failed to register commands:', error);
  }
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  registerCommands();
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName, options, member, guild } = interaction;

  // Require user to have Birthday role for all commands
  const birthdayRoleName = 'Birthday';
  const birthdayRole = guild.roles.cache.find(r => r.name === birthdayRoleName);
  if (birthdayRole && !member.roles.cache.has(birthdayRole.id)) {
    await interaction.reply({ content: `You must have the "${birthdayRoleName}" role to use this command.`, ephemeral: true });
    return;
  }

  try {
    if (commandName === 'birthday') {
      // Original birthday command logic here
      const date = options.getString('date');
      db.run(`INSERT OR REPLACE INTO birthdays(user_id, birthday) VALUES (?, ?)`, [interaction.user.id, date], err => {
        if (err) return interaction.reply({ content: 'Failed to set your birthday.', ephemeral: true });
        interaction.reply(`Your birthday has been set to ${date}.`);
      });

    } else if (commandName === 'memberroles') {
      // New memberroles logic with emoji + role names from strings, react and store role IDs by lookup
      const emojis = [
        options.getString('emoji1'),
        options.getString('emoji2'),
        options.getString('emoji3'),
        options.getString('emoji4'),
      ];
      const roleNames = [
        options.getString('role1'),
        options.getString('role2'),
        options.getString('role3'),
        options.getString('role4'),
      ];
      const customText = options.getString('text') || 'React to get your roles!';

      // Find roles by name in guild (case-insensitive)
      const roles = roleNames.map(name => guild.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase()));

      if (roles.includes(undefined)) {
        return interaction.reply({ content: 'One or more roles not found. Please check role names.', ephemeral: true });
      }

      let description = '';
      for (let i = 0; i < 4; i++) {
        description += `${emojis[i]} = ${roles[i].name}\n`;
      }

      const msg = await interaction.reply({ content: `${customText}\n\n${description}`, fetchReply: true });

      db.serialize(() => {
        for (let i = 0; i < 4; i++) {
          db.run(`INSERT OR REPLACE INTO reaction_roles(message_id, emoji, role_id) VALUES (?, ?, ?)`, [msg.id, emojis[i], roles[i].id]);
          msg.react(emojis[i]).catch(console.error);
        }
      });

    } else if (commandName === 'modifyrole') {
      // Placeholder - put your original modifyrole command code here
      // For example, if it used subcommands, just restore the old handling you had.
      await interaction.reply({ content: 'Modifyrole command placeholder — restore your original code here.', ephemeral: true });

    } else if (commandName === 'clear') {
      // Original clear messages command logic
      const count = options.getInteger('count');
      if (count < 1 || count > 100) return interaction.reply({ content: 'Count must be between 1 and 100.', ephemeral: true });

      const fetched = await interaction.channel.messages.fetch({ limit: count + 1 });
      interaction.channel.bulkDelete(fetched)
        .then(() => interaction.reply({ content: `Deleted ${count} messages.`, ephemeral: true }))
        .catch(() => interaction.reply({ content: 'Failed to delete messages.', ephemeral: true }));
    }
  } catch (error) {
    console.error(error);
    interaction.reply({ content: 'An error occurred.', ephemeral: true });
  }
});

// Reaction role add/remove handlers
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch {
      return;
    }
  }
  db.get(`SELECT role_id FROM reaction_roles WHERE message_id = ? AND emoji = ?`, [reaction.message.id, reaction.emoji.name], async (err, row) => {
    if (err || !row) return;
    const guild = reaction.message.guild;
    const member = guild.members.cache.get(user.id);
    if (!member) return;
    const role = guild.roles.cache.get(row.role_id);
    if (!role) return;
    member.roles.add(role).catch(console.error);
  });
});

client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch {
      return;
    }
  }
  db.get(`SELECT role_id FROM reaction_roles WHERE message_id = ? AND emoji = ?`, [reaction.message.id, reaction.emoji.name], async (err, row) => {
    if (err || !row) return;
    const guild = reaction.message.guild;
    const member = guild.members.cache.get(user.id);
    if (!member) return;
    const role = guild.roles.cache.get(row.role_id);
    if (!role) return;
    member.roles.remove(role).catch(console.error);
  });
});

client.login(process.env.DISCORD_TOKEN);
