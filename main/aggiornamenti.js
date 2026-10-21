const { app } = require("electron");

// Controlla le release pubbliche su Shadowed1996/Partner-Monitor-Release
// (configurate in electron-builder.yml): all'apertura e poi ogni 6 ore.
// Il programma vive nell'area di notifica, quindi niente finestra di
// avanzamento: scarica in silenzio, poi installa e si riapre da solo.
const INTERVALLO = 6 * 60 * 60 * 1000;

function avviaAggiornamenti({ prontaPerInstallare } = {}) {
  if (!app.isPackaged) return;

  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (errore) {
    console.error("electron-updater non disponibile:", errore);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-downloaded", (info) => {
    if (typeof prontaPerInstallare === "function") prontaPerInstallare(info.version);
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 1500);
  });

  autoUpdater.on("error", (errore) => {
    console.error("Aggiornamento non riuscito:", errore);
  });

  const controlla = () => autoUpdater.checkForUpdates().catch(() => {});
  controlla();
  setInterval(controlla, INTERVALLO).unref();
}

module.exports = { avviaAggiornamenti };
