// src/index.js
require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  EmbedBuilder,
  REST,
  Routes,
} = require('discord.js');
const cron = require('node-cron');
const fs = require('fs');
const warera = require('./warera');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('Mancano DISCORD_TOKEN o CLIENT_ID nel file .env');
  process.exit(1);
}

// --- Helper: formattazione dati WarEra -------------------------------------

const ETHIC_AXES = [
  { key: 'militarism', pos: 'Espansionista', neg: 'Pacifista' },
  { key: 'isolationism', pos: 'Isolazionista', neg: 'Diplomatico' },
  { key: 'imperialism', pos: 'Imperialista', neg: 'Repubblicano' },
  { key: 'industrialism', pos: 'Industrialista', neg: 'Agrario' },
];

function formatEthics(ethics) {
  if (!ethics) return 'n/d';
  const parts = [];
  for (const axis of ETHIC_AXES) {
    const v = ethics[axis.key];
    if (!v) continue;
    const label = v > 0 ? axis.pos : axis.neg;
    const level = Math.abs(v) >= 2 ? 'Fanatico' : 'Normale';
    parts.push(`${label} (${level})`);
  }
  if (ethics.unethical) parts.push('Senza scrupoli');
  return parts.length ? parts.join('\n') : 'Nessuna etica attiva';
}

const COMBAT_SKILLS = [
  { key: 'attack', label: 'Attacco' },
  { key: 'precision', label: 'Precisione', percent: true },
  { key: 'criticalChance', label: 'Prob. critico', percent: true },
  { key: 'criticalDamages', label: 'Danni critici', percent: true },
  { key: 'armor', label: 'Armatura' },
  { key: 'dodge', label: 'Schiva' },
  { key: 'health', label: 'Salute' },
  { key: 'lootChance', label: 'Prob. bottino', percent: true },
  { key: 'hunger', label: 'Sazietà' },
];

const ECONOMIC_SKILLS = [
  { key: 'entrepreneurship', label: 'Imprenditoria' },
  { key: 'energy', label: 'Energia' },
  { key: 'production', label: 'Produzione' },
  { key: 'companies', label: 'Aziende' },
  { key: 'management', label: 'Gestione' },
];

function formatSkillGroup(skills, group) {
  if (!skills) return 'n/d';
  return group
    .filter((s) => skills[s.key])
    .map((s) => {
      const skill = skills[s.key];
      const val = skill.value ?? '?';
      const suffix = s.percent ? '%' : '';
      return `**${s.label}:** Lv ${skill.level ?? '?'} · ${val}${suffix}`;
    })
    .join('\n');
}

const ITEM_NAMES_IT = {
  steel: 'Acciaio',
  iron: 'Ferro',
  oil: 'Petrolio',
  lithium: 'Litio',
  aluminum: 'Alluminio',
  wood: 'Legno',
  stone: 'Pietra',
  food: 'Cibo',
  wheat: 'Grano',
  fish: 'Pesce',
  water: 'Acqua',
  coal: 'Carbone',
  weapons: 'Armi',
  ammo: 'Munizioni',
  fuel: 'Carburante',
};

function itemNameIt(code) {
  if (!code) return 'n/d';
  return ITEM_NAMES_IT[code] ?? code.charAt(0).toUpperCase() + code.slice(1);
}

function numberFmt(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return 'n/d';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

async function resolveUsername(userId) {
  if (!userId) return 'n/d';
  try {
    const user = await warera.getUserLite(userId);
    return user?.username ?? userId;
  } catch {
    return userId;
  }
}

async function resolveCountryName(countryId) {
  if (!countryId) return 'n/d';
  try {
    const country = await warera.getCountryById(countryId);
    return country?.name ?? countryId;
  } catch {
    return countryId;
  }
}

// --- Funzioni di ricerca (usano search.searchAnything: restituisce solo ID,
// gia' ordinati per pertinenza da WarEra, non oggetti con username) --------

async function findUserIdByName(searchTerm) {
  try {
    const results = await warera.raw('search.searchAnything', { searchText: searchTerm });
    const ids = results.userIds || [];
    if (ids.length === 0) {
      console.log(`⚠️ Nessun utente trovato per "${searchTerm}".`);
      return null;
    }
    console.log(`✅ Trovato utente per "${searchTerm}": ${ids[0]}`);
    return ids[0];
  } catch (err) {
    console.error('❌ Errore nella ricerca utente:', err);
    return null;
  }
}

async function findMuIdByName(searchTerm) {
  try {
    const results = await warera.raw('search.searchAnything', { searchText: searchTerm });
    const ids = results.muIds || [];
    if (ids.length === 0) {
      console.log(`⚠️ Nessuna MU trovata per "${searchTerm}".`);
      return null;
    }
    console.log(`✅ Trovata MU per "${searchTerm}": ${ids[0]}`);
    return ids[0];
  } catch (err) {
    console.error('❌ Errore nella ricerca MU:', err);
    return null;
  }
}

async function findRegionIdByName(searchTerm) {
  try {
    const results = await warera.raw('search.searchAnything', { searchText: searchTerm });
    const ids = results.regionIds || [];
    if (ids.length === 0) {
      console.log(`⚠️ Nessuna regione trovata per "${searchTerm}".`);
      return null;
    }
    console.log(`✅ Trovata regione per "${searchTerm}": ${ids[0]}`);
    return ids[0];
  } catch (err) {
    console.error('❌ Errore nella ricerca regione:', err);
    return null;
  }
}

// --- Funzione per costruire l'embed del report MU (riutilizzabile) ---------

async function buildMuReportEmbed(muId, isAutomatic = false) {
  let mu;
  try {
    mu = await warera.getMuById(muId);
  } catch (err) {
    throw new Error(`Impossibile recuperare la MU con ID ${muId}. Verifica che l'ID sia corretto.`);
  }

  const nazioneMu = await resolveCountryName(mu.country);
  const memberIds = mu.members ?? [];
  const members = [];
  let errorCount = 0;

  for (const memberId of memberIds) {
    try {
      const u = await warera.getUserLite(memberId);
      members.push({
        username: u.username ?? memberId,
        weeklyDamage: u.rankings?.weeklyUserDamages?.value ?? null,
        totalDamage: u.rankings?.userDamages?.value ?? null,
        wealth: u.rankings?.userWealth?.value ?? null,
      });
    } catch (err) {
      console.warn(`Impossibile recuperare i dati per l'utente ${memberId}:`, err.message);
      members.push({
        username: memberId,
        weeklyDamage: null,
        totalDamage: null,
        wealth: null,
      });
      errorCount++;
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  const errorMessage = errorCount > 0 ? `\n⚠️ ${errorCount} membro/i non recuperato/i correttamente.` : '';

  // Ordine alfabetico: resta stabile nel tempo, utile per confrontare lo
  // stesso giocatore report dopo report (a differenza dell'ordine per danni).
  members.sort((a, b) => a.username.localeCompare(b.username, 'it', { sensitivity: 'base' }));

  // --- Tabella allineata a colonne, senza bordi laterali ---------------
  const NAME_W = Math.min(16, Math.max(10, ...members.map((m) => m.username.length)));
  const VAL_W = 7;
  const col = (s, len) => String(s).slice(0, len).padEnd(len, ' ');
  const colR = (s, len) => String(s).slice(0, len).padStart(len, ' ');
  const row = (name, v1, v2, v3) =>
    `${col(name, NAME_W)}   ${colR(v1, VAL_W)}   ${colR(v2, VAL_W)}   ${colR(v3, VAL_W)}`;

  const headerRow = row('Nome', 'Sett.', 'Tot.', 'Ricch.');
  const separator = '-'.repeat(headerRow.length);

  const MAX_FIELD_VALUE = 1024;
  const wrap = (lines) => '```\n' + lines.join('\n') + '\n```';

  const memberFields = [];
  let currentLines = [headerRow, separator];

  for (const m of members) {
    const line = row(m.username, numberFmt(m.weeklyDamage), numberFmt(m.totalDamage), numberFmt(m.wealth));
    const candidate = currentLines.concat([line]);
    if (wrap(candidate).length <= MAX_FIELD_VALUE) {
      currentLines = candidate;
    } else {
      memberFields.push({
        name: memberFields.length === 0 ? '📋 Membri (ordine alfabetico)' : '\u200b',
        value: wrap(currentLines),
      });
      currentLines = [headerRow, separator, line];
    }
  }
  if (currentLines.length > 2) {
    memberFields.push({
      name: memberFields.length === 0 ? '📋 Membri (ordine alfabetico)' : '\u200b',
      value: wrap(currentLines),
    });
  }
  if (memberFields.length === 0) {
    memberFields.push({ name: '📋 Membri', value: 'Nessun membro trovato in questa MU.' });
  }

  const hq = mu.activeUpgradeLevels?.headquarters ?? 0;
  const dorm = mu.activeUpgradeLevels?.dormitories ?? 0;
  const r = mu.rankings ?? {};

  const embed = new EmbedBuilder()
    .setTitle(`🛡️ ${mu.name}`)
    .setColor(0xd69e2e)
    .setThumbnail(mu.avatarUrl ?? null)
    .addFields(
      { name: '👥 Membri', value: numberFmt(memberIds.length), inline: true },
      { name: '🌍 Nazionalità', value: nazioneMu, inline: true },
      { name: '🤝 Reputazione mercenaria', value: mu.mercenaryReputation != null ? mu.mercenaryReputation.toFixed(2) : 'n/d', inline: true },
      { name: '💥 Danni settimanali MU', value: numberFmt(r.muWeeklyDamages?.value), inline: true },
      { name: '💥 Danni totali MU', value: numberFmt(r.muDamages?.value), inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '🏢 Quartier generale', value: `Livello ${hq} — ${hq > 0 ? 'Attivo ✅' : 'Non attivo ❌'}`, inline: true },
      { name: '🛌 Dormitori', value: `Livello ${dorm} — ${dorm > 0 ? 'Attivi ✅' : 'Non attivi ❌'}`, inline: true },
      ...memberFields,
    )
    .setFooter({ text: `${isAutomatic ? 'Report automatico' : 'Generato'} il ${new Date().toLocaleString('it-IT')}${errorMessage}` });

  return { embed, members, mu };
}

// --- Funzione helper per convertire date GG-MM-AAAA <-> YYYY-MM-DD ---
function parseItalianDate(dateStr) {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return null;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function formatItalianDate(isoDate) {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

// --- 1. Definizione degli slash command -------------------------------------

const commands = [
  new SlashCommandBuilder()
    .setName('warera-countries')
    .setDescription('Elenca tutte le nazioni di WarEra'),

  new SlashCommandBuilder()
    .setName('warera-country')
    .setDescription('Scheda riassuntiva di una nazione')
    .addStringOption((opt) =>
      opt.setName('nome').setDescription('Nome della nazione (es. Italy)').setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName('warera-user')
    .setDescription('Scheda profilo di un giocatore (cerca per ID o nome)')
    .addStringOption((opt) =>
      opt.setName('cerca')
        .setDescription('ID utente OPPURE nome del giocatore')
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName('warera-mu')
    .setDescription('Scheda riassuntiva di una MU (cerca per ID o nome)')
    .addStringOption((opt) =>
      opt.setName('cerca')
        .setDescription('ID MU OPPURE nome della MU')
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName('warera-mu-report')
    .setDescription('Mostra il report completo della MU con le statistiche di tutti i membri')
    .addStringOption((opt) =>
      opt.setName('id').setDescription('ID della MU (dalla URL della MU)').setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName('warera-region')
    .setDescription('Scheda riassuntiva di una regione (cerca per ID o nome)')
    .addStringOption((opt) =>
      opt.setName('cerca')
        .setDescription('ID regione OPPURE nome della regione')
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName('warera-news')
    .setDescription('Mostra gli ultimi articoli pubblicati su WarEra'),

  new SlashCommandBuilder()
    .setName('warera-raw')
    .setDescription('[Debug] Chiama un endpoint WarEra grezzo e mostra il JSON')
    .addStringOption((opt) =>
      opt
        .setName('endpoint')
        .setDescription('es. user.getUserLite, mu.getById, region.getById')
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName('parametri')
        .setDescription('JSON dei parametri, es. {"userId":"123"} (default {})')
        .setRequired(false),
    )
    .addStringOption((opt) =>
      opt
        .setName('campo')
        .setDescription('Path del campo da isolare, es. "rankings". Vuoto = elenco chiavi.')
        .setRequired(false),
    )
    .addStringOption((opt) =>
      opt
        .setName('metodo')
        .setDescription('GET (default) o POST — alcuni endpoint come company.getCompanies richiedono POST')
        .setRequired(false)
        .addChoices({ name: 'GET', value: 'GET' }, { name: 'POST', value: 'POST' }),
    ),

  new SlashCommandBuilder()
    .setName('report')
    .setDescription('Invia manualmente il report della MU configurata (MOSTRA TUTTI I MEMBRI)'),

  new SlashCommandBuilder()
    .setName('confronta')
    .setDescription('Confronta due report salvati di giorni diversi')
    .addStringOption((opt) =>
      opt.setName('data1')
        .setDescription('Prima data (formato GG-MM-AAAA, es. 07-09-2026)')
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName('data2')
        .setDescription('Seconda data (formato GG-MM-AAAA, es. 08-09-2026)')
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName('forza-report')
    .setDescription('[TEST] Salva manualmente un report per una data specifica')
    .addStringOption((opt) =>
      opt.setName('data')
        .setDescription('Data nel formato GG-MM-AAAA (es. 06-09-2026)')
        .setRequired(true),
    ),
].map((c) => c.toJSON());

// --- 2. Registrazione dei comandi su Discord --------------------------------

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  const route = GUILD_ID
    ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
    : Routes.applicationCommands(CLIENT_ID);

  await rest.put(route, { body: commands });
  console.log(`Slash command registrati ${GUILD_ID ? `sul server ${GUILD_ID}` : 'globalmente'}.`);
}

// --- 3. Client Discord e gestione delle interazioni -------------------------

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ------------------- VARIABILI PER IL REPORT AUTOMATICO -------------------
const REPORT_CHANNEL_ID = process.env.REPORT_CHANNEL_ID;
const MU_ID = process.env.MU_ID;

// ------------------- FUNZIONE PER INVIARE IL REPORT (AUTOMATICO) ---------
async function sendAutomaticReport() {
  if (!REPORT_CHANNEL_ID) {
    console.error('❌ REPORT_CHANNEL_ID non configurato!');
    return;
  }
  if (!MU_ID) {
    console.error('❌ MU_ID non configurato!');
    return;
  }

  try {
    const channel = client.channels.cache.get(REPORT_CHANNEL_ID);
    if (!channel) {
      console.error(`❌ Canale ${REPORT_CHANNEL_ID} non trovato!`);
      return;
    }

    console.log('⏰ Generazione report automatico delle 9:00...');
    const { embed, members, mu } = await buildMuReportEmbed(MU_ID, true);
    
    const reportData = {
      date: new Date().toISOString().split('T')[0],
      timestamp: new Date().toISOString(),
      mu: {
        id: MU_ID,
        name: mu.name,
        country: mu.country,
        memberCount: mu.members?.length || 0,
        weeklyDamage: mu.rankings?.muWeeklyDamages?.value || 0,
        totalDamage: mu.rankings?.muDamages?.value || 0,
        reputation: mu.mercenaryReputation || 0,
      },
      members: members.map(m => ({
        username: m.username,
        weeklyDamage: m.weeklyDamage,
        totalDamage: m.totalDamage,
        wealth: m.wealth,
      }))
    };

    const reportsPath = './reports.json';
    let reports = [];
    if (fs.existsSync(reportsPath)) {
      const content = fs.readFileSync(reportsPath, 'utf8');
      reports = JSON.parse(content);
    }
    
    const existingIndex = reports.findIndex(r => r.date === reportData.date);
    if (existingIndex >= 0) {
      reports[existingIndex] = reportData;
    } else {
      reports.push(reportData);
    }
    fs.writeFileSync(reportsPath, JSON.stringify(reports, null, 2));

    await channel.send({ embeds: [embed] });
    console.log(`✅ Report automatico inviato e salvato per il ${reportData.date}`);

  } catch (error) {
    console.error('❌ Errore nel report automatico:', error);
  }
}

// ------------------- QUANDO IL BOT È PRONTO --------------------------------
client.once('ready', () => {
  console.log(`✅ Bot connesso come ${client.user.tag}`);

  // --- Programma il report giornaliero alle 9:00 (UNA SOLA VOLTA) con fuso orario ITALIANO ---
  if (REPORT_CHANNEL_ID && MU_ID) {
    cron.schedule('0 9 * * *', async () => {
      await sendAutomaticReport();
    }, {
      timezone: 'Europe/Rome'  // Imposta il fuso orario italiano
    });
    console.log('⏰ Report automatico programmato per le 9:00 ogni giorno (fuso orario: Europe/Rome)');
  } else {
    console.warn('⚠️ Report automatico NON programmato: mancano REPORT_CHANNEL_ID o MU_ID');
  }
});

// ------------------- GESTIONE DEI COMANDI SLASH ----------------------------
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    // --- /warera-countries ---------------------------------------------
    if (interaction.commandName === 'warera-countries') {
      await interaction.deferReply();
      const countries = await warera.getAllCountries();
      const names = countries.slice(0, 40).map((c) => c.name).join(', ');
      await interaction.editReply(`**Nazioni (prime 40):** ${names}`);
    }

    // --- /warera-country --------------------------------------------------
    if (interaction.commandName === 'warera-country') {
      await interaction.deferReply();
      const nome = interaction.options.getString('nome');
      const countries = await warera.getAllCountries();
      const match = countries.find((c) => c.name.toLowerCase() === nome.toLowerCase());
      if (!match) {
        await interaction.editReply(`Nessuna nazione trovata con nome "${nome}".`);
        return;
      }
      const country = await warera.getCountryById(match._id);

      let government = null;
      try {
        government = await warera.getGovernmentByCountryId(country._id);
      } catch {}

      let ethicsText = 'n/d';
      if (country.rulingParty) {
        try {
          const party = await warera.getPartyById(country.rulingParty);
          ethicsText = formatEthics(party.ethics);
        } catch {}
      }

      const [presidente, vicePresidente, ministroDifesa, ministroEsteri, ministroEconomia] =
        government
          ? await Promise.all([
              resolveUsername(government.president),
              resolveUsername(government.vicePresident),
              resolveUsername(government.minOfDefense),
              resolveUsername(government.minOfForeignAffairs),
              resolveUsername(government.minOfEconomy),
            ])
          : ['n/d', 'n/d', 'n/d', 'n/d', 'n/d'];

      const embed = new EmbedBuilder()
        .setTitle(`🏳️ ${country.name}`)
        .setColor(0x2b6cb0)
        .addFields(
          { name: '👥 Popolazione', value: numberFmt(country.currentPopulation), inline: true },
          { name: '🟢 Giocatori attivi', value: numberFmt(country.rankings?.countryActivePopulation?.value), inline: true },
          { name: '🏛️ Congresso', value: numberFmt(government?.congressMembers?.length), inline: true },
          {
            name: '👑 Governo',
            value:
              `**Presidente:** ${presidente}\n` +
              `**Vicepresidente:** ${vicePresidente}\n` +
              `**Min. Difesa:** ${ministroDifesa}\n` +
              `**Min. Esteri:** ${ministroEsteri}\n` +
              `**Min. Economia:** ${ministroEconomia}`,
          },
          { name: '⚖️ Etiche del partito', value: ethicsText },
          { name: '🏭 Specializzazione', value: itemNameIt(country.specializedItem), inline: true },
          { name: '📈 Bonus produzione', value: `${country.strategicResources?.bonuses?.productionPercent ?? 0}%`, inline: true },
          {
            name: '💰 Tassazione',
            value:
              `Reddito: ${country.taxes?.income ?? 0}%  ·  ` +
              `Mercato: ${country.taxes?.market ?? 0}%  ·  ` +
              `Lavoro autonomo: ${country.taxes?.selfWork ?? 0}%`,
          },
        );
      await interaction.editReply({ embeds: [embed] });
    }

    // --- /warera-user (cerca per ID o nome) ------------------------------
    if (interaction.commandName === 'warera-user') {
      await interaction.deferReply();
      const searchTerm = interaction.options.getString('cerca');
      
      const isId = /^[0-9a-fA-F]{24}$/.test(searchTerm); // ID WarEra = 24 caratteri esadecimali (MongoDB ObjectId)
      let userId = searchTerm;
      let usedName = null;
      
      if (!isId) {
        const foundId = await findUserIdByName(searchTerm);
        if (!foundId) {
          await interaction.editReply(`❌ Nessun giocatore trovato con il nome "${searchTerm}".\n📌 Se il nome contiene caratteri speciali (es. _), prova con l'ID.`);
          return;
        }
        userId = foundId;
        usedName = searchTerm;
      }
      
      try {
        const user = await warera.getUserLite(userId);
        
        const [nazione, muNome] = await Promise.all([
          resolveCountryName(user.country),
          user.mu ? warera.getMuById(user.mu).then((m) => m?.name ?? user.mu).catch(() => user.mu) : 'Nessuna',
        ]);

        // Aziende: prima l'elenco degli ID, poi i dettagli di ciascuna
        // (massimo 12 aziende per giocatore nel gioco).
        let aziendeText = 'Nessuna azienda';
        try {
          const companiesList = await warera.getCompaniesByUserId(userId, 20);
          const companyIds = (companiesList.items ?? []).slice(0, 12);
          if (companyIds.length > 0) {
            const companies = await Promise.all(
              companyIds.map((id) => warera.getCompanyById(id).catch(() => null)),
            );
            aziendeText = companies
              .filter(Boolean)
              .map((c) => {
                const lvl = c.activeUpgradeLevels ?? {};
                const stato = c.disabledAt ? 'Disabilitata ❌' : 'Attiva ✅';
                return (
                  `**${itemNameIt(c.itemCode) ?? c.name ?? 'n/d'}** — ${stato}\n` +
                  `Magazzino Lv${lvl.storage ?? 0}, Automazione Lv${lvl.automatedEngine ?? 0}, ` +
                  `Dipendenti: ${c.workerCount ?? 0}`
                );
              })
              .join('\n');
            if (!aziendeText) aziendeText = 'Nessuna azienda';
          }
        } catch {
          aziendeText = 'n/d (errore nel recupero)';
        }

        const r = user.rankings ?? {};
        const embed = new EmbedBuilder()
          .setTitle(`🪖 ${user.username ?? userId}`)
          .setColor(0x38a169)
          .setThumbnail(user.avatarUrl ?? null)
          .addFields(
            { name: '🌍 Nazionalità', value: nazione, inline: true },
            { name: '⚔️ MU', value: muNome, inline: true },
            { name: '⭐ Livello', value: numberFmt(user.leveling?.level), inline: true },
            { name: '💰 Ricchezza totale', value: numberFmt(r.userWealth?.value), inline: true },
            { name: '💥 Danni settimanali', value: numberFmt(r.weeklyUserDamages?.value), inline: true },
            { name: '💥 Danni totali', value: numberFmt(r.userDamages?.value), inline: true },
            { name: '⚔️ Abilità di combattimento', value: formatSkillGroup(user.skills, COMBAT_SKILLS) },
            { name: '💼 Abilità economiche', value: formatSkillGroup(user.skills, ECONOMIC_SKILLS) },
            { name: '🏭 Aziende', value: aziendeText },
          )
          .setFooter({ text: usedName ? `Ricerca per nome: "${usedName}"` : `ID: ${userId}` });
          
        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error(error);
        await interaction.editReply(`❌ Errore nel recuperare i dati. Verifica che ${isId ? 'l\'ID' : 'il nome'} sia corretto.`);
      }
    }

    // --- /warera-mu (cerca per ID o nome) --------------------------------
    if (interaction.commandName === 'warera-mu') {
      await interaction.deferReply();
      const searchTerm = interaction.options.getString('cerca');
      
      const isId = /^[0-9a-fA-F]{24}$/.test(searchTerm); // ID WarEra = 24 caratteri esadecimali (MongoDB ObjectId)
      let muId = searchTerm;
      let usedName = null;
      
      if (!isId) {
        const foundId = await findMuIdByName(searchTerm);
        if (!foundId) {
          await interaction.editReply(`❌ Nessuna MU trovata con il nome "${searchTerm}".\n📌 Se il nome contiene caratteri speciali, prova con l'ID.`);
          return;
        }
        muId = foundId;
        usedName = searchTerm;
      }
      
      try {
        const mu = await warera.getMuById(muId);
        const nazione = await resolveCountryName(mu.country);

        const r = mu.rankings ?? {};
        const hq = mu.activeUpgradeLevels?.headquarters ?? 0;
        const dorm = mu.activeUpgradeLevels?.dormitories ?? 0;

        const embed = new EmbedBuilder()
          .setTitle(`🛡️ ${mu.name}`)
          .setColor(0xd69e2e)
          .setThumbnail(mu.avatarUrl ?? null)
          .addFields(
            { name: '👥 Membri', value: numberFmt(mu.members?.length), inline: true },
            { name: '🌍 Nazionalità', value: nazione, inline: true },
            { name: '🤝 Reputazione mercenaria', value: mu.mercenaryReputation != null ? mu.mercenaryReputation.toFixed(2) : 'n/d', inline: true },
            { name: '💥 Danni settimanali', value: numberFmt(r.muWeeklyDamages?.value), inline: true },
            { name: '💥 Danni totali', value: numberFmt(r.muDamages?.value), inline: true },
            { name: '🏢 Quartier generale', value: `Livello ${hq} — ${hq > 0 ? 'Attivo ✅' : 'Non attivo ❌'}` },
            { name: '🛌 Dormitori', value: `Livello ${dorm} — ${dorm > 0 ? 'Attivi ✅' : 'Non attivi ❌'}` },
          )
          .setFooter({ text: usedName ? `Ricerca per nome: "${usedName}"` : `ID: ${muId}` });

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error(error);
        await interaction.editReply(`❌ Errore nel recuperare i dati. Verifica che ${isId ? 'l\'ID' : 'il nome'} sia corretto.`);
      }
    }

    // --- /warera-mu-report ----------------------------------------------
    if (interaction.commandName === 'warera-mu-report') {
      await interaction.deferReply();
      const id = interaction.options.getString('id');
      try {
        const { embed } = await buildMuReportEmbed(id, false);
        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        await interaction.editReply(`❌ ${err.message}`);
      }
    }

    // --- /warera-region (cerca per ID o nome) -----------------------------
    if (interaction.commandName === 'warera-region') {
      await interaction.deferReply();
      const searchTerm = interaction.options.getString('cerca');
      
      const isId = /^[0-9a-fA-F]{24}$/.test(searchTerm); // ID WarEra = 24 caratteri esadecimali (MongoDB ObjectId)
      let regionId = searchTerm;
      let usedName = null;
      
      if (!isId) {
        const foundId = await findRegionIdByName(searchTerm);
        if (!foundId) {
          await interaction.editReply(`❌ Nessuna regione trovata con il nome "${searchTerm}".\n📌 Se il nome contiene caratteri speciali, prova con l'ID.`);
          return;
        }
        regionId = foundId;
        usedName = searchTerm;
      }
      
      try {
        const region = await warera.getRegionById(regionId);

        const [nazioneOriginale, nazioneAttuale] = await Promise.all([
          resolveCountryName(region.initialCountry),
          resolveCountryName(region.country),
        ]);

        const bunker = region.activeUpgradeLevels?.bunker ?? 0;
        const baseLevel = region.activeUpgradeLevels?.base ?? 0;

        const embed = new EmbedBuilder()
          .setTitle(`🗺️ ${region.name}`)
          .setColor(0x805ad5)
          .addFields(
            { name: '🏳️ Nazione di appartenenza', value: nazioneOriginale, inline: true },
            { name: '🚩 Nazione attuale', value: nazioneAttuale, inline: true },
            { name: '🛡️ Bunker', value: `Livello ${bunker} — ${bunker > 0 ? 'Attivo ✅' : 'Non attivo ❌'}` },
            {
              name: '🎖️ Base Militare',
              value: `Livello ${baseLevel} — ${baseLevel > 0 ? 'Attiva ✅' : 'Non attiva ❌'}`,
            },
          )
          .setFooter({ text: usedName ? `Ricerca per nome: "${usedName}"` : `ID: ${regionId}` });

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error(error);
        await interaction.editReply(`❌ Errore nel recuperare i dati. Verifica che ${isId ? 'l\'ID' : 'il nome'} sia corretto.`);
      }
    }

    // --- /warera-news -------------------------------------------------------
    if (interaction.commandName === 'warera-news') {
      await interaction.deferReply();
      const result = await warera.getLatestArticles(5);
      const items = result.items ?? result;
      const list = items
        .slice(0, 5)
        .map((a) => `• ${a.title ?? a.name ?? a._id}`)
        .join('\n');
      await interaction.editReply(`**Ultimi articoli:**\n${list}`);
    }

    // --- /warera-raw (debug) -------------------------------------------------
    if (interaction.commandName === 'warera-raw') {
      await interaction.deferReply();
      const endpoint = interaction.options.getString('endpoint');
      const paramsStr = interaction.options.getString('parametri') || '{}';
      const campo = interaction.options.getString('campo');
      const metodo = interaction.options.getString('metodo') || 'GET';
      let params;
      try {
        params = JSON.parse(paramsStr);
      } catch {
        await interaction.editReply('I "parametri" devono essere un JSON valido, es. {"userId":"123"}');
        return;
      }
      const data = metodo === 'POST' ? await warera.rawPost(endpoint, params) : await warera.raw(endpoint, params);
      const base = Array.isArray(data) ? data[0] : data;

      let output;
      if (!campo) {
        const keys = base && typeof base === 'object' ? Object.keys(base) : [];
        output =
          `Chiavi disponibili${Array.isArray(data) ? ' (nel primo elemento)' : ''}:\n` +
          keys.map((k) => `• ${k}`).join('\n');
      } else {
        const value = campo
          .split('.')
          .reduce((acc, key) => (acc == null ? undefined : acc[key]), base);
        let json = JSON.stringify(value, null, 2);
        if (json === undefined) json = 'undefined (campo non trovato)';
        if (json.length > 1800) {
          if (value && typeof value === 'object') {
            const keys = Array.isArray(value)
              ? value.map((_, i) => String(i))
              : Object.keys(value);
            json =
              `(troppo grande per essere mostrato per intero, ${keys.length} chiavi)\n` +
              keys.map((k) => `• ${k}`).join('\n');
          } else {
            json = json.slice(0, 1800) + '\n... (troncato)';
          }
        }
        output = '```\n' + json + '\n```';
      }
      await interaction.editReply(output);
    }

    // ------------------- COMANDO /REPORT (MANUALE) -------------------------
    if (interaction.commandName === 'report') {
      await interaction.deferReply({ ephemeral: true });

      if (!MU_ID) {
        await interaction.editReply('❌ MU_ID non configurato nelle variabili d\'ambiente!');
        return;
      }

      try {
        const { embed, members, mu } = await buildMuReportEmbed(MU_ID, false);
        
        const reportData = {
          date: new Date().toISOString().split('T')[0],
          timestamp: new Date().toISOString(),
          mu: {
            id: MU_ID,
            name: mu.name,
            country: mu.country,
            memberCount: mu.members?.length || 0,
            weeklyDamage: mu.rankings?.muWeeklyDamages?.value || 0,
            totalDamage: mu.rankings?.muDamages?.value || 0,
            reputation: mu.mercenaryReputation || 0,
          },
          members: members.map(m => ({
            username: m.username,
            weeklyDamage: m.weeklyDamage,
            totalDamage: m.totalDamage,
            wealth: m.wealth,
          }))
        };

        const reportsPath = './reports.json';
        let reports = [];
        if (fs.existsSync(reportsPath)) {
          const content = fs.readFileSync(reportsPath, 'utf8');
          reports = JSON.parse(content);
        }
        
        const existingIndex = reports.findIndex(r => r.date === reportData.date);
        if (existingIndex >= 0) {
          reports[existingIndex] = reportData;
        } else {
          reports.push(reportData);
        }
        fs.writeFileSync(reportsPath, JSON.stringify(reports, null, 2));

        await interaction.channel.send({ embeds: [embed] });
        await interaction.editReply('✅ Report inviato e salvato con successo!');
      } catch (err) {
        await interaction.editReply(`❌ ${err.message}`);
      }
    }

    // ------------------- COMANDO /CONFRONTA (GG-MM-AAAA) ---------------------
    if (interaction.commandName === 'confronta') {
      await interaction.deferReply({ ephemeral: true });

      try {
        const data1Input = interaction.options.getString('data1');
        const data2Input = interaction.options.getString('data2');

        const data1 = parseItalianDate(data1Input);
        const data2 = parseItalianDate(data2Input);
        if (!data1 || !data2) {
          await interaction.editReply('❌ Formato data non valido. Usa GG-MM-AAAA (es. 07-09-2026)');
          return;
        }

        const reportsPath = './reports.json';
        if (!fs.existsSync(reportsPath)) {
          await interaction.editReply('❌ Nessun report salvato! Usa `/report` per generare un report.');
          return;
        }

        const content = fs.readFileSync(reportsPath, 'utf8');
        const reports = JSON.parse(content);

        if (reports.length === 0) {
          await interaction.editReply('❌ Nessun report salvato! Usa `/report` per generare un report.');
          return;
        }

        const report1 = reports.find(r => r.date === data1);
        const report2 = reports.find(r => r.date === data2);

        if (!report1) {
          await interaction.editReply(`❌ Nessun report trovato per la data **${formatItalianDate(data1)}**.`);
          return;
        }
        if (!report2) {
          await interaction.editReply(`❌ Nessun report trovato per la data **${formatItalianDate(data2)}**.`);
          return;
        }

        const mu1 = report1.mu;
        const mu2 = report2.mu;
        const members1 = report1.members || [];
        const members2 = report2.members || [];

        const usernames1 = new Set(members1.map(m => m.username));
        const usernames2 = new Set(members2.map(m => m.username));

        const newMembers = members2.filter(m => !usernames1.has(m.username));
        const leftMembers = members1.filter(m => !usernames2.has(m.username));

        const diff = {
          members: mu2.memberCount - mu1.memberCount,
          weeklyDamage: mu2.weeklyDamage - mu1.weeklyDamage,
          totalDamage: mu2.totalDamage - mu1.totalDamage,
          reputation: mu2.reputation - mu1.reputation,
        };

        const newList = newMembers.slice(0, 10).map(m => `• ${m.username}`).join('\n') || 'Nessuno';
        const leftList = leftMembers.slice(0, 10).map(m => `• ${m.username}`).join('\n') || 'Nessuno';

        const embed = new EmbedBuilder()
          .setTitle(`📊 Confronto Report MU: ${mu1.name}`)
          .setColor(0xFFAA00)
          .addFields(
            {
              name: '📅 Date confrontate',
              value: `**${formatItalianDate(data1)}** → **${formatItalianDate(data2)}**`,
              inline: false
            },
            {
              name: '👥 Membri',
              value: `${mu1.memberCount} → ${mu2.memberCount} (${diff.members > 0 ? '+' : ''}${diff.members})`,
              inline: true
            },
            {
              name: '💥 Danni settimanali',
              value: `${numberFmt(mu1.weeklyDamage)} → ${numberFmt(mu2.weeklyDamage)} (${diff.weeklyDamage > 0 ? '+' : ''}${numberFmt(diff.weeklyDamage)})`,
              inline: true
            },
            {
              name: '💥 Danni totali',
              value: `${numberFmt(mu1.totalDamage)} → ${numberFmt(mu2.totalDamage)} (${diff.totalDamage > 0 ? '+' : ''}${numberFmt(diff.totalDamage)})`,
              inline: true
            },
            {
              name: '🤝 Reputazione',
              value: `${mu1.reputation?.toFixed(2) || 0} → ${mu2.reputation?.toFixed(2) || 0} (${diff.reputation > 0 ? '+' : ''}${diff.reputation?.toFixed(2) || 0})`,
              inline: true
            },
            {
              name: '🟢 Nuovi membri (entrati)',
              value: newList,
              inline: true
            },
            {
              name: '🔴 Membri usciti',
              value: leftList,
              inline: true
            }
          )
          .setFooter({
            text: `Report salvati: ${reports.length} giorni disponibili`
          })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

      } catch (error) {
        console.error('❌ Errore nel confronto:', error);
        await interaction.editReply(`❌ Errore: ${error.message}`);
      }
    }

    // ------------------- COMANDO /FORZA-REPORT (TEST) ------------------------
    if (interaction.commandName === 'forza-report') {
      await interaction.deferReply({ ephemeral: true });

      if (!MU_ID) {
        await interaction.editReply('❌ MU_ID non configurato!');
        return;
      }

      try {
        const dataInput = interaction.options.getString('data');
        const data = parseItalianDate(dataInput);
        if (!data) {
          await interaction.editReply('❌ Formato data non valido. Usa GG-MM-AAAA (es. 06-09-2026)');
          return;
        }

        const mu = await warera.getMuById(MU_ID);
        const members = [];
        for (const memberId of (mu.members || [])) {
          try {
            const u = await warera.getUserLite(memberId);
            members.push({
              username: u.username ?? memberId,
              weeklyDamage: u.rankings?.weeklyUserDamages?.value ?? null,
              totalDamage: u.rankings?.userDamages?.value ?? null,
              wealth: u.rankings?.userWealth?.value ?? null,
            });
          } catch {
            members.push({ username: memberId, weeklyDamage: null, totalDamage: null, wealth: null });
          }
          await new Promise(r => setTimeout(r, 250));
        }

        const reportData = {
          date: data,
          timestamp: new Date().toISOString(),
          mu: {
            id: MU_ID,
            name: mu.name,
            country: mu.country,
            memberCount: mu.members?.length || 0,
            weeklyDamage: mu.rankings?.muWeeklyDamages?.value || 0,
            totalDamage: mu.rankings?.muDamages?.value || 0,
            reputation: mu.mercenaryReputation || 0,
          },
          members: members.map(m => ({
            username: m.username,
            weeklyDamage: m.weeklyDamage,
            totalDamage: m.totalDamage,
            wealth: m.wealth,
          }))
        };

        const reportsPath = './reports.json';
        let reports = [];
        if (fs.existsSync(reportsPath)) {
          const content = fs.readFileSync(reportsPath, 'utf8');
          reports = JSON.parse(content);
        }
        
        const existingIndex = reports.findIndex(r => r.date === data);
        if (existingIndex >= 0) {
          reports[existingIndex] = reportData;
        } else {
          reports.push(reportData);
        }
        fs.writeFileSync(reportsPath, JSON.stringify(reports, null, 2));

        await interaction.editReply(`✅ Report salvato con successo per la data **${formatItalianDate(data)}**! Ora puoi usare \`/confronta\`.`);
      } catch (err) {
        await interaction.editReply(`❌ ${err.message}`);
      }
    }
  } catch (err) {
    console.error(err);
    const msg = `Errore nel contattare WarEra: ${err.message}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(msg);
    } else {
      await interaction.reply({ content: msg, ephemeral: true });
    }
  }
});

// --- 4. Avvio ---------------------------------------------------------------

(async () => {
  await registerCommands();
  await client.login(DISCORD_TOKEN);
})();
