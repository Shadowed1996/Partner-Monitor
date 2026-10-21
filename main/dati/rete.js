const https = require("node:https");

const DIMENSIONE_MASSIMA = 5 * 1024 * 1024;

function httpPredefinito({ metodo = "GET", url, intestazioni = {}, corpo = null, attesaMassima = 15000 }) {
  return new Promise((risolvi, rifiuta) => {
    const indirizzo = new URL(url);
    const opzioni = {
      method: metodo,
      hostname: indirizzo.hostname,
      port: indirizzo.port || 443,
      path: indirizzo.pathname + indirizzo.search,
      headers: { "User-Agent": "PartnerMonitor/1.0", Accept: "application/json", ...intestazioni }
    };
    if (corpo != null) opzioni.headers["Content-Length"] = Buffer.byteLength(corpo);
    const richiesta = https.request(opzioni, (risposta) => {
      const pezzi = [];
      let dimensione = 0;
      risposta.on("data", (pezzo) => {
        dimensione += pezzo.length;
        if (dimensione > DIMENSIONE_MASSIMA) {
          richiesta.destroy(new Error("risposta troppo grande"));
          return;
        }
        pezzi.push(pezzo);
      });
      risposta.on("end", () => risolvi({ stato: risposta.statusCode, intestazioni: risposta.headers, corpo: Buffer.concat(pezzi).toString("utf8") }));
      risposta.on("error", rifiuta);
    });
    richiesta.setTimeout(attesaMassima, () => richiesta.destroy(new Error("tempo scaduto")));
    richiesta.on("error", rifiuta);
    if (corpo != null) richiesta.write(corpo);
    richiesta.end();
  });
}

class ErroreTwitch extends Error {
  constructor(messaggio, { codice = "http", stato = null, attesa = 0 } = {}) {
    super(messaggio);
    this.codice = codice;
    this.stato = stato;
    this.attesa = attesa;
  }
}

function minuscole(intestazioni) {
  const esito = {};
  for (const [chiave, valore] of Object.entries(intestazioni || {})) esito[String(chiave).toLowerCase()] = valore;
  return esito;
}

async function eseguiRichiesta(http, richiesta) {
  let risposta;
  try {
    risposta = await http(richiesta);
  } catch {
    throw new ErroreTwitch("rete non raggiungibile", { codice: "rete" });
  }
  if (!risposta || typeof risposta.stato !== "number") throw new ErroreTwitch("risposta non valida", { codice: "rete" });
  const corpo = typeof risposta.corpo === "string" ? risposta.corpo : risposta.corpo == null ? "" : JSON.stringify(risposta.corpo);
  let json = null;
  try {
    json = corpo ? JSON.parse(corpo) : null;
  } catch {}
  return { stato: risposta.stato, intestazioni: minuscole(risposta.intestazioni), corpo, json };
}

function codificaModulo(campi) {
  const parametri = new URLSearchParams();
  for (const [chiave, valore] of Object.entries(campi)) if (valore != null) parametri.set(chiave, String(valore));
  return parametri.toString();
}

module.exports = { httpPredefinito, eseguiRichiesta, ErroreTwitch, codificaModulo };
