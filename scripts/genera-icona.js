const path = require("path");
const fs = require("fs");

const RADICE = path.join(__dirname, "..");
const CARTELLA = path.join(RADICE, "risorse");
const LATO = 256;
const LATI_ICO = [16, 24, 32, 48, 64, 128, 256];

function disegnoSvg() {
  const tacche = [];
  for (let indice = 0; indice < 6; indice += 1) {
    const x = 50 + indice * 27;
    const piena = indice < 4;
    tacche.push(`<rect x="${x}" y="186" width="19" height="22" rx="5" fill="${piena ? "#22e0ff" : "#3b2d5c"}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${LATO}" height="${LATO}" viewBox="0 0 256 256">
<defs>
<linearGradient id="fondo" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#2a1250"/>
<stop offset="1" stop-color="#0e0a18"/>
</linearGradient>
<linearGradient id="linea" x1="0" y1="1" x2="1" y2="0">
<stop offset="0" stop-color="#9b5cff"/>
<stop offset="1" stop-color="#22e0ff"/>
</linearGradient>
</defs>
<rect x="8" y="8" width="240" height="240" rx="56" fill="url(#fondo)"/>
<rect x="8.5" y="8.5" width="239" height="239" rx="55.5" fill="none" stroke="#9b5cff" stroke-opacity="0.45" stroke-width="3"/>
<line x1="44" y1="104" x2="212" y2="104" stroke="#f1eefa" stroke-opacity="0.5" stroke-width="6" stroke-dasharray="12 10" stroke-linecap="round"/>
<polyline points="48,156 86,130 116,142 152,94 196,62" fill="none" stroke="url(#linea)" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="196" cy="62" r="18" fill="#22e0ff"/>
<circle cx="196" cy="62" r="8" fill="#0e0a18"/>
${tacche.join("\n")}
</svg>`;
}

function icoDaPng(immagini) {
  const intestazione = Buffer.alloc(6);
  intestazione.writeUInt16LE(0, 0);
  intestazione.writeUInt16LE(1, 2);
  intestazione.writeUInt16LE(immagini.length, 4);
  const voci = [];
  let scostamento = 6 + immagini.length * 16;
  for (const { lato, png } of immagini) {
    const voce = Buffer.alloc(16);
    voce.writeUInt8(lato >= 256 ? 0 : lato, 0);
    voce.writeUInt8(lato >= 256 ? 0 : lato, 1);
    voce.writeUInt8(0, 2);
    voce.writeUInt8(0, 3);
    voce.writeUInt16LE(1, 4);
    voce.writeUInt16LE(32, 6);
    voce.writeUInt32LE(png.length, 8);
    voce.writeUInt32LE(scostamento, 12);
    scostamento += png.length;
    voci.push(voce);
  }
  return Buffer.concat([intestazione, ...voci, ...immagini.map((voce) => voce.png)]);
}

function eseguiInElectron() {
  const { app, BrowserWindow } = require("electron");
  app.disableHardwareAcceleration();
  app.whenReady().then(async () => {
    const finestra = new BrowserWindow({
      width: LATO,
      height: LATO,
      show: false,
      frame: false,
      transparent: true,
      useContentSize: true,
      webPreferences: { offscreen: true }
    });
    const pagina = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">${disegnoSvg()}</body></html>`;
    await finestra.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pagina)}`);
    await new Promise((risolvi) => setTimeout(risolvi, 400));
    let immagine = await finestra.webContents.capturePage({ x: 0, y: 0, width: LATO, height: LATO });
    const dimensioni = immagine.getSize();
    if (dimensioni.width !== LATO || dimensioni.height !== LATO) {
      immagine = immagine.resize({ width: LATO, height: LATO, quality: "best" });
    }
    const immagini = LATI_ICO.map((lato) => ({
      lato,
      png: lato === LATO ? immagine.toPNG() : immagine.resize({ width: lato, height: lato, quality: "best" }).toPNG()
    }));
    fs.mkdirSync(CARTELLA, { recursive: true });
    fs.writeFileSync(path.join(CARTELLA, "icona.png"), immagine.toPNG());
    fs.writeFileSync(path.join(CARTELLA, "icona.ico"), icoDaPng(immagini));
    fs.writeFileSync(path.join(CARTELLA, "tray.png"), immagine.resize({ width: 32, height: 32, quality: "best" }).toPNG());
    process.stdout.write("Icone scritte in risorse: icona.png, icona.ico, tray.png\n");
    app.exit(0);
  });
}

function avviaElectron() {
  const { spawnSync } = require("child_process");
  const eseguibile = require("electron");
  const ambiente = { ...process.env };
  delete ambiente.ELECTRON_RUN_AS_NODE;
  const esito = spawnSync(eseguibile, [__filename], { stdio: "inherit", env: ambiente });
  process.exit(esito.status || 0);
}

if (process.versions.electron) {
  eseguiInElectron();
} else {
  avviaElectron();
}
