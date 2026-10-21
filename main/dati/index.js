const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const { leggiJson, scriviJson, cancella, clona } = require("./archivio");
const { httpPredefinito, eseguiRichiesta, ErroreTwitch } = require("./rete");
const { creaTwitch } = require("./twitch");
const { giornoRoma, giornoValido, spostaGiorno, durataInOre, iso } = require("./tempo");
const { unisciGiorni, calcolaPeriodi, arrotonda } = require("./periodi");
const campionatore = require("./campionatore");
const { analizzaAvanzamento, analizzaRiepilogo, riassunto } = require("./cruscotto");
const { esportaCsv, mappaTracker } = require("./esporta");

const SCOPE_FOLLOWER = "moderator:read:followers";
const ORA = 3600000;
const LIMITE_TESTO_STATO = 20000;
const FILE_DIAGNOSTICA = 30;

const IMPOSTAZIONI_PREDEFINITE = {
  canale: "",
  clientId: "",
  obiettivo: { media: 75, dirette: 6, giorni: 30 },
  follower: true,
  tracker: false,
  diagnostica: false,
  importaCruscotto: true,
  notifiche: true,
  avvioConWindows: false
};

function datiVuoti() {
  return {
    versione: 1,
    giorni: {},
    manuali: {},
    video: {},
    cruscotto: {},
    diretta: null,
    periodiOk: null,
    cache: { canale: null, follower: null, ufficiale: null, tracker: null, trackerTentativo: null }
  };
}

function oggetto(valore) {
  return valore && typeof valore === "object" && !Array.isArray(valore) ? valore : {};
}

function normalizzaDati(grezzi) {
  const base = datiVuoti();
  const dati = { ...base, ...oggetto(grezzi) };
  for (const chiave of ["giorni", "manuali", "video", "cruscotto"]) dati[chiave] = oggetto(dati[chiave]);
  dati.cache = { ...base.cache, ...oggetto(dati.cache) };
  for (const [giorno, voce] of Object.entries(dati.giorni)) {
    const valida = giornoValido(giorno) && voce && Number.isFinite(voce.somma) && Number.isFinite(voce.numero) && voce.numero >= 0;
    if (!valida) delete dati.giorni[giorno];
    else if (!Number.isFinite(voce.minuti)) voce.minuti = voce.numero;
  }
  for (const chiave of ["manuali", "cruscotto"]) {
    for (const [giorno, voce] of Object.entries(dati[chiave])) if (!giornoValido(giorno) || !voce || typeof voce !== "object") delete dati[chiave][giorno];
  }
  const diretta = dati.diretta;
  if (!diretta || typeof diretta !== "object" || !giornoValido(diretta.giorno) || !Number.isFinite(diretta.ultimoVisto)) dati.diretta = null;
  else if (!Array.isArray(diretta.serie)) diretta.serie = [];
  if (dati.periodiOk && typeof dati.periodiOk !== "object") dati.periodiOk = null;
  return dati;
}

function pulisciCanale(valore) {
  return String(valore || "")
    .trim()
    .replace(/^https?:\/\/(www\.)?twitch\.tv\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 25);
}

function intero(valore, minimo, massimo, predefinito) {
  const numero = Math.round(Number(valore));
  return Number.isFinite(numero) ? Math.min(massimo, Math.max(minimo, numero)) : predefinito;
}

function normalizzaImpostazioni(grezze) {
  const sorgente = oggetto(grezze);
  const esito = { ...IMPOSTAZIONI_PREDEFINITE, ...sorgente };
  if (!sorgente.canale && sorgente.login) esito.canale = sorgente.login;
  delete esito.login;
  esito.canale = pulisciCanale(esito.canale);
  esito.clientId = String(esito.clientId || "").trim().replace(/[^A-Za-z0-9]/g, "").slice(0, 64);
  const obiettivo = oggetto(sorgente.obiettivo);
  esito.obiettivo = {
    media: intero(obiettivo.media, 1, 100000, 75),
    dirette: intero(obiettivo.dirette, 1, 30, 6),
    giorni: intero(obiettivo.giorni, 1, 90, 30)
  };
  for (const chiave of ["follower", "tracker", "diagnostica", "importaCruscotto", "notifiche", "avvioConWindows"]) esito[chiave] = Boolean(esito[chiave]);
  return esito;
}

function creaMonitor(opzioni = {}) {
  const { cartella, finestraTwitch, protezione } = opzioni;
  if (!cartella) throw new Error("cartella obbligatoria");
  const http = typeof opzioni.http === "function" ? opzioni.http : httpPredefinito;
  const adesso = () => {
    const valore = typeof opzioni.adesso === "function" ? opzioni.adesso() : Date.now();
    return valore instanceof Date ? valore.getTime() : Number(valore);
  };
  const attendi = typeof opzioni.attendi === "function" ? opzioni.attendi : (ms) => new Promise((risolvi) => setTimeout(risolvi, ms));
  const pianifica = typeof opzioni.pianifica === "function"
    ? opzioni.pianifica
    : (funzione, ms) => {
        const timer = setTimeout(funzione, ms);
        if (timer.unref) timer.unref();
        return timer;
      };
  const annulla = typeof opzioni.annulla === "function" ? opzioni.annulla : (timer) => clearTimeout(timer);

  const monitor = new EventEmitter();
  const percorsi = {
    impostazioni: path.join(cartella, "impostazioni.json"),
    campioni: path.join(cartella, "campioni.json"),
    token: path.join(cartella, "token.json"),
    diagnostica: path.join(cartella, "diagnostica")
  };

  const avvisiCorrotti = [];
  const segnalaCorrotto = (nome) => avvisiCorrotti.push(nome);
  let impostazioni = normalizzaImpostazioni(leggiJson(percorsi.impostazioni, {}, segnalaCorrotto));
  let dati = normalizzaDati(leggiJson(percorsi.campioni, datiVuoti(), segnalaCorrotto));
  let token = caricaToken();

  const vivo = {
    inOnda: null,
    spettatori: 0,
    titolo: "",
    gioco: "",
    ultimoErrore: avvisiCorrotti.length ? `File danneggiato ripristinato: ${avvisiCorrotti.join(", ")}` : null
  };

  let attivo = false;
  let timer = null;
  let inCorso = false;
  let richiestaSubito = false;
  let errori = 0;
  let ultimaValidazione = 0;
  let ultimoFollower = 0;
  let ultimoVod = 0;
  let followerNegato = false;
  let accessoInCorso = null;
  let controlloAccesso = null;
  let ufficialeInCorso = null;

  function caricaToken() {
    const grezzo = leggiJson(percorsi.token, {}, segnalaCorrotto);
    let contenuto = grezzo;
    if (typeof grezzo.cifrato === "string") {
      if (!protezione || typeof protezione.decifra !== "function") return null;
      try {
        contenuto = JSON.parse(protezione.decifra(grezzo.cifrato));
      } catch {
        return null;
      }
    }
    if (!contenuto || typeof contenuto.accessToken !== "string" || !contenuto.accessToken) return null;
    return {
      accessToken: contenuto.accessToken,
      refreshToken: typeof contenuto.refreshToken === "string" ? contenuto.refreshToken : null,
      scadeIl: Number.isFinite(contenuto.scadeIl) ? contenuto.scadeIl : null,
      scope: Array.isArray(contenuto.scope) ? contenuto.scope.map(String) : []
    };
  }

  function scriviToken(nuovo) {
    token = nuovo ? { ...nuovo } : null;
    if (!token) {
      cancella(percorsi.token);
      return;
    }
    let contenuto = token;
    if (protezione && typeof protezione.cifra === "function") {
      try {
        contenuto = { cifrato: protezione.cifra(JSON.stringify(token)) };
      } catch {}
    }
    scriviJson(percorsi.token, contenuto);
  }

  const twitch = creaTwitch({
    http,
    adesso,
    attendi,
    clientId: () => impostazioni.clientId,
    leggiToken: () => token,
    scriviToken
  });

  function salvaDati() {
    try {
      scriviJson(percorsi.campioni, dati);
    } catch {
      vivo.ultimoErrore = "Impossibile salvare i dati sul disco";
    }
  }

  function salvaImpostazioniSuDisco() {
    scriviJson(percorsi.impostazioni, impostazioni);
  }

  function evento(tipo, testo) {
    monitor.emit("evento", { tipo, testo });
  }

  function canaleAttuale() {
    const salvato = dati.cache.canale;
    if (salvato && salvato.login === impostazioni.canale) return salvato;
    return null;
  }

  function costruisciStato() {
    const obiettivo = { ...impostazioni.obiettivo };
    const istante = adesso();
    const oggi = giornoRoma(istante);
    const { periodi, completati, totali } = calcolaPeriodi(oggi, unisciGiorni(dati), obiettivo);
    const diretta = campionatore.direttaAttiva(dati);
    const media = diretta ? campionatore.mediaGiorno(dati, diretta.giorno) : null;
    const noto = canaleAttuale();
    const ufficiale = dati.cache.ufficiale;
    return {
      canale: impostazioni.canale ? { login: impostazioni.canale, nome: noto ? noto.nome : impostazioni.canale } : null,
      collegato: Boolean(token && token.accessToken),
      clientIdMancante: !impostazioni.clientId,
      inOnda: vivo.inOnda,
      spettatori: vivo.inOnda ? vivo.spettatori : 0,
      titolo: vivo.titolo,
      gioco: vivo.gioco,
      iniziataIl: diretta ? diretta.inizio : null,
      mediaDiretta: arrotonda(media),
      contaOra: media != null && media >= obiettivo.media,
      follower: dati.cache.follower,
      obiettivo,
      periodi,
      completati,
      totali,
      serieDiretta: dati.diretta ? dati.diretta.serie.map((punto) => ({ t: punto.t, v: punto.v })) : [],
      ufficiale: ufficiale
        ? {
            aggiornatoIl: ufficiale.aggiornatoIl,
            testo: String(ufficiale.testo || "").slice(0, LIMITE_TESTO_STATO),
            avanzamento: ufficiale.avanzamento,
            voci: ufficiale.voci || [],
            richiedeAccesso: Boolean(ufficiale.richiedeAccesso)
          }
        : null,
      tracker: impostazioni.tracker && dati.cache.tracker ? { ...dati.cache.tracker } : null,
      ultimoErrore: vivo.ultimoErrore,
      aggiornatoIl: iso(istante)
    };
  }

  function controllaPeriodi(stato) {
    const attuale = {};
    for (const periodo of stato.periodi) attuale[periodo.chiave] = periodo.ok;
    const prima = dati.periodiOk;
    dati.periodiOk = attuale;
    if (!prima) return;
    for (const periodo of stato.periodi) {
      if (periodo.ok && prima[periodo.chiave] === false) {
        const nome = periodo.chiave === "corrente" ? "Ultimi 30 giorni" : "30-60 giorni fa";
        evento("periodo-completato", `${nome}: ${periodo.totaleReale} dirette sopra ${stato.obiettivo.media} spettatori. Periodi completati ${stato.completati} / ${stato.totali}.`);
      }
    }
  }

  function emettiStato() {
    const stato = costruisciStato();
    const primaOk = JSON.stringify(dati.periodiOk);
    controllaPeriodi(stato);
    if (JSON.stringify(dati.periodiOk) !== primaOk) salvaDati();
    monitor.emit("stato", stato);
    return stato;
  }

  function programma(ms) {
    if (!attivo) return;
    if (timer) annulla(timer);
    timer = pianifica(() => {
      timer = null;
      return esegui();
    }, ms);
  }

  async function esegui() {
    if (!attivo) return;
    if (inCorso) {
      richiestaSubito = true;
      return;
    }
    inCorso = true;
    let ritardo;
    try {
      ritardo = await ciclo();
    } catch (errore) {
      ritardo = gestisciErrore(errore);
    } finally {
      inCorso = false;
    }
    salvaDati();
    emettiStato();
    if (richiestaSubito) {
      richiestaSubito = false;
      ritardo = 0;
    }
    programma(ritardo);
  }

  function gestisciErrore(errore) {
    errori += 1;
    const codice = errore instanceof ErroreTwitch ? errore.codice : "interno";
    if (codice === "non-autorizzato") {
      token = null;
      vivo.ultimoErrore = "Accesso a Twitch scaduto: ricollegati dalle impostazioni";
      return 60000;
    }
    if (codice === "canale") {
      vivo.ultimoErrore = "Canale Twitch non trovato: controlla il nome nelle impostazioni";
      return 5 * 60000;
    }
    const base = Math.min(10 * 60000, 30000 * 2 ** (errori - 1));
    const attesa = Math.max(base, Math.min(errore.attesa || 0, 15 * 60000));
    const secondi = Math.round(attesa / 1000);
    if (codice === "limite") vivo.ultimoErrore = `Twitch chiede di rallentare (429). Riprovo tra ${secondi} secondi.`;
    else if (codice === "rete") vivo.ultimoErrore = `Twitch non raggiungibile. Riprovo tra ${secondi} secondi.`;
    else if (codice === "http") vivo.ultimoErrore = `Twitch ha risposto con un errore (${errore.stato}). Riprovo tra ${secondi} secondi.`;
    else vivo.ultimoErrore = `Errore interno. Riprovo tra ${secondi} secondi.`;
    return attesa;
  }

  async function ciclo() {
    const istante = adesso();
    if (!impostazioni.clientId || !token || !token.accessToken) {
      vivo.inOnda = null;
      await forseTracker();
      return 60000;
    }
    if (istante - ultimaValidazione >= ORA) {
      const esito = await twitch.valida();
      ultimaValidazione = istante;
      if (esito && esito.login && !impostazioni.canale) {
        impostazioni = normalizzaImpostazioni({ ...impostazioni, canale: esito.login });
        salvaImpostazioniSuDisco();
      }
    }
    if (!impostazioni.canale) {
      await forseTracker();
      return 60000;
    }
    const canale = await assicuraCanale();
    const inOnda = await leggiStream();
    if (impostazioni.follower && !followerNegato && token && token.scope.includes(SCOPE_FOLLOWER) && istante - ultimoFollower >= 10 * 60000) {
      ultimoFollower = istante;
      try {
        const json = await twitch.helix("/channels/followers", { broadcaster_id: canale.id, first: 1 }, { facoltativa: true });
        if (Number.isFinite(Number(json.total))) dati.cache.follower = Number(json.total);
      } catch (errore) {
        if (errore.codice === "permesso") followerNegato = true;
        else throw errore;
      }
    }
    if (istante - ultimoVod >= 6 * ORA) {
      await recuperaVod(canale);
      ultimoVod = istante;
    }
    await forseTracker();
    errori = 0;
    vivo.ultimoErrore = null;
    return inOnda ? 30000 : 60000;
  }

  async function assicuraCanale() {
    const noto = canaleAttuale();
    if (noto && noto.id) return noto;
    const json = await twitch.helix("/users", { login: impostazioni.canale });
    const utente = Array.isArray(json.data) ? json.data[0] : null;
    if (!utente || !utente.id) throw new ErroreTwitch("canale non trovato", { codice: "canale" });
    dati.cache.canale = { id: String(utente.id), login: impostazioni.canale, nome: String(utente.display_name || utente.login || impostazioni.canale) };
    dati.cache.follower = null;
    return dati.cache.canale;
  }

  async function leggiStream() {
    const json = await twitch.helix("/streams", { user_login: impostazioni.canale });
    const elenco = Array.isArray(json.data) ? json.data : [];
    const diretta = elenco.find((voce) => voce && voce.type === "live") || elenco[0] || null;
    const istante = adesso();
    const prima = vivo.inOnda;
    if (diretta) {
      const spettatori = Math.max(0, Math.round(Number(diretta.viewer_count) || 0));
      const esito = campionatore.registraInOnda(dati, istante, spettatori, diretta.started_at);
      vivo.inOnda = true;
      vivo.spettatori = spettatori;
      vivo.titolo = typeof diretta.title === "string" ? diretta.title : "";
      vivo.gioco = typeof diretta.game_name === "string" ? diretta.game_name : "";
      if (esito.nuova && prima === false) evento("diretta-iniziata", `${canaleAttuale() ? canaleAttuale().nome : impostazioni.canale} e in diretta${vivo.gioco ? ` con ${vivo.gioco}` : ""}.`);
      const giudizio = campionatore.giudicaConteggio(dati, impostazioni.obiettivo.media);
      if (giudizio) {
        const media = Math.round(campionatore.mediaGiorno(dati, dati.diretta.giorno));
        if (giudizio === "sta-contando") evento("sta-contando", `La diretta sta contando: media ${media} su ${impostazioni.obiettivo.media}.`);
        else evento("sotto-media", `La diretta e scesa sotto la media: ${media} su ${impostazioni.obiettivo.media}.`);
      }
      return true;
    }
    vivo.inOnda = false;
    vivo.spettatori = 0;
    const precedente = dati.diretta ? dati.diretta.ultimoVisto : null;
    const finita = campionatore.registraOffline(dati, istante);
    if (finita && prima !== null && istante - precedente <= 20 * 60000) {
      const media = campionatore.mediaGiorno(dati, finita.giorno);
      const testoMedia = media == null ? "" : ` Media ${Math.round(media)}${media >= impostazioni.obiettivo.media ? ", conta per il Partner" : ", sotto l obiettivo"}.`;
      evento("diretta-finita", `Diretta finita.${testoMedia}`);
    }
    return false;
  }

  async function recuperaVod(canale) {
    const json = await twitch.helix("/videos", { user_id: canale.id, type: "archive", first: 100 });
    for (const video of Array.isArray(json.data) ? json.data : []) {
      if (!video || !video.id || !video.created_at) continue;
      const giorno = giornoRoma(video.created_at);
      const ore = durataInOre(video.duration);
      if (giorno && ore != null) dati.video[String(video.id)] = { giorno, ore };
    }
    const limite = spostaGiorno(giornoRoma(adesso()), -(2 * impostazioni.obiettivo.giorni + 10));
    for (const [id, video] of Object.entries(dati.video)) if (!video || video.giorno < limite) delete dati.video[id];
  }

  async function forseTracker() {
    if (!impostazioni.tracker || !impostazioni.canale) return;
    const istante = adesso();
    const cache = dati.cache;
    if (cache.trackerTentativo && istante - cache.trackerTentativo < ORA && istante >= cache.trackerTentativo) return;
    cache.trackerTentativo = istante;
    try {
      const risposta = await eseguiRichiesta(http, {
        metodo: "GET",
        url: `https://twitchtracker.com/api/channels/summary/${encodeURIComponent(impostazioni.canale)}`,
        intestazioni: { Accept: "application/json" }
      });
      const valori = risposta.stato === 200 ? mappaTracker(risposta.json) : null;
      if (valori) cache.tracker = { aggiornatoIl: iso(istante), ...valori };
    } catch {}
  }

  function scriviDiagnostica(tipo, testo) {
    if (!impostazioni.diagnostica) return;
    try {
      fs.mkdirSync(percorsi.diagnostica, { recursive: true });
      const marca = iso(adesso()).replace(/[:.]/g, "-");
      fs.writeFileSync(path.join(percorsi.diagnostica, `${tipo}-${marca}.txt`), testo, "utf8");
      const elenco = fs.readdirSync(percorsi.diagnostica).filter((nome) => nome.endsWith(".txt")).sort();
      for (const nome of elenco.slice(0, Math.max(0, elenco.length - FILE_DIAGNOSTICA))) fs.unlinkSync(path.join(percorsi.diagnostica, nome));
    } catch {}
  }

  async function leggiPagina(url, mostra) {
    const risultato = await finestraTwitch(url, { mostra, estrai: true });
    if (typeof risultato === "string") return risultato;
    if (risultato && typeof risultato.testo === "string") return risultato.testo;
    return "";
  }

  async function eseguiUfficiale(mostra) {
    if (!impostazioni.canale) throw new Error("Imposta prima il canale Twitch");
    if (typeof finestraTwitch !== "function") throw new Error("Cruscotto non disponibile");
    const base = `https://dashboard.twitch.tv/u/${encodeURIComponent(impostazioni.canale)}`;
    let testo;
    try {
      testo = String(await leggiPagina(`${base}/achievements`, mostra)).slice(0, 500000);
    } catch {
      vivo.ultimoErrore = "Non riesco ad aprire il cruscotto Twitch";
      emettiStato();
      return costruisciStato().ufficiale;
    }
    scriviDiagnostica("achievements", testo);
    const avanzamento = analizzaAvanzamento(testo);
    dati.cache.ufficiale = {
      aggiornatoIl: iso(adesso()),
      testo,
      avanzamento: riassunto(avanzamento),
      voci: avanzamento.voci,
      richiedeAccesso: avanzamento.richiedeAccesso
    };
    if (!avanzamento.richiedeAccesso) {
      try {
        const riepilogo = String(await leggiPagina(`${base}/stream-summary`, false)).slice(0, 500000);
        scriviDiagnostica("stream-summary", riepilogo);
        if (impostazioni.importaCruscotto) {
          const oggi = giornoRoma(adesso());
          const limite = spostaGiorno(oggi, -(2 * impostazioni.obiettivo.giorni));
          for (const voce of analizzaRiepilogo(riepilogo, oggi)) {
            if (voce.giorno >= limite) dati.cruscotto[voce.giorno] = { media: voce.media, ore: voce.ore };
          }
        }
      } catch {}
    }
    salvaDati();
    emettiStato();
    return costruisciStato().ufficiale;
  }

  monitor.avvia = () => {
    if (attivo) return;
    attivo = true;
    emettiStato();
    programma(0);
  };

  monitor.ferma = () => {
    attivo = false;
    if (timer) annulla(timer);
    timer = null;
    if (controlloAccesso) controlloAccesso.annullato = true;
    salvaDati();
  };

  monitor.stato = () => costruisciStato();

  monitor.accedi = () => {
    if (accessoInCorso) return accessoInCorso;
    if (!impostazioni.clientId) {
      emettiStato();
      return Promise.resolve({ ok: false, motivo: "client-id-mancante" });
    }
    const controllo = { annullato: false };
    controlloAccesso = controllo;
    const scope = impostazioni.follower ? [SCOPE_FOLLOWER] : [];
    accessoInCorso = (async () => {
      try {
        const esito = await twitch.accessoDispositivo(scope, (info) => monitor.emit("accesso", info), controllo);
        if (esito.ok) {
          scriviToken(esito.token);
          ultimaValidazione = 0;
          followerNegato = false;
          ultimoFollower = 0;
          errori = 0;
          vivo.ultimoErrore = null;
        } else if (esito.motivo !== "annullato") {
          const testi = {
            scaduto: "Il codice di accesso e scaduto: riprova",
            negato: "Accesso negato su Twitch",
            "client-id-non-valido": "Client ID non valido: controllalo su dev.twitch.tv",
            "avvio-fallito": "Twitch non ha avviato l accesso: riprova"
          };
          vivo.ultimoErrore = testi[esito.motivo] || "Accesso non riuscito";
        }
        emettiStato();
        if (esito.ok) programma(0);
        return { ok: esito.ok, motivo: esito.ok ? null : esito.motivo };
      } catch (errore) {
        vivo.ultimoErrore = errore instanceof ErroreTwitch && errore.codice === "rete" ? "Twitch non raggiungibile: riprova" : "Accesso non riuscito";
        emettiStato();
        return { ok: false, motivo: "errore" };
      } finally {
        accessoInCorso = null;
        if (controlloAccesso === controllo) controlloAccesso = null;
      }
    })();
    return accessoInCorso;
  };

  monitor.esci = async () => {
    if (controlloAccesso) controlloAccesso.annullato = true;
    const vecchio = token;
    scriviToken(null);
    vivo.inOnda = null;
    dati.cache.follower = null;
    await twitch.revoca(vecchio);
    emettiStato();
    return true;
  };

  monitor.impostazioni = () => clona(impostazioni);

  monitor.salvaImpostazioni = async (parziale) => {
    const nuove = oggetto(parziale);
    const unite = { ...impostazioni, ...nuove, obiettivo: { ...impostazioni.obiettivo, ...oggetto(nuove.obiettivo) } };
    const prima = impostazioni;
    impostazioni = normalizzaImpostazioni(unite);
    if (prima.clientId !== impostazioni.clientId && token) scriviToken(null);
    if (prima.canale !== impostazioni.canale) {
      dati.cache.follower = null;
      dati.cache.tracker = null;
      dati.cache.trackerTentativo = null;
      dati.cache.ufficiale = null;
      ultimoVod = 0;
      vivo.inOnda = null;
    }
    salvaImpostazioniSuDisco();
    salvaDati();
    emettiStato();
    programma(0);
    return clona(impostazioni);
  };

  monitor.aggiungiManuale = async (voce) => {
    const { giorno, media, ore } = oggetto(voce);
    if (!giornoValido(giorno)) throw new Error("Giorno non valido, usa AAAA-MM-GG");
    if (giorno > giornoRoma(adesso())) throw new Error("Il giorno e nel futuro");
    const numeroMedia = Number(media);
    if (media == null || media === "" || !Number.isFinite(numeroMedia) || numeroMedia < 0) throw new Error("Media non valida");
    const numeroOre = ore == null || ore === "" ? null : Number(ore);
    if (numeroOre != null && (!Number.isFinite(numeroOre) || numeroOre < 0 || numeroOre > 48)) throw new Error("Ore non valide");
    dati.manuali[giorno] = { media: numeroMedia, ore: numeroOre };
    salvaDati();
    return emettiStato();
  };

  monitor.rimuoviManuale = async (giorno) => {
    delete dati.manuali[giorno];
    salvaDati();
    return emettiStato();
  };

  monitor.aggiornaUfficiale = (opzioniUfficiale = {}) => {
    if (!ufficialeInCorso) {
      ufficialeInCorso = eseguiUfficiale(Boolean(oggetto(opzioniUfficiale).mostra)).finally(() => {
        ufficialeInCorso = null;
      });
    }
    return ufficialeInCorso;
  };

  monitor.esportaCsv = () => esportaCsv(unisciGiorni(dati), impostazioni.obiettivo);

  return monitor;
}

module.exports = { creaMonitor, normalizzaImpostazioni, pulisciCanale };
