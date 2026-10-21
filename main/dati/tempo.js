const formattatoreRoma = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Rome",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function giornoRoma(istante) {
  const data = istante instanceof Date ? istante : new Date(istante);
  if (Number.isNaN(data.getTime())) return null;
  const parti = {};
  for (const parte of formattatoreRoma.formatToParts(data)) parti[parte.type] = parte.value;
  return `${parti.year}-${parti.month}-${parti.day}`;
}

function giornoValido(giorno) {
  if (typeof giorno !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(giorno)) return false;
  const [anno, mese, numero] = giorno.split("-").map(Number);
  const data = new Date(Date.UTC(anno, mese - 1, numero));
  return data.getUTCFullYear() === anno && data.getUTCMonth() === mese - 1 && data.getUTCDate() === numero;
}

function spostaGiorno(giorno, quanti) {
  const [anno, mese, numero] = giorno.split("-").map(Number);
  return new Date(Date.UTC(anno, mese - 1, numero + quanti)).toISOString().slice(0, 10);
}

function durataInOre(durata) {
  if (typeof durata !== "string") return null;
  const esito = /^\s*(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?\s*$/i.exec(durata);
  if (!esito || (!esito[1] && !esito[2] && !esito[3])) return null;
  const secondi = Number(esito[1] || 0) * 3600 + Number(esito[2] || 0) * 60 + Number(esito[3] || 0);
  return secondi / 3600;
}

function iso(ms) {
  return new Date(ms).toISOString();
}

module.exports = { giornoRoma, giornoValido, spostaGiorno, durataInOre, iso };
