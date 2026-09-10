// src/warera.js
// Wrapper minimale per l'API pubblica (non ufficiale) di WarEra.
// L'API è una API tRPC esposta su https://api2.warera.io/trpc
// Documentazione "live" (schema auto-generato): https://api2.warera.io/docs
//
// Formato di una chiamata GET tRPC:
//   GET https://api2.warera.io/trpc/<namespace>.<procedura>?input=<JSON con encodeURIComponent>
// Risposta:
//   { result: { data: ... } }         in caso di successo
//   { error:  { json: { message } } } in caso di errore

const BASE_URL = 'https://api2.warera.io/trpc';

// Alcuni endpoint (es. referral, ranking) richiedono un'API key generata in
// Warera -> Impostazioni -> API Tokens. Va messa nel file .env come WARERA_API_KEY.
const API_KEY = process.env.WARERA_API_KEY;

/**
 * Chiama una qualsiasi procedura tRPC di WarEra via GET (per query semplici).
 * @param {string} endpoint - es. "user.getUserLite", "country.getAllCountries"
 * @param {object} params - parametri della procedura (oggetto, può essere {})
 */
async function callEndpoint(endpoint, params = {}) {
  const input = encodeURIComponent(JSON.stringify(params));
  const url = `${BASE_URL}/${endpoint}?input=${input}`;

  const res = await fetch(url, { headers: buildHeaders() });
  return parseResponse(res, endpoint);
}

/**
 * Come callEndpoint, ma via POST con il body JSON: alcuni endpoint (es.
 * company.getCompanies) lo richiedono invece della GET.
 * @param {string} endpoint
 * @param {object} body - corpo della richiesta (va mandato cosi' com'e', NON
 *   incapsulato in {input: ...} come per la GET)
 */
async function postEndpoint(endpoint, body = {}) {
  const url = `${BASE_URL}/${endpoint}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...buildHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseResponse(res, endpoint);
}

function buildHeaders() {
  const headers = {
    // L'API controlla Origin/Referer/User-Agent su alcuni endpoint: ci
    // presentiamo come farebbe il client ufficiale del gioco.
    'Origin': 'https://app.warera.io',
    'Referer': 'https://app.warera.io/',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  };
  if (API_KEY) headers['X-API-Key'] = API_KEY;
  return headers;
}

async function parseResponse(res, endpoint) {
  // Anche in caso di errore tRPC il body e' JSON valido, quindi lo leggiamo
  // sempre prima di decidere se lanciare un'eccezione.
  const data = await res.json();

  if (data.error) {
    const msg = data.error?.message || data.error?.json?.message || 'Errore sconosciuto';
    throw new Error(`WarEra API error su ${endpoint}: ${msg}`);
  }

  return data.result.data;
}

// --- Alcune procedure verificate, come scorciatoia -------------------------

const warera = {
  raw: callEndpoint, // "escape hatch" GET: chiama qualsiasi endpoint tu scopra sui docs
  rawPost: postEndpoint, // "escape hatch" POST, per gli endpoint che la richiedono

  getAllCountries: () => callEndpoint('country.getAllCountries', {}),
  getCountryById: (countryId) => callEndpoint('country.getCountryById', { countryId }),
  getGovernmentByCountryId: (countryId) =>
    callEndpoint('government.getByCountryId', { countryId }),
  getPartyById: (partyId) => callEndpoint('party.getById', { partyId }),

  getUserLite: (userId) => callEndpoint('user.getUserLite', { userId }),

  getMuById: (muId) => callEndpoint('mu.getById', { muId }),

  getRegionById: (regionId) => callEndpoint('region.getById', { regionId }),

  getLatestArticles: (limit = 5) =>
    callEndpoint('article.getArticlesPaginated', { limit }),

  // Aziende di un giocatore: endpoint POST, con paginazione (perPage/cursor).
  // Restituisce solo gli ID; per i dettagli serve una seconda chiamata GET.
  getCompaniesByUserId: (userId, perPage = 50, cursor) =>
    postEndpoint('company.getCompanies', { userId, perPage, ...(cursor ? { cursor } : {}) }),

  getCompanyById: (companyId) => callEndpoint('company.getById', { companyId }),

  // Contratti mercenari attivi (asta): endpoint POST con paginazione.
  getMercenaryContracts: (perPage = 50) =>
    postEndpoint('mercenaryContractAuction.getPaginatedAuctions', { perPage }),

  // Donazioni fatte a una MU (cursor-paginated). Ogni elemento: { userId,
  // muId, amount, createdAt, ... }. Endpoint confermato dalla documentazione
  // community dell'API (donation.getManyPaginated). Proviamo prima GET (come
  // la maggior parte delle query tRPC "get..."); se fallisce, ripieghiamo su
  // POST, dato che alcuni endpoint di WarEra lo richiedono.
  getDonationsByMu: async (muId, limit = 100, cursor) => {
    const params = { muId, limit, ...(cursor ? { cursor } : {}) };
    try {
      return await callEndpoint('donation.getManyPaginated', params);
    } catch (err) {
      return await postEndpoint('donation.getManyPaginated', params);
    }
  },
};

module.exports = warera;