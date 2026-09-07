# WarEra Discord Bot

Bot Discord in Node.js (discord.js v14) che interroga l'API pubblica (non
ufficiale) di WarEra per rispondere a slash command come `/warera-country`,
`/warera-user`, `/warera-news`.

## 1. Crea il bot su Discord

1. Vai su https://discord.com/developers/applications e clicca **New Application**.
2. Nel menu a sinistra apri **Bot** → **Reset Token** → copia il token
   (andrà in `DISCORD_TOKEN`). Non condividerlo mai pubblicamente.
3. In **General Information** copia l'**Application ID** (va in `CLIENT_ID`).
4. Vai su **OAuth2 → URL Generator**, seleziona gli scope `bot` e
   `applications.commands`, come permessi almeno `Send Messages` e
   `Use Slash Commands`. Copia l'URL generato e aprilo nel browser per
   invitare il bot sul tuo server.
5. (Facoltativo, consigliato in sviluppo) Copia l'ID del tuo server
   (tasto destro sull'icona del server con la modalità sviluppatore attiva)
   e mettilo in `GUILD_ID`: così i comandi compaiono subito, invece di
   aspettare fino a un'ora come per i comandi globali.

## 2. Configura il progetto

```bash
npm install
cp .env.example .env
# apri .env e incolla DISCORD_TOKEN, CLIENT_ID, GUILD_ID
```

## 3. Avvia il bot

```bash
npm start
```

Al primo avvio il bot registra automaticamente gli slash command; poi resta
in ascolto delle interazioni.

## 4. Come funziona il collegamento a WarEra

L'API di WarEra non è un REST tradizionale ma un'API **tRPC**, esposta su
`https://api2.warera.io/trpc`. Ogni chiamata è una GET del tipo:

```
GET https://api2.warera.io/trpc/<namespace>.<procedura>?input=<JSON URL-encoded>
```

es.

```
GET https://api2.warera.io/trpc/country.getAllCountries?input=%7B%7D
```

La risposta è `{ "result": { "data": ... } }` in caso di successo, oppure
`{ "error": { ... } }` in caso di errore. Tutto questo è incapsulato in
`src/warera.js`, che espone:

- `warera.getAllCountries()`
- `warera.getCountryById(countryId)`
- `warera.getUserLite(userId)`
- `warera.getLatestArticles(limit)`
- `warera.raw(endpoint, params)` — chiamata generica a **qualsiasi**
  endpoint, utile per aggiungere nuovi comandi.

### Dove trovare altri endpoint

- Documentazione interattiva (schema auto-generato dal server):
  https://api2.warera.io/docs
- Repository community con endpoint mappati, utili come riferimento:
  - https://github.com/majimawrks/warera-fetch (Python, elenco comandi/endpoint)
  - https://github.com/WarEraProjects/api-client-py (client Python con tutti i namespace)
  - https://github.com/gsipos/warera-tools (dashboard web che usa l'API)

  ⚠️ Sono progetti di terze parti non ufficiali: verifica sempre il nome
  esatto degli endpoint e i parametri sui docs live prima di affidarti al
  codice di un bot in produzione.

### Autenticazione (opzionale)

Molti endpoint di lettura funzionano senza autenticazione. Alcuni (ranking,
referral, rate limit più alti) richiedono una API key, generabile in
WarEra da **Impostazioni → API Tokens**, da mettere in `WARERA_API_KEY`
nel file `.env`. Il wrapper la invia automaticamente come header
`X-API-Key`.

### Attenzione ai limiti di richieste

L'API applica un **rate limit**. Se ricevi errori HTTP 429, aggiungi un
ritardo tra le chiamate o implementa un retry con backoff (vedi l'esempio
nei repository community linkati sopra).

## 5. Aggiungere nuovi comandi

Per aggiungere un nuovo slash command:

1. Aggiungi una nuova entry a `commands` in `src/index.js`
   (con `SlashCommandBuilder`).
2. Aggiungi la logica corrispondente nel gestore `interactionCreate`.
3. Se ti serve un endpoint non ancora presente in `src/warera.js`, usa
   `warera.raw('namespace.metodo', { parametro: valore })` per testarlo
   rapidamente, poi eventualmente "pulisci" il risultato in una funzione
   dedicata come le altre già presenti.

## Nota legale

L'API di WarEra usata qui non risulta avere una documentazione ufficiale
"stabile e garantita": è un'API interna del gioco che si è rivelata
pubblicamente accessibile, e diversi progetti community la usano in sola
lettura. Rispetta i rate limit, non tentare azioni di scrittura (acquisti,
azioni di gioco) senza aver verificato i termini di servizio di WarEra, e
non pubblicare mai la tua API key o il token del bot Discord.
