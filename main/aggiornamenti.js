const { app } = require("electron");

const INTERVALLO = 6 * 60 * 60 * 1000;
const ATTESA_INSTALLAZIONE = 1500;
const ATTESA_MASSIMA_CONTROLLO = 9000;
const ATTESA_MASSIMA_DOWNLOAD_FERMO = 45000;
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

function attendiEsitoAvvio() {
  return new Promise((risolvi) => {
    let deciso = false;
    let fermo = null;
    let limite = null;
    const osserva = (attuale) => {
      if (attuale.fase === "scarica") {
        clearTimeout(limite);
        clearTimeout(fermo);
        fermo = setTimeout(() => {
          if (stato.fase === "scarica") {
            comunica({ fase: "errore", versione: stato.versione, percentuale: null });
          }
          decidi();
        }, ATTESA_MASSIMA_DOWNLOAD_FERMO);
        return;
      }
      if (attuale.fase === "installa") {
        clearTimeout(limite);
        clearTimeout(fermo);
        fermo = setTimeout(decidi, 20000);
        return;
      }
      decidi();
    };
    const decidi = () => {
      if (deciso) {
        return;
      }
      deciso = true;
      clearTimeout(limite);
      clearTimeout(fermo);
      ascoltatori = ascoltatori.filter((funzione) => funzione !== osserva);
      risolvi("continua");
    };
    limite = setTimeout(() => {
      if (stato.fase === "controllo") {
        comunica({ fase: "lento", percentuale: null });
      }
      decidi();
    }, ATTESA_MASSIMA_CONTROLLO);
    ascoltatori.push(osserva);
    if (stato.fase !== "controllo" && stato.fase !== "scarica" && stato.fase !== "installa") {
      decidi();
    }
  });
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

  comunica({ fase: "controllo", percentuale: null });
  controllaAggiornamenti();
  setInterval(controllaAggiornamenti, INTERVALLO).unref();
}

module.exports = { avviaAggiornamenti, controllaAggiornamenti, attendiEsitoAvvio, statoAggiornamento: () => stato };
