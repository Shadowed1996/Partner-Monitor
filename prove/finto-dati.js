const { EventEmitter } = require("node:events");

const SCENARI = ["primo-avvio", "accesso", "offline", "live-1", "live-conta", "periodo-completo", "errore", "vuoto"];

function giornoIso(data) {
  const anno = data.getFullYear();
  const mese = String(data.getMonth() + 1).padStart(2, "0");
  const giorno = String(data.getDate()).padStart(2, "0");
  return `${anno}-${mese}-${giorno}`;
}

function giorniFa(numero) {
  const data = new Date();
  data.setHours(12, 0, 0, 0);
  data.setDate(data.getDate() - numero);
  return data;
}

function diretta(giorniIndietro, media, ore, fonte = "campione") {
  return { giorno: giornoIso(giorniFa(giorniIndietro)), media, ore, conta: media !== null && media >= 75, fonte };
}

function costruisciPeriodo(chiave, inizio, dirette) {
  const confermate = dirette.filter((voce) => voce.conta).length;
  return {
    chiave,
    da: giornoIso(giorniFa(inizio + 29)),
    a: giornoIso(giorniFa(inizio)),
    confermate: Math.min(confermate, 6),
    totaleReale: confermate,
    richieste: 6,
    ok: confermate >= 6,
    dirette: dirette.sort((a, b) => (a.giorno < b.giorno ? 1 : -1))
  };
}

function serie(minuti, base, crescita, rumore) {
  const fine = Date.now();
  const punti = [];
  for (let indice = minuti; indice >= 0; indice -= 1) {
    const avanzamento = 1 - indice / Math.max(minuti, 1);
    const onda = Math.sin(indice / 9) * rumore + Math.cos(indice / 23) * rumore * 0.6;
    const valore = Math.max(0, Math.round(base + crescita * Math.sqrt(avanzamento) + onda));
    punti.push({ t: new Date(fine - indice * 60000).toISOString(), v: valore });
  }
  return punti;
}

function direttePeriodi(variante) {
  if (variante === "vuoto") {
    return [costruisciPeriodo("corrente", 0, []), costruisciPeriodo("precedente", 30, [])];
  }
  if (variante === "completo") {
    return [
      costruisciPeriodo("corrente", 0, [
        diretta(1, 96, 4.2), diretta(3, 88, 3.5), diretta(6, 79, 5.1), diretta(9, 63, 3), diretta(12, 102, 4.6),
        diretta(15, 77, 3.2), diretta(19, 84, 4), diretta(24, 71, 2.5, "manuale")
      ]),
      costruisciPeriodo("precedente", 30, [
        diretta(32, 81, 3.8), diretta(36, 58, 3), diretta(41, 76, 4.1, "cruscotto"), diretta(47, 69, 2.2), diretta(53, null, 3.4, "vod")
      ])
    ];
  }
  return [
    costruisciPeriodo("corrente", 0, [
      diretta(2, 82, 4.1), diretta(4, 61, 3.2), diretta(7, 77, 5), diretta(11, 49, 2.6), diretta(16, 91, 4.4, "manuale"), diretta(22, null, 3, "vod")
    ]),
    costruisciPeriodo("precedente", 30, [
      diretta(33, 78, 3.1), diretta(38, 55, 2.8), diretta(44, 86, 4), diretta(50, 75, 3.3, "cruscotto")
    ])
  ];
}

function statoScenario(nome, impostazioni) {
  const base = {
    canale: { login: "slayer_beard", nome: "Slayer_Beard" },
    collegato: true,
    clientIdMancante: false,
    inOnda: false,
    spettatori: 0,
    titolo: "",
    gioco: "",
    iniziataIl: null,
    mediaDiretta: null,
    contaOra: false,
    follower: 1284,
    obiettivo: { media: 75, dirette: 6, giorni: 30 },
    periodi: direttePeriodi("normale"),
    completati: 0,
    totali: 2,
    serieDiretta: [],
    ufficiale: null,
    tracker: null,
    lurk: { presenti: 7, vivi: 5, aggiornato: new Date().toISOString(), letto: new Date().toISOString(), errore: false },
    ultimoErrore: null,
    aggiornatoIl: new Date().toISOString()
  };
  if (nome === "primo-avvio") {
    return { ...base, canale: null, collegato: false, clientIdMancante: true, inOnda: null, follower: null, periodi: direttePeriodi("vuoto") };
  }
  if (nome === "accesso") {
    return { ...base, canale: { login: impostazioni.canale || "slayer_beard", nome: "Slayer_Beard" }, collegato: false, inOnda: null, follower: null, periodi: direttePeriodi("vuoto") };
  }
  if (nome === "vuoto") {
    return { ...base, periodi: direttePeriodi("vuoto"), follower: 312 };
  }
  if (nome === "live-1") {
    return {
      ...base,
      inOnda: true,
      spettatori: 1,
      titolo: "Prima diretta del giorno, si parte piano",
      gioco: "Just Chatting",
      iniziataIl: new Date(Date.now() - 4 * 60000).toISOString(),
      mediaDiretta: 1,
      serieDiretta: serie(4, 0, 1, 0)
    };
  }
  if (nome === "live-conta") {
    return {
      ...base,
      inOnda: true,
      spettatori: 92,
      titolo: "Titolo della diretta di prova",
      gioco: "Gioco di prova",
      iniziataIl: new Date(Date.now() - 194 * 60000).toISOString(),
      mediaDiretta: 81,
      contaOra: true,
      serieDiretta: serie(194, 42, 58, 7),
      ufficiale: {
        aggiornatoIl: new Date(Date.now() - 3 * 3600000).toISOString(),
        testo: "Path to Partner\nStream for 25 hours 25/25\nStream on 12 different days 12/12\nAverage of 75 viewers 68/75",
        avanzamento: "Media 68 / 75, Giorni 12 / 12",
        voci: [
          { etichetta: "Trasmetti per 25 ore", tipo: "ore", attuale: 25, richiesto: 25 },
          { etichetta: "Trasmetti in 12 giorni diversi", tipo: "giorni", attuale: 12, richiesto: 12 },
          { etichetta: "Media di 75 spettatori", tipo: "media", attuale: 68, richiesto: 75 }
        ],
        richiedeAccesso: false
      },
      tracker: { aggiornatoIl: new Date(Date.now() - 40 * 60000).toISOString(), media30: 71, picco30: 133, minuti30: 3120, follower: 1281 },
      lurk: { presenti: 34, vivi: 29, aggiornato: new Date().toISOString(), letto: new Date().toISOString(), errore: false }
    };
  }
  if (nome === "periodo-completo") {
    return {
      ...base,
      inOnda: false,
      periodi: direttePeriodi("completo"),
      completati: 1,
      ufficiale: { aggiornatoIl: new Date(Date.now() - 26 * 3600000).toISOString(), testo: "Path to Partner\nAverage of 75 viewers 79/75", avanzamento: "Media 79 / 75" }
    };
  }
  if (nome === "errore") {
    return { ...base, inOnda: null, ultimoErrore: "Twitch non risponde (429). Riprovo tra 60 secondi." };
  }
  return base;
}

function creaMonitor() {
  const emettitore = new EventEmitter();
  let impostazioni = {
    canale: "slayer_beard",
    clientId: "finto0123456789abcdef",
    obiettivo: { media: 75, dirette: 6, giorni: 30 },
    avvioConWindows: false,
    notifiche: process.env.PARTNER_COLLAUDO ? false : true,
    tracker: true
  };
  let scenario = SCENARI.includes(process.env.PARTNER_SCENARIO) ? process.env.PARTNER_SCENARIO : "live-conta";
  let stato = statoScenario(scenario, impostazioni);
  let timer = null;
  let accessoInCorso = null;

  function emetti() {
    stato = { ...stato, aggiornatoIl: new Date().toISOString() };
    emettitore.emit("stato", stato);
  }

  function imposta(nome) {
    scenario = nome;
    stato = statoScenario(nome, impostazioni);
    if (nome === "primo-avvio") {
      impostazioni = { ...impostazioni, canale: "", clientId: "" };
    }
    emetti();
    if (nome === "accesso") {
      emettitore.emit("accesso", { codice: "WDJB-MJHT", url: "https://www.twitch.tv/activate?device-code=WDJBMJHT", scadeTra: 1800 });
    }
  }

  function ricalcola() {
    const periodi = stato.periodi.map((periodo) => costruisciPeriodo(periodo.chiave, periodo.chiave === "corrente" ? 0 : 30, periodo.dirette));
    stato = { ...stato, periodi, completati: periodi.filter((periodo) => periodo.ok).length };
  }

  emettitore.avvia = () => {
    if (scenario === "accesso") {
      setTimeout(() => emettitore.emit("accesso", { codice: "WDJB-MJHT", url: "https://www.twitch.tv/activate?device-code=WDJBMJHT", scadeTra: 1800 }), 200);
    }
    timer = setInterval(() => {
      if (stato.inOnda && scenario === "live-conta") {
        const ultimo = stato.serieDiretta[stato.serieDiretta.length - 1];
        const valore = Math.max(60, Math.round(ultimo.v + (Math.random() - 0.48) * 6));
        stato = { ...stato, spettatori: valore, serieDiretta: [...stato.serieDiretta, { t: new Date().toISOString(), v: valore }] };
        emetti();
      }
    }, 5000);
    emetti();
  };
  emettitore.ferma = () => {
    clearInterval(timer);
    clearTimeout(accessoInCorso);
  };
  emettitore.stato = () => stato;
  emettitore.accedi = async () => {
    emettitore.emit("accesso", { codice: "WDJB-MJHT", url: "https://www.twitch.tv/activate?device-code=WDJBMJHT", scadeTra: 1800 });
    clearTimeout(accessoInCorso);
    return new Promise((risolvi) => {
      accessoInCorso = setTimeout(() => {
        scenario = "offline";
        stato = { ...statoScenario("offline", impostazioni), canale: { login: impostazioni.canale || "slayer_beard", nome: "Slayer_Beard" } };
        emetti();
        risolvi({ ok: true, motivo: null });
      }, 8000);
    });
  };
  emettitore.esci = async () => {
    stato = { ...stato, collegato: false };
    emetti();
    return true;
  };
  emettitore.impostazioni = () => impostazioni;
  emettitore.salvaImpostazioni = async (parziale) => {
    impostazioni = { ...impostazioni, ...parziale, obiettivo: { ...impostazioni.obiettivo, ...(parziale.obiettivo || {}) } };
    stato = {
      ...stato,
      obiettivo: { ...impostazioni.obiettivo },
      clientIdMancante: !impostazioni.clientId,
      canale: impostazioni.canale ? { login: impostazioni.canale, nome: stato.canale ? stato.canale.nome : impostazioni.canale } : null
    };
    emetti();
    return impostazioni;
  };
  emettitore.aggiungiManuale = async ({ giorno, media, ore }) => {
    const voce = { giorno, media: Number(media), ore: Number(ore), conta: Number(media) >= stato.obiettivo.media, fonte: "manuale" };
    const limite = giornoIso(giorniFa(29));
    const chiave = giorno >= limite ? "corrente" : "precedente";
    stato = {
      ...stato,
      periodi: stato.periodi.map((periodo) => (periodo.chiave === chiave ? { ...periodo, dirette: [...periodo.dirette.filter((d) => d.giorno !== giorno), voce] } : periodo))
    };
    ricalcola();
    emetti();
    return true;
  };
  emettitore.rimuoviManuale = async (giorno) => {
    stato = {
      ...stato,
      periodi: stato.periodi.map((periodo) => ({ ...periodo, dirette: periodo.dirette.filter((d) => !(d.giorno === giorno && d.fonte === "manuale")) }))
    };
    ricalcola();
    emetti();
    return true;
  };
  emettitore.aggiornaUfficiale = async () => {
    await new Promise((risolvi) => setTimeout(risolvi, 1200));
    stato = { ...stato, ufficiale: { aggiornatoIl: new Date().toISOString(), testo: "Path to Partner\nAverage of 75 viewers 70/75", avanzamento: "Media 70 / 75", voci: [{ etichetta: "Media di 75 spettatori", tipo: "media", attuale: 70, richiesto: 75 }], richiedeAccesso: false } };
    emetti();
    return stato.ufficiale;
  };
  emettitore.esportaCsv = () => {
    const righe = ["periodo;giorno;media;ore;conta;fonte"];
    for (const periodo of stato.periodi) {
      for (const voce of periodo.dirette) {
        righe.push([periodo.chiave, voce.giorno, voce.media === null ? "" : voce.media, voce.ore, voce.conta ? "si" : "no", voce.fonte].join(";"));
      }
    }
    return righe.join("\n");
  };
  emettitore.scenario = imposta;
  emettitore.scenari = SCENARI;
  creaMonitor.ultimo = emettitore;
  return emettitore;
}

module.exports = { creaMonitor, SCENARI };
