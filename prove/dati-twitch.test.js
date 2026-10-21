const test = require("node:test");
const assert = require("node:assert/strict");
const { creaTwitch, GRANT_DISPOSITIVO } = require("../main/dati/twitch");
const { creaOrologio, creaHttp, leggiCorpo } = require("./dati-aiuti");

function prepara(gestore, tokenIniziale = null) {
  const orologio = creaOrologio("2026-10-21T10:00:00Z");
  const http = creaHttp(gestore);
  const attese = [];
  let token = tokenIniziale;
  const twitch = creaTwitch({
    http,
    adesso: orologio.adesso,
    attendi: async (ms) => {
      attese.push(ms);
      orologio.avanza(ms);
    },
    clientId: () => "cid123",
    leggiToken: () => token,
    scriviToken: (nuovo) => {
      token = nuovo;
    }
  });
  return { twitch, http, orologio, attese, token: () => token };
}

const AVVIO = { device_code: "dev-1", user_code: "ABCD-EFGH", verification_uri: "https://www.twitch.tv/activate?device-code=ABCDEFGH", expires_in: 1800, interval: 5 };

test("device flow riuscito con pending e slow_down", async () => {
  let tentativi = 0;
  const { twitch, http, attese } = prepara((richiesta) => {
    if (richiesta.url.endsWith("/device")) return { corpo: AVVIO };
    tentativi += 1;
    if (tentativi === 1) return { stato: 400, corpo: { status: 400, message: "authorization_pending" } };
    if (tentativi === 2) return { stato: 400, corpo: { status: 400, message: "slow_down" } };
    return { corpo: { access_token: "tok-a", refresh_token: "ref-a", expires_in: 14000, scope: ["moderator:read:followers"] } };
  });
  const avvisi = [];
  const esito = await twitch.accessoDispositivo(["moderator:read:followers"], (info) => avvisi.push(info));
  assert.equal(esito.ok, true);
  assert.equal(esito.token.accessToken, "tok-a");
  assert.equal(esito.token.refreshToken, "ref-a");
  assert.deepEqual(avvisi, [{ codice: "ABCD-EFGH", url: AVVIO.verification_uri, scadeTra: 1800 }]);
  assert.deepEqual(attese, [5000, 5000, 10000]);
  const avvio = leggiCorpo(http.chiamate[0]);
  assert.equal(avvio.client_id, "cid123");
  assert.equal(avvio.scopes, "moderator:read:followers");
  const richiestaToken = leggiCorpo(http.chiamate[1]);
  assert.equal(richiestaToken.grant_type, GRANT_DISPOSITIVO);
  assert.equal(richiestaToken.device_code, "dev-1");
  assert.equal(http.chiamate[1].url, "https://id.twitch.tv/oauth2/token");
});

test("device flow scaduto per tempo e per risposta", async () => {
  const breve = prepara((richiesta) => {
    if (richiesta.url.endsWith("/device")) return { corpo: { ...AVVIO, expires_in: 12 } };
    return { stato: 400, corpo: { message: "authorization_pending" } };
  });
  assert.deepEqual(await breve.twitch.accessoDispositivo([], () => {}), { ok: false, motivo: "scaduto" });
  const rifiutato = prepara((richiesta) => {
    if (richiesta.url.endsWith("/device")) return { corpo: AVVIO };
    return { stato: 400, corpo: { message: "invalid device code" } };
  });
  assert.equal((await rifiutato.twitch.accessoDispositivo([], () => {})).motivo, "scaduto");
});

test("device flow negato e annullato", async () => {
  const negato = prepara((richiesta) => {
    if (richiesta.url.endsWith("/device")) return { corpo: AVVIO };
    return { stato: 400, corpo: { message: "access_denied" } };
  });
  assert.deepEqual(await negato.twitch.accessoDispositivo([], () => {}), { ok: false, motivo: "negato" });
  const controllo = { annullato: false };
  const annullato = prepara((richiesta) => {
    if (richiesta.url.endsWith("/device")) return { corpo: AVVIO };
    controllo.annullato = true;
    return { stato: 400, corpo: { message: "authorization_pending" } };
  });
  assert.equal((await annullato.twitch.accessoDispositivo([], () => {}, controllo)).motivo, "annullato");
  const clientSbagliato = prepara(() => ({ stato: 400, corpo: { message: "invalid client" } }));
  assert.equal((await clientSbagliato.twitch.accessoDispositivo([], () => {})).motivo, "client-id-non-valido");
});

test("device flow sopravvive a un errore di rete", async () => {
  let tentativi = 0;
  const { twitch } = prepara((richiesta) => {
    if (richiesta.url.endsWith("/device")) return { corpo: AVVIO };
    tentativi += 1;
    if (tentativi === 1) return new Error("ECONNRESET");
    return { corpo: { access_token: "tok-b", refresh_token: "ref-b", expires_in: 100 } };
  });
  const esito = await twitch.accessoDispositivo(["moderator:read:followers"], () => {});
  assert.equal(esito.ok, true);
  assert.deepEqual(esito.token.scope, ["moderator:read:followers"]);
});

test("401 su Helix: rinnovo del token e nuova richiesta", async () => {
  const autorizzazioni = [];
  const contesto = prepara((richiesta) => {
    if (richiesta.url.includes("/oauth2/token")) {
      const corpo = leggiCorpo(richiesta);
      assert.equal(corpo.grant_type, "refresh_token");
      assert.equal(corpo.refresh_token, "ref-1");
      assert.equal(corpo.client_id, "cid123");
      assert.equal(corpo.client_secret, undefined);
      return { corpo: { access_token: "tok-2", refresh_token: "ref-2", expires_in: 14000 } };
    }
    autorizzazioni.push(richiesta.intestazioni.Authorization);
    assert.equal(richiesta.intestazioni["Client-Id"], "cid123");
    if (richiesta.intestazioni.Authorization === "Bearer tok-1") return { stato: 401, corpo: { message: "Invalid OAuth token" } };
    return { corpo: { data: [] } };
  }, { accessToken: "tok-1", refreshToken: "ref-1", scadeIl: null, scope: [] });
  const json = await contesto.twitch.helix("/streams", { user_login: "slayer_beard" });
  assert.deepEqual(json, { data: [] });
  assert.deepEqual(autorizzazioni, ["Bearer tok-1", "Bearer tok-2"]);
  assert.equal(contesto.token().accessToken, "tok-2");
  assert.equal(contesto.token().refreshToken, "ref-2");
});

test("token in scadenza rinnovato prima della richiesta, rinnovi concorrenti uniti", async () => {
  let rinnovi = 0;
  const contesto = prepara(async (richiesta) => {
    if (richiesta.url.includes("/oauth2/token")) {
      rinnovi += 1;
      return { corpo: { access_token: "tok-n", refresh_token: "ref-n", expires_in: 14000 } };
    }
    return { corpo: { data: [] } };
  }, { accessToken: "tok-1", refreshToken: "ref-1", scadeIl: Date.parse("2026-10-21T10:00:30Z"), scope: [] });
  await Promise.all([contesto.twitch.helix("/streams"), contesto.twitch.helix("/users")]);
  assert.equal(rinnovi, 1);
});

test("rinnovo rifiutato: token cancellato ed errore non autorizzato senza token nel messaggio", async () => {
  const contesto = prepara((richiesta) => {
    if (richiesta.url.includes("/oauth2/token")) return { stato: 400, corpo: { message: "Invalid refresh token" } };
    return { stato: 401, corpo: {} };
  }, { accessToken: "segreto-a", refreshToken: "segreto-r", scadeIl: null, scope: [] });
  await assert.rejects(contesto.twitch.helix("/streams"), (errore) => {
    assert.equal(errore.codice, "non-autorizzato");
    assert.ok(!errore.message.includes("segreto"));
    return true;
  });
  assert.equal(contesto.token(), null);
});

test("429 con Ratelimit-Reset diventa attesa", async () => {
  const contesto = prepara(() => ({ stato: 429, intestazioni: { "Ratelimit-Reset": String(Date.parse("2026-10-21T10:01:00Z") / 1000) }, corpo: {} }), { accessToken: "t", refreshToken: "r", scadeIl: null, scope: [] });
  await assert.rejects(contesto.twitch.helix("/streams"), (errore) => errore.codice === "limite" && errore.attesa === 60000);
});

test("errore di rete diventa codice rete", async () => {
  const contesto = prepara(() => new Error("getaddrinfo ENOTFOUND"), { accessToken: "t", refreshToken: "r", scadeIl: null, scope: [] });
  await assert.rejects(contesto.twitch.helix("/streams"), (errore) => errore.codice === "rete");
});

test("chiamata facoltativa con permesso mancante non cancella il token", async () => {
  const contesto = prepara((richiesta) => {
    if (richiesta.url.includes("/oauth2/token")) return { corpo: { access_token: "t2", refresh_token: "r2", expires_in: 100 } };
    return { stato: 401, corpo: { message: "Missing scope" } };
  }, { accessToken: "t", refreshToken: "r", scadeIl: null, scope: [] });
  await assert.rejects(contesto.twitch.helix("/channels/followers", {}, { facoltativa: true }), (errore) => errore.codice === "permesso");
  assert.equal(contesto.token().accessToken, "t2");
});
