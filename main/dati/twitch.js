const { eseguiRichiesta, ErroreTwitch, codificaModulo } = require("./rete");

const ID = "https://id.twitch.tv/oauth2";
const HELIX = "https://api.twitch.tv/helix";
const MODULO = { "Content-Type": "application/x-www-form-urlencoded" };
const GRANT_DISPOSITIVO = "urn:ietf:params:oauth:grant-type:device_code";

function creaTwitch({ http, adesso, attendi, clientId, leggiToken, scriviToken }) {
  let rinnovoInCorso = null;

  function daRisposta(json, precedente) {
    const scope = Array.isArray(json.scope) ? json.scope.map(String) : precedente && Array.isArray(precedente.scope) ? precedente.scope : [];
    const durata = Number(json.expires_in);
    return {
      accessToken: String(json.access_token),
      refreshToken: json.refresh_token ? String(json.refresh_token) : precedente ? precedente.refreshToken || null : null,
      scadeIl: Number.isFinite(durata) && durata > 0 ? adesso() + durata * 1000 : null,
      scope
    };
  }

  function attesaDaLimite(risposta) {
    const reset = Number(risposta.intestazioni["ratelimit-reset"]);
    if (Number.isFinite(reset) && reset > 0) return Math.max(0, reset * 1000 - adesso());
    const dopo = Number(risposta.intestazioni["retry-after"]);
    return Number.isFinite(dopo) && dopo > 0 ? dopo * 1000 : 0;
  }

  async function accessoDispositivo(scope, avvisa, controllo = {}) {
    const avvio = await eseguiRichiesta(http, {
      metodo: "POST",
      url: `${ID}/device`,
      intestazioni: MODULO,
      corpo: codificaModulo({ client_id: clientId(), scopes: scope.join(" ") })
    });
    if (avvio.stato !== 200 || !avvio.json || !avvio.json.device_code) {
      return { ok: false, motivo: avvio.stato === 400 ? "client-id-non-valido" : "avvio-fallito", stato: avvio.stato };
    }
    const { device_code: codiceDispositivo, user_code: codice, verification_uri: url } = avvio.json;
    const durata = Number(avvio.json.expires_in) > 0 ? Number(avvio.json.expires_in) : 1800;
    const scade = adesso() + durata * 1000;
    let passo = Math.max(1, Number(avvio.json.interval) || 5) * 1000;
    avvisa({ codice: String(codice || ""), url: String(url || "https://www.twitch.tv/activate"), scadeTra: durata });
    for (;;) {
      if (controllo.annullato) return { ok: false, motivo: "annullato" };
      if (adesso() >= scade) return { ok: false, motivo: "scaduto" };
      await attendi(passo);
      if (controllo.annullato) return { ok: false, motivo: "annullato" };
      let risposta;
      try {
        risposta = await eseguiRichiesta(http, {
          metodo: "POST",
          url: `${ID}/token`,
          intestazioni: MODULO,
          corpo: codificaModulo({ client_id: clientId(), scopes: scope.join(" "), device_code: codiceDispositivo, grant_type: GRANT_DISPOSITIVO })
        });
      } catch {
        passo = Math.min(passo * 2, 30000);
        continue;
      }
      if (risposta.stato === 200 && risposta.json && risposta.json.access_token) {
        const token = daRisposta(risposta.json, null);
        if (!token.scope.length) token.scope = scope.slice();
        return { ok: true, token };
      }
      const messaggio = String((risposta.json && (risposta.json.message || risposta.json.error)) || "").toLowerCase();
      if (messaggio.includes("pending")) continue;
      if (messaggio.includes("slow")) {
        passo += 5000;
        continue;
      }
      if (risposta.stato === 429) {
        passo = Math.max(passo + 5000, attesaDaLimite(risposta));
        continue;
      }
      if (messaggio.includes("denied")) return { ok: false, motivo: "negato" };
      if (messaggio.includes("expired") || messaggio.includes("invalid device code")) return { ok: false, motivo: "scaduto" };
      if (risposta.stato >= 500) continue;
      return { ok: false, motivo: "errore", stato: risposta.stato };
    }
  }

  function rinnova() {
    if (!rinnovoInCorso) {
      rinnovoInCorso = (async () => {
        const attuale = leggiToken();
        if (!attuale || !attuale.refreshToken) {
          scriviToken(null);
          throw new ErroreTwitch("accesso scaduto", { codice: "non-autorizzato", stato: 401 });
        }
        const risposta = await eseguiRichiesta(http, {
          metodo: "POST",
          url: `${ID}/token`,
          intestazioni: MODULO,
          corpo: codificaModulo({ client_id: clientId(), grant_type: "refresh_token", refresh_token: attuale.refreshToken })
        });
        if (risposta.stato === 200 && risposta.json && risposta.json.access_token) {
          const nuovo = daRisposta(risposta.json, attuale);
          scriviToken(nuovo);
          return nuovo;
        }
        if (risposta.stato === 400 || risposta.stato === 401) {
          scriviToken(null);
          throw new ErroreTwitch("accesso scaduto", { codice: "non-autorizzato", stato: risposta.stato });
        }
        if (risposta.stato === 429) throw new ErroreTwitch("troppe richieste", { codice: "limite", stato: 429, attesa: attesaDaLimite(risposta) });
        throw new ErroreTwitch("rinnovo non riuscito", { codice: "http", stato: risposta.stato });
      })().finally(() => {
        rinnovoInCorso = null;
      });
    }
    return rinnovoInCorso;
  }

  function intestazioniHelix(token) {
    return { "Client-Id": clientId(), Authorization: `Bearer ${token.accessToken}` };
  }

  async function helix(percorso, parametri = {}, { facoltativa = false } = {}) {
    let token = leggiToken();
    if (!token || !token.accessToken) throw new ErroreTwitch("non collegato", { codice: "non-autorizzato", stato: 401 });
    if (token.scadeIl && token.scadeIl - adesso() < 60000) token = await rinnova();
    const url = `${HELIX}${percorso}?${codificaModulo(parametri)}`;
    let risposta = await eseguiRichiesta(http, { metodo: "GET", url, intestazioni: intestazioniHelix(token) });
    if (risposta.stato === 401) {
      token = await rinnova();
      risposta = await eseguiRichiesta(http, { metodo: "GET", url, intestazioni: intestazioniHelix(token) });
      if (risposta.stato === 401) {
        if (facoltativa) throw new ErroreTwitch("permesso mancante", { codice: "permesso", stato: 401 });
        scriviToken(null);
        throw new ErroreTwitch("accesso scaduto", { codice: "non-autorizzato", stato: 401 });
      }
    }
    if (risposta.stato === 429) throw new ErroreTwitch("troppe richieste", { codice: "limite", stato: 429, attesa: attesaDaLimite(risposta) });
    if (risposta.stato === 403 && facoltativa) throw new ErroreTwitch("permesso mancante", { codice: "permesso", stato: 403 });
    if (risposta.stato < 200 || risposta.stato >= 300) throw new ErroreTwitch(`errore ${risposta.stato}`, { codice: "http", stato: risposta.stato });
    return risposta.json || {};
  }

  async function valida() {
    let token = leggiToken();
    if (!token || !token.accessToken) return null;
    const chiedi = (t) => eseguiRichiesta(http, { metodo: "GET", url: `${ID}/validate`, intestazioni: { Authorization: `OAuth ${t.accessToken}` } });
    let risposta = await chiedi(token);
    if (risposta.stato === 401) {
      token = await rinnova();
      risposta = await chiedi(token);
      if (risposta.stato === 401) {
        scriviToken(null);
        throw new ErroreTwitch("accesso scaduto", { codice: "non-autorizzato", stato: 401 });
      }
    }
    if (risposta.stato === 429) throw new ErroreTwitch("troppe richieste", { codice: "limite", stato: 429, attesa: attesaDaLimite(risposta) });
    if (risposta.stato !== 200 || !risposta.json) throw new ErroreTwitch(`errore ${risposta.stato}`, { codice: "http", stato: risposta.stato });
    const json = risposta.json;
    if (Array.isArray(json.scopes)) {
      const aggiornato = { ...leggiToken(), scope: json.scopes.map(String) };
      scriviToken(aggiornato);
    }
    return { login: json.login ? String(json.login) : null, id: json.user_id ? String(json.user_id) : null, scope: Array.isArray(json.scopes) ? json.scopes : [] };
  }

  async function revoca(token) {
    if (!token || !token.accessToken) return;
    try {
      await eseguiRichiesta(http, {
        metodo: "POST",
        url: `${ID}/revoke`,
        intestazioni: MODULO,
        corpo: codificaModulo({ client_id: clientId(), token: token.accessToken })
      });
    } catch {}
  }

  return { accessoDispositivo, rinnova, helix, valida, revoca };
}

module.exports = { creaTwitch, ID, HELIX, GRANT_DISPOSITIVO };
