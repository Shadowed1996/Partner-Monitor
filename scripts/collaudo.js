const path = require("path");
const fs = require("fs");
const os = require("os");

const RADICE = path.join(__dirname, "..");
const REALE = process.argv.includes("--reale");
const ARGOMENTI = process.argv.slice(2).filter((voce) => voce !== "--reale");
const USCITA = path.resolve(ARGOMENTI[0] || process.env.PARTNER_COLLAUDO_USCITA || path.join(os.tmpdir(), "partner-monitor-collaudo"));

const PROVE = [
  { scenario: "live-conta", vista: "monitor", misure: [[1240, 900], [800, 1000], [420, 760]] },
  { scenario: "live-1", vista: "monitor", misure: [[1240, 900]] },
  { scenario: "offline", vista: "monitor", misure: [[1240, 900], [420, 760]] },
  { scenario: "periodo-completo", vista: "monitor", misure: [[1240, 900]] },
  { scenario: "errore", vista: "monitor", misure: [[1240, 900]] },
  { scenario: "vuoto", vista: "monitor", misure: [[1240, 900]] },
  { scenario: "vuoto", vista: "dirette", misure: [[1240, 900]] },
  { scenario: "offline", vista: "dirette", misure: [[1240, 900], [420, 760]] },
  { scenario: "offline", vista: "impostazioni", misure: [[1240, 900], [420, 760]] },
  { scenario: "primo-avvio", vista: "monitor", misure: [[1240, 900], [420, 700]] },
  { scenario: "primo-avvio", vista: "monitor", misure: [[1240, 900]], passo: 2 },
  { scenario: "accesso", vista: "monitor", misure: [[1240, 900], [420, 700]] }
];

function attendi(millisecondi) {
  return new Promise((risolvi) => setTimeout(risolvi, millisecondi));
}

async function eseguiInElectron() {
  const { app, BrowserWindow } = require("electron");
  process.env.PARTNER_COLLAUDO = "1";
  if (REALE) {
    delete process.env.PARTNER_FINTO;
  } else {
    process.env.PARTNER_FINTO = "1";
  }
  const dati = fs.mkdtempSync(path.join(os.tmpdir(), "partner-monitor-dati-"));
  app.setPath("userData", dati);
  app.disableHardwareAcceleration();
  fs.mkdirSync(USCITA, { recursive: true });
  const avvio = require(path.join(RADICE, "main", "avvio.js"));
  const scadenza = setTimeout(() => {
    process.stderr.write("Collaudo bloccato, chiudo\n");
    app.exit(2);
  }, 240000);
  await app.whenReady();
  let principale = null;
  for (let tentativo = 0; tentativo < 50 && !principale; tentativo += 1) {
    await attendi(200);
    principale = avvio.finestre().principale;
  }
  const scritti = [];
  const errori = [];
  principale.webContents.on("console-message", (dettagli) => {
    if (dettagli.level === "error" || dettagli.level === 3) {
      errori.push(dettagli.message);
    }
  });
  principale.showInactive();
  const cattura = async (finestra, nome) => {
    process.stdout.write(`cattura ${nome}
`);
    let immagine = null;
    for (let tentativo = 0; tentativo < 4 && !immagine; tentativo += 1) {
      try {
        immagine = await finestra.webContents.capturePage();
      } catch {
        finestra.webContents.invalidate();
        await attendi(500);
      }
    }
    if (!immagine) {
      throw new Error(`Cattura non riuscita: ${nome}`);
    }
    const percorso = path.join(USCITA, `${nome}.png`);
    fs.writeFileSync(percorso, immagine.toPNG());
    scritti.push(percorso);
  };
  if (REALE) {
    await attendi(3000);
    await cattura(principale, "reale-primo-avvio");
    const stato = await principale.webContents.executeJavaScript("window.monitor.stato()");
    process.stdout.write(`Stato reale: clientIdMancante=${stato.clientIdMancante} collegato=${stato.collegato} canale=${stato.canale ? "si" : "no"} errore=${stato.ultimoErrore}${os.EOL}`);
    await principale.webContents.executeJavaScript("document.querySelector('#guida-canale').value='slayer_beard';document.querySelector('#guida-modulo-canale').requestSubmit()");
    await attendi(800);
    await cattura(principale, "reale-passo2");
    await principale.webContents.executeJavaScript("document.querySelector('#guida-client').value='abcdefghijklmnopqrstuvwxyz0123';document.querySelector('#guida-modulo-client').requestSubmit()");
    await attendi(800);
    await cattura(principale, "reale-passo3");
    clearTimeout(scadenza);
    process.stdout.write(`${scritti.length} immagini in ${USCITA}${os.EOL}`);
    if (errori.length) {
      process.stdout.write(`Errori in console:${os.EOL}${[...new Set(errori)].join(os.EOL)}${os.EOL}`);
    }
    avvio.finestre().principale.destroy();
    app.exit(errori.length ? 1 : 0);
    return;
  }
  const finto = require(path.join(RADICE, "prove", "finto-dati.js")).creaMonitor.ultimo;
  for (const prova of PROVE) {
    finto.scenario(prova.scenario);
    principale.webContents.reload();
    await new Promise((risolvi) => principale.webContents.once("did-finish-load", risolvi));
    await attendi(500);
    finto.scenario(prova.scenario);
    await attendi(400);
    if (prova.vista !== "monitor") {
      await principale.webContents.executeJavaScript(`document.querySelector('[data-vista="${prova.vista}"]').click()`);
    }
    if (prova.passo === 2) {
      await principale.webContents.executeJavaScript("document.querySelector('#guida-canale').value='slayer_beard';document.querySelector('#guida-modulo-canale').requestSubmit()");
    }
    for (const [larghezza, altezza] of prova.misure) {
      principale.setContentSize(larghezza, altezza);
      await attendi(700);
      const nome = `${prova.scenario}-${prova.vista}${prova.passo ? `-passo${prova.passo}` : ""}-${larghezza}`;
      await principale.webContents.executeJavaScript("window.scrollTo(0,0)");
      await attendi(400);
      await cattura(principale, nome);
      const lunga = await principale.webContents.executeJavaScript("document.documentElement.scrollHeight > window.innerHeight + 40");
      if (lunga && !prova.scenario.startsWith("primo") && prova.scenario !== "accesso") {
        await principale.webContents.executeJavaScript("window.scrollTo(0, document.documentElement.scrollHeight)");
        await attendi(300);
        await cattura(principale, `${nome}-fondo`);
      }
    }
  }
  finto.scenario("live-conta");
  avvio.apriOverlay(true);
  await attendi(1500);
  const overlay = avvio.finestre().overlay;
  if (overlay) {
    await cattura(overlay, "overlay-live");
    finto.scenario("periodo-completo");
    await attendi(500);
    await cattura(overlay, "overlay-offline");
    avvio.apriOverlay(false);
  }
  clearTimeout(scadenza);
  process.stdout.write(`${scritti.length} immagini in ${USCITA}\n`);
  if (errori.length) {
    process.stdout.write(`Errori in console:\n${[...new Set(errori)].join("\n")}\n`);
  }
  try {
    fs.rmSync(dati, { recursive: true, force: true });
  } catch {
    process.stderr.write("Cartella dati di prova non rimossa\n");
  }
  app.exit(errori.length ? 1 : 0);
}

function avviaElettron() {
  const { spawnSync } = require("child_process");
  const eseguibile = require("electron");
  const ambiente = { ...process.env, PARTNER_COLLAUDO: "1" };
  if (!REALE) {
    ambiente.PARTNER_FINTO = "1";
  }
  delete ambiente.ELECTRON_RUN_AS_NODE;
  const esito = spawnSync(eseguibile, [__filename, USCITA, ...(REALE ? ["--reale"] : [])], { stdio: "inherit", env: ambiente, timeout: 300000 });
  process.exit(esito.status === null ? 3 : esito.status);
}

if (process.versions.electron) {
  eseguiInElectron().catch((errore) => {
    process.stderr.write(`Collaudo fallito: ${errore.stack || errore}\n`);
    require("electron").app.exit(1);
  });
} else {
  avviaElettron();
}
