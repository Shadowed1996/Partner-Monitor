const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("avvio", {
  versione: () => ipcRenderer.invoke("avvio:versione"),
  suStato: (richiamo) => {
    if (typeof richiamo !== "function") {
      return () => null;
    }
    const gestore = (_evento, dati) => richiamo(dati);
    ipcRenderer.on("avvio:stato", gestore);
    return () => ipcRenderer.removeListener("avvio:stato", gestore);
  },
  chiudi: () => ipcRenderer.send("avvio:chiudi")
});
