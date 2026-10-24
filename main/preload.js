const { contextBridge, ipcRenderer } = require("electron");

async function chiama(canale, ...argomenti) {
  const risposta = await ipcRenderer.invoke(canale, ...argomenti);
  if (!risposta || !risposta.ok) {
    throw new Error(risposta && risposta.errore ? risposta.errore : "Operazione non riuscita");
  }
  return risposta.valore;
}

function ascolta(canale, richiamo) {
  if (typeof richiamo !== "function") {
    return () => null;
  }
  const gestore = (_evento, dati) => richiamo(dati);
  ipcRenderer.on(canale, gestore);
  return () => ipcRenderer.removeListener(canale, gestore);
}

contextBridge.exposeInMainWorld("monitor", {
  stato: () => chiama("monitor:stato"),
  onStato: (richiamo) => ascolta("monitor:stato", richiamo),
  onAccesso: (richiamo) => ascolta("monitor:accesso", richiamo),
  onEvento: (richiamo) => ascolta("monitor:evento", richiamo),
  onOverlay: (richiamo) => ascolta("monitor:overlay", richiamo),
  accessoCorrente: () => chiama("monitor:accessoCorrente"),
  accedi: () => chiama("monitor:accedi"),
  esci: () => chiama("monitor:esci"),
  impostazioni: () => chiama("monitor:impostazioni"),
  salvaImpostazioni: (parziale) => chiama("monitor:salvaImpostazioni", parziale),
  aggiungiManuale: (voce) => chiama("monitor:aggiungiManuale", voce),
  rimuoviManuale: (giorno) => chiama("monitor:rimuoviManuale", giorno),
  aggiornaUfficiale: (opzioni) => chiama("monitor:aggiornaUfficiale", { mostra: Boolean(opzioni && opzioni.mostra) }),
  esportaCsv: () => chiama("monitor:esportaCsv"),
  apriOverlay: (aperto) => chiama("monitor:apriOverlay", Boolean(aperto)),
  overlayAperto: () => chiama("monitor:overlayAperto"),
  apriPrincipale: () => chiama("monitor:apriPrincipale"),
  apriLink: (indirizzo) => chiama("monitor:apriLink", String(indirizzo)),
  versione: () => chiama("monitor:versione"),
  statoAggiornamento: () => chiama("monitor:aggiornamento"),
  onAggiornamento: (richiamo) => ascolta("monitor:aggiornamento", richiamo),
  controllaAggiornamenti: () => chiama("monitor:controllaAggiornamenti")
});
