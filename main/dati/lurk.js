const INDIRIZZO_LURK = "https://slayerbeard.com/api/lurk/presenti";
const INTERVALLO_LURK = 15000;
const INTERVALLO_LURK_ERRORE = 120000;

function mappaLurk(json) {
  const numero = (valore) => {
    const n = Number(valore);
    return Number.isInteger(n) && n >= 0 ? n : null;
  };
  if (!json || typeof json !== "object") return null;
  const presenti = numero(json.presenti);
  if (presenti === null) return null;
  const vivi = numero(json.vivi);
  return {
    presenti,
    vivi: vivi === null ? 0 : Math.min(vivi, presenti),
    aggiornato: typeof json.aggiornato === "string" ? json.aggiornato : null
  };
}

module.exports = { INDIRIZZO_LURK, INTERVALLO_LURK, INTERVALLO_LURK_ERRORE, mappaLurk };
