const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, shell, dialog, nativeTheme, nativeImage, session, screen, safeStorage } = require("electron");

const RADICE = path.join(__dirname, "..");
const FINTO = process.env.PARTNER_FINTO === "1";
const COLLAUDO = Boolean(process.env.PARTNER_COLLAUDO);
const NASCOSTO = process.argv.includes("--nascosto");
const ICONA = path.join(RADICE, "risorse", "icona.png");
const ICONA_TRAY = path.join(RADICE, "risorse", "tray.png");
const PAGINA_PRINCIPALE = path.join(RADICE, "renderer", "index.html");
const PAGINA_OVERLAY = path.join(RADICE, "renderer", "overlay.html");
const PRELOAD = path.join(__dirname, "preload.js");
const COLORE_FONDO = "#0d0b14";
const PARTIZIONE_TWITCH = "persist:twitch";
const LINK_AMMESSI = [
  /^https:\/\/(www\.)?twitch\.tv\//,
  /^https:\/\/dev\.twitch\.tv\//,
  /^https:\/\/dashboard\.twitch\.tv\//,
  /^https:\/\/help\.twitch\.tv\//,
  /^https:\/\/link\.twitch\.tv\//,
  /^https:\/\/twitchtracker\.com\//
];
const TITOLI_EVENTO = {
  "diretta-iniziata": "Sei in diretta",
  "diretta-finita": "Diretta finita",
  "sta-contando": "Questa diretta sta contando",
  "sotto-media": "Sotto la media",
  "periodo-completato": "Periodo completato"
};

let monitor = null;
let principale = null;
let overlay = null;
let tray = null;
let uscendo = false;
let ultimoStato = null;
let ultimoAccesso = null;
let impostazioniCorrenti = {};
let preferenze = {};
let codaTwitch = Promise.resolve();

nativeTheme.themeSource = "dark";
app.setAppUserModelId("com.filippo.partnermonitor");

function percorsoPreferenze() {
  return path.join(app.getPath("userData"), "interfaccia.json");
}

function leggiPreferenze() {
  try {
    preferenze = JSON.parse(fs.readFileSync(percorsoPreferenze(), "utf8")) || {};
  } catch {
    preferenze = {};
  }
}

function scriviPreferenze(parziale) {
  preferenze = { ...preferenze, ...parziale };
  try {
    fs.mkdirSync(path.dirname(percorsoPreferenze()), { recursive: true });
    fs.writeFileSync(percorsoPreferenze(), JSON.stringify(preferenze, null, 2));
  } catch {
    process.stderr.write("Preferenze interfaccia non salvate\n");
  }
}

function linkAmmesso(indirizzo) {
  return typeof indirizzo === "string" && LINK_AMMESSI.some((regola) => regola.test(indirizzo));
}

function paginaNostra(indirizzo) {
  return typeof indirizzo === "string" && indirizzo.startsWith("file://");
}

function inviaATutti(canale, dati) {
  for (const finestra of [principale, overlay]) {
    if (finestra && !finestra.isDestroyed()) {
      finestra.webContents.send(canale, dati);
    }
  }
}

function riquadroVisibile(riquadro) {
  if (!riquadro || typeof riquadro.x !== "number") {
    return false;
  }
  return screen.getAllDisplays().some(({ workArea }) =>
    riquadro.x + 40 > workArea.x && riquadro.y + 20 > workArea.y && riquadro.x < workArea.x + workArea.width - 40 && riquadro.y < workArea.y + workArea.height - 20
  );
}

function creaPrincipale() {
  const salvato = preferenze.finestra;
  const opzioni = {
    width: 1180,
    height: 860,
    minWidth: 420,
    minHeight: 600,
    show: false,
    title: "Partner Monitor",
    icon: ICONA,
    backgroundColor: COLORE_FONDO,
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  };
  if (salvato && riquadroVisibile(salvato)) {
    Object.assign(opzioni, { x: salvato.x, y: salvato.y, width: Math.max(420, salvato.width), height: Math.max(600, salvato.height) });
  }
  principale = new BrowserWindow(opzioni);
  principale.setMenu(null);
  if (salvato && salvato.massimizzata) {
    principale.maximize();
  }
  principale.loadFile(PAGINA_PRINCIPALE);
  principale.once("ready-to-show", () => {
    if (!NASCOSTO && !COLLAUDO) {
      principale.show();
    }
  });
  const ricordaRiquadro = () => {
    if (principale && !principale.isDestroyed() && !principale.isMinimized()) {
      scriviPreferenze({ finestra: { ...principale.getNormalBounds(), massimizzata: principale.isMaximized() } });
    }
  };
  principale.on("resized", ricordaRiquadro);
  principale.on("moved", ricordaRiquadro);
  principale.on("close", (evento) => {
    if (uscendo) {
      return;
    }
    evento.preventDefault();
    principale.hide();
    if (!preferenze.avvisoTray && Notification.isSupported() && !COLLAUDO) {
      scriviPreferenze({ avvisoTray: true });
      new Notification({ title: "Partner Monitor resta attivo", body: "Lo trovi nell'area di notifica, accanto all'orologio. Per chiuderlo davvero usa Esci dal suo menu.", icon: ICONA }).show();
    }
  });
}

function mostraPrincipale() {
  if (!principale || principale.isDestroyed()) {
    creaPrincipale();
    principale.once("ready-to-show", () => principale.show());
    return;
  }
  if (principale.isMinimized()) {
    principale.restore();
  }
  principale.show();
  principale.focus();
}

function apriOverlay(aperto) {
  if (!aperto) {
    if (overlay && !overlay.isDestroyed()) {
      overlay.close();
    }
    overlay = null;
    scriviPreferenze({ overlayAperto: false });
    aggiornaTray();
    inviaATutti("monitor:overlay", false);
    return false;
  }
  if (overlay && !overlay.isDestroyed()) {
    overlay.showInactive();
    return true;
  }
  const area = screen.getPrimaryDisplay().workArea;
  const posizione = riquadroVisibile(preferenze.overlay) ? preferenze.overlay : { x: area.x + area.width - 300, y: area.y + 24 };
  overlay = new BrowserWindow({
    x: posizione.x,
    y: posizione.y,
    width: 276,
    height: 118,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    title: "Partner Monitor overlay",
    icon: ICONA,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  });
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.setVisibleOnAllWorkspaces(true);
  overlay.loadFile(PAGINA_OVERLAY);
  overlay.once("ready-to-show", () => overlay && overlay.showInactive());
  overlay.on("moved", () => {
    if (overlay && !overlay.isDestroyed()) {
      const { x, y } = overlay.getBounds();
      scriviPreferenze({ overlay: { x, y } });
    }
  });
  overlay.on("closed", () => {
    overlay = null;
    if (!uscendo) {
      scriviPreferenze({ overlayAperto: false });
      aggiornaTray();
      inviaATutti("monitor:overlay", false);
    }
  });
  scriviPreferenze({ overlayAperto: true });
  aggiornaTray();
  inviaATutti("monitor:overlay", true);
  return true;
}

function testoTray() {
  if (!ultimoStato) {
    return "Partner Monitor";
  }
  const media = ultimoStato.obiettivo ? ultimoStato.obiettivo.media : 75;
  if (ultimoStato.inOnda) {
    return `Partner Monitor\nLIVE ${ultimoStato.spettatori} / ${media}`;
  }
  const periodi = Array.isArray(ultimoStato.periodi) ? ultimoStato.periodi.map((periodo) => `${periodo.confermate}/${periodo.richieste}`).join("  ") : "";
  return `Partner Monitor\nOffline  ${periodi}`.trim();
}

function aggiornaTray() {
  if (!tray || tray.isDestroyed()) {
    return;
  }
  tray.setToolTip(testoTray());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Apri Partner Monitor", click: mostraPrincipale },
      { label: "Overlay", type: "checkbox", checked: Boolean(overlay && !overlay.isDestroyed()), click: (voce) => apriOverlay(voce.checked) },
      { type: "separator" },
      { label: "Esci", click: esci }
    ])
  );
}

function creaTray() {
  const immagine = nativeImage.createFromPath(ICONA_TRAY);
  tray = new Tray(immagine.isEmpty() ? nativeImage.createFromPath(ICONA) : immagine);
  tray.on("click", mostraPrincipale);
  tray.on("double-click", mostraPrincipale);
  aggiornaTray();
}

function esci() {
  uscendo = true;
  app.quit();
}

function applicaAvvioConWindows(attivo) {
  if (!app.isPackaged || COLLAUDO) {
    return;
  }
  app.setLoginItemSettings({ openAtLogin: Boolean(attivo), path: process.execPath, args: ["--nascosto"] });
}

function notifica(evento) {
  if (!evento || COLLAUDO || impostazioniCorrenti.notifiche === false || !Notification.isSupported()) {
    return;
  }
  const avviso = new Notification({
    title: TITOLI_EVENTO[evento.tipo] || "Partner Monitor",
    body: typeof evento.testo === "string" ? evento.testo : "",
    icon: ICONA
  });
  avviso.on("click", mostraPrincipale);
  avviso.show();
}

function serveLogin(indirizzo) {
  return /twitch\.tv\/login|passport\.twitch\.tv|twitch\.tv\/signup|id\.twitch\.tv/.test(indirizzo || "");
}

function attendi(millisecondi) {
  return new Promise((risolvi) => setTimeout(risolvi, millisecondi));
}

function codiceEstrazione(estrai) {
  if (typeof estrai === "function") {
    return `(${estrai.toString()})()`;
  }
  if (typeof estrai === "string" && estrai.trim()) {
    return estrai;
  }
  return "document.body ? document.body.innerText : ''";
}

async function eseguiFinestraTwitch(indirizzo, opzioni) {
  if (!/^https:\/\/([a-z0-9-]+\.)*twitch\.tv\//.test(indirizzo || "")) {
    throw new Error("Indirizzo Twitch non ammesso");
  }
  const mostra = Boolean(opzioni && opzioni.mostra);
  const codice = codiceEstrazione(opzioni && opzioni.estrai);
  const finestra = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 420,
    minHeight: 600,
    show: false,
    title: "Twitch, accesso per Partner Monitor",
    icon: ICONA,
    backgroundColor: COLORE_FONDO,
    autoHideMenuBar: true,
    webPreferences: { partition: PARTIZIONE_TWITCH, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  finestra.setMenu(null);
  finestra.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/([a-z0-9-]+\.)*twitch\.tv\//.test(url)) {
      return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { partition: PARTIZIONE_TWITCH, contextIsolation: true, sandbox: true } } };
    }
    return { action: "deny" };
  });
  let chiusa = false;
  finestra.on("closed", () => {
    chiusa = true;
  });
  const mostrata = { per: mostra ? "richiesta" : null };
  if (mostra) {
    finestra.show();
  }
  try {
    await finestra.loadURL(indirizzo).catch(() => null);
    const inizio = Date.now();
    let precedente = null;
    let tornatoDalLogin = false;
    while (!chiusa) {
      const attuale = finestra.webContents.getURL();
      const limite = mostrata.per ? 10 * 60000 : 60000;
      if (Date.now() - inizio > limite) {
        throw new Error("Tempo scaduto leggendo la pagina Twitch");
      }
      if (serveLogin(attuale)) {
        if (!mostrata.per) {
          mostrata.per = "login";
          finestra.setTitle("Accedi a Twitch: Partner Monitor legge solo il tuo cruscotto");
          finestra.show();
          finestra.focus();
        }
        tornatoDalLogin = true;
        precedente = null;
        await attendi(1000);
        continue;
      }
      if (tornatoDalLogin) {
        tornatoDalLogin = false;
        if (!attuale.startsWith(indirizzo.split("?")[0])) {
          await finestra.loadURL(indirizzo).catch(() => null);
        }
        await attendi(1500);
        continue;
      }
      if (finestra.webContents.isLoading()) {
        await attendi(600);
        continue;
      }
      let testo = null;
      try {
        testo = await finestra.webContents.executeJavaScript(codice, true);
      } catch {
        testo = null;
      }
      const confronto = typeof testo === "string" ? testo : JSON.stringify(testo);
      if (confronto && confronto.length > 60 && confronto === precedente) {
        return testo;
      }
      precedente = confronto;
      await attendi(1500);
    }
    throw new Error("Finestra Twitch chiusa prima della lettura");
  } finally {
    if (!chiusa && !finestra.isDestroyed()) {
      finestra.destroy();
    }
  }
}

function finestraTwitch(indirizzo, opzioni = {}) {
  const lavoro = codaTwitch.then(() => eseguiFinestraTwitch(indirizzo, opzioni));
  codaTwitch = lavoro.catch(() => null);
  return lavoro;
}

function protezioneToken() {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return {
    cifra: (testo) => safeStorage.encryptString(String(testo)).toString("base64"),
    decifra: (cifrato) => safeStorage.decryptString(Buffer.from(String(cifrato), "base64"))
  };
}

function celleCsv(riga) {
  const celle = [];
  let attuale = "";
  let virgolette = false;
  for (let indice = 0; indice < riga.length; indice += 1) {
    const carattere = riga[indice];
    if (virgolette) {
      if (carattere === '"' && riga[indice + 1] === '"') {
        attuale += '"';
        indice += 1;
      } else if (carattere === '"') {
        virgolette = false;
      } else {
        attuale += carattere;
      }
    } else if (carattere === '"') {
      virgolette = true;
    } else if (carattere === ",") {
      celle.push(attuale);
      attuale = "";
    } else {
      attuale += carattere;
    }
  }
  celle.push(attuale);
  return celle;
}

function csvPerExcel(contenuto) {
  const righe = String(contenuto || "").split(/\r?\n/);
  const prima = righe[0] || "";
  if (prima.includes(";") || !prima.includes(",")) {
    return righe.join("\r\n");
  }
  return righe
    .map((riga) =>
      riga
        ? celleCsv(riga)
            .map((cella) => (/^-?\d+\.\d+$/.test(cella) ? cella.replace(".", ",") : /[";\r\n]/.test(cella) ? `"${cella.replace(/"/g, '""')}"` : cella))
            .join(";")
        : riga
    )
    .join("\r\n");
}

function caricaMonitor() {
  const modulo = FINTO ? require(path.join(RADICE, "prove", "finto-dati.js")) : require("./dati");
  return modulo.creaMonitor({ cartella: app.getPath("userData"), finestraTwitch, protezione: protezioneToken() });
}

function oggiIso() {
  const data = new Date();
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}

function gestisci(canale, funzione) {
  ipcMain.handle(canale, async (evento, ...argomenti) => {
    if (!paginaNostra(evento.senderFrame && evento.senderFrame.url)) {
      return { ok: false, errore: "Richiesta non ammessa" };
    }
    try {
      return { ok: true, valore: await funzione(...argomenti) };
    } catch (errore) {
      return { ok: false, errore: errore && errore.message ? errore.message : "Operazione non riuscita" };
    }
  });
}

function numeroValido(valore, minimo, massimo) {
  const numero = Number(valore);
  return Number.isFinite(numero) && numero >= minimo && numero <= massimo;
}

function registraIpc() {
  gestisci("monitor:stato", async () => monitor.stato());
  gestisci("monitor:accessoCorrente", async () => (ultimoStato && ultimoStato.collegato ? null : ultimoAccesso));
  gestisci("monitor:accedi", async () => monitor.accedi());
  gestisci("monitor:esci", async () => {
    ultimoAccesso = null;
    return monitor.esci();
  });
  gestisci("monitor:impostazioni", async () => {
    impostazioniCorrenti = (await monitor.impostazioni()) || {};
    return impostazioniCorrenti;
  });
  gestisci("monitor:salvaImpostazioni", async (parziale) => {
    if (!parziale || typeof parziale !== "object" || Array.isArray(parziale)) {
      throw new Error("Impostazioni non valide");
    }
    const risultato = await monitor.salvaImpostazioni(parziale);
    impostazioniCorrenti = (await monitor.impostazioni()) || { ...impostazioniCorrenti, ...parziale };
    if (Object.prototype.hasOwnProperty.call(parziale, "avvioConWindows")) {
      applicaAvvioConWindows(parziale.avvioConWindows);
    }
    return risultato === undefined ? impostazioniCorrenti : risultato;
  });
  gestisci("monitor:aggiungiManuale", async (voce) => {
    if (!voce || !/^\d{4}-\d{2}-\d{2}$/.test(voce.giorno || "")) {
      throw new Error("Giorno non valido");
    }
    if (!numeroValido(voce.media, 0, 1000000) || !numeroValido(voce.ore, 0, 24)) {
      throw new Error("Media o ore non valide");
    }
    if (voce.giorno > oggiIso()) {
      throw new Error("Il giorno non può essere nel futuro");
    }
    return monitor.aggiungiManuale({ giorno: voce.giorno, media: Number(voce.media), ore: Number(voce.ore) });
  });
  gestisci("monitor:rimuoviManuale", async (giorno) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(giorno || "")) {
      throw new Error("Giorno non valido");
    }
    return monitor.rimuoviManuale(giorno);
  });
  gestisci("monitor:aggiornaUfficiale", async (opzioni) => monitor.aggiornaUfficiale({ mostra: Boolean(opzioni && opzioni.mostra) }));
  gestisci("monitor:esportaCsv", async () => {
    const contenuto = await monitor.esportaCsv();
    const scelta = await dialog.showSaveDialog(principale && !principale.isDestroyed() ? principale : undefined, {
      title: "Esporta le dirette in CSV",
      defaultPath: path.join(app.getPath("documents"), `partner-monitor-${oggiIso()}.csv`),
      filters: [{ name: "CSV", extensions: ["csv"] }]
    });
    if (scelta.canceled || !scelta.filePath) {
      return { salvato: false };
    }
    fs.writeFileSync(scelta.filePath, String.fromCharCode(0xfeff) + csvPerExcel(contenuto), "utf8");
    return { salvato: true, nome: path.basename(scelta.filePath) };
  });
  gestisci("monitor:apriOverlay", async (aperto) => apriOverlay(Boolean(aperto)));
  gestisci("monitor:overlayAperto", async () => Boolean(overlay && !overlay.isDestroyed()));
  gestisci("monitor:apriPrincipale", async () => {
    mostraPrincipale();
    return true;
  });
  gestisci("monitor:apriLink", async (indirizzo) => {
    if (!linkAmmesso(indirizzo)) {
      throw new Error("Link non ammesso");
    }
    await shell.openExternal(indirizzo);
    return true;
  });
  gestisci("monitor:versione", async () => ({ versione: app.getVersion(), finto: FINTO }));
}

function proteggi() {
  session.defaultSession.setPermissionRequestHandler((_contenuti, permesso, risposta) => risposta(permesso === "clipboard-sanitized-write"));
  session.fromPartition(PARTIZIONE_TWITCH).setPermissionRequestHandler((_contenuti, permesso, risposta) => risposta(permesso === "clipboard-sanitized-write"));
  app.on("web-contents-created", (_evento, contenuti) => {
    contenuti.on("will-navigate", (evento, indirizzo) => {
      const attuale = contenuti.getURL();
      if (paginaNostra(attuale) && !paginaNostra(indirizzo)) {
        evento.preventDefault();
        if (linkAmmesso(indirizzo)) {
          shell.openExternal(indirizzo);
        }
      } else if (!paginaNostra(attuale) && !indirizzo.startsWith("https://")) {
        evento.preventDefault();
      }
    });
    contenuti.on("will-attach-webview", (evento) => evento.preventDefault());
    if (contenuti.getType() === "window") {
      contenuti.setWindowOpenHandler(({ url }) => {
        if (paginaNostra(contenuti.getURL()) && linkAmmesso(url)) {
          shell.openExternal(url);
        }
        return { action: "deny" };
      });
    }
  });
}

if (!COLLAUDO && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", mostraPrincipale);
  app.on("before-quit", () => {
    uscendo = true;
  });
  app.on("window-all-closed", () => {
    if (uscendo) {
      app.quit();
    }
  });
  app.on("will-quit", () => {
    if (monitor && typeof monitor.ferma === "function") {
      try {
        monitor.ferma();
      } catch {
        process.stderr.write("Arresto del monitor non pulito\n");
      }
    }
    if (tray && !tray.isDestroyed()) {
      tray.destroy();
    }
  });
  app.whenReady().then(async () => {
    leggiPreferenze();
    proteggi();
    try {
      monitor = caricaMonitor();
    } catch (errore) {
      dialog.showErrorBox("Partner Monitor", `Il livello dati non si avvia: ${errore && errore.message ? errore.message : "errore sconosciuto"}`);
      uscendo = true;
      app.quit();
      return;
    }
    monitor.on("stato", (stato) => {
      ultimoStato = stato;
      if (stato && stato.collegato) {
        ultimoAccesso = null;
      }
      inviaATutti("monitor:stato", stato);
      aggiornaTray();
    });
    monitor.on("accesso", (accesso) => {
      ultimoAccesso = accesso ? { ...accesso, ricevutoIl: Date.now() } : null;
      inviaATutti("monitor:accesso", ultimoAccesso);
    });
    monitor.on("evento", (evento) => {
      notifica(evento);
      inviaATutti("monitor:evento", evento);
    });
    monitor.on("error", () => null);
    registraIpc();
    try {
      impostazioniCorrenti = (await monitor.impostazioni()) || {};
    } catch {
      impostazioniCorrenti = {};
    }
    applicaAvvioConWindows(impostazioniCorrenti.avvioConWindows);
    creaPrincipale();
    creaTray();
    if (preferenze.overlayAperto) {
      apriOverlay(true);
    }
    try {
      await monitor.avvia();
    } catch (errore) {
      process.stderr.write(`Avvio del monitor non riuscito: ${errore && errore.message ? errore.message : "errore"}\n`);
    }
    try {
      ultimoStato = await monitor.stato();
      aggiornaTray();
    } catch {
      ultimoStato = null;
    }
  });
}

module.exports = { finestre: () => ({ principale, overlay }), apriOverlay };
