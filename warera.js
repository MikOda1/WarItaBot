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
 * Chiama una qualsiasi procedura tRPC di WarEra.
 * @param {string} endpoint - es. "user.getUserLite", "country.getAllCountries"
 * @param {object} params - parametri della procedura (oggetto, può essere {})
 */
async function callEndpoint(endpoint, params = {}) {
  const input = encodeURIComponent(JSON.stringify(params));
  const url = `${BASE_URL}/${endpoint}?input=${input}`;

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

  const res = await fetch(url, { headers });

  // Anche in caso di errore tRPC il body è JSON valido, quindi lo leggiamo
  // sempre prima di decidere se lanciare un'eccezione.
  const data = await res.json();

  if (data.error) {
    const msg = data.error?.json?.message || data.error?.message || 'Errore sconosciuto';
    throw new Error(`WarEra API error su ${endpoint}: ${msg}`);
  }

  return data.result.data;
}

// --- Alcune procedure verificate, come scorciatoia -------------------------

const warera = {
  raw: callEndpoint, // "escape hatch": chiama qualsiasi endpoint tu scopra sui docs

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
};

module.exports = warera;