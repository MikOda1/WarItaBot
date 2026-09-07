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
    .setDescription('Scheda profilo di un giocatore')
    .addStringOption((opt) =>
      opt.setName('id').setDescription('ID utente WarEra (dalla URL del profilo)').setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName('warera-mu')
    .setDescription('Scheda riassuntiva di una MU (unità militare)')
    .addStringOption((opt) =>
      opt.setName('id').setDescription('ID della MU (dalla URL della MU)').setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName('warera-mu-report')
    .setDescription('Esporta un report Excel della MU con le statistiche di tutti i membri')
    .addStringOption((opt) =>
      opt.setName('id').setDescription('ID della MU (dalla URL della MU)').setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName('warera-region')
    .setDescription('Scheda riassuntiva di una regione')
    .addStringOption((opt) =>
      opt.setName('id').setDescription('ID della regione (dalla URL della regione)').setRequired(true),
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

client.once('ready', () => {
  console.log(`Bot connesso come ${client.user.tag}`);
});

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
          { name: '🏭 Specializzazione', value: String(country.specializedItem ?? 'n/d'), inline: true },
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

    // --- /warera-user -------------------------------------------------------
    if (interaction.commandName === 'warera-user') {
      await interaction.deferReply();
      const id = interaction.options.getString('id');
      const user = await warera.getUserLite(id);

      const [nazione, muNome] = await Promise.all([
        resolveCountryName(user.country),
        user.mu ? warera.getMuById(user.mu).then((m) => m?.name ?? user.mu).catch(() => user.mu) : 'Nessuna',
      ]);

      const r = user.rankings ?? {};
      const embed = new EmbedBuilder()
        .setTitle(`🪖 ${user.username ?? id}`)
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
          { name: '🏭 Aziende', value: 'Non disponibile pubblicamente via API (dato privato)' },
        );
      await interaction.editReply({ embeds: [embed] });
    }

    // --- /warera-mu -----------------------------------------------------
    if (interaction.commandName === 'warera-mu') {
      await interaction.deferReply();
      const id = interaction.options.getString('id');
      const mu = await warera.getMuById(id);
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
        );
      await interaction.editReply({ embeds: [embed] });
    }

    // --- /warera-mu-report (riepilogo embed) ------------------------------
    if (interaction.commandName === 'warera-mu-report') {
      await interaction.deferReply();

      const id = interaction.options.getString('id');

      let mu;
      try {
        mu = await warera.getMuById(id);
      } catch (err) {
        console.error(`Errore nel recuperare la MU ${id}:`, err.message);
        await interaction.editReply(`❌ Impossibile recuperare la MU con ID \`${id}\`. Verifica che l'ID sia corretto e che la MU esista.`);
        return;
      }

      const nazioneMu = await resolveCountryName(mu.country);

      // Recupero membri
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

      // Ordine alfabetico
      members.sort((a, b) => a.username.localeCompare(b.username, 'it', { sensitivity: 'base' }));

      // --- Costruzione tabella senza bordi, con nomi completi ---
      const maxNameLen = Math.max(10, ...members.map(m => m.username.length));
      const NAME_W = maxNameLen;
      const VAL_W = 7;
      const col = (s, len) => String(s).slice(0, len).padEnd(len, ' ');
      const colR = (s, len) => String(s).slice(0, len).padStart(len, ' ');
      const row = (name, v1, v2, v3) =>
        `${col(name, NAME_W)}   ${colR(v1, VAL_W)}   ${colR(v2, VAL_W)}   ${colR(v3, VAL_W)}`;

      const headerRow = row('Nome', 'Sett.', 'Tot.', 'Ricch.');
      const separator = '-'.repeat(headerRow.length);

      // --- Generazione campi embed rispettando il limite di 1024 caratteri ---
      const MAX_FIELD_VALUE = 1024;
      const memberFields = [];

      // Funzione per ottenere il valore completo del campo (con backtick)
      function getChunkValue(lines) {
        return '```\n' + lines.join('\n') + '\n```';
      }

      // Inizia con intestazione e separatore
      let currentLines = [headerRow, separator];
      let currentLength = getChunkValue(currentLines).length;

      for (const m of members) {
        const line = row(m.username, numberFmt(m.weeklyDamage), numberFmt(m.totalDamage), numberFmt(m.wealth));
        const potentialLines = currentLines.concat([line]);
        const potentialValue = getChunkValue(potentialLines);

        if (potentialValue.length <= MAX_FIELD_VALUE) {
          currentLines.push(line);
        } else {
          // Salva il chunk corrente
          memberFields.push({
            name: memberFields.length === 0 ? '📋 Membri (ordine alfabetico)' : '\u200b',
            value: getChunkValue(currentLines),
          });
          // Inizia nuovo chunk con intestazione, separatore e la riga corrente
          currentLines = [headerRow, separator, line];
        }
      }

      // Aggiungi l'ultimo chunk (se contiene almeno intestazione + separatore + almeno un membro)
      if (currentLines.length > 2) {
        memberFields.push({
          name: memberFields.length === 0 ? '📋 Membri (ordine alfabetico)' : '\u200b',
          value: getChunkValue(currentLines),
        });
      }

      // Se non ci sono membri, mostra un messaggio
      if (memberFields.length === 0) {
        memberFields.push({
          name: '📋 Membri',
          value: 'Nessun membro trovato in questa MU.',
        });
      }

      // --- Costruzione embed finale ---
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
        .setFooter({ text: `Generato il ${new Date().toLocaleString('it-IT')}${errorMessage}` });

      await interaction.editReply({ embeds: [embed] });
    }

    // --- /warera-region ---------------------------------------------------
    if (interaction.commandName === 'warera-region') {
      await interaction.deferReply();
      const id = interaction.options.getString('id');
      const region = await warera.getRegionById(id);

      const [nazioneOriginale, nazioneAttuale] = await Promise.all([
        resolveCountryName(region.initialCountry),
        resolveCountryName(region.country),
      ]);

      const bunker = region.activeUpgradeLevels?.bunker ?? 0;

      const embed = new EmbedBuilder()
        .setTitle(`🗺️ ${region.name}`)
        .setColor(0x805ad5)
        .addFields(
          { name: '🏳️ Nazione di appartenenza', value: nazioneOriginale, inline: true },
          { name: '🚩 Nazione attuale', value: nazioneAttuale, inline: true },
          { name: '🛡️ Bunker', value: `Livello ${bunker} — ${bunker > 0 ? 'Attivo ✅' : 'Non attivo ❌'}` },
          { name: '🎖️ Base Militare', value: 'Non ancora individuata via API pubblica (usa /warera-raw per riprovare)' },
        );
      await interaction.editReply({ embeds: [embed] });
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
      let params;
      try {
        params = JSON.parse(paramsStr);
      } catch {
        await interaction.editReply('I "parametri" devono essere un JSON valido, es. {"userId":"123"}');
        return;
      }
      const data = await warera.raw(endpoint, params);
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