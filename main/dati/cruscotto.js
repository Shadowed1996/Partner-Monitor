const { giornoValido } = require("./tempo");

const MESI = {
  gen: 1, gennaio: 1, jan: 1, january: 1,
  feb: 2, febbraio: 2, february: 2,
  mar: 3, marzo: 3, march: 3,
  apr: 4, aprile: 4, april: 4,
  mag: 5, maggio: 5, may: 5,
  giu: 6, giugno: 6, jun: 6, june: 6,
  lug: 7, luglio: 7, jul: 7, july: 7,
  ago: 8, agosto: 8, aug: 8, august: 8,
  set: 9, sett: 9, settembre: 9, sep: 9, sept: 9, september: 9,
  ott: 10, ottobre: 10, oct: 10, october: 10,
  nov: 11, novembre: 11, november: 11,
  dic: 12, dicembre: 12, dec: 12, december: 12
};

const NOMI_MESI = Object.keys(MESI).sort((a, b) => b.length - a.length).join("|");

function testoSicuro(testo) {
  return typeof testo === "string" ? testo.replace(/\r/g, "").slice(0, 500000) : "";
}

function righe(testo) {
  return testoSicuro(testo)
    .split("\n")
    .map((riga) => riga.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function leggiNumero(grezzo) {
  if (grezzo == null) return null;
  const pulito = String(grezzo).replace(/\s/g, "");
  if (/^\d{1,3}([.,]\d{3})+$/.test(pulito)) return Number(pulito.replace(/[.,]/g, ""));
  const numero = Number(pulito.replace(",", "."));
  return Number.isFinite(numero) ? numero : null;
}

function tipoVoce(etichetta) {
  if (/spettator|viewer/i.test(etichetta)) return "media";
  if (/\bor[ae]\b|hour/i.test(etichetta)) return "ore";
  if (/giorn|day|dirett|stream|trasmission/i.test(etichetta)) return "giorni";
  if (/follower/i.test(etichetta)) return "follower";
  return "altro";
}

function analizzaAvanzamento(testo) {
  const linee = righe(testo);
  const unito = linee.join("\n");
  const trovato = /partner/i.test(unito);
  const richiedeAccesso = !trovato && /(accedi|log ?in|sign ?in|iscriviti)/i.test(unito);
  const voci = [];
  const frazione = /(\d[\d.,]*)\s*(?:\/|di|of|su)\s*(\d[\d.,]*)/gi;
  linee.forEach((riga, indice) => {
    for (const esito of riga.matchAll(frazione)) {
      const attuale = leggiNumero(esito[1]);
      const richiesto = leggiNumero(esito[2]);
      if (attuale == null || richiesto == null || richiesto <= 0 || richiesto > 100000) continue;
      let etichetta = riga.replace(esito[0], "").replace(/\s+/g, " ").trim();
      if (!/[a-zà-ú]/i.test(etichetta) && indice > 0) etichetta = linee[indice - 1];
      voci.push({ etichetta: etichetta.slice(0, 120), tipo: tipoVoce(etichetta), attuale, richiesto });
      if (voci.length >= 20) return;
    }
  });
  const percentuale = /(\d{1,3}(?:[.,]\d+)?)\s*%/.exec(unito);
  return {
    trovato,
    richiedeAccesso,
    voci,
    percentuale: percentuale ? leggiNumero(percentuale[1]) : null
  };
}

function riassunto(avanzamento) {
  if (!avanzamento) return "Nessun dato";
  if (avanzamento.richiedeAccesso) return "Serve accedere a Twitch nella finestra del cruscotto";
  const media = avanzamento.voci.find((voce) => voce.tipo === "media");
  const giorni = avanzamento.voci.find((voce) => voce.tipo === "giorni");
  const parti = [];
  if (media) parti.push(`Media ${media.attuale} / ${media.richiesto}`);
  if (giorni) parti.push(`Giorni ${giorni.attuale} / ${giorni.richiesto}`);
  if (!parti.length && avanzamento.percentuale != null) parti.push(`Avanzamento ${avanzamento.percentuale}%`);
  if (!parti.length) return avanzamento.trovato ? "Pagina letta, avanzamento non riconosciuto" : "Avanzamento non trovato";
  return parti.join(", ");
}

function annoProbabile(mese, numero, oggi) {
  const annoOggi = Number(oggi.slice(0, 4));
  const candidato = `${annoOggi}-${String(mese).padStart(2, "0")}-${String(numero).padStart(2, "0")}`;
  return candidato > oggi ? annoOggi - 1 : annoOggi;
}

function componi(anno, mese, numero) {
  const giorno = `${anno}-${String(mese).padStart(2, "0")}-${String(numero).padStart(2, "0")}`;
  return giornoValido(giorno) ? giorno : null;
}

function trovaData(riga, oggi) {
  let esito = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(riga);
  if (esito) return componi(Number(esito[1]), Number(esito[2]), Number(esito[3]));
  esito = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(riga);
  if (esito) return componi(Number(esito[3]), Number(esito[2]), Number(esito[1]));
  esito = new RegExp(`\\b(\\d{1,2})\\s+(${NOMI_MESI})\\.?(?:\\s+(\\d{4}))?\\b`, "i").exec(riga);
  if (esito) {
    const mese = MESI[esito[2].toLowerCase()];
    const numero = Number(esito[1]);
    return componi(esito[3] ? Number(esito[3]) : annoProbabile(mese, numero, oggi), mese, numero);
  }
  esito = new RegExp(`\\b(${NOMI_MESI})\\.?\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?\\b`, "i").exec(riga);
  if (esito) {
    const mese = MESI[esito[1].toLowerCase()];
    const numero = Number(esito[2]);
    return componi(esito[3] ? Number(esito[3]) : annoProbabile(mese, numero, oggi), mese, numero);
  }
  return null;
}

function analizzaRiepilogo(testo, oggi) {
  const linee = righe(testo);
  const trovati = {};
  for (let indice = 0; indice < linee.length; indice += 1) {
    const giorno = trovaData(linee[indice], oggi);
    if (!giorno || giorno > oggi || trovati[giorno]) continue;
    const finestra = [linee[indice]];
    for (let altro = indice + 1; altro < Math.min(linee.length, indice + 9); altro += 1) {
      if (trovaData(linee[altro], oggi)) break;
      finestra.push(linee[altro]);
    }
    const blocco = finestra.join("\n");
    const media = /(?:spettatori medi|media (?:degli )?spettatori|average viewers|avg\.? viewers)\D{0,30}?(\d[\d.,]*)/i.exec(blocco)
      || /(\d[\d.,]*)\s*(?:spettatori medi|average viewers|avg\.? viewers)/i.exec(blocco);
    if (!media) continue;
    const valore = leggiNumero(media[1]);
    if (valore == null || valore < 0 || valore > 1000000) continue;
    let ore = null;
    const durata = /(\d{1,2})\s*h(?:\s*(\d{1,2})\s*m)?/i.exec(blocco) || /(\d{1,2}):(\d{2}):\d{2}/.exec(blocco);
    if (durata) ore = Number(durata[1]) + Number(durata[2] || 0) / 60;
    trovati[giorno] = { giorno, media: valore, ore };
  }
  return Object.values(trovati);
}

module.exports = { analizzaAvanzamento, analizzaRiepilogo, riassunto, leggiNumero, trovaData };
