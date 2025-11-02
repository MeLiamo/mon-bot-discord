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
  tickets: {}
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
      inventory: []
    };
    saveDatabase();
  }
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

// Bot prêt
client.once('ready', () => {
  console.log(`✅ Bot connecté: ${client.user.tag}`);
  loadDatabase();
  
  client.guilds.cache.forEach(guild => {
    setupStatsChannels(guild);
    setupVoiceControlPanel(guild);
    setupTicketPanel(guild);
  });
  
  setInterval(() => {
    client.guilds.cache.forEach(guild => {
      updateStatsChannels(guild);
    });
  }, CONFIG.UPDATE_STATS_INTERVAL);
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
    
    buttonData.claimed = true;
    buttonData.claimedBy = userId;
    addRios(userId, CONFIG.WELCOME_BUTTON_REWARD);
    saveDatabase();
    
    await interaction.update({ components: [] });
    await interaction.followUp({
      content: `✅ ${interaction.user} a gagné **${CONFIG.WELCOME_BUTTON_REWARD} rios** !`,
      ephemeral: false
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
      return interaction.reply({ 
        content: '➕ Mentionne la personne à inviter (@user) dans le chat.', 
        ephemeral: true 
      });
    }
    
    if (interaction.customId === 'vc_kick') {
      return interaction.reply({ 
        content: '🚫 Mentionne la personne à expulser (@user) dans le chat.', 
        ephemeral: true 
      });
    }
    
    return;
  }
  
  // Jeu - Pierre Papier Ciseaux
  if (interaction.customId.startsWith('rps_')) {
    const choice = interaction.customId.split('_')[1];
    const choices = ['rock', 'paper', 'scissors'];
    const botChoice = choices[Math.floor(Math.random() * choices.length)];
    
    const emojis = { rock: '🪨', paper: '📄', scissors: '✂️' };
    
    let result;
    if (choice === botChoice) {
      result = '🤝 Égalité !';
    } else if (
      (choice === 'rock' && botChoice === 'scissors') ||
      (choice === 'paper' && botChoice === 'rock') ||
      (choice === 'scissors' && botChoice === 'paper')
    ) {
      result = '🎉 Tu gagnes ! +10 rios';
      addRios(userId, 10);
    } else {
      result = '😢 Tu perds ! -5 rios';
      addRios(userId, -5);
    }
    
    return interaction.reply({
      content: `${emojis[choice]} vs ${emojis[botChoice]}\n${result}`,
      ephemeral: true
    });
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
    if (interaction.customId === 'modal_vc_limit') {
      const limit = parseInt(interaction.fields.getTextInputValue('limit_input'));
      
      if (isNaN(limit) || limit < 0 || limit > 99) {
        return interaction.reply({ content: '❌ Nombre invalide ! Utilise un nombre entre 0 et 99.', ephemeral: true });
      }
      
      await interaction.deferReply({ ephemeral: true });
      await voiceChannel.setUserLimit(limit);
      return interaction.editReply({ content: `✅ Limite changée : ${limit === 0 ? 'Illimité' : limit + ' membres'}` });
    }
    
    if (interaction.customId === 'modal_vc_rename') {
      const newName = interaction.fields.getTextInputValue('name_input');
      
      await interaction.deferReply({ ephemeral: true });
      await voiceChannel.setName(newName);
      return interaction.editReply({ content: `✅ Salon renommé en : **${newName}**` });
    }
    
  } catch (error) {
    console.error('Erreur modal:', error);
    
    if (!interaction.replied && !interaction.deferred) {
      return interaction.reply({ content: '❌ Erreur lors de l\'opération.', ephemeral: true });
    } else {
      return interaction.editReply({ content: '❌ Erreur lors de l\'opération.' });
    }
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


  
  database.welcomeButtons[member.id] = { messageId: message.id, claimed: false };
  saveDatabase();
  
  // Supprimer le message après 10 secondes
  setTimeout(async () => {
    try {
      await message.delete();
      // Nettoyer la base de données
      delete database.welcomeButtons[member.id];
      saveDatabase();
    } catch (error) {
      console.log('Message déjà supprimé ou introuvable');
    }
  }, 10000); // 10 secondes
  
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
  
  // !play
  if (message.content.toLowerCase() === '!play') {
    const embed = new EmbedBuilder()
      .setColor('#ff0066')
      .setTitle('🎮 Pierre Papier Ciseaux')
      .setDescription('Choisis ton coup ! Gagne 10 rios, perds 5 rios.');
    
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('rps_rock').setLabel('🪨 Pierre').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('rps_paper').setLabel('📄 Papier').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('rps_scissors').setLabel('✂️ Ciseaux').setStyle(ButtonStyle.Danger)
    );
    
    return message.reply({ embeds: [embed], components: [row] });
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
        { name: '🎮 Jeu & Économie', value: '`!play` - Pierre papier ciseaux\n`!shop` - Boutique\n`!buy <n>` - Acheter un article', inline: false },
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
