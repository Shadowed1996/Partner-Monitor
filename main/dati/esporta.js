const { voceVisibile } = require("./periodi");

function cella(valore) {
  const testo = valore == null ? "" : String(valore);
  return /[",\r\n]/.test(testo) ? `"${testo.replace(/"/g, '""')}"` : testo;
}

function esportaCsv(uniti, obiettivo) {
  const righe = ["giorno,media,ore,conta,fonte"];
  const voci = Object.values(uniti).sort((a, b) => (a.giorno < b.giorno ? -1 : 1));
  for (const grezza of voci) {
    const voce = voceVisibile(grezza, obiettivo);
    righe.push([
      voce.giorno,
      voce.media == null ? "" : voce.media.toFixed(2),
      voce.ore == null ? "" : voce.ore.toFixed(2),
      voce.conta ? "si" : "no",
      voce.fonte
    ].map(cella).join(","));
  }
  return `${righe.join("\r\n")}\r\n`;
}

function mappaTracker(json) {
  const numero = (valore) => {
    const n = Number(valore);
    return valore == null || !Number.isFinite(n) ? null : n;
  };
  if (!json || typeof json !== "object") return null;
  return {
    media30: numero(json.avg_viewers),
    picco30: numero(json.max_viewers),
    minuti30: numero(json.minutes_streamed),
    follower: numero(json.followers_total != null ? json.followers_total : json.followers)
  };
}

module.exports = { esportaCsv, mappaTracker };
