const test = require("node:test");
const assert = require("node:assert/strict");
const { giornoRoma, spostaGiorno, durataInOre, giornoValido } = require("../main/dati/tempo");
const { unisciGiorni, calcolaPeriodi } = require("../main/dati/periodi");
const { esportaCsv, mappaTracker } = require("../main/dati/esporta");
const campionatore = require("../main/dati/campionatore");

const OBIETTIVO = { media: 75, dirette: 6, giorni: 30 };

function datiCon(giorni = {}, extra = {}) {
  return { giorni, manuali: {}, video: {}, cruscotto: {}, diretta: null, ...extra };
}

function campione(media, minuti = 120) {
  return { somma: media * minuti, numero: minuti, minuti };
}

test("fuso di Roma: mezzanotte con ora legale e solare", () => {
  assert.equal(giornoRoma("2026-10-20T21:59:59Z"), "2026-10-20");
  assert.equal(giornoRoma("2026-10-20T22:00:00Z"), "2026-10-21");
  assert.equal(giornoRoma("2026-12-31T22:59:59Z"), "2026-12-31");
  assert.equal(giornoRoma("2026-12-31T23:00:00Z"), "2027-01-01");
  assert.equal(giornoRoma("2026-10-25T22:59:00Z"), "2026-10-25");
  assert.equal(giornoRoma("2026-10-25T23:00:00Z"), "2026-10-26");
  assert.equal(giornoRoma("2026-03-28T23:00:00Z"), "2026-03-29");
  assert.equal(giornoRoma("2026-03-29T22:00:00Z"), "2026-03-30");
  assert.equal(giornoRoma("non una data"), null);
});

test("aritmetica dei giorni e durate dei VOD", () => {
  assert.equal(spostaGiorno("2026-03-01", -1), "2026-02-28");
  assert.equal(spostaGiorno("2028-03-01", -1), "2028-02-29");
  assert.equal(spostaGiorno("2026-12-31", 1), "2027-01-01");
  assert.equal(durataInOre("3h30m0s"), 3.5);
  assert.equal(durataInOre("45m"), 0.75);
  assert.equal(durataInOre("abc"), null);
  assert.equal(durataInOre(null), null);
  assert.equal(giornoValido("2026-02-30"), false);
  assert.equal(giornoValido("2026-02-28"), true);
});

test("periodi: bordi a 30 e 60 giorni", () => {
  const giorni = {
    "2026-10-21": campione(80),
    "2026-09-22": campione(80),
    "2026-09-21": campione(80),
    "2026-08-23": campione(80),
    "2026-08-22": campione(80)
  };
  const { periodi } = calcolaPeriodi("2026-10-21", unisciGiorni(datiCon(giorni)), OBIETTIVO);
  const [corrente, precedente] = periodi;
  assert.equal(corrente.da, "2026-09-22");
  assert.equal(corrente.a, "2026-10-21");
  assert.equal(precedente.da, "2026-08-23");
  assert.equal(precedente.a, "2026-09-21");
  assert.deepEqual(corrente.dirette.map((voce) => voce.giorno), ["2026-10-21", "2026-09-22"]);
  assert.deepEqual(precedente.dirette.map((voce) => voce.giorno), ["2026-09-21", "2026-08-23"]);
});

test("periodi: 6 giorni distinti sopra la media, cap e soglia esatta", () => {
  const giorni = {};
  for (let indice = 0; indice < 8; indice += 1) giorni[spostaGiorno("2026-10-21", -indice * 2)] = campione(75);
  giorni["2026-10-20"] = campione(74.99);
  const { periodi, completati, totali } = calcolaPeriodi("2026-10-21", unisciGiorni(datiCon(giorni)), OBIETTIVO);
  const corrente = periodi[0];
  assert.equal(corrente.totaleReale, 8);
  assert.equal(corrente.confermate, 6);
  assert.equal(corrente.richieste, 6);
  assert.equal(corrente.ok, true);
  assert.equal(corrente.dirette.find((voce) => voce.giorno === "2026-10-20").conta, false);
  assert.equal(completati, 1);
  assert.equal(totali, 2);
});

test("periodi: cinque giorni non bastano, buchi non penalizzano", () => {
  const giorni = {};
  for (const indice of [0, 3, 10, 20, 29]) giorni[spostaGiorno("2026-10-21", -indice)] = campione(90);
  giorni["2026-10-15"] = campione(10);
  const { periodi } = calcolaPeriodi("2026-10-21", unisciGiorni(datiCon(giorni)), OBIETTIVO);
  assert.equal(periodi[0].totaleReale, 5);
  assert.equal(periodi[0].ok, false);
  assert.equal(periodi[0].dirette.length, 6);
});

test("a parita di giorno vince il manuale, poi campione, cruscotto, vod", () => {
  const dati = datiCon(
    { "2026-10-10": campione(60, 90), "2026-10-11": campione(80, 60) },
    {
      manuali: { "2026-10-10": { media: 90, ore: 2 } },
      cruscotto: { "2026-10-11": { media: 50, ore: 1 }, "2026-10-12": { media: 77, ore: 3 } },
      video: { a: { giorno: "2026-10-11", ore: 4 }, b: { giorno: "2026-10-13", ore: 2.5 } }
    }
  );
  const uniti = unisciGiorni(dati);
  assert.equal(uniti["2026-10-10"].fonte, "manuale");
  assert.equal(uniti["2026-10-10"].mediaGrezza, 90);
  assert.equal(uniti["2026-10-10"].ore, 2);
  assert.equal(uniti["2026-10-11"].fonte, "campione");
  assert.equal(uniti["2026-10-11"].ore, 4);
  assert.equal(uniti["2026-10-12"].fonte, "cruscotto");
  assert.equal(uniti["2026-10-13"].fonte, "vod");
  assert.equal(uniti["2026-10-13"].mediaGrezza, null);
  const { periodi } = calcolaPeriodi("2026-10-21", uniti, OBIETTIVO);
  assert.equal(periodi[0].dirette.find((voce) => voce.giorno === "2026-10-13").conta, false);
  assert.equal(periodi[0].totaleReale, 3);
});

test("campionatore: un campione al minuto, diretta oltre la mezzanotte resta sul giorno di inizio", () => {
  const dati = datiCon();
  const inizio = Date.parse("2026-10-20T21:30:00Z");
  for (let secondi = 0; secondi < 60 * 60; secondi += 30) {
    campionatore.registraInOnda(dati, inizio + secondi * 1000, 100, "2026-10-20T21:30:00Z");
  }
  assert.deepEqual(Object.keys(dati.giorni), ["2026-10-20"]);
  assert.equal(dati.giorni["2026-10-20"].numero, 60);
  assert.equal(dati.giorni["2026-10-20"].minuti, 60);
  assert.equal(dati.diretta.serie.length, 60);
});

test("campionatore: buco di 10 minuti stessa diretta, oltre nuova diretta", () => {
  const dati = datiCon();
  const t0 = Date.parse("2026-10-21T18:00:00Z");
  assert.equal(campionatore.registraInOnda(dati, t0, 50, "2026-10-21T18:00:00Z").nuova, true);
  assert.equal(campionatore.registraOffline(dati, t0 + 5 * 60000), null);
  assert.equal(campionatore.registraInOnda(dati, t0 + 10 * 60000, 60, "2026-10-21T18:09:00Z").nuova, false);
  assert.equal(campionatore.registraOffline(dati, t0 + 20 * 60000 + 1), dati.diretta);
  assert.equal(dati.diretta.chiusa, true);
  assert.equal(campionatore.registraInOnda(dati, t0 + 30 * 60000, 70, "2026-10-21T18:29:00Z").nuova, true);
});

test("campionatore: la serie dettagliata tiene solo le ultime 12 ore", () => {
  const dati = datiCon();
  const t0 = Date.parse("2026-10-21T00:00:00Z");
  for (let minuto = 0; minuto < 14 * 60; minuto += 1) campionatore.registraInOnda(dati, t0 + minuto * 60000, 10, "2026-10-21T00:00:00Z");
  assert.ok(dati.diretta.serie.length <= 12 * 60 + 1);
  assert.equal(dati.giorni[dati.diretta.giorno].numero, 14 * 60);
});

test("esportaCsv: intestazione e righe", () => {
  const uniti = unisciGiorni(datiCon({ "2026-10-02": campione(80, 90) }, { manuali: { "2026-10-01": { media: 70, ore: null } } }));
  const csv = esportaCsv(uniti, OBIETTIVO);
  assert.equal(csv, "giorno,media,ore,conta,fonte\r\n2026-10-01,70.00,,no,manuale\r\n2026-10-02,80.00,1.50,si,campione\r\n");
});

test("mappaTracker tollera dati mancanti", () => {
  assert.deepEqual(mappaTracker({ avg_viewers: 70, max_viewers: 130, minutes_streamed: 3000, followers: 5 }), { media30: 70, picco30: 130, minuti30: 3000, follower: 5 });
  assert.equal(mappaTracker(null), null);
  assert.deepEqual(mappaTracker({}), { media30: null, picco30: null, minuti30: null, follower: null });
});
