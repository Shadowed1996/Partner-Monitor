const { giornoRoma, iso } = require("./tempo");

const BUCO_MASSIMO = 10 * 60000;
const DURATA_SERIE = 12 * 3600000;
const CAMPIONI_PER_GIUDIZIO = 10;

function registraInOnda(dati, adesso, spettatori, iniziataIl) {
  const inizioMs = Date.parse(iniziataIl);
  const inizio = Number.isFinite(inizioMs) ? iso(inizioMs) : iso(adesso);
  let diretta = dati.diretta;
  let nuova = false;
  const stessa = diretta && (diretta.inizio === inizio || (!diretta.chiusa && adesso - diretta.ultimoVisto <= BUCO_MASSIMO));
  if (!stessa) {
    diretta = dati.diretta = {
      inizio,
      giorno: giornoRoma(inizio),
      ultimoVisto: adesso,
      ultimoCampione: null,
      serie: [],
      contava: null,
      chiusa: false
    };
    nuova = true;
  }
  diretta.chiusa = false;
  let campionato = false;
  const minuto = Math.floor(adesso / 60000);
  if (diretta.ultimoCampione == null || Math.floor(diretta.ultimoCampione / 60000) !== minuto) {
    const minuti = diretta.ultimoCampione == null ? 1 : Math.max(1, Math.min(10, Math.round((adesso - diretta.ultimoCampione) / 60000)));
    const voce = dati.giorni[diretta.giorno] || (dati.giorni[diretta.giorno] = { somma: 0, numero: 0, minuti: 0 });
    voce.somma += spettatori;
    voce.numero += 1;
    voce.minuti += minuti;
    diretta.ultimoCampione = adesso;
    diretta.serie.push({ t: iso(adesso), v: spettatori });
    const limite = adesso - DURATA_SERIE;
    while (diretta.serie.length && Date.parse(diretta.serie[0].t) < limite) diretta.serie.shift();
    campionato = true;
  }
  diretta.ultimoVisto = adesso;
  return { nuova, campionato };
}

function registraOffline(dati, adesso) {
  const diretta = dati.diretta;
  if (!diretta || diretta.chiusa) return null;
  if (adesso - diretta.ultimoVisto <= BUCO_MASSIMO) return null;
  diretta.chiusa = true;
  return diretta;
}

function direttaAttiva(dati) {
  return dati.diretta && !dati.diretta.chiusa ? dati.diretta : null;
}

function mediaGiorno(dati, giorno) {
  const voce = dati.giorni[giorno];
  return voce && voce.numero > 0 ? voce.somma / voce.numero : null;
}

function giudicaConteggio(dati, obiettivoMedia) {
  const diretta = direttaAttiva(dati);
  if (!diretta) return null;
  const voce = dati.giorni[diretta.giorno];
  if (!voce || voce.numero < CAMPIONI_PER_GIUDIZIO) return null;
  const conta = voce.somma / voce.numero >= obiettivoMedia;
  if (diretta.contava == null) {
    diretta.contava = conta;
    return conta ? "sta-contando" : null;
  }
  if (diretta.contava === conta) return null;
  diretta.contava = conta;
  return conta ? "sta-contando" : "sotto-media";
}

module.exports = { registraInOnda, registraOffline, direttaAttiva, mediaGiorno, giudicaConteggio, BUCO_MASSIMO };
