const fs = require("node:fs");
const path = require("node:path");

function clona(valore) {
  return valore == null ? valore : JSON.parse(JSON.stringify(valore));
}

function leggiJson(percorso, predefinito, alCorrotto) {
  for (const candidato of [percorso, `${percorso}.bak`]) {
    let testo;
    try {
      testo = fs.readFileSync(candidato, "utf8");
    } catch {
      continue;
    }
    try {
      const valore = JSON.parse(testo.replace(/^﻿/, ""));
      if (valore && typeof valore === "object" && !Array.isArray(valore)) return valore;
    } catch {}
    if (candidato === percorso) {
      try {
        fs.renameSync(percorso, `${percorso}.corrotto-${Date.now()}`);
      } catch {}
      if (typeof alCorrotto === "function") alCorrotto(path.basename(percorso));
    }
  }
  return clona(predefinito);
}

function pausa(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function rinomina(da, a) {
  for (let tentativo = 0; ; tentativo += 1) {
    try {
      fs.renameSync(da, a);
      return;
    } catch (errore) {
      if (tentativo >= 5 || !["EPERM", "EBUSY", "EACCES"].includes(errore.code)) throw errore;
      pausa(25 * (tentativo + 1));
    }
  }
}

function scriviJson(percorso, dati) {
  fs.mkdirSync(path.dirname(percorso), { recursive: true });
  const temporaneo = `${percorso}.tmp`;
  const testo = JSON.stringify(dati, null, 2);
  const descrittore = fs.openSync(temporaneo, "w", 0o600);
  try {
    fs.writeFileSync(descrittore, testo, "utf8");
    fs.fsyncSync(descrittore);
  } finally {
    fs.closeSync(descrittore);
  }
  try {
    fs.copyFileSync(percorso, `${percorso}.bak`);
  } catch {}
  rinomina(temporaneo, percorso);
}

function cancella(percorso) {
  for (const candidato of [percorso, `${percorso}.bak`, `${percorso}.tmp`]) {
    try {
      fs.unlinkSync(candidato);
    } catch {}
  }
}

module.exports = { leggiJson, scriviJson, cancella, clona };
