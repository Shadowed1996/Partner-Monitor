const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { creaMonitor } = require("../main/dati");
const {
  creaOrologio,
  creaPianificatore,
  cartellaTemporanea,
  creaTwitchFinto,
  scriviTokenIniziale,
  scriviImpostazioni,
  creaHttp
} = require("./dati-aiuti");

function prepara({ inizio = "2026-10-21T16:00:00Z", impostazioni = {}, conToken = true, finto = {}, finestraTwitch, http } = {}) {
  const cartella = cartellaTemporanea();
  const orologio = creaOrologio(inizio);
  const twitch = creaTwitchFinto({ orologio, ...finto });
  if (impostazioni !== null) scriviImpostazioni(cartella, impostazioni);
  if (conToken) scriviTokenIniziale(cartella);
  const pianificatore = creaPianificatore();
  const eventi = [];
  const stati = [];
  const accessi = [];
  const crea = () => {
    const monitor = creaMonitor({
      cartella,
      finestraTwitch,
      http: http || twitch.http,
      adesso: orologio.adesso,
      attendi: async (ms) => orologio.avanza(ms),
      pianifica: pianificatore.pianifica,
      annulla: pianificatore.annulla
    });
    monitor.on("evento", (voce) => eventi.push(voce));
    monitor.on("stato", (stato) => stati.push(stato));
    monitor.on("accesso", (voce) => accessi.push(voce));
    return monitor;
  };
  return { cartella, orologio, twitch, pianificatore, eventi, stati, accessi, crea };
}

async function giri(contesto, quanti, passo) {
  let ritardo = null;
  for (let indice = 0; indice < quanti; indice += 1) {
    ritardo = await contesto.pianificatore.giro();
    contesto.orologio.avanza(passo == null ? ritardo : passo);
  }
  return ritardo;
}

function tipi(eventi) {
  return eventi.map((voce) => voce.tipo);
}

test("client id mancante e nessun token", async () => {
  const contesto = prepara({ impostazioni: { clientId: "" }, conToken: false });
  const monitor = contesto.crea();
  const stato = monitor.stato();
  assert.equal(stato.clientIdMancante, true);
  assert.equal(stato.collegato, false);
  assert.equal(stato.inOnda, null);
  assert.deepEqual(stato.obiettivo, { media: 75, dirette: 6, giorni: 30 });
  assert.equal(stato.periodi.length, 2);
  assert.equal(stato.totali, 2);
  assert.deepEqual(await monitor.accedi(), { ok: false, motivo: "client-id-mancante" });
  monitor.avvia();
  assert.equal(await contesto.pianificatore.giro(), 60000);
  assert.equal(contesto.twitch.http.chiamate.length, 0);
  monitor.ferma();
});

test("diretta: campioni al minuto, media, ritmo 30 s in onda e 60 s offline, eventi", async () => {
  const contesto = prepara();
  contesto.twitch.stato.diretta = { viewer_count: 100, title: "Pollo Run", game_name: "Pollo", started_at: "2026-10-21T16:00:00Z" };
  const monitor = contesto.crea();
  monitor.avvia();
  const ritardo = await giri(contesto, 40);
  assert.equal(ritardo, 30000);
  let stato = monitor.stato();
  assert.equal(stato.inOnda, true);
  assert.equal(stato.collegato, true);
  assert.equal(stato.canale.nome, "Slayer_Beard");
  assert.equal(stato.spettatori, 100);
  assert.equal(stato.titolo, "Pollo Run");
  assert.equal(stato.gioco, "Pollo");
  assert.equal(stato.iniziataIl, "2026-10-21T16:00:00.000Z");
  assert.equal(stato.mediaDiretta, 100);
  assert.equal(stato.contaOra, true);
  assert.equal(stato.serieDiretta.length, 20);
  assert.equal(stato.follower, 1234);
  assert.equal(stato.periodi[0].dirette[0].fonte, "campione");
  assert.equal(stato.periodi[0].dirette[0].conta, true);
  assert.deepEqual(tipi(contesto.eventi), ["sta-contando"]);
  contesto.twitch.stato.diretta.viewer_count = 0;
  await giri(contesto, 80);
  stato = monitor.stato();
  assert.ok(stato.mediaDiretta < 75);
  assert.deepEqual(tipi(contesto.eventi), ["sta-contando", "sotto-media"]);
  contesto.twitch.stato.diretta = null;
  assert.equal(await giri(contesto, 1), 60000);
  assert.equal(monitor.stato().inOnda, false);
  assert.ok(monitor.stato().mediaDiretta != null);
  await giri(contesto, 12);
  assert.deepEqual(tipi(contesto.eventi), ["sta-contando", "sotto-media", "diretta-finita"]);
  assert.equal(monitor.stato().mediaDiretta, null);
  contesto.twitch.stato.diretta = { viewer_count: 5, title: "Di nuovo", game_name: "X", started_at: new Date(contesto.orologio.adesso()).toISOString() };
  await giri(contesto, 1);
  assert.deepEqual(tipi(contesto.eventi), ["sta-contando", "sotto-media", "diretta-finita", "diretta-iniziata"]);
  monitor.ferma();
});

test("buco breve di rete o offline: stessa diretta, nessun evento", async () => {
  const contesto = prepara();
  contesto.twitch.stato.diretta = { viewer_count: 80, started_at: "2026-10-21T16:00:00Z" };
  const monitor = contesto.crea();
  monitor.avvia();
  await giri(contesto, 4);
  contesto.twitch.stato.diretta = null;
  await giri(contesto, 5, 60000);
  contesto.twitch.stato.diretta = { viewer_count: 80, started_at: "2026-10-21T16:07:00Z" };
  await giri(contesto, 2);
  assert.deepEqual(tipi(contesto.eventi), []);
  assert.equal(monitor.stato().iniziataIl, "2026-10-21T16:00:00.000Z");
  monitor.ferma();
});

test("diretta a cavallo della mezzanotte di Roma resta sul giorno di inizio", async () => {
  const contesto = prepara({ inizio: "2026-10-21T21:40:00Z" });
  contesto.twitch.stato.diretta = { viewer_count: 90, started_at: "2026-10-21T21:30:00Z" };
  const monitor = contesto.crea();
  monitor.avvia();
  await giri(contesto, 60);
  const stato = monitor.stato();
  assert.equal(stato.periodi[0].a, "2026-10-22");
  assert.deepEqual(stato.periodi[0].dirette.map((voce) => voce.giorno), ["2026-10-21"]);
  monitor.ferma();
});

test("periodo completato: evento quando si arriva a 6 giorni", async () => {
  const contesto = prepara({ conToken: false });
  const monitor = contesto.crea();
  for (const giorno of ["2026-10-01", "2026-10-03", "2026-10-05", "2026-10-07", "2026-10-09"]) await monitor.aggiungiManuale({ giorno, media: 80, ore: 3 });
  assert.deepEqual(tipi(contesto.eventi), []);
  const stato = await monitor.aggiungiManuale({ giorno: "2026-10-11", media: 76, ore: 2 });
  assert.equal(stato.periodi[0].ok, true);
  assert.equal(stato.periodi[0].confermate, 6);
  assert.equal(stato.completati, 1);
  assert.deepEqual(tipi(contesto.eventi), ["periodo-completato"]);
  await monitor.aggiungiManuale({ giorno: "2026-10-12", media: 99, ore: 2 });
  assert.equal(contesto.eventi.length, 1);
  await assert.rejects(monitor.aggiungiManuale({ giorno: "2026-13-01", media: 80 }));
  await assert.rejects(monitor.aggiungiManuale({ giorno: "2026-10-12", media: "abc" }));
  await assert.rejects(monitor.aggiungiManuale({ giorno: "2026-12-01", media: 80 }));
  const dopo = await monitor.rimuoviManuale("2026-10-12");
  assert.equal(dopo.periodi[0].totaleReale, 6);
});

test("manuale vince sul campione dello stesso giorno, export CSV", async () => {
  const contesto = prepara();
  contesto.twitch.stato.diretta = { viewer_count: 40, started_at: "2026-10-21T16:00:00Z" };
  const monitor = contesto.crea();
  monitor.avvia();
  await giri(contesto, 6);
  assert.equal(monitor.stato().periodi[0].dirette[0].fonte, "campione");
  await monitor.aggiungiManuale({ giorno: "2026-10-21", media: 88, ore: 4 });
  const voce = monitor.stato().periodi[0].dirette[0];
  assert.deepEqual(voce, { giorno: "2026-10-21", media: 88, ore: 4, conta: true, fonte: "manuale" });
  assert.match(monitor.esportaCsv(), /^giorno,media,ore,conta,fonte\r\n2026-10-21,88\.00,4\.00,si,manuale\r\n$/);
  monitor.ferma();
});

test("recupero dai VOD: ore senza media", async () => {
  const contesto = prepara({
    finto: {
      video: [
        { id: "v1", created_at: "2026-10-19T19:00:00Z", duration: "3h30m0s" },
        { id: "v2", created_at: "2026-10-18T21:30:00Z", duration: "2h" },
        { id: "v5", created_at: "2026-10-16T22:30:00Z", duration: "1h" },
        { id: "v3", created_at: "2026-06-01T10:00:00Z", duration: "1h" },
        { id: "v4", duration: "1h" }
      ]
    }
  });
  const monitor = contesto.crea();
  monitor.avvia();
  await giri(contesto, 1);
  const dirette = monitor.stato().periodi[0].dirette;
  assert.deepEqual(dirette, [
    { giorno: "2026-10-19", media: null, ore: 3.5, conta: false, fonte: "vod" },
    { giorno: "2026-10-18", media: null, ore: 2, conta: false, fonte: "vod" },
    { giorno: "2026-10-17", media: null, ore: 1, conta: false, fonte: "vod" }
  ]);
  monitor.ferma();
});

test("401: rinnovo del token e prosecuzione; rinnovo negato: scollegato", async () => {
  const contesto = prepara();
  contesto.twitch.stato.token = "accesso-scaduto";
  const monitor = contesto.crea();
  monitor.avvia();
  await giri(contesto, 1);
  assert.equal(contesto.twitch.stato.rinnovi, 1);
  assert.equal(monitor.stato().collegato, true);
  assert.equal(monitor.stato().ultimoErrore, null);
  const salvato = JSON.parse(fs.readFileSync(path.join(contesto.cartella, "token.json"), "utf8"));
  assert.equal(salvato.accessToken, "accesso-2");
  assert.equal(salvato.refreshToken, "rinnovo-2");
  contesto.twitch.stato.token = "revocato";
  contesto.twitch.stato.rifiutaRinnovo = true;
  await giri(contesto, 1);
  const stato = monitor.stato();
  assert.equal(stato.collegato, false);
  assert.match(stato.ultimoErrore, /ricollegati/);
  assert.equal(fs.existsSync(path.join(contesto.cartella, "token.json")), false);
  monitor.ferma();
});

test("429 e rete giu: backoff crescente, poi si riprende", async () => {
  const contesto = prepara({ finto: { limite: 1 } });
  const monitor = contesto.crea();
  monitor.avvia();
  const primo = await contesto.pianificatore.giro();
  assert.ok(primo >= 89000 && primo <= 91000, String(primo));
  assert.match(monitor.stato().ultimoErrore, /429/);
  contesto.orologio.avanza(primo);
  contesto.twitch.stato.reteGiu = 2;
  const secondo = await contesto.pianificatore.giro();
  assert.equal(secondo, 60000);
  contesto.orologio.avanza(secondo);
  const terzo = await contesto.pianificatore.giro();
  assert.equal(terzo, 120000);
  assert.match(monitor.stato().ultimoErrore, /non raggiungibile/);
  contesto.orologio.avanza(terzo);
  assert.equal(await contesto.pianificatore.giro(), 60000);
  assert.equal(monitor.stato().ultimoErrore, null);
  monitor.ferma();
});

test("i giri non si sovrappongono", async () => {
  const contesto = prepara();
  let attivi = 0;
  let massimo = 0;
  let rilascia;
  const blocco = new Promise((risolvi) => {
    rilascia = risolvi;
  });
  const lento = async (richiesta) => {
    attivi += 1;
    massimo = Math.max(massimo, attivi);
    if (richiesta.url.includes("/helix/streams")) await blocco;
    const risposta = await contesto.twitch.http(richiesta);
    attivi -= 1;
    return risposta;
  };
  const cartella = contesto.cartella;
  const monitor = creaMonitor({ cartella, http: lento, adesso: contesto.orologio.adesso, pianifica: contesto.pianificatore.pianifica, annulla: contesto.pianificatore.annulla });
  monitor.avvia();
  const primo = contesto.pianificatore.giro();
  await new Promise((risolvi) => setImmediate(risolvi));
  await monitor.salvaImpostazioni({ obiettivo: { media: 70 } });
  const secondo = contesto.pianificatore.giro();
  await new Promise((risolvi) => setImmediate(risolvi));
  rilascia();
  await Promise.all([primo, secondo]);
  assert.equal(massimo, 1);
  assert.equal(contesto.pianificatore.inAttesa().length, 1);
  assert.equal(contesto.pianificatore.inAttesa()[0].ms, 0);
  monitor.ferma();
});

test("file corrotto: si riparte dal backup o da vuoto e lo si segnala", async () => {
  const contesto = prepara({ conToken: false });
  const primo = contesto.crea();
  await primo.aggiungiManuale({ giorno: "2026-10-10", media: 80, ore: 2 });
  await primo.aggiungiManuale({ giorno: "2026-10-11", media: 81, ore: 2 });
  const file = path.join(contesto.cartella, "campioni.json");
  assert.equal(fs.existsSync(`${file}.tmp`), false);
  fs.writeFileSync(file, "{ rotto");
  const secondo = contesto.crea();
  const stato = secondo.stato();
  assert.match(stato.ultimoErrore, /campioni\.json/);
  assert.deepEqual(stato.periodi[0].dirette.map((voce) => voce.giorno), ["2026-10-10"]);
  assert.ok(fs.readdirSync(contesto.cartella).some((nome) => nome.startsWith("campioni.json.corrotto-")));
  fs.writeFileSync(file, "\u0000\u0000");
  fs.writeFileSync(`${file}.bak`, "[]");
  const terzo = contesto.crea();
  assert.deepEqual(terzo.stato().periodi[0].dirette, []);
  fs.writeFileSync(path.join(contesto.cartella, "impostazioni.json"), "nul");
  fs.writeFileSync(path.join(contesto.cartella, "token.json"), "{\"accessToken\": 5}");
  const quarto = contesto.crea();
  assert.equal(quarto.impostazioni().clientId, "");
  assert.equal(quarto.stato().collegato, false);
});

test("persistenza: ricarica e campioni con valori strani scartati", async () => {
  const contesto = prepara({ conToken: false });
  fs.writeFileSync(
    path.join(contesto.cartella, "campioni.json"),
    JSON.stringify({ giorni: { "2026-10-20": { somma: 800, numero: 10, minuti: 10 }, rotto: { somma: 1 }, "2026-10-19": { somma: "x" } }, manuali: [], diretta: "boh" })
  );
  const monitor = contesto.crea();
  const stato = monitor.stato();
  assert.deepEqual(stato.periodi[0].dirette.map((voce) => voce.giorno), ["2026-10-20"]);
  assert.deepEqual(stato.serieDiretta, []);
});

test("il token non compare mai in stato, eventi, errori o impostazioni", async () => {
  const contesto = prepara({ finto: { limite: 1 } });
  contesto.twitch.stato.token = "accesso-scaduto";
  const monitor = contesto.crea();
  monitor.avvia();
  await giri(contesto, 3);
  contesto.twitch.stato.rifiutaRinnovo = true;
  contesto.twitch.stato.token = "x";
  await giri(contesto, 1);
  const tutto = JSON.stringify([contesto.stati, contesto.eventi, monitor.impostazioni(), monitor.stato()]);
  for (const segreto of ["accesso-1", "accesso-2", "rinnovo-1", "rinnovo-2"]) assert.ok(!tutto.includes(segreto), segreto);
  monitor.ferma();
});

test("accedi dal monitor: evento accesso, token salvato, canale preso dall account", async () => {
  const cartella = cartellaTemporanea();
  scriviImpostazioni(cartella, { canale: "" });
  const orologio = creaOrologio("2026-10-21T10:00:00Z");
  const pianificatore = creaPianificatore();
  let tentativi = 0;
  const http = creaHttp((richiesta) => {
    if (richiesta.url.endsWith("/oauth2/device")) return { corpo: { device_code: "d", user_code: "WXYZ-1234", verification_uri: "https://www.twitch.tv/activate", expires_in: 1800, interval: 5 } };
    if (richiesta.url.endsWith("/oauth2/token")) {
      tentativi += 1;
      if (tentativi < 3) return { stato: 400, corpo: { message: "authorization_pending" } };
      return { corpo: { access_token: "nuovo", refresh_token: "nuovo-r", expires_in: 14000, scope: [] } };
    }
    if (richiesta.url.endsWith("/oauth2/validate")) return { corpo: { login: "Slayer_Beard", user_id: "42", scopes: [] } };
    if (richiesta.url.includes("/helix/users")) return { corpo: { data: [{ id: "42", login: "slayer_beard", display_name: "Slayer_Beard" }] } };
    return { corpo: { data: [] } };
  });
  const monitor = creaMonitor({ cartella, http, adesso: orologio.adesso, attendi: async (ms) => orologio.avanza(ms), pianifica: pianificatore.pianifica, annulla: pianificatore.annulla });
  const accessi = [];
  monitor.on("accesso", (voce) => accessi.push(voce));
  monitor.avvia();
  const esito = await monitor.accedi();
  assert.deepEqual(esito, { ok: true, motivo: null });
  assert.deepEqual(accessi, [{ codice: "WXYZ-1234", url: "https://www.twitch.tv/activate", scadeTra: 1800 }]);
  assert.equal(monitor.stato().collegato, true);
  await pianificatore.giro();
  assert.equal(monitor.impostazioni().canale, "slayer_beard");
  assert.equal(monitor.stato().inOnda, false);
  assert.ok(!http.chiamate.some((richiesta) => richiesta.url.includes("/channels/followers")));
  await monitor.esci();
  assert.equal(monitor.stato().collegato, false);
  assert.ok(http.chiamate.some((richiesta) => richiesta.url.endsWith("/oauth2/revoke")));
  assert.equal(fs.existsSync(path.join(cartella, "token.json")), false);
  monitor.ferma();
});

test("impostazioni: canale pulito, obiettivo limitato, cambio client id scollega", async () => {
  const contesto = prepara();
  const monitor = contesto.crea();
  const nuove = await monitor.salvaImpostazioni({ canale: "https://www.twitch.tv/Slayer_Beard/", obiettivo: { media: "80", dirette: 999 } });
  assert.equal(nuove.canale, "slayer_beard");
  assert.deepEqual(nuove.obiettivo, { media: 80, dirette: 30, giorni: 30 });
  assert.equal(monitor.stato().collegato, true);
  await monitor.salvaImpostazioni({ clientId: "altro999" });
  assert.equal(monitor.stato().collegato, false);
  const riletto = JSON.parse(fs.readFileSync(path.join(contesto.cartella, "impostazioni.json"), "utf8"));
  assert.equal(riletto.clientId, "altro999");
});

test("cruscotto ufficiale: parser, diagnostica, import riepilogo, errori della finestra", async () => {
  const pagine = {
    "https://dashboard.twitch.tv/u/slayer_beard/achievements": "Path to Partner\nAverage of 75 viewers 68/75\nStream on 12 different days 9/12",
    "https://dashboard.twitch.tv/u/slayer_beard/stream-summary": "Oct 15, 2026\n3h 0m\nAverage viewers 77\nOct 14, 2026\nAverage viewers 30"
  };
  const richieste = [];
  const contesto = prepara({
    conToken: false,
    impostazioni: { diagnostica: true },
    finestraTwitch: async (url, opzioni) => {
      richieste.push({ url, opzioni });
      return pagine[url];
    }
  });
  const monitor = contesto.crea();
  const ufficiale = await monitor.aggiornaUfficiale();
  assert.equal(ufficiale.avanzamento, "Media 68 / 75, Giorni 9 / 12");
  assert.match(ufficiale.testo, /Path to Partner/);
  assert.equal(ufficiale.aggiornatoIl, "2026-10-21T16:00:00.000Z");
  assert.deepEqual(richieste[0].opzioni, { mostra: false, estrai: true });
  const diagnostica = fs.readdirSync(path.join(contesto.cartella, "diagnostica"));
  assert.equal(diagnostica.length, 2);
  const dirette = monitor.stato().periodi[0].dirette;
  assert.deepEqual(dirette.map((voce) => [voce.giorno, voce.media, voce.conta, voce.fonte]), [
    ["2026-10-15", 77, true, "cruscotto"],
    ["2026-10-14", 30, false, "cruscotto"]
  ]);
  const rotto = prepara({ conToken: false, finestraTwitch: async () => { throw new Error("finestra chiusa"); } });
  const altro = rotto.crea();
  assert.equal(await altro.aggiornaUfficiale(), null);
  assert.match(altro.stato().ultimoErrore, /cruscotto/);
  const strano = prepara({ conToken: false, finestraTwitch: async () => ({ niente: true }) });
  const terzo = strano.crea();
  const vuoto = await terzo.aggiornaUfficiale();
  assert.equal(vuoto.avanzamento, "Avanzamento non trovato");
});

test("Spettatori in lurk letti dal sito ogni 30 secondi, con errori silenziosi", async () => {
  const contesto = prepara({ impostazioni: { lurk: true } });
  const monitor = contesto.crea();
  monitor.avvia();
  const chiamate = () => contesto.twitch.http.chiamate.filter((richiesta) => richiesta.url.includes("slayerbeard.com")).length;
  await new Promise((risolvi) => setImmediate(risolvi));
  assert.equal(chiamate(), 1);
  assert.deepEqual(monitor.stato().lurk, { presenti: 12, vivi: 9, aggiornato: "2026-10-21T16:00:00.000Z", letto: "2026-10-21T16:00:00.000Z", errore: false });
  const timerLurk = contesto.pianificatore.inAttesa().find((voce) => voce.ms === 30000);
  assert.ok(timerLurk);
  contesto.twitch.stato.lurk = 20;
  contesto.orologio.avanza(30000);
  timerLurk.annullato = true;
  await timerLurk.funzione();
  assert.equal(chiamate(), 2);
  assert.equal(monitor.stato().lurk.presenti, 20);
  contesto.twitch.stato.lurkGuasto = true;
  const secondo = contesto.pianificatore.inAttesa().find((voce) => voce.ms === 30000);
  secondo.annullato = true;
  await secondo.funzione();
  assert.equal(monitor.stato().lurk.presenti, 20);
  assert.equal(monitor.stato().lurk.errore, true);
  assert.equal(monitor.stato().ultimoErrore, null);
  assert.ok(contesto.pianificatore.inAttesa().some((voce) => voce.ms === 120000));
  await monitor.salvaImpostazioni({ lurk: false });
  assert.equal(monitor.stato().lurk, null);
  assert.equal(contesto.pianificatore.inAttesa().some((voce) => voce.ms === 120000), false);
  monitor.ferma();
});

test("TwitchTracker al massimo una volta l ora e solo se attivo", async () => {
  const contesto = prepara({ impostazioni: { tracker: true } });
  const monitor = contesto.crea();
  monitor.avvia();
  await giri(contesto, 30);
  const chiamate = () => contesto.twitch.http.chiamate.filter((richiesta) => richiesta.url.includes("twitchtracker.com")).length;
  assert.equal(chiamate(), 1);
  assert.deepEqual(monitor.stato().tracker, { aggiornatoIl: "2026-10-21T16:00:00.000Z", media30: 70, picco30: 130, minuti30: 3000, follower: 1200 });
  contesto.orologio.avanza(3600000);
  await giri(contesto, 1);
  assert.equal(chiamate(), 2);
  await monitor.salvaImpostazioni({ tracker: false });
  assert.equal(monitor.stato().tracker, null);
  contesto.orologio.avanza(2 * 3600000);
  await giri(contesto, 2);
  assert.equal(chiamate(), 2);
  monitor.ferma();
});
