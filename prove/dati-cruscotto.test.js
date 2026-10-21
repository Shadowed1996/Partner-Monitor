const test = require("node:test");
const assert = require("node:assert/strict");
const { analizzaAvanzamento, analizzaRiepilogo, riassunto, leggiNumero } = require("../main/dati/cruscotto");

test("avanzamento in inglese", () => {
  const testo = "Path to Partner\nStream for 25 hours\n25/25\nStream on 12 different days 12/12\nAverage of 75 viewers 68/75";
  const esito = analizzaAvanzamento(testo);
  assert.equal(esito.trovato, true);
  assert.equal(esito.richiedeAccesso, false);
  const media = esito.voci.find((voce) => voce.tipo === "media");
  assert.deepEqual([media.attuale, media.richiesto], [68, 75]);
  assert.equal(esito.voci.find((voce) => voce.tipo === "ore").attuale, 25);
  assert.equal(riassunto(esito), "Media 68 / 75, Giorni 12 / 12");
});

test("avanzamento in italiano con percentuale", () => {
  const esito = analizzaAvanzamento("Percorso per diventare Partner\nMedia di 75 spettatori\n80 di 75\nCompletato 40%");
  assert.equal(esito.voci[0].tipo, "media");
  assert.equal(esito.voci[0].attuale, 80);
  assert.equal(esito.percentuale, 40);
});

test("pagina di accesso e testo inutile non rompono il parser", () => {
  assert.equal(analizzaAvanzamento("Accedi a Twitch\nNome utente\nPassword").richiedeAccesso, true);
  assert.equal(riassunto(analizzaAvanzamento("Accedi a Twitch")), "Serve accedere a Twitch nella finestra del cruscotto");
  for (const strano of [null, undefined, 42, {}, "", "x".repeat(2000000)]) {
    const esito = analizzaAvanzamento(strano);
    assert.ok(Array.isArray(esito.voci));
  }
  assert.equal(riassunto(analizzaAvanzamento("niente")), "Avanzamento non trovato");
  assert.deepEqual(analizzaRiepilogo(null, "2026-10-21"), []);
});

test("riepilogo dirette: formati di data diversi", () => {
  const testo = [
    "Stream summary",
    "Oct 19, 2026",
    "3h 20m",
    "Average viewers 81",
    "18 ottobre",
    "Spettatori medi",
    "1.204",
    "2026-10-17",
    "Average viewers 64,5",
    "25 dic",
    "Average viewers 99"
  ].join("\n");
  const esito = analizzaRiepilogo(testo, "2026-10-21");
  const perGiorno = Object.fromEntries(esito.map((voce) => [voce.giorno, voce]));
  assert.equal(perGiorno["2026-10-19"].media, 81);
  assert.ok(Math.abs(perGiorno["2026-10-19"].ore - 3.3333) < 0.01);
  assert.equal(perGiorno["2026-10-18"].media, 1204);
  assert.equal(perGiorno["2026-10-17"].media, 64.5);
  assert.equal(perGiorno["2025-12-25"].media, 99);
});

test("numeri con separatori", () => {
  assert.equal(leggiNumero("1.234"), 1234);
  assert.equal(leggiNumero("1,234"), 1234);
  assert.equal(leggiNumero("75,5"), 75.5);
  assert.equal(leggiNumero("abc"), null);
});
