const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');

require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences
  ]
});

// Configuration
const CONFIG = {
  TOKEN: process.env.TOKEN,
  OWNER_ID: process.env.OWNER_ID,
  WELCOME_CHANNEL_ID: process.env.WELCOME_CHANNEL_ID,
  GENERAL_CHANNEL_ID: process.env.GENERAL_CHANNEL_ID,
  RULES_CHANNEL_ID: process.env.RULES_CHANNEL_ID,
  STATS_CATEGORY_ID: process.env.STATS_CATEGORY_ID,
  XP_PER_MESSAGE: 15,
  XP_COOLDOWN: 60000,
  WELCOME_BUTTON_REWARD: 3,
  UPDATE_STATS_INTERVAL: 60000
};

// Base de données simple (JSON)
let database = {
  users: {},
  welcomeButtons: {},
  statsChannels: {}
};

// Charger la base de données
function loadDatabase() {
  try {
    if (fs.existsSync('database.json')) {
      database = JSON.parse(fs.readFileSync('database.json', 'utf8'));
    }
  } catch (error) {
    console.error('Erreur lors du chargement de la base de données:', error);
  }
}

// Sauvegarder la base de données
function saveDatabase() {
  try {
    fs.writeFileSync('database.json', JSON.stringify(database, null, 2));
  } catch (error) {
    console.error('Erreur lors de la sauvegarde de la base de données:', error);
  }
}

// Initialiser un utilisateur
function initUser(userId) {
  if (!database.users[userId]) {
    database.users[userId] = {
      xp: 0,
      level: 1,
      rios: 0,
      lastXpGain: 0
    };
    saveDatabase();
  }
}

// Calculer l'XP nécessaire pour un niveau
function getXpForLevel(level) {
  return level * 100;
}

// Calculer le niveau actuel basé sur l'XP
function calculateLevel(xp) {
  let level = 1;
  let totalXpNeeded = 0;
  
  while (xp >= totalXpNeeded + getXpForLevel(level)) {
    totalXpNeeded += getXpForLevel(level);
    level++;
  }
  
  return { level, xpForNextLevel: getXpForLevel(level), currentLevelXp: xp - totalXpNeeded };
}

// Ajouter de l'XP à un utilisateur
function addXp(userId, amount) {
  initUser(userId);
  
  const oldLevel = database.users[userId].level;
  database.users[userId].xp += amount;
  
  const { level, xpForNextLevel, currentLevelXp } = calculateLevel(database.users[userId].xp);
  const newLevel = level;
  
  database.users[userId].level = newLevel;
  
  if (newLevel > oldLevel) {
    const riosReward = newLevel * 10;
    database.users[userId].rios += riosReward;
    saveDatabase();
    return { leveledUp: true, newLevel, riosReward, currentLevelXp, xpForNextLevel };
  }
  
  saveDatabase();
  return { leveledUp: false, currentLevelXp, xpForNextLevel };
}

// Ajouter des rios
function addRios(userId, amount) {
  initUser(userId);
  database.users[userId].rios += amount;
  saveDatabase();
}

// Bot prêt
client.once('ready', () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
  loadDatabase();
  
  client.guilds.cache.forEach(guild => {
    setupStatsChannels(guild);
  });
  
  setInterval(() => {
    client.guilds.cache.forEach(guild => {
      updateStatsChannels(guild);
    });
  }, CONFIG.UPDATE_STATS_INTERVAL);
});

// Créer les salons de statistiques
async function setupStatsChannels(guild) {
  const category = guild.channels.cache.get(CONFIG.STATS_CATEGORY_ID);
  
  if (!category || category.type !== 4) {
    console.log('⚠️ Catégorie de stats non trouvée ou invalide');
    return;
  }
  
  if (!database.statsChannels[guild.id]) {
    database.statsChannels[guild.id] = {
      categoryId: CONFIG.STATS_CATEGORY_ID
    };
    saveDatabase();
  }
  
  updateStatsChannels(guild);
  console.log('✅ Système de statistiques initialisé');
}

// Mettre à jour les statistiques
async function updateStatsChannels(guild) {
  if (!database.statsChannels[guild.id]) return;
  
  try {
    const category = guild.channels.cache.get(CONFIG.STATS_CATEGORY_ID);
    if (!category) return;
    
    const voiceCount = guild.members.cache.filter(m => m.voice.channel).size;
    const newName = `Statistique Rio - ${guild.memberCount} membres`;
    
    if (category.name !== newName) {
      await category.setName(newName);
      console.log(`✅ Stats mises à jour: ${newName}`);
    }
  } catch (error) {
    if (error.code !== 50013 && error.code !== 429) {
      console.error('❌ Erreur lors de la mise à jour des stats:', error);
    }
  }
}

// Bienvenue aux nouveaux membres
client.on('guildMemberAdd', async (member) => {
  const welcomeChannel = member.guild.channels.cache.get(CONFIG.WELCOME_CHANNEL_ID);
  
  if (!welcomeChannel) return;
  
  const embed = new EmbedBuilder()
    .setColor('#00ff00')
    .setTitle('🎉 Nouveau membre !')
    .setDescription(`Bienvenue ${member} sur le serveur !`)
    .addFields(
      { name: '📜 Règles', value: `<#${CONFIG.RULES_CHANNEL_ID}>`, inline: true },
      { name: '💬 Général', value: `<#${CONFIG.GENERAL_CHANNEL_ID}>`, inline: true }
    )
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
    .setTimestamp();
  
  const button = new ButtonBuilder()
    .setCustomId(`welcome_${member.id}`)
    .setLabel('🎁 Souhaiter la bienvenue (3 rios)')
    .setStyle(ButtonStyle.Success);
  
  const row = new ActionRowBuilder().addComponents(button);
  
  const message = await welcomeChannel.send({ embeds: [embed], components: [row] });
  
  database.welcomeButtons[member.id] = {
    messageId: message.id,
    claimed: false
  };
  saveDatabase();
  
  updateStatsChannels(member.guild);
});

// Mettre à jour les stats quand quelqu'un quitte
client.on('guildMemberRemove', (member) => {
  updateStatsChannels(member.guild);
});

// Mettre à jour les stats lors des changements vocaux
client.on('voiceStateUpdate', (oldState, newState) => {
  if (oldState.guild) {
    updateStatsChannels(oldState.guild);
  }
});

// Gestion des boutons
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  
  const [action, memberId] = interaction.customId.split('_');
  
  if (action === 'welcome') {
    const buttonData = database.welcomeButtons[memberId];
    
    if (!buttonData) {
      return interaction.reply({ content: '❌ Bouton expiré.', ephemeral: true });
    }
    
    if (buttonData.claimed) {
      return interaction.reply({ content: '❌ Quelqu\'un a déjà cliqué sur ce bouton !', ephemeral: true });
    }
    
    if (interaction.user.id === memberId) {
      return interaction.reply({ content: '❌ Tu ne peux pas souhaiter la bienvenue à toi-même !', ephemeral: true });
    }
    
    buttonData.claimed = true;
    buttonData.claimedBy = interaction.user.id;
    addRios(interaction.user.id, CONFIG.WELCOME_BUTTON_REWARD);
    saveDatabase();
    
    await interaction.update({ components: [] });
    
    await interaction.followUp({
      content: `✅ ${interaction.user} a souhaité la bienvenue et a gagné **${CONFIG.WELCOME_BUTTON_REWARD} rios** ! 🎉`,
      ephemeral: false
    });
  }
});

// Système d'XP et commandes
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  
  const userId = message.author.id;
  initUser(userId);
  
  // Commande !profil ou !stats
  if (message.content.toLowerCase() === '!profil' || message.content.toLowerCase() === '!stats') {
    const user = database.users[userId];
    const { currentLevelXp, xpForNextLevel } = calculateLevel(user.xp);
    
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle(`📊 Profil de ${message.author.username}`)
      .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: '📈 Niveau', value: `${user.level}`, inline: true },
        { name: '💰 Rios', value: `${user.rios}`, inline: true },
        { name: '⭐ XP Total', value: `${user.xp}`, inline: true },
        { name: '📊 Progression', value: `${currentLevelXp}/${xpForNextLevel} XP` }
      )
      .setTimestamp();
    
    return message.reply({ embeds: [embed] });
  }
  
  // Commande !say
  if (message.content.startsWith('!say ')) {
    if (message.author.id !== CONFIG.OWNER_ID) {
      return message.reply('❌ Cette commande est réservée au propriétaire du bot.');
    }
    
    const content = message.content.slice(5).trim();
    
    if (!content) {
      return message.reply('❌ Usage: `!say <message>`');
    }
    
    try {
      await message.delete();
    } catch (error) {
      console.log('⚠️ Impossible de supprimer le message');
    }
    
    return message.channel.send(content);
  }
  
  // Commande !sayembed
  if (message.content.startsWith('!sayembed ')) {
    if (message.author.id !== CONFIG.OWNER_ID) {
      return message.reply('❌ Cette commande est réservée au propriétaire du bot.');
    }
    
    const content = message.content.slice(11).trim();
    
    if (!content) {
      return message.reply('❌ Usage: `!sayembed <message>`');
    }
    
    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setDescription(content)
      .setTimestamp();
    
    try {
      await message.delete();
    } catch (error) {
      console.log('⚠️ Impossible de supprimer le message');
    }
    
    return message.channel.send({ embeds: [embed] });
  }
  
  // Commande !ban
  if (message.content.startsWith('!ban ')) {
    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
      return message.reply('❌ Tu n\'as pas la permission de bannir des membres.');
    }
    
    const args = message.content.slice(5).trim().split(/ +/);
    const userMention = message.mentions.members.first();
    
    if (!userMention) {
      return message.reply('❌ Usage: `!ban @utilisateur [raison]`');
    }
    
    if (!userMention.bannable) {
      return message.reply('❌ Je ne peux pas bannir ce membre.');
    }
    
    const reason = args.slice(1).join(' ') || 'Aucune raison fournie';
    
    try {
      await userMention.ban({ reason });
      
      const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('🔨 Membre banni')
        .addFields(
          { name: 'Utilisateur', value: `${userMention.user.tag}`, inline: true },
          { name: 'Modérateur', value: `${message.author.tag}`, inline: true },
          { name: 'Raison', value: reason }
        )
        .setTimestamp();
      
      return message.reply({ embeds: [embed] });
    } catch (error) {
      return message.reply('❌ Une erreur est survenue lors du bannissement.');
    }
  }
  
  // Commande !kick
  if (message.content.startsWith('!kick ')) {
    if (!message.member.permissions.has(PermissionFlagsBits.KickMembers)) {
      return message.reply('❌ Tu n\'as pas la permission d\'expulser des membres.');
    }
    
    const args = message.content.slice(6).trim().split(/ +/);
    const userMention = message.mentions.members.first();
    
    if (!userMention) {
      return message.reply('❌ Usage: `!kick @utilisateur [raison]`');
    }
    
    if (!userMention.kickable) {
      return message.reply('❌ Je ne peux pas expulser ce membre.');
    }
    
    const reason = args.slice(1).join(' ') || 'Aucune raison fournie';
    
    try {
      await userMention.kick(reason);
      
      const embed = new EmbedBuilder()
        .setColor('#ff9900')
        .setTitle('👢 Membre expulsé')
        .addFields(
          { name: 'Utilisateur', value: `${userMention.user.tag}`, inline: true },
          { name: 'Modérateur', value: `${message.author.tag}`, inline: true },
          { name: 'Raison', value: reason }
        )
        .setTimestamp();
      
      return message.reply({ embeds: [embed] });
    } catch (error) {
      return message.reply('❌ Une erreur est survenue lors de l\'expulsion.');
    }
  }
  
  // Commande !mute
  if (message.content.startsWith('!mute ')) {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return message.reply('❌ Tu n\'as pas la permission de mute des membres.');
    }
    
    const args = message.content.slice(6).trim().split(/ +/);
    const userMention = message.mentions.members.first();
    
    if (!userMention) {
      return message.reply('❌ Usage: `!mute @utilisateur [raison]`');
    }
    
    if (!userMention.moderatable) {
      return message.reply('❌ Je ne peux pas mute ce membre.');
    }
    
    const reason = args.slice(1).join(' ') || 'Aucune raison fournie';
    
    try {
      await userMention.timeout(28 * 24 * 60 * 60 * 1000, reason);
      
      const embed = new EmbedBuilder()
        .setColor('#ffff00')
        .setTitle('🔇 Membre muté')
        .addFields(
          { name: 'Utilisateur', value: `${userMention.user.tag}`, inline: true },
          { name: 'Modérateur', value: `${message.author.tag}`, inline: true },
          { name: 'Durée', value: 'Permanent (28 jours)', inline: true },
          { name: 'Raison', value: reason }
        )
        .setTimestamp();
      
      return message.reply({ embeds: [embed] });
    } catch (error) {
      return message.reply('❌ Une erreur est survenue lors du mute.');
    }
  }
  
  // Commande !tempmute
  if (message.content.startsWith('!tempmute ')) {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return message.reply('❌ Tu n\'as pas la permission de mute des membres.');
    }
    
    const args = message.content.slice(10).trim().split(/ +/);
    const userMention = message.mentions.members.first();
    
    if (!userMention || args.length < 2) {
      return message.reply('❌ Usage: `!tempmute @utilisateur <durée> [raison]`\nExemple: `!tempmute @user 10m Spam`\nDurées: s (secondes), m (minutes), h (heures), d (jours)');
    }
    
    if (!userMention.moderatable) {
      return message.reply('❌ Je ne peux pas mute ce membre.');
    }
    
    const durationStr = args[1];
    const durationMatch = durationStr.match(/^(\d+)([smhd])$/);
    
    if (!durationMatch) {
      return message.reply('❌ Format de durée invalide. Utilise: 10s, 5m, 2h, 1d');
    }
    
    const durationValue = parseInt(durationMatch[1]);
    const durationUnit = durationMatch[2];
    
    let durationMs;
    let durationText;
    
    switch (durationUnit) {
      case 's':
        durationMs = durationValue * 1000;
        durationText = `${durationValue} seconde${durationValue > 1 ? 's' : ''}`;
        break;
      case 'm':
        durationMs = durationValue * 60 * 1000;
        durationText = `${durationValue} minute${durationValue > 1 ? 's' : ''}`;
        break;
      case 'h':
        durationMs = durationValue * 60 * 60 * 1000;
        durationText = `${durationValue} heure${durationValue > 1 ? 's' : ''}`;
        break;
      case 'd':
        durationMs = durationValue * 24 * 60 * 60 * 1000;
        durationText = `${durationValue} jour${durationValue > 1 ? 's' : ''}`;
        break;
    }
    
    if (durationMs > 28 * 24 * 60 * 60 * 1000) {
      return message.reply('❌ La durée maximum est de 28 jours.');
    }
    
    const reason = args.slice(2).join(' ') || 'Aucune raison fournie';
    
    try {
      await userMention.timeout(durationMs, reason);
      
      const embed = new EmbedBuilder()
        .setColor('#ffaa00')
        .setTitle('⏱️ Membre temporairement muté')
        .addFields(
          { name: 'Utilisateur', value: `${userMention.user.tag}`, inline: true },
          { name: 'Modérateur', value: `${message.author.tag}`, inline: true },
          { name: 'Durée', value: durationText, inline: true },
          { name: 'Raison', value: reason }
        )
        .setTimestamp();
      
      return message.reply({ embeds: [embed] });
    } catch (error) {
      return message.reply('❌ Une erreur est survenue lors du mute temporaire.');
    }
  }
  
  // Commande !unmute
  if (message.content.startsWith('!unmute ')) {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return message.reply('❌ Tu n\'as pas la permission de unmute des membres.');
    }
    
    const userMention = message.mentions.members.first();
    
    if (!userMention) {
      return message.reply('❌ Usage: `!unmute @utilisateur`');
    }
    
    if (!userMention.moderatable) {
      return message.reply('❌ Je ne peux pas unmute ce membre.');
    }
    
    try {
      await userMention.timeout(null);
      
      const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('🔊 Membre démuté')
        .addFields(
          { name: 'Utilisateur', value: `${userMention.user.tag}`, inline: true },
          { name: 'Modérateur', value: `${message.author.tag}`, inline: true }
        )
        .setTimestamp();
      
      return message.reply({ embeds: [embed] });
    } catch (error) {
      return message.reply('❌ Une erreur est survenue lors du unmute.');
    }
  }
  
  // Commande !leaderboard
  if (message.content.toLowerCase() === '!leaderboard' || message.content.toLowerCase() === '!top') {
    const sortedUsers = Object.entries(database.users)
      .sort(([, a], [, b]) => b.xp - a.xp)
      .slice(0, 10);
    
    let description = '';
    
    for (let i = 0; i < sortedUsers.length; i++) {
      const [userId, userData] = sortedUsers[i];
      const user = await client.users.fetch(userId).catch(() => null);
      const username = user ? user.username : 'Utilisateur inconnu';
      
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      description += `${medal} **${username}** - Niveau ${userData.level} (${userData.xp} XP) - ${userData.rios} rios\n`;
    }
    
    const embed = new EmbedBuilder()
      .setColor('#ffd700')
      .setTitle('🏆 Classement des membres')
      .setDescription(description || 'Aucun membre dans le classement.')
      .setTimestamp();
    
    return message.reply({ embeds: [embed] });
  }
  
  // Commande !help
  if (message.content.toLowerCase() === '!help' || message.content.toLowerCase() === '!aide') {
    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('📚 Commandes disponibles')
      .setDescription('Voici la liste des commandes du bot :')
      .addFields(
        { name: '!profil / !stats', value: 'Voir ton profil et tes statistiques' },
        { name: '!leaderboard / !top', value: 'Voir le classement des membres' },
        { name: '!help / !aide', value: 'Afficher ce message d\'aide' }
      )
      .setFooter({ text: 'Gagne de l\'XP en envoyant des messages !' })
      .setTimestamp();
    
    if (message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
      embed.addFields({ name: '!ban @user [raison]', value: 'Bannir un membre' });
    }
    
    if (message.member.permissions.has(PermissionFlagsBits.KickMembers)) {
      embed.addFields({ name: '!kick @user [raison]', value: 'Expulser un membre' });
    }
    
    if (message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      embed.addFields(
        { name: '!mute @user [raison]', value: 'Mute un membre (permanent)' },
        { name: '!tempmute @user <durée> [raison]', value: 'Mute temporaire (ex: 10m, 2h, 1d)' },
        { name: '!unmute @user', value: 'Démute un membre' }
      );
    }
    
    if (message.author.id === CONFIG.OWNER_ID) {
      embed.addFields(
        { name: '!say <message>', value: '(Owner) Envoyer un message avec le bot' },
        { name: '!sayembed <message>', value: '(Owner) Envoyer un embed avec le bot' }
      );
    }
    
    return message.reply({ embeds: [embed] });
  }
  
  // Gain d'XP (seulement si ce n'est pas une commande)
  const now = Date.now();
  const userData = database.users[userId];
  
  if (now - userData.lastXpGain < CONFIG.XP_COOLDOWN) return;
  
  userData.lastXpGain = now;
  const result = addXp(userId, CONFIG.XP_PER_MESSAGE);
  
  if (result.leveledUp) {
    const embed = new EmbedBuilder()
      .setColor('#ffd700')
      .setTitle('🎊 Niveau supérieur !')
      .setDescription(`Félicitations ${message.author} ! Tu es maintenant **niveau ${result.newLevel}** !`)
      .addFields({ name: '🎁 Récompense', value: `+${result.riosReward} rios` })
      .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
      .setTimestamp();
    
    message.channel.send({ embeds: [embed] });
  }
});

// Serveur web pour Render
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('🤖 Bot Discord en ligne !');
});

app.listen(PORT, () => {
  console.log(`✅ Serveur web actif sur le port ${PORT}`);
});

// Connexion du bot
client.login(CONFIG.TOKEN);