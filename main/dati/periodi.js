const { spostaGiorno } = require("./tempo");

const PRIORITA = { manuale: 4, campione: 3, cruscotto: 2, vod: 1 };

function numeroONull(valore) {
  const numero = Number(valore);
  return valore == null || valore === "" || !Number.isFinite(numero) ? null : numero;
}

function arrotonda(valore, cifre = 2) {
  if (valore == null) return null;
  const fattore = 10 ** cifre;
  return Math.round(valore * fattore) / fattore;
}

function oreVod(dati) {
  const perGiorno = {};
  for (const video of Object.values(dati.video || {})) {
    if (!video || typeof video.giorno !== "string") continue;
    const ore = numeroONull(video.ore);
    if (ore == null) continue;
    perGiorno[video.giorno] = (perGiorno[video.giorno] || 0) + ore;
  }
  return perGiorno;
}

function unisciGiorni(dati) {
  const candidati = {};
  const aggiungi = (giorno, voce) => {
    (candidati[giorno] = candidati[giorno] || []).push(voce);
  };
  for (const [giorno, voce] of Object.entries(dati.giorni || {})) {
    if (!voce || !(voce.numero > 0)) continue;
    aggiungi(giorno, { fonte: "campione", mediaGrezza: voce.somma / voce.numero, ore: (voce.minuti || voce.numero) / 60 });
  }
  for (const [giorno, ore] of Object.entries(oreVod(dati))) {
    aggiungi(giorno, { fonte: "vod", mediaGrezza: null, ore });
  }
  for (const [giorno, voce] of Object.entries(dati.cruscotto || {})) {
    if (!voce) continue;
    aggiungi(giorno, { fonte: "cruscotto", mediaGrezza: numeroONull(voce.media), ore: numeroONull(voce.ore) });
  }
  for (const [giorno, voce] of Object.entries(dati.manuali || {})) {
    if (!voce) continue;
    aggiungi(giorno, { fonte: "manuale", mediaGrezza: numeroONull(voce.media), ore: numeroONull(voce.ore) });
  }
  const uniti = {};
  for (const [giorno, voci] of Object.entries(candidati)) {
    voci.sort((a, b) => PRIORITA[b.fonte] - PRIORITA[a.fonte]);
    const scelta = voci[0];
    const altreOre = voci.map((voce) => voce.ore).filter((ore) => ore != null);
    let ore = scelta.ore;
    if (scelta.fonte === "campione" && altreOre.length) ore = Math.max(...altreOre);
    if (ore == null && altreOre.length) ore = Math.max(...altreOre);
    uniti[giorno] = { giorno, mediaGrezza: scelta.mediaGrezza, ore, fonte: scelta.fonte };
  }
  return uniti;
}

function conta(voce, obiettivo) {
  return voce.mediaGrezza != null && voce.mediaGrezza >= obiettivo.media;
}

function voceVisibile(voce, obiettivo) {
  return {
    giorno: voce.giorno,
    media: arrotonda(voce.mediaGrezza),
    ore: arrotonda(voce.ore),
    conta: conta(voce, obiettivo),
    fonte: voce.fonte
  };
}

function calcolaPeriodi(oggi, uniti, obiettivo) {
  const lunghezza = obiettivo.giorni;
  const confini = [
    { chiave: "corrente", da: spostaGiorno(oggi, -(lunghezza - 1)), a: oggi },
    { chiave: "precedente", da: spostaGiorno(oggi, -(2 * lunghezza - 1)), a: spostaGiorno(oggi, -lunghezza) }
  ];
  const periodi = confini.map(({ chiave, da, a }) => {
    const dirette = Object.values(uniti)
      .filter((voce) => voce.giorno >= da && voce.giorno <= a)
      .sort((x, y) => (x.giorno < y.giorno ? 1 : -1))
      .map((voce) => voceVisibile(voce, obiettivo));
    const totaleReale = dirette.filter((voce) => voce.conta).length;
    return {
      chiave,
      da,
      a,
      confermate: Math.min(totaleReale, obiettivo.dirette),
      totaleReale,
      richieste: obiettivo.dirette,
      ok: totaleReale >= obiettivo.dirette,
      dirette
    };
  });
  return { periodi, completati: periodi.filter((periodo) => periodo.ok).length, totali: periodi.length };
}

module.exports = { unisciGiorni, calcolaPeriodi, voceVisibile, arrotonda, PRIORITA };
