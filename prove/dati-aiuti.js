const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function creaOrologio(inizio) {
  let istante = Date.parse(inizio);
  return {
    adesso: () => istante,
    avanza: (ms) => {
      istante += ms;
    },
    imposta: (testo) => {
      istante = Date.parse(testo);
    }
  };
}

function creaHttp(gestore) {
  const chiamate = [];
  const http = async (richiesta) => {
    chiamate.push(richiesta);
    const esito = await gestore(richiesta, chiamate);
    if (esito instanceof Error) throw esito;
    const risposta = esito || {};
    return {
      stato: risposta.stato == null ? 200 : risposta.stato,
      intestazioni: risposta.intestazioni || {},
      corpo: typeof risposta.corpo === "string" ? risposta.corpo : JSON.stringify(risposta.corpo == null ? {} : risposta.corpo)
    };
  };
  http.chiamate = chiamate;
  return http;
}

function creaPianificatore() {
  const coda = [];
  const pianificatore = {
    pianifica: (funzione, ms) => {
      const voce = { funzione, ms, annullato: false };
      coda.push(voce);
      return voce;
    },
    annulla: (voce) => {
      if (voce) voce.annullato = true;
    },
    inAttesa: () => coda.filter((voce) => !voce.annullato),
    async giro() {
      const voce = coda.find((elemento) => !elemento.annullato);
      if (!voce) throw new Error("nessun giro in attesa");
      voce.annullato = true;
      await voce.funzione();
      const prossimo = pianificatore.inAttesa();
      return prossimo.length ? prossimo[prossimo.length - 1].ms : null;
    }
  };
  return pianificatore;
}

function cartellaTemporanea() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pm-dati-"));
}

function leggiCorpo(richiesta) {
  return Object.fromEntries(new URLSearchParams(richiesta.corpo || ""));
}

function creaTwitchFinto(opzioni = {}) {
  const stato = {
    token: "accesso-1",
    refresh: "rinnovo-1",
    rinnovi: 0,
    diretta: null,
    video: [],
    follower: 1234,
    scope: ["moderator:read:followers"],
    rifiutaRinnovo: false,
    limite: 0,
    reteGiu: 0,
    ...opzioni
  };
  const gestore = (richiesta) => {
    const url = new URL(richiesta.url);
    const autorizzazione = (richiesta.intestazioni && richiesta.intestazioni.Authorization) || "";
    if (stato.reteGiu > 0 && url.hostname === "api.twitch.tv") {
      stato.reteGiu -= 1;
      return new Error("ECONNRESET");
    }
    if (url.pathname === "/oauth2/validate") {
      if (autorizzazione !== `OAuth ${stato.token}`) return { stato: 401, corpo: { status: 401, message: "invalid access token" } };
      return { corpo: { client_id: "cid", login: "slayer_beard", user_id: "42", scopes: stato.scope, expires_in: 10000 } };
    }
    if (url.pathname === "/oauth2/token") {
      const corpo = leggiCorpo(richiesta);
      if (corpo.grant_type === "refresh_token") {
        if (stato.rifiutaRinnovo || corpo.refresh_token !== stato.refresh) return { stato: 400, corpo: { status: 400, message: "Invalid refresh token" } };
        stato.rinnovi += 1;
        stato.token = `accesso-${stato.rinnovi + 1}`;
        stato.refresh = `rinnovo-${stato.rinnovi + 1}`;
        return { corpo: { access_token: stato.token, refresh_token: stato.refresh, expires_in: 14000, scope: stato.scope, token_type: "bearer" } };
      }
    }
    if (url.pathname === "/oauth2/revoke") return { corpo: {} };
    if (url.hostname === "api.twitch.tv") {
      if (stato.limite > 0) {
        stato.limite -= 1;
        return { stato: 429, intestazioni: { "Ratelimit-Reset": String(Math.ceil(opzioni.orologio.adesso() / 1000) + 90) }, corpo: { message: "Too Many Requests" } };
      }
      if (autorizzazione !== `Bearer ${stato.token}`) return { stato: 401, corpo: { status: 401, message: "Invalid OAuth token" } };
      if (url.pathname === "/helix/users") return { corpo: { data: [{ id: "42", login: "slayer_beard", display_name: "Slayer_Beard" }] } };
      if (url.pathname === "/helix/streams") return { corpo: { data: stato.diretta ? [{ type: "live", ...stato.diretta }] : [] } };
      if (url.pathname === "/helix/videos") return { corpo: { data: stato.video } };
      if (url.pathname === "/helix/channels/followers") return { corpo: { total: stato.follower, data: [] } };
    }
    if (url.hostname === "twitchtracker.com") return { corpo: { avg_viewers: 70, max_viewers: 130, minutes_streamed: 3000, followers_total: 1200 } };
    if (url.hostname === "slayerbeard.com") {
      if (stato.lurkGuasto) return new Error("rete giu");
      return { corpo: { presenti: stato.lurk == null ? 12 : stato.lurk, vivi: 9, aggiornato: new Date(opzioni.orologio.adesso()).toISOString() } };
    }
    return { stato: 404, corpo: { message: "not found" } };
  };
  return { stato, http: creaHttp(gestore) };
}

function scriviTokenIniziale(cartella, extra = {}) {
  fs.writeFileSync(
    path.join(cartella, "token.json"),
    JSON.stringify({ accessToken: "accesso-1", refreshToken: "rinnovo-1", scadeIl: null, scope: ["moderator:read:followers"], ...extra })
  );
}

function scriviImpostazioni(cartella, impostazioni) {
  fs.writeFileSync(path.join(cartella, "impostazioni.json"), JSON.stringify({ canale: "slayer_beard", clientId: "abc123", lurk: false, ...impostazioni }));
}

module.exports = { creaOrologio, creaHttp, creaPianificatore, cartellaTemporanea, leggiCorpo, creaTwitchFinto, scriviTokenIniziale, scriviImpostazioni };
