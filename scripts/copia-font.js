const path = require("path");
const fs = require("fs");

const RADICE = path.join(__dirname, "..");
const FAMIGLIE = [
  { pacchetto: "manrope", cartella: "manrope", pesi: [400, 500, 600, 700, 800] },
  { pacchetto: "jetbrains-mono", cartella: "jetbrains-mono", pesi: [400, 500, 700] }
];

for (const famiglia of FAMIGLIE) {
  const origine = path.join(RADICE, "node_modules", "@fontsource", famiglia.pacchetto, "files");
  const destinazione = path.join(RADICE, "risorse", "font", famiglia.cartella);
  fs.mkdirSync(destinazione, { recursive: true });
  for (const peso of famiglia.pesi) {
    for (const sottoinsieme of ["latin", "latin-ext"]) {
      const nome = `${famiglia.pacchetto}-${sottoinsieme}-${peso}-normal.woff2`;
      const arrivo = path.join(destinazione, `${sottoinsieme === "latin" ? "" : "ext-"}${peso}.woff2`);
      fs.copyFileSync(path.join(origine, nome), arrivo);
    }
  }
  process.stdout.write(`Font copiati: ${famiglia.pacchetto}\n`);
}
