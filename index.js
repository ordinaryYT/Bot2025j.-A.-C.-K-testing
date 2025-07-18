client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'setbirthday') {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const requiredRoleId = process.env.BIRTHDAY_ROLE_ID;
      if (!member.roles.cache.has(requiredRoleId)) {
        return interaction.reply({ content: 'error', ephemeral: true });
      }

      const dateInput = interaction.options.getString('date');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
        return interaction.reply({ content: 'error', ephemeral: true });
      }

      await pool.query(
        `INSERT INTO birthdays (user_id, birthday)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET birthday = EXCLUDED.birthday`,
        [interaction.user.id, dateInput]
      );
      await interaction.reply(`Birthday saved: ${dateInput}`);

    } else if (interaction.commandName === 'clearchannel') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: 'error', ephemeral: true });
      }

      const messages = await interaction.channel.messages.fetch({ limit: 100 });
      await interaction.channel.bulkDelete(messages, true);
      await interaction.reply({ content: 'Messages deleted.', ephemeral: true });

    } else if (interaction.commandName === 'modifyrole') {
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
        await interaction.reply({ content: 'error', ephemeral: true });
      }

    } else if (interaction.commandName === 'memberroles') {
      const customText = interaction.options.getString('text') || 'Choose your roles:';

      const pairs = [];
      for (let i = 1; i <= 10; i++) {
        const emoji = interaction.options.getString(`emoji${i}`);
        const role = interaction.options.getRole(`role${i}`);
        if (emoji && role) pairs.push({ emoji, role });
      }
      if (pairs.length === 0) {
        return interaction.reply({ content: 'error', ephemeral: true });
      }

      let description = `${customText}\n\n`;
      for (const p of pairs) {
        description += `${p.emoji} → <@&${p.role.id}>\n`;
      }

      const embed = {
        color: 0x00ff00,
        title: 'Member Roles',
        description
      };

      const message = await interaction.channel.send({ embeds: [embed] });

      await pool.query(`DELETE FROM reaction_roles WHERE message_id = $1`, [message.id]);

      for (const p of pairs) {
        await pool.query(
          `INSERT INTO reaction_roles (message_id, emoji, role_id)
           VALUES ($1, $2, $3)`,
          [message.id, p.emoji, p.role.id]
        );

        try {
          await message.react(p.emoji);
        } catch {
          // ignore reaction errors silently
        }
      }

      await interaction.reply({ content: 'Reaction role message created!', ephemeral: true });

    }
  } catch {
    console.error('error');
    if (!interaction.replied) {
      await interaction.reply({ content: 'error', ephemeral: true });
    }
  }
});
