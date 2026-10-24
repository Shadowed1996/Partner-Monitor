const { app } = require("electron");

const INTERVALLO = 6 * 60 * 60 * 1000;
const ATTESA_INSTALLAZIONE = 1500;
const simulazione = process.env.PARTNER_PROVA_AGGIORNAMENTO || "";

let stato = { fase: "sviluppo", versione: app.getVersion(), percentuale: null, controllatoIl: null };
let ascoltatori = [];
let autoUpdater = null;
let controlloInCorso = null;

function comunica(parziale) {
  stato = { ...stato, ...parziale, versione: parziale.versione || app.getVersion() };
  for (const funzione of ascoltatori) {
    try {
      funzione(stato);
    } catch (errore) {
      console.error(errore);
    }
  }
}

function attendi(millisecondi) {
  return new Promise((risolvi) => setTimeout(risolvi, millisecondi));
}

async function simula() {
  comunica({ fase: "controllo", percentuale: null });
  await attendi(1500);
  if (simulazione !== "scarica") {
    comunica({ fase: "aggiornato", percentuale: null, controllatoIl: new Date().toISOString() });
    return;
  }
  const versione = "9.9.9";
  for (let percentuale = 0; percentuale <= 100; percentuale += 4) {
    comunica({ fase: "scarica", versione, percentuale });
    await attendi(120);
  }
  comunica({ fase: "installa", versione, percentuale: 100 });
}

function controllaAggiornamenti() {
  if (simulazione) {
    return simula();
  }
  if (!autoUpdater) {
    return Promise.resolve(stato);
  }
  if (controlloInCorso) {
    return controlloInCorso;
  }
  controlloInCorso = autoUpdater
    .checkForUpdates()
    .catch((errore) => {
      console.error("Controllo aggiornamenti non riuscito:", errore);
      if (stato.fase === "controllo") {
        comunica({ fase: "errore-controllo", percentuale: null, controllatoIl: new Date().toISOString() });
      }
    })
    .then(() => {
      controlloInCorso = null;
      return stato;
    });
  return controlloInCorso;
}

function avviaAggiornamenti({ suStato, prontaPerInstallare } = {}) {
  if (typeof suStato === "function") {
    ascoltatori.push(suStato);
  }
  if (simulazione) {
    controllaAggiornamenti();
    return;
  }
  if (!app.isPackaged) {
    comunica({ fase: "sviluppo", percentuale: null });
    return;
  }
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (errore) {
    console.error("electron-updater non disponibile:", errore);
    comunica({ fase: "errore-controllo", percentuale: null });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    comunica({ fase: "controllo", percentuale: null });
  });

  autoUpdater.on("update-not-available", () => {
    comunica({ fase: "aggiornato", percentuale: null, controllatoIl: new Date().toISOString() });
  });

  autoUpdater.on("update-available", (info) => {
    comunica({ fase: "scarica", versione: info.version, percentuale: 0 });
  });

  autoUpdater.on("download-progress", (avanzamento) => {
    comunica({ fase: "scarica", versione: stato.versione, percentuale: Math.round(avanzamento.percent || 0) });
  });

  autoUpdater.on("update-downloaded", (info) => {
    comunica({ fase: "installa", versione: info.version, percentuale: 100 });
    if (typeof prontaPerInstallare === "function") {
      prontaPerInstallare(info.version);
    }
    setTimeout(() => autoUpdater.quitAndInstall(true, true), ATTESA_INSTALLAZIONE);
  });

  autoUpdater.on("error", (errore) => {
    console.error("Aggiornamento non riuscito:", errore);
    const durante = stato.fase === "scarica" || stato.fase === "installa";
    comunica({ fase: durante ? "errore" : "errore-controllo", versione: durante ? stato.versione : null, percentuale: null, controllatoIl: new Date().toISOString() });
  });

  controllaAggiornamenti();
  setInterval(controllaAggiornamenti, INTERVALLO).unref();
}

module.exports = { avviaAggiornamenti, controllaAggiornamenti, statoAggiornamento: () => stato };
