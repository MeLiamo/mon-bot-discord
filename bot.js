const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType } = require('discord.js');
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
  TEMP_VOICE_CHANNEL_ID: process.env.TEMP_VOICE_CHANNEL_ID, // Salon "Créer un salon vocal"
  TEMP_VOICE_CATEGORY_ID: process.env.TEMP_VOICE_CATEGORY_ID, // Catégorie pour les vocaux temporaires
  VOICE_CONTROL_CHANNEL_ID: process.env.VOICE_CONTROL_CHANNEL_ID, // Salon de contrôle des vocaux
  TICKET_CHANNEL_ID: process.env.TICKET_CHANNEL_ID, // Salon où sera le panneau de tickets
  TICKET_CATEGORY_ID: process.env.TICKET_CATEGORY_ID, // Catégorie où seront créés les tickets
  STAFF_ROLE_ID: process.env.STAFF_ROLE_ID, // Rôle du staff
  BOT_COMMANDS_CHANNEL_ID: process.env.BOT_COMMANDS_CHANNEL_ID,
  GAMES_CHANNEL_ID: process.env.GAMES_CHANNEL_ID,
  LEADERBOARD_CHANNEL_ID: process.env.LEADERBOARD_CHANNEL_ID,
  XP_PER_MESSAGE: 15,
  XP_COOLDOWN: 60000,
  WELCOME_BUTTON_REWARD: 3,
  UPDATE_STATS_INTERVAL: 300000
};

// Shop items
const SHOP_ITEMS = [
  { id: 'xp_boost', name: '🚀 Boost XP x2 (1h)', price: 50, type: 'boost' },
  { id: 'custom_role', name: '🎨 Rôle personnalisé', price: 200, type: 'role' },
  { id: 'color_name', name: '🌈 Couleur de pseudo', price: 150, type: 'cosmetic' },
  { id: 'vip_badge', name: '⭐ Badge VIP', price: 300, type: 'badge' }
];

// Base de données
let database = {
  users: {},
  welcomeButtons: {},
  statsChannels: {},
  tempVoiceChannels: {},
  gameScores: {},
  purchases: {},
  tickets: {},
  leaderboardMessage: null
};

function loadDatabase() {
  try {
    if (fs.existsSync('database.json')) {
      database = JSON.parse(fs.readFileSync('database.json', 'utf8'));
    }
  } catch (error) {
    console.error('Erreur chargement DB:', error);
  }
}

function saveDatabase() {
  try {
    fs.writeFileSync('database.json', JSON.stringify(database, null, 2));
  } catch (error) {
    console.error('Erreur sauvegarde DB:', error);
  }
}

function initUser(userId) {
  if (!database.users[userId]) {
    database.users[userId] = {
      xp: 0,
      level: 1,
      rios: 0,
      lastXpGain: 0,
      lastDaily: 0,
      lastWork: 0,
      inventory: []
    };
    saveDatabase();
  }
  // Ajouter les propriétés manquantes pour les anciens utilisateurs
  if (!database.users[userId].lastDaily) database.users[userId].lastDaily = 0;
  if (!database.users[userId].lastWork) database.users[userId].lastWork = 0;
}

function getXpForLevel(level) {
  return Math.floor(100 * Math.pow(level, 1.8));
}

function calculateLevel(xp) {
  let level = 1;
  let totalXpNeeded = 0;
  
  while (xp >= totalXpNeeded + getXpForLevel(level)) {
    totalXpNeeded += getXpForLevel(level);
    level++;
  }
  
  return { level, xpForNextLevel: getXpForLevel(level), currentLevelXp: xp - totalXpNeeded };
}

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

function addRios(userId, amount) {
  initUser(userId);
  database.users[userId].rios += amount;
  saveDatabase();
}

function createProgressBar(current, max) {
  const percentage = Math.min((current / max) * 100, 100);
  const filledBars = Math.round(percentage / 10);
  const emptyBars = 10 - filledBars;
  
  const filled = '█'.repeat(filledBars);
  const empty = '░'.repeat(emptyBars);
  
  return `${filled}${empty} ${percentage.toFixed(1)}%`;
}

async function updateLeaderboard(guild) {
  const leaderboardChannel = guild.channels.cache.get(CONFIG.LEADERBOARD_CHANNEL_ID);
  if (!leaderboardChannel) {
    console.log('❌ Salon classement introuvable (ID:', CONFIG.LEADERBOARD_CHANNEL_ID, ')');
    return;
  }
  
  try {
    // Récupérer le top 15
    const sortedByXP = Object.entries(database.users)
      .sort(([, a], [, b]) => b.xp - a.xp)
      .slice(0, 15);
    
    const sortedByRios = Object.entries(database.users)
      .sort(([, a], [, b]) => b.rios - a.rios)
      .slice(0, 15);
    
    // Créer le classement XP
    let xpRanking = '';
    for (let i = 0; i < Math.min(sortedByXP.length, 15); i++) {
      const [userId, userData] = sortedByXP[i];
      const user = await guild.members.fetch(userId).catch(() => null);
      const username = user ? user.user.username : 'Inconnu';
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `\`${i + 1}.\``;
      xpRanking += `${medal} **${username}** - Niv.${userData.level} (${userData.xp} XP)\n`;
    }
    
    // Créer le classement Rios
    let riosRanking = '';
    for (let i = 0; i < Math.min(sortedByRios.length, 15); i++) {
      const [userId, userData] = sortedByRios[i];
      const user = await guild.members.fetch(userId).catch(() => null);
      const username = user ? user.user.username : 'Inconnu';
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `\`${i + 1}.\``;
      riosRanking += `${medal} **${username}** - ${userData.rios} 💰\n`;
    }
    
    const embed = new EmbedBuilder()
      .setColor('#FFD700')
      .setTitle('🏆 CLASSEMENT DU SERVEUR RIO')
      .setDescription('Classement mis à jour automatiquement toutes les minutes')
      .addFields(
        { 
          name: '📊 TOP 15 XP', 
          value: xpRanking || 'Aucun membre', 
          inline: false 
        },
        { 
          name: '💰 TOP 15 RIOS', 
          value: riosRanking || 'Aucun membre', 
          inline: false 
        }
      )
      .setFooter({ text: `Dernière mise à jour` })
      .setTimestamp();
    
    // Si le message existe, le mettre à jour, sinon en créer un nouveau
    if (database.leaderboardMessage) {
      try {
        const message = await leaderboardChannel.messages.fetch(database.leaderboardMessage);
        await message.edit({ embeds: [embed] });
        console.log('✅ Classement mis à jour');
      } catch (error) {
        console.log('⚠️ Message introuvable, création d\'un nouveau...');
        const newMessage = await leaderboardChannel.send({ embeds: [embed] });
        database.leaderboardMessage = newMessage.id;
        saveDatabase();
        console.log('✅ Nouveau classement créé (ID:', newMessage.id, ')');
      }
    } else {
      // Créer le premier message
      const newMessage = await leaderboardChannel.send({ embeds: [embed] });
      database.leaderboardMessage = newMessage.id;
      saveDatabase();
      console.log('✅ Premier classement créé (ID:', newMessage.id, ')');
    }
    
  } catch (error) {
    console.error('❌ Erreur mise à jour classement:', error);
  }
}

async function setupLeaderboard(guild) {
  const leaderboardChannel = guild.channels.cache.get(CONFIG.LEADERBOARD_CHANNEL_ID);
  if (!leaderboardChannel) {
    console.log('❌ Salon classement introuvable');
    return;
  }
  
  console.log('🔍 Vérification du classement...');
  
  // Vérifier si le message existe déjà
  if (database.leaderboardMessage) {
    try {
      const existingMessage = await leaderboardChannel.messages.fetch(database.leaderboardMessage);
      console.log('✅ Message de classement trouvé, mise à jour...');
      await updateLeaderboard(guild);
      return;
    } catch (error) {
      console.log('⚠️ Message de classement introuvable, création...');
      database.leaderboardMessage = null;
    }
  }
  
  // Vérifier s'il y a déjà un message de classement dans le salon
  const messages = await leaderboardChannel.messages.fetch({ limit: 10 });
  const existingPanel = messages.find(msg => 
    msg.author.id === client.user.id && 
    msg.embeds.length > 0 && 
    msg.embeds[0].title === '🏆 CLASSEMENT DU SERVEUR RIO'
  );
  
  if (existingPanel) {
    console.log('✅ Panneau de classement déjà existant');
    database.leaderboardMessage = existingPanel.id;
    saveDatabase();
    await updateLeaderboard(guild);
    return;
  }
  
  // Créer le premier message
  console.log('📊 Création du classement...');
  await updateLeaderboard(guild);
}

// Bot prêt
client.once('ready', () => {
  console.log(`✅ Bot connecté: ${client.user.tag}`);
  loadDatabase();
  
  client.guilds.cache.forEach(guild => {
    setupStatsChannels(guild);
    setupVoiceControlPanel(guild);
    setupTicketPanel(guild);
    setupLeaderboard(guild);
  });

  
  setInterval(() => {
    client.guilds.cache.forEach(guild => {
      updateStatsChannels(guild);
    });
  }, CONFIG.UPDATE_STATS_INTERVAL);

  setInterval(() => {
    client.guilds.cache.forEach(guild => {
      updateLeaderboard(guild);
    });
  }, 60000);
});

async function setupStatsChannels(guild) {
  const category = guild.channels.cache.get(CONFIG.STATS_CATEGORY_ID);
  if (!category || category.type !== 4) return;
  
  if (!database.statsChannels[guild.id]) {
    database.statsChannels[guild.id] = { categoryId: CONFIG.STATS_CATEGORY_ID };
    saveDatabase();
  }
  
  updateStatsChannels(guild);
}

async function updateStatsChannels(guild) {
  if (!database.statsChannels[guild.id]) return;
  
  try {
    const category = guild.channels.cache.get(CONFIG.STATS_CATEGORY_ID);
    if (!category) return;
    
    const newName = `Statistique Rio - ${guild.memberCount} membres`;
    
    if (category.name !== newName) {
      await category.setName(newName);
    }
  } catch (error) {
    if (error.code !== 50013 && error.code !== 429) {
      console.error('Erreur stats:', error);
    }
  }
}

// Panneau de contrôle vocal
async function setupVoiceControlPanel(guild) {
  const controlChannel = guild.channels.cache.get(CONFIG.VOICE_CONTROL_CHANNEL_ID);
  if (!controlChannel) return;
  
  // Vérifier si le panneau existe déjà
  const messages = await controlChannel.messages.fetch({ limit: 10 });
  const existingPanel = messages.find(msg => 
    msg.author.id === client.user.id && 
    msg.embeds.length > 0 && 
    msg.embeds[0].title === '🎙️ Contrôle de ton salon vocal'
  );
  
  // Si le panneau existe déjà, ne pas le recréer
  if (existingPanel) {
    console.log('✅ Panneau de contrôle vocal déjà existant');
    return;
  }
  
  const embed = new EmbedBuilder()
    .setColor('#00d4ff')
    .setTitle('🎙️ Contrôle de ton salon vocal')
    .setDescription('Utilise les boutons ci-dessous pour gérer ton salon vocal temporaire.')
    .addFields(
      { name: '🔒 Verrouiller', value: 'Rendre le salon privé', inline: true },
      { name: '🔓 Déverrouiller', value: 'Rendre le salon public', inline: true },
      { name: '👥 Limite', value: 'Changer la limite de membres', inline: true },
      { name: '✏️ Renommer', value: 'Changer le nom du salon', inline: true },
      { name: '➕ Inviter', value: 'Donner accès à quelqu\'un', inline: true },
      { name: '🚫 Bannir', value: 'Retirer quelqu\'un', inline: true }
    );
  
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vc_lock').setLabel('🔒 Verrouiller').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vc_unlock').setLabel('🔓 Déverrouiller').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('vc_limit').setLabel('👥 Limite').setStyle(ButtonStyle.Primary)
  );
  
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vc_rename').setLabel('✏️ Renommer').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('vc_invite').setLabel('➕ Inviter').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('vc_kick').setLabel('🚫 Expulser').setStyle(ButtonStyle.Danger)
  );
  
  await controlChannel.send({ embeds: [embed], components: [row1, row2] });
  console.log('✅ Panneau de contrôle vocal créé');
}

// Panneau de tickets
async function setupTicketPanel(guild) {
  const ticketChannel = guild.channels.cache.get(CONFIG.TICKET_CHANNEL_ID);
  if (!ticketChannel) return;
  
  // Vérifier si le panneau existe déjà
  const messages = await ticketChannel.messages.fetch({ limit: 10 });
  const existingPanel = messages.find(msg => 
    msg.author.id === client.user.id && 
    msg.embeds.length > 0 && 
    msg.embeds[0].title === '🎫 Système de Tickets'
  );
  
  if (existingPanel) {
    console.log('✅ Panneau de tickets déjà existant');
    return;
  }
  
  const embed = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('🎫 Système de Tickets')
    .setDescription('**Besoin d\'aide ?** Ouvre un ticket en cliquant sur l\'un des boutons ci-dessous.\n\nUn salon privé sera créé où seuls toi et le staff pourront communiquer.')
    .addFields(
      { name: '❓ Support Général', value: 'Questions générales sur le serveur', inline: true },
      { name: '🛠️ Support Technique', value: 'Problèmes techniques ou bugs', inline: true },
      { name: '💰 Support Économie', value: 'Questions sur les rios et le shop', inline: true },
      { name: '⚠️ Signalement', value: 'Signaler un membre ou un problème', inline: true },
      { name: '💡 Suggestion', value: 'Proposer une idée pour le serveur', inline: true },
      { name: '🎁 Partenariat', value: 'Demande de partenariat', inline: true }
    )
    .setFooter({ text: 'Un ticket = Un problème. Ne spam pas les tickets !' });
  
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_support').setLabel('❓ Support').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_tech').setLabel('🛠️ Technique').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_economy').setLabel('💰 Économie').setStyle(ButtonStyle.Success)
  );
  
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_report').setLabel('⚠️ Signalement').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ticket_suggestion').setLabel('💡 Suggestion').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_partnership').setLabel('🎁 Partenariat').setStyle(ButtonStyle.Secondary)
  );
  
  await ticketChannel.send({ embeds: [embed], components: [row1, row2] });
  console.log('✅ Panneau de tickets créé');
}

// Création de salons vocaux temporaires
client.on('voiceStateUpdate', async (oldState, newState) => {
  // Mise à jour des stats
  if (oldState.guild) {
    updateStatsChannels(oldState.guild);
  }
  
  // Création de salon temporaire
  if (newState.channelId === CONFIG.TEMP_VOICE_CHANNEL_ID) {
    const guild = newState.guild;
    const member = newState.member;
    
    try {
      const tempChannel = await guild.channels.create({
        name: `🎙️ ${member.user.username}`,
        type: ChannelType.GuildVoice,
        parent: CONFIG.TEMP_VOICE_CATEGORY_ID,
        permissionOverwrites: [
          {
            id: member.id,
            allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers]
          }
        ]
      });
      
      await member.voice.setChannel(tempChannel);
      
      database.tempVoiceChannels[tempChannel.id] = {
        ownerId: member.id,
        createdAt: Date.now()
      };
      saveDatabase();
      
      console.log(`✅ Salon vocal créé pour ${member.user.username} (ID: ${tempChannel.id})`);
      
    } catch (error) {
      console.error('Erreur création vocal:', error);
    }
  }
  
  // Suppression du salon si vide
  if (oldState.channel && database.tempVoiceChannels[oldState.channelId]) {
    if (oldState.channel.members.size === 0) {
      try {
        await oldState.channel.delete();
        delete database.tempVoiceChannels[oldState.channelId];
        saveDatabase();
      } catch (error) {
        console.error('Erreur suppression vocal:', error);
      }
    }
  }
});

// Gestion des boutons vocaux
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  
  const userId = interaction.user.id;
  const member = interaction.member;
  
  // Bouton bienvenue
  if (interaction.customId.startsWith('welcome_')) {
    const [, memberId] = interaction.customId.split('_');
    const buttonData = database.welcomeButtons[memberId];
    
    if (!buttonData) {
      return interaction.reply({ content: '❌ Bouton expiré.', ephemeral: true });
    }
    
    if (buttonData.claimed) {
      return interaction.reply({ content: '❌ Déjà réclamé !', ephemeral: true });
    }
    
    if (interaction.user.id === memberId) {
      return interaction.reply({ content: '❌ Tu ne peux pas te souhaiter la bienvenue !', ephemeral: true });
    }
    
    // Marquer comme réclamé
    buttonData.claimed = true;
    buttonData.claimedBy = userId;
    addRios(userId, CONFIG.WELCOME_BUTTON_REWARD);
    saveDatabase();
    
    // Désactiver le bouton
    const disabledButton = new ButtonBuilder()
      .setCustomId(`welcome_${memberId}_claimed`)
      .setLabel('✅ Bienvenue souhaitée')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);
    
    const disabledRow = new ActionRowBuilder().addComponents(disabledButton);
    
    // Mettre à jour le message avec le bouton désactivé
    await interaction.update({ components: [disabledRow] });
    
    // Envoyer le message de bienvenue dans le salon
    await interaction.channel.send({
      content: `🎊 ${interaction.user} souhaite la bienvenue à <@${memberId}> !\n✨ **Le serveur te souhaite la bienvenue !** ✨\n\n💰 ${interaction.user} a gagné **${CONFIG.WELCOME_BUTTON_REWARD} rios** !`
    });
    
    return;
  }

    // Contrôles vocaux
  if (interaction.customId.startsWith('vc_')) {
    // Protection anti-spam : vérifier si l'interaction n'a pas déjà été traitée
    if (interaction.replied || interaction.deferred) {
      return;
    }
    
    const voiceChannel = member.voice.channel;
    
    if (!voiceChannel) {
      return interaction.reply({ content: '❌ Tu dois être dans un salon vocal !', ephemeral: true });
    }
    
    // Vérifier si c'est un salon temporaire
    const vcData = database.tempVoiceChannels[voiceChannel.id];
    
    // Debug pour voir ce qui se passe
    console.log('Voice Channel ID:', voiceChannel.id);
    console.log('User ID:', userId);
    console.log('VCData:', vcData);
    console.log('Temp Channels:', Object.keys(database.tempVoiceChannels));
    
    if (!vcData) {
      return interaction.reply({ content: '❌ Ce n\'est pas un salon vocal temporaire !', ephemeral: true });
    }
    
    if (vcData.ownerId !== userId) {
      return interaction.reply({ content: `❌ Ce salon appartient à <@${vcData.ownerId}> !`, ephemeral: true });
    }
    
    if (interaction.customId === 'vc_lock') {
      try {
        // Déférer la réponse immédiatement
        await interaction.deferReply({ ephemeral: true });
        
        await voiceChannel.permissionOverwrites.edit(interaction.guild.id, {
          Connect: false
        });
        
        return interaction.editReply({ content: '🔒 Salon verrouillé !' });
      } catch (error) {
        console.error('Erreur lock:', error);
        if (!interaction.replied) {
          return interaction.editReply({ content: '❌ Erreur lors du verrouillage.' });
        }
      }
    }
    
    if (interaction.customId === 'vc_unlock') {
      try {
        // Déférer la réponse immédiatement
        await interaction.deferReply({ ephemeral: true });
        
        await voiceChannel.permissionOverwrites.edit(interaction.guild.id, {
          Connect: null
        });
        
        return interaction.editReply({ content: '🔓 Salon déverrouillé !' });
      } catch (error) {
        console.error('Erreur unlock:', error);
        if (!interaction.replied) {
          return interaction.editReply({ content: '❌ Erreur lors du déverrouillage.' });
        }
      }
    }
    
    if (interaction.customId === 'vc_limit') {
      const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
      
      const modal = new ModalBuilder()
        .setCustomId('modal_vc_limit')
        .setTitle('👥 Changer la limite du salon');
      
      const limitInput = new TextInputBuilder()
        .setCustomId('limit_input')
        .setLabel('Nombre de membres (0 = illimité)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ex: 5')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(2);
      
      const row = new ActionRowBuilder().addComponents(limitInput);
      modal.addComponents(row);
      
      return interaction.showModal(modal);
    }
    
    if (interaction.customId === 'vc_rename') {
      const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
      
      const modal = new ModalBuilder()
        .setCustomId('modal_vc_rename')
        .setTitle('✏️ Renommer le salon');
      
      const nameInput = new TextInputBuilder()
        .setCustomId('name_input')
        .setLabel('Nouveau nom du salon')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ex: 🎮 Gaming Squad')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(50);
      
      const row = new ActionRowBuilder().addComponents(nameInput);
      modal.addComponents(row);
      
      return interaction.showModal(modal);
    }
    
    if (interaction.customId === 'vc_invite') {
      const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
      
      const modal = new ModalBuilder()
        .setCustomId('modal_vc_invite')
        .setTitle('➕ Inviter un membre');
      
      const userInput = new TextInputBuilder()
        .setCustomId('user_input')
        .setLabel('ID ou pseudo du membre')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ex: 123456789 ou @Pseudo')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(100);
      
      const row = new ActionRowBuilder().addComponents(userInput);
      modal.addComponents(row);
      
      return interaction.showModal(modal);
    }
    
    if (interaction.customId === 'vc_kick') {
      const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
      
      const modal = new ModalBuilder()
        .setCustomId('modal_vc_kick')
        .setTitle('🚫 Expulser un membre');
      
      const userInput = new TextInputBuilder()
        .setCustomId('user_input')
        .setLabel('ID ou pseudo du membre')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ex: 123456789 ou @Pseudo')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(100);
      
      const row = new ActionRowBuilder().addComponents(userInput);
      modal.addComponents(row);
      
      return interaction.showModal(modal);
    }
    
    return;
  }

  // Création de tickets
  if (interaction.customId.startsWith('ticket_')) {
    const ticketType = interaction.customId.split('_')[1];
    
    // Vérifier si l'utilisateur a déjà un ticket ouvert
    const existingTicket = Object.values(database.tickets).find(t => t.userId === userId && !t.closed);
    
    if (existingTicket) {
      return interaction.reply({ 
        content: `❌ Tu as déjà un ticket ouvert : <#${existingTicket.channelId}>`, 
        ephemeral: true 
      });
    }
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const guild = interaction.guild;
      
      // Noms et emojis selon le type
      const types = {
        support: { name: 'support', emoji: '❓' },
        tech: { name: 'technique', emoji: '🛠️' },
        economy: { name: 'economie', emoji: '💰' },
        report: { name: 'signalement', emoji: '⚠️' },
        suggestion: { name: 'suggestion', emoji: '💡' },
        partnership: { name: 'partenariat', emoji: '🎁' }
      };
      
      const ticketInfo = types[ticketType];
      const ticketNumber = Object.keys(database.tickets).length + 1;
      
      // Créer le salon ticket
      const ticketChannel = await guild.channels.create({
        name: `${ticketInfo.emoji}・ticket-${ticketNumber}`,
        type: ChannelType.GuildText,
        parent: CONFIG.TICKET_CATEGORY_ID,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: [PermissionFlagsBits.ViewChannel]
          },
          {
            id: userId,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
          },
          {
            id: CONFIG.STAFF_ROLE_ID,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages]
          }
        ]
      });
      
      // Message dans le ticket
      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`${ticketInfo.emoji} Ticket #${ticketNumber} - ${ticketInfo.name.toUpperCase()}`)
        .setDescription(`Bienvenue ${interaction.user} !\n\nUn membre du staff prendra en charge ton ticket sous peu.\n\n**Type de ticket :** ${ticketInfo.name}\n**Ouvert le :** <t:${Math.floor(Date.now() / 1000)}:F>`)
        .setFooter({ text: 'Merci de décrire ton problème en détail' })
        .setTimestamp();
      
      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_claim').setLabel('📌 Prendre en charge').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Fermer le ticket').setStyle(ButtonStyle.Danger)
      );
      
      await ticketChannel.send({ 
        content: `${interaction.user} | <@&${CONFIG.STAFF_ROLE_ID}>`,
        embeds: [embed], 
        components: [buttons] 
      });
      
      // Enregistrer dans la base de données
      database.tickets[ticketChannel.id] = {
        channelId: ticketChannel.id,
        userId: userId,
        type: ticketType,
        claimedBy: null,
        closed: false,
        createdAt: Date.now()
      };
      saveDatabase();
      
      return interaction.editReply({ 
        content: `✅ Ton ticket a été créé : ${ticketChannel}` 
      });
      
    } catch (error) {
      console.error('Erreur création ticket:', error);
      return interaction.editReply({ 
        content: '❌ Erreur lors de la création du ticket.' 
      });
    }
  }
  
  // Prendre en charge un ticket
  if (interaction.customId === 'ticket_claim') {
    const ticketData = database.tickets[interaction.channel.id];
    
    if (!ticketData) {
      return interaction.reply({ content: '❌ Ticket introuvable.', ephemeral: true });
    }
    
    if (ticketData.claimedBy) {
      return interaction.reply({ 
        content: `❌ Ce ticket est déjà pris en charge par <@${ticketData.claimedBy}>`, 
        ephemeral: true 
      });
    }
    
    ticketData.claimedBy = userId;
    saveDatabase();
    
    const embed = new EmbedBuilder()
      .setColor('#00ff00')
      .setDescription(`✅ Ticket pris en charge par ${interaction.user}`)
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
  }
  
  // Fermer un ticket
  if (interaction.customId === 'ticket_close') {
    const ticketData = database.tickets[interaction.channel.id];
    
    if (!ticketData) {
      return interaction.reply({ content: '❌ Ticket introuvable.', ephemeral: true });
    }
    
    // Vérifier les permissions : Owner, Staff ou Créateur
    const isOwner = userId === CONFIG.OWNER_ID;
    const isStaff = interaction.member.roles.cache.has(CONFIG.STAFF_ROLE_ID);
    const isCreator = userId === ticketData.userId;
    
    if (!isOwner && !isStaff && !isCreator) {
      return interaction.reply({ 
        content: '❌ Seul le staff, le créateur ou l\'owner peut fermer ce ticket.', 
        ephemeral: true 
      });
    }
    
    // Marquer comme fermé AVANT de répondre
    ticketData.closed = true;
    saveDatabase();
    
    await interaction.reply({ content: '🔒 Fermeture du ticket dans 5 secondes...' });
    
    setTimeout(async () => {
      try {
        await interaction.channel.delete();
        delete database.tickets[interaction.channel.id];
        saveDatabase();
        console.log(`✅ Ticket ${interaction.channel.name} fermé par ${interaction.user.tag}`);
      } catch (error) {
        console.error('Erreur fermeture ticket:', error);
      }
    }, 5000);
  } 
});

// Gestionnaire séparé pour les modals
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isModalSubmit()) return;
  
  const userId = interaction.user.id;
  const member = interaction.member;
  const voiceChannel = member.voice.channel;
  
  if (!voiceChannel) {
    return interaction.reply({ content: '❌ Tu dois être dans un salon vocal !', ephemeral: true });
  }
  
  const vcData = database.tempVoiceChannels[voiceChannel.id];
  
  if (!vcData || vcData.ownerId !== userId) {
    return interaction.reply({ content: '❌ Ce n\'est pas ton salon vocal !', ephemeral: true });
  }
  
  try {
    // CORRECTION : Déférer AVANT toute opération
    await interaction.deferReply({ ephemeral: true });
    
    if (interaction.customId === 'modal_vc_limit') {
      const limit = parseInt(interaction.fields.getTextInputValue('limit_input'));
      
      if (isNaN(limit) || limit < 0 || limit > 99) {
        return interaction.editReply({ content: '❌ Nombre invalide ! Utilise un nombre entre 0 et 99.' });
      }
      
      await voiceChannel.setUserLimit(limit);
      return interaction.editReply({ content: `✅ Limite changée : ${limit === 0 ? 'Illimité' : limit + ' membres'}` });
    }
    
    if (interaction.customId === 'modal_vc_rename') {
      const newName = interaction.fields.getTextInputValue('name_input');
      
      if (newName.length < 1 || newName.length > 100) {
        return interaction.editReply({ content: '❌ Le nom doit faire entre 1 et 100 caractères.' });
      }
      
      await voiceChannel.setName(newName);
      return interaction.editReply({ content: `✅ Salon renommé en : **${newName}**` });
    }

    if (interaction.customId === 'modal_vc_invite') {
      const userInput = interaction.fields.getTextInputValue('user_input').trim();
      
      // Rechercher le membre (par ID, mention ou pseudo)
      let targetMember;
      
      // Si c'est un ID
      if (/^\d+$/.test(userInput)) {
        targetMember = await voiceChannel.guild.members.fetch(userInput).catch(() => null);
      }
      // Si c'est une mention <@123456>
      else if (userInput.match(/^<@!?(\d+)>$/)) {
        const id = userInput.match(/^<@!?(\d+)>$/)[1];
        targetMember = await voiceChannel.guild.members.fetch(id).catch(() => null);
      }
      // Sinon, recherche par pseudo
      else {
        targetMember = voiceChannel.guild.members.cache.find(m => 
          m.user.username.toLowerCase() === userInput.toLowerCase() ||
          m.displayName.toLowerCase() === userInput.toLowerCase()
        );
      }
      
      if (!targetMember) {
        return interaction.editReply({ content: '❌ Membre introuvable ! Vérifie l\'ID ou le pseudo.' });
      }
      
      await voiceChannel.permissionOverwrites.edit(targetMember.id, {
        Connect: true,
        ViewChannel: true
      });
      
      return interaction.editReply({ content: `✅ ${targetMember} peut maintenant rejoindre ton salon !` });
    }
    
    if (interaction.customId === 'modal_vc_kick') {
      const userInput = interaction.fields.getTextInputValue('user_input').trim();
      
      // Même logique de recherche que pour l'invitation
      let targetMember;
      
      if (/^\d+$/.test(userInput)) {
        targetMember = await voiceChannel.guild.members.fetch(userInput).catch(() => null);
      }
      else if (userInput.match(/^<@!?(\d+)>$/)) {
        const id = userInput.match(/^<@!?(\d+)>$/)[1];
        targetMember = await voiceChannel.guild.members.fetch(id).catch(() => null);
      }
      else {
        targetMember = voiceChannel.guild.members.cache.find(m => 
          m.user.username.toLowerCase() === userInput.toLowerCase() ||
          m.displayName.toLowerCase() === userInput.toLowerCase()
        );
      }
      
      if (!targetMember) {
        return interaction.editReply({ content: '❌ Membre introuvable ! Vérifie l\'ID ou le pseudo.' });
      }
      
      if (targetMember.id === userId) {
        return interaction.editReply({ content: '❌ Tu ne peux pas te bannir toi-même !' });
      }
      
      // Retirer les permissions et expulser
      await voiceChannel.permissionOverwrites.edit(targetMember.id, {
        Connect: false
      });
      
      // Si le membre est dans le salon, l'expulser
      if (targetMember.voice.channelId === voiceChannel.id) {
        await targetMember.voice.disconnect();
      }
      
      return interaction.editReply({ content: `✅ ${targetMember} a été banni du salon !` });
    }
    
  } catch (error) {
    console.error('Erreur modal:', error);
    
    // Gestion des erreurs Discord spécifiques
    if (error.code === 50013) {
      return interaction.editReply({ content: '❌ Je n\'ai pas les permissions nécessaires.' });
    }
    if (error.code === 429) {
      return interaction.editReply({ content: '⏳ Trop de modifications. Réessaye dans quelques minutes.' });
    }
    
    return interaction.editReply({ content: '❌ Erreur lors de l\'opération. Réessaye plus tard.' });
  }
});

// Bienvenue
client.on('guildMemberAdd', async (member) => {
  const welcomeChannel = member.guild.channels.cache.get(CONFIG.WELCOME_CHANNEL_ID);
  if (!welcomeChannel) return;
  
  const button = new ButtonBuilder()
    .setCustomId(`welcome_${member.id}`)
    .setLabel('🎁 Souhaiter la bienvenue (3 rios)')
    .setStyle(ButtonStyle.Success);
  
  const row = new ActionRowBuilder().addComponents(button);
  
  const message = await welcomeChannel.send({ 
    content: `🎉 **Bienvenue ${member} sur le serveur !**\n\n📜 Consulte <#${CONFIG.RULES_CHANNEL_ID}> | 💬 Discute dans <#${CONFIG.GENERAL_CHANNEL_ID}>`,
    components: [row] 
  });
  
  database.welcomeButtons[member.id] = { 
    messageId: message.id, 
    claimed: false 
  };
  saveDatabase();
  
  updateStatsChannels(member.guild);
});



// Commandes
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  
  const userId = message.author.id;
  initUser(userId);
  
  // !profil
  if (message.content.toLowerCase() === '!profil' || message.content.toLowerCase() === '!stats') {
    // Vérification du salon
    if (message.channel.id !== CONFIG.BOT_COMMANDS_CHANNEL_ID) {
      return message.reply(`❌ Cette commande ne fonctionne que dans <#${CONFIG.BOT_COMMANDS_CHANNEL_ID}> !`);
    }
    
    const user = database.users[userId];
    const { currentLevelXp, xpForNextLevel } = calculateLevel(user.xp);
    
    const progressBar = createProgressBar(currentLevelXp, xpForNextLevel);
    
    const embed = new EmbedBuilder()
      .setColor('#7289da')
      .setAuthor({ name: `Profil de ${message.author.username}`, iconURL: message.author.displayAvatarURL() })
      .setThumbnail(message.author.displayAvatarURL({ dynamic: true, size: 256 }))
      .addFields(
        { name: '📊 Niveau', value: `\`${user.level}\``, inline: true },
        { name: '💰 Rios', value: `\`${user.rios}\``, inline: true },
        { name: '⭐ XP', value: `\`${user.xp}\``, inline: true },
        { name: '📈 Progression', value: `${progressBar}\n\`${currentLevelXp}/${xpForNextLevel} XP\`` }
      )
      .setFooter({ text: 'Continue à être actif pour gagner plus d\'XP !' })
      .setTimestamp();
    
    return message.reply({ embeds: [embed] });
  }
  
  // !shop
  if (message.content.toLowerCase() === '!shop') {
    // Vérification du salon
    if (message.channel.id !== CONFIG.BOT_COMMANDS_CHANNEL_ID) {
      return message.reply(`❌ Cette commande ne fonctionne que dans <#${CONFIG.BOT_COMMANDS_CHANNEL_ID}> !`);
    }
    
    const user = database.users[userId];
    
    let shopText = '';
    SHOP_ITEMS.forEach((item, index) => {
      shopText += `**${index + 1}.** ${item.name} - \`${item.price} rios\`\n`;
    });
    
    const embed = new EmbedBuilder()
      .setColor('#ffd700')
      .setTitle('🛒 Boutique Rio')
      .setDescription(`Tes rios : **${user.rios}** 💰\n\n${shopText}`)
      .setFooter({ text: 'Utilise !buy <numéro> pour acheter' });
    
    return message.reply({ embeds: [embed] });
  }
  
  // !buy
  if (message.content.startsWith('!buy ')) {
    // Vérification du salon
    if (message.channel.id !== CONFIG.BOT_COMMANDS_CHANNEL_ID) {
      return message.reply(`❌ Cette commande ne fonctionne que dans <#${CONFIG.BOT_COMMANDS_CHANNEL_ID}> !`);
    }
    
    const itemNumber = parseInt(message.content.split(' ')[1]) - 1;
    const item = SHOP_ITEMS[itemNumber];
    const user = database.users[userId];
    
    if (!item) {
      return message.reply('❌ Article invalide ! Utilise `!shop` pour voir la liste.');
    }
    
    if (user.rios < item.price) {
      return message.reply(`❌ Tu n'as pas assez de rios ! Il te manque ${item.price - user.rios} rios.`);
    }
    
    user.rios -= item.price;
    if (!user.inventory) user.inventory = [];
    user.inventory.push(item.id);
    saveDatabase();
    
    return message.reply(`✅ Tu as acheté **${item.name}** pour ${item.price} rios !`);
  }

  // !pen - Jeu de penalty
  if (message.content.startsWith('!pen ')) {
    // Vérification du salon
    if (message.channel.id !== CONFIG.GAMES_CHANNEL_ID) {
      return message.reply(`❌ Cette commande ne fonctionne que dans <#${CONFIG.GAMES_CHANNEL_ID}> !`);
    }
    
    const args = message.content.split(' ');
    
    // Vérification des arguments
    if (args.length !== 3) {
      return message.reply('❌ **Usage:** `!pen <montant> <gauche/centre/droite>`\n**Exemple:** `!pen 50 gauche`');
    }
    
    const bet = parseInt(args[1]);
    const direction = args[2].toLowerCase();
    
    // Validation du montant
    if (isNaN(bet) || bet < 10) {
      return message.reply('❌ Mise minimale : **10 rios** !');
    }
    
    if (bet > 500) {
      return message.reply('❌ Mise maximale : **500 rios** !');
    }
    
    const user = database.users[userId];
    
    if (user.rios < bet) {
      return message.reply(`❌ Tu n'as que **${user.rios} rios** ! Il te manque **${bet - user.rios} rios**.`);
    }
    
    // Validation de la direction
    const validDirections = ['gauche', 'centre', 'droite', 'left', 'center', 'right', 'g', 'c', 'd'];
    if (!validDirections.includes(direction)) {
      return message.reply('❌ Direction invalide ! Utilise : **gauche**, **centre** ou **droite**');
    }
    
    // Normaliser la direction
    let playerChoice;
    if (['gauche', 'left', 'g'].includes(direction)) playerChoice = 'gauche';
    else if (['centre', 'center', 'c'].includes(direction)) playerChoice = 'centre';
    else playerChoice = 'droite';
    
    // Le gardien choisit aléatoirement
    const directions = ['gauche', 'centre', 'droite'];
    const goalkeeperChoice = directions[Math.floor(Math.random() * directions.length)];
    
    const emojis = {
      gauche: '⬅️',
      centre: '⏺️',
      droite: '➡️'
    };
    
    // Message de tir
    const shootEmbed = new EmbedBuilder()
      .setColor('#FFD700')
      .setTitle('⚽ PENALTY !')
      .setDescription(`${message.author} tire vers **${emojis[playerChoice]} ${playerChoice.toUpperCase()}** !\n\nMise : **${bet} rios**`)
      .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: 'Le gardien plonge...' })
      .setTimestamp();
    
    const shootMessage = await message.reply({ embeds: [shootEmbed] });
    
    // Attendre 3 secondes avant le résultat
    setTimeout(async () => {
      if (playerChoice === goalkeeperChoice) {
        // RATÉ - Le gardien a arrêté
        user.rios -= bet;
        saveDatabase();
        
        const resultEmbed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('🧤 ARRÊT DU GARDIEN !')
          .setDescription(`Le gardien plonge vers **${emojis[goalkeeperChoice]} ${goalkeeperChoice.toUpperCase()}** et arrête le ballon !`)
          .addFields(
            { name: '❌ Résultat', value: `${message.author} perd **${bet} rios**`, inline: true },
            { name: '💰 Solde', value: `${user.rios} rios`, inline: true }
          )
          .setThumbnail('https://em-content.zobj.net/source/twitter/348/gloves_1f9e4.png')
          .setFooter({ text: 'Réessaye avec !pen <montant> <direction>' })
          .setTimestamp();
        
        await message.channel.send({ embeds: [resultEmbed] });
        
      } else {
        // BUT - Le gardien s'est trompé
        const winAmount = bet * 2;
        user.rios += winAmount;
        saveDatabase();
        
        const resultEmbed = new EmbedBuilder()
          .setColor('#00FF00')
          .setTitle('⚽ BUUUUUUUT !')
          .setDescription(`Le gardien plonge vers **${emojis[goalkeeperChoice]} ${goalkeeperChoice.toUpperCase()}** mais ${message.author} tire vers **${emojis[playerChoice]} ${playerChoice.toUpperCase()}** !`)
          .addFields(
            { name: '✅ Résultat', value: `${message.author} gagne **${winAmount} rios** !`, inline: true },
            { name: '💰 Solde', value: `${user.rios} rios`, inline: true }
          )
          .setThumbnail('https://em-content.zobj.net/source/twitter/348/soccer-ball_26bd.png')
          .setFooter({ text: 'Bravo ! Rejoue avec !pen <montant> <direction>' })
          .setTimestamp();
        
        await message.channel.send({ embeds: [resultEmbed] });
      }
      
    }, 3000); // 3 secondes de suspense
    
    return;
  }

   // !chifoumi - Pierre Papier Ciseaux
  if (message.content.startsWith('!chifoumi ') || message.content.startsWith('!ppc ')) {
    // Vérification du salon
    if (message.channel.id !== CONFIG.GAMES_CHANNEL_ID) {
      return message.reply(`❌ Cette commande ne fonctionne que dans <#${CONFIG.GAMES_CHANNEL_ID}> !`);
    }
    
    const args = message.content.split(' ');
    
    // Vérification des arguments
    if (args.length !== 3) {
      return message.reply('❌ **Usage:** `!chifoumi <montant> <pierre/papier/ciseaux>`\n**Exemple:** `!chifoumi 50 pierre`');
    }
    
    const bet = parseInt(args[1]);
    const choice = args[2].toLowerCase();
    
    // Validation du montant
    if (isNaN(bet) || bet < 10) {
      return message.reply('❌ Mise minimale : **10 rios** !');
    }
    
    if (bet > 500) {
      return message.reply('❌ Mise maximale : **500 rios** !');
    }
    
    const user = database.users[userId];
    
    if (user.rios < bet) {
      return message.reply(`❌ Tu n'as que **${user.rios} rios** ! Il te manque **${bet - user.rios} rios**.`);
    }
    
    // Validation du choix
    const validChoices = ['pierre', 'papier', 'ciseaux', 'rock', 'paper', 'scissors', 'p', 'c', 'ci'];
    if (!validChoices.includes(choice)) {
      return message.reply('❌ Choix invalide ! Utilise : **pierre**, **papier** ou **ciseaux**');
    }
    
    // Normaliser le choix
    let playerChoice;
    if (['pierre', 'rock', 'p'].includes(choice)) playerChoice = 'pierre';
    else if (['papier', 'paper'].includes(choice)) playerChoice = 'papier';
    else playerChoice = 'ciseaux';
    
    // Le bot choisit aléatoirement
    const choices = ['pierre', 'papier', 'ciseaux'];
    const botChoice = choices[Math.floor(Math.random() * choices.length)];
    
    const emojis = {
      pierre: '🪨',
      papier: '📄',
      ciseaux: '✂️'
    };
    
    // Message de choix
    const choiceEmbed = new EmbedBuilder()
      .setColor('#FFD700')
      .setTitle('✊ CHIFOUMI !')
      .setDescription(`${message.author} joue **${emojis[playerChoice]} ${playerChoice.toUpperCase()}** !\n\nMise : **${bet} rios**`)
      .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: 'Le bot réfléchit...' })
      .setTimestamp();
    
    const choiceMessage = await message.reply({ embeds: [choiceEmbed] });
    
    // Attendre 2 secondes avant le résultat
    setTimeout(async () => {
      // Déterminer le résultat
      if (playerChoice === botChoice) {
        // ÉGALITÉ
        const resultEmbed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('🤝 ÉGALITÉ !')
          .setDescription(`${message.author} et le bot ont joué **${emojis[playerChoice]} ${playerChoice.toUpperCase()}** !`)
          .addFields(
            { name: '↔️ Résultat', value: `Mise remboursée : **${bet} rios**`, inline: true },
            { name: '💰 Solde', value: `${user.rios} rios`, inline: true }
          )
          .setFooter({ text: 'Réessaye avec !chifoumi <montant> <choix>' })
          .setTimestamp();
        
        await message.channel.send({ embeds: [resultEmbed] });
          
      } else if (
        (playerChoice === 'pierre' && botChoice === 'ciseaux') ||
        (playerChoice === 'papier' && botChoice === 'pierre') ||
        (playerChoice === 'ciseaux' && botChoice === 'papier')
      ) {
        // VICTOIRE
        const winAmount = bet * 2;
        user.rios += winAmount;
        saveDatabase();
        
        const resultEmbed = new EmbedBuilder()
          .setColor('#00FF00')
          .setTitle('🎉 VICTOIRE !')
          .setDescription(`${emojis[playerChoice]} **${playerChoice.toUpperCase()}** bat ${emojis[botChoice]} **${botChoice.toUpperCase()}** !`)
          .addFields(
            { name: '✅ Résultat', value: `${message.author} gagne **${winAmount} rios** !`, inline: true },
            { name: '💰 Solde', value: `${user.rios} rios`, inline: true }
          )
          .setThumbnail('https://em-content.zobj.net/source/twitter/348/trophy_1f3c6.png')
          .setFooter({ text: 'Bravo ! Rejoue avec !chifoumi <montant> <choix>' })
          .setTimestamp();
        
        await message.channel.send({ embeds: [resultEmbed] });
          
      } else {
        // DÉFAITE
        user.rios -= bet;
        saveDatabase();
        
        const resultEmbed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('😢 DÉFAITE !')
          .setDescription(`${emojis[botChoice]} **${botChoice.toUpperCase()}** bat ${emojis[playerChoice]} **${playerChoice.toUpperCase()}** !`)
          .addFields(
            { name: '❌ Résultat', value: `${message.author} perd **${bet} rios**`, inline: true },
            { name: '💰 Solde', value: `${user.rios} rios`, inline: true }
          )
          .setFooter({ text: 'Réessaye avec !chifoumi <montant> <choix>' })
          .setTimestamp();
        
        await message.channel.send({ embeds: [resultEmbed] });
      }
      
    }, 2000); // 2 secondes de suspense
    
    return;
  }

  // !daily - Récompense quotidienne
  if (message.content.toLowerCase() === '!daily') {
    // Vérification du salon
    if (message.channel.id !== CONFIG.BOT_COMMANDS_CHANNEL_ID) {
      return message.reply(`❌ Cette commande ne fonctionne que dans <#${CONFIG.BOT_COMMANDS_CHANNEL_ID}> !`);
    }
    
    const user = database.users[userId];
    const now = Date.now();
    const cooldown = 24 * 60 * 60 * 1000; // 24 heures
    
    if (now - user.lastDaily < cooldown) {
      const timeLeft = cooldown - (now - user.lastDaily);
      const hoursLeft = Math.floor(timeLeft / (60 * 60 * 1000));
      const minutesLeft = Math.floor((timeLeft % (60 * 60 * 1000)) / (60 * 1000));
      
      return message.reply(`⏰ Tu as déjà réclamé ta récompense quotidienne !\n⏳ Reviens dans **${hoursLeft}h ${minutesLeft}min**`);
    }
    
    const dailyReward = 100;
    user.rios += dailyReward;
    user.lastDaily = now;
    saveDatabase();
    
    return message.reply(`🎁 Tu as réclamé ta récompense quotidienne de **${dailyReward} rios** !\n💰 Nouveau solde : **${user.rios} rios**\n⏰ Reviens demain pour en récupérer plus !`);
  }

  // !work - Travailler pour gagner des rios
  if (message.content.toLowerCase() === '!work') {
    // Vérification du salon
    if (message.channel.id !== CONFIG.BOT_COMMANDS_CHANNEL_ID) {
      return message.reply(`❌ Cette commande ne fonctionne que dans <#${CONFIG.BOT_COMMANDS_CHANNEL_ID}> !`);
    }
    
    const user = database.users[userId];
    const now = Date.now();
    const cooldown = 60 * 60 * 1000; // 1 heure
    
    if (now - user.lastWork < cooldown) {
      const timeLeft = cooldown - (now - user.lastWork);
      const minutesLeft = Math.ceil(timeLeft / (60 * 1000));
      
      return message.reply(`⏰ Tu es fatigué ! Repose-toi encore **${minutesLeft} minutes**`);
    }
    
    // Jobs aléatoires avec récompenses variables
    const jobs = [
      { name: '🍕 Livreur de pizza', min: 30, max: 60 },
      { name: '🚗 Chauffeur Uber', min: 40, max: 70 },
      { name: '💼 Consultant', min: 50, max: 100 },
      { name: '🎨 Designer freelance', min: 35, max: 80 },
      { name: '🔧 Réparateur', min: 45, max: 85 },
      { name: '📦 Préparateur de commandes', min: 25, max: 55 },
      { name: '☕ Barista', min: 30, max: 65 },
      { name: '🎮 Testeur de jeux', min: 40, max: 90 },
      { name: '📱 Community Manager', min: 35, max: 75 },
      { name: '🏋️ Coach sportif', min: 45, max: 95 }
    ];
    
    const job = jobs[Math.floor(Math.random() * jobs.length)];
    const earned = Math.floor(Math.random() * (job.max - job.min + 1)) + job.min;
    
    user.rios += earned;
    user.lastWork = now;
    saveDatabase();
    
    return message.reply(`${job.name}\nTu as travaillé dur et gagné **${earned} rios** !\n💰 Nouveau solde : **${user.rios} rios**\n⏰ Tu pourras retravailler dans 1 heure`);
  }

  // !give - Donner des rios à un autre membre
  if (message.content.startsWith('!give ')) {
    // Vérification du salon
    if (message.channel.id !== CONFIG.BOT_COMMANDS_CHANNEL_ID) {
      return message.reply(`❌ Cette commande ne fonctionne que dans <#${CONFIG.BOT_COMMANDS_CHANNEL_ID}> !`);
    }
    
    const args = message.content.split(' ');
    
    if (args.length !== 3) {
      return message.reply('❌ **Usage:** `!give @user <montant>`\n**Exemple:** `!give @Rio 50`');
    }
    
    const targetUser = message.mentions.users.first();
    const amount = parseInt(args[2]);
    
    if (!targetUser) {
      return message.reply('❌ Tu dois mentionner un utilisateur valide !');
    }
    
    if (targetUser.id === userId) {
      return message.reply('❌ Tu ne peux pas te donner des rios à toi-même !');
    }
    
    if (targetUser.bot) {
      return message.reply('❌ Tu ne peux pas donner des rios à un bot !');
    }
    
    if (isNaN(amount) || amount < 1) {
      return message.reply('❌ Le montant doit être supérieur ou égal à 1 rio !');
    }
    
    const user = database.users[userId];
    
    if (user.rios < amount) {
      return message.reply(`❌ Tu n'as que **${user.rios} rios** ! Tu ne peux pas donner **${amount} rios**.`);
    }
    
    // Transaction
    initUser(targetUser.id);
    user.rios -= amount;
    database.users[targetUser.id].rios += amount;
    saveDatabase();
    
    return message.reply(`✅ Tu as donné **${amount} rios** à ${targetUser} !\n💰 Ton nouveau solde : **${user.rios} rios**`);
  }

  // !toprios - Classement des plus riches
  if (message.content.toLowerCase() === '!toprios') {
    // Vérification du salon
    if (message.channel.id !== CONFIG.BOT_COMMANDS_CHANNEL_ID) {
      return message.reply(`❌ Cette commande ne fonctionne que dans <#${CONFIG.BOT_COMMANDS_CHANNEL_ID}> !`);
    }
    
    const sortedUsers = Object.entries(database.users)
      .sort(([, a], [, b]) => b.rios - a.rios)
      .slice(0, 10);
    
    if (sortedUsers.length === 0) {
      return message.reply('❌ Aucun membre dans le classement.');
    }
    
    let description = '**🏆 TOP 10 DES PLUS RICHES 🏆**\n\n';
    
    for (let i = 0; i < sortedUsers.length; i++) {
      const [userId, userData] = sortedUsers[i];
      const user = await client.users.fetch(userId).catch(() => null);
      const username = user ? user.username : 'Inconnu';
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      description += `${medal} **${username}** - ${userData.rios} rios\n`;
    }
    
    const embed = new EmbedBuilder()
      .setColor('#FFD700')
      .setTitle('💰 Classement des Rios')
      .setDescription(description)
      .setFooter({ text: 'Gagne plus de rios en jouant et en travaillant !' })
      .setTimestamp();
    
    return message.reply({ embeds: [embed] });
  }
  
  // Commandes de modération et owner (gardées courtes pour économiser l'espace)
  
  // !say
  if (message.content.startsWith('!say ') && message.author.id === CONFIG.OWNER_ID) {
    const content = message.content.slice(5).trim();
    if (!content) return message.reply('❌ Usage: `!say <message>`');
    try { await message.delete(); } catch {}
    return message.channel.send(content);
  }
  
  // !sayembed
  if (message.content.startsWith('!sayembed ') && message.author.id === CONFIG.OWNER_ID) {
    const content = message.content.slice(11).trim();
    if (!content) return message.reply('❌ Usage: `!sayembed <message>`');
    const embed = new EmbedBuilder().setColor('#5865F2').setDescription(content).setTimestamp();
    try { await message.delete(); } catch {}
    return message.channel.send({ embeds: [embed] });
  }
  
  // !ban
  if (message.content.startsWith('!ban ')) {
    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
      return message.reply('❌ Permission refusée.');
    }
    const userMention = message.mentions.members.first();
    if (!userMention) return message.reply('❌ Usage: `!ban @user [raison]`');
    if (!userMention.bannable) return message.reply('❌ Impossible de bannir ce membre.');
    const reason = message.content.split(' ').slice(2).join(' ') || 'Aucune raison';
    try {
      await userMention.ban({ reason });
      return message.reply(`✅ ${userMention.user.tag} a été banni.`);
    } catch {
      return message.reply('❌ Erreur lors du bannissement.');
    }
  }
  
  // !kick
  if (message.content.startsWith('!kick ')) {
    if (!message.member.permissions.has(PermissionFlagsBits.KickMembers)) {
      return message.reply('❌ Permission refusée.');
    }
    const userMention = message.mentions.members.first();
    if (!userMention) return message.reply('❌ Usage: `!kick @user [raison]`');
    if (!userMention.kickable) return message.reply('❌ Impossible d\'expulser ce membre.');
    const reason = message.content.split(' ').slice(2).join(' ') || 'Aucune raison';
    try {
      await userMention.kick(reason);
      return message.reply(`✅ ${userMention.user.tag} a été expulsé.`);
    } catch {
      return message.reply('❌ Erreur lors de l\'expulsion.');
    }
  }
  
  // !mute
  if (message.content.startsWith('!mute ')) {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return message.reply('❌ Permission refusée.');
    }
    const userMention = message.mentions.members.first();
    if (!userMention) return message.reply('❌ Usage: `!mute @user [raison]`');
    const reason = message.content.split(' ').slice(2).join(' ') || 'Aucune raison';
    try {
      await userMention.timeout(28 * 24 * 60 * 60 * 1000, reason);
      return message.reply(`✅ ${userMention.user.tag} a été mute.`);
    } catch {
      return message.reply('❌ Erreur lors du mute.');
    }
  }
  
  // !tempmute
  if (message.content.startsWith('!tempmute ')) {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return message.reply('❌ Permission refusée.');
    }
    const args = message.content.split(' ');
    const userMention = message.mentions.members.first();
    if (!userMention || args.length < 3) {
      return message.reply('❌ Usage: `!tempmute @user <durée> [raison]`\nEx: `!tempmute @user 10m Spam`');
    }
    const durationStr = args[2];
    const match = durationStr.match(/^(\d+)([smhd])$/);
    if (!match) return message.reply('❌ Format invalide. Ex: 10s, 5m, 2h, 1d');
    
    const value = parseInt(match[1]);
    const unit = match[2];
    let ms;
    
    switch (unit) {
      case 's': ms = value * 1000; break;
      case 'm': ms = value * 60 * 1000; break;
      case 'h': ms = value * 60 * 60 * 1000; break;
      case 'd': ms = value * 24 * 60 * 60 * 1000; break;
    }
    
    if (ms > 28 * 24 * 60 * 60 * 1000) return message.reply('❌ Maximum 28 jours.');
    
    const reason = args.slice(3).join(' ') || 'Aucune raison';
    try {
      await userMention.timeout(ms, reason);
      return message.reply(`✅ ${userMention.user.tag} a été mute pour ${durationStr}.`);
    } catch {
      return message.reply('❌ Erreur lors du mute.');
    }
  }
  
  // !unmute
  if (message.content.startsWith('!unmute ')) {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return message.reply('❌ Permission refusée.');
    }
    const userMention = message.mentions.members.first();
    if (!userMention) return message.reply('❌ Usage: `!unmute @user`');
    try {
      await userMention.timeout(null);
      return message.reply(`✅ ${userMention.user.tag} a été unmute.`);
    } catch {
      return message.reply('❌ Erreur.');
    }
  }
  
  // !leaderboard
  if (message.content.toLowerCase() === '!leaderboard' || message.content.toLowerCase() === '!top') {
    // Vérification du salon
    if (message.channel.id !== CONFIG.BOT_COMMANDS_CHANNEL_ID) {
      return message.reply(`❌ Cette commande ne fonctionne que dans <#${CONFIG.BOT_COMMANDS_CHANNEL_ID}> !`);
    }
    
    const sortedUsers = Object.entries(database.users)
      .sort(([, a], [, b]) => b.xp - a.xp)
      .slice(0, 10);
    
    let description = '';
    for (let i = 0; i < sortedUsers.length; i++) {
      const [userId, userData] = sortedUsers[i];
      const user = await client.users.fetch(userId).catch(() => null);
      const username = user ? user.username : 'Inconnu';
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      description += `${medal} **${username}** - Niv.${userData.level} (${userData.xp} XP) - ${userData.rios} rios\n`;
    }
    
    const embed = new EmbedBuilder()
      .setColor('#ffd700')
      .setTitle('🏆 Classement')
      .setDescription(description || 'Aucun membre.')
      .setTimestamp();
    
    return message.reply({ embeds: [embed] });
  }
  
  // !help
  if (message.content.toLowerCase() === '!help' || message.content.toLowerCase() === '!aide') {
    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('📚 Commandes disponibles')
      .setDescription('Liste de toutes les commandes du bot')
      .addFields(
        { name: '🎮 Jeux', value: '`!pen <montant> <direction>` - Penalty ⚽\n`!chifoumi <montant> <choix>` - Pierre-papier-ciseaux ✊', inline: false },
        { name: '💰 Économie', value: '`!daily` - Récompense quotidienne (100 rios)\n`!work` - Travailler pour gagner des rios\n`!give @user <montant>` - Donner des rios\n`!toprios` - Top 10 des plus riches\n`!shop` - Boutique\n`!buy <n>` - Acheter', inline: false },
        { name: '📊 Profil', value: '`!profil` / `!stats` - Voir ton profil\n`!top` / `!leaderboard` - Classement', inline: false }
      )
      .setFooter({ text: 'Utilise les commandes pour interagir avec le bot !' })
      .setTimestamp();
    
    if (message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
      embed.addFields({ name: '🔨 Modération', value: '`!ban @user [raison]` - Bannir\n`!kick @user [raison]` - Expulser' });
    }
    
    if (message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      embed.addFields({ 
        name: '🔇 Mute', 
        value: '`!mute @user [raison]` - Mute permanent\n`!tempmute @user <durée> [raison]` - Mute temporaire\n`!unmute @user` - Démute' 
      });
    }
    
    if (message.author.id === CONFIG.OWNER_ID) {
      embed.addFields({ 
        name: '👑 Owner', 
        value: '`!say <message>` - Envoyer un message\n`!sayembed <message>` - Envoyer un embed' 
      });
    }
    
    return message.reply({ embeds: [embed] });
  }
  
  // !leaderboard
  if (message.content.toLowerCase() === '!leaderboard' || message.content.toLowerCase() === '!top') {
    const sortedUsers = Object.entries(database.users)
      .sort(([, a], [, b]) => b.xp - a.xp)
      .slice(0, 10);
    
    let description = '';
    for (let i = 0; i < sortedUsers.length; i++) {
      const [userId, userData] = sortedUsers[i];
      const user = await client.users.fetch(userId).catch(() => null);
      const username = user ? user.username : 'Inconnu';
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      description += `${medal} **${username}** - Niv.${userData.level} (${userData.xp} XP) - ${userData.rios} rios\n`;
    }
    
    const embed = new EmbedBuilder()
      .setColor('#ffd700')
      .setTitle('🏆 Classement des membres')
      .setDescription(description || 'Aucun membre dans le classement.')
      .setTimestamp();
    
    return message.reply({ embeds: [embed] });
  }
  
  // Gain d'XP (seulement si ce n'est pas une commande)
  const now = Date.now();
  const userData = database.users[userId];
  
  if (now - userData.lastXpGain < CONFIG.XP_COOLDOWN) return;
  
  userData.lastXpGain = now;
  const result = addXp(userId, CONFIG.XP_PER_MESSAGE);
  
   if (result.leveledUp) {
    // Récupérer le salon de commandes bot
    const botCommandsChannel = message.guild.channels.cache.get(CONFIG.BOT_COMMANDS_CHANNEL_ID);
    
    // Si le salon existe, envoyer là-bas, sinon dans le salon actuel
    const targetChannel = botCommandsChannel || message.channel;
    
    targetChannel.send(`🎊 Bravo ${message.author}, tu es monté **niveau ${result.newLevel}** et tu as gagné **${result.riosReward} rios** !`);
  }

  // !debugleaderboard - Debug complet (OWNER ONLY)
  if (message.content.toLowerCase() === '!debugleaderboard' && message.author.id === CONFIG.OWNER_ID) {
    const reply = await message.reply('🔍 **Debug du classement...**');
    
    const checks = [];
    
    // 1. Vérifier la CONFIG
    checks.push(`**1. Configuration**`);
    checks.push(`• LEADERBOARD_CHANNEL_ID: \`${CONFIG.LEADERBOARD_CHANNEL_ID}\``);
    checks.push(`• Message ID stocké: \`${database.leaderboardMessage || 'Aucun'}\``);
    
    // 2. Vérifier le salon
    const channel = message.guild.channels.cache.get(CONFIG.LEADERBOARD_CHANNEL_ID);
    checks.push(`\n**2. Salon**`);
    checks.push(`• Existe: ${channel ? '✅' : '❌'}`);
    if (channel) {
      checks.push(`• Nom: ${channel.name}`);
      checks.push(`• Permissions: ${channel.permissionsFor(message.guild.members.me).has('SendMessages') ? '✅' : '❌'}`);
    }
    
    // 3. Vérifier la base de données
    const userCount = Object.keys(database.users).length;
    checks.push(`\n**3. Base de données**`);
    checks.push(`• Utilisateurs: ${userCount}`);
    
    // 4. Forcer la création
    checks.push(`\n**4. Test de création**`);
    await setupLeaderboard(message.guild);
    checks.push(`• Exécuté ✅`);
    
    await reply.edit(checks.join('\n'));
    return;
  }
});

// Serveur web pour Render (empêche la mise en veille)
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
