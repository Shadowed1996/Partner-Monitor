(function () {
  const ORDINE = ["aggiornamenti", "twitch", "monitor"];
  const PAUSA_MINIMA = 820;
  const PAUSA_FINALE = 1100;
  const avvio = window.avvio;
  const $ = (id) => document.getElementById(id);
  const coda = [];
  let inMostra = false;
  let chiusa = false;
  let corrente = null;

  function passo(nome) {
    return document.querySelector(`.avvio-passo[data-passo="${nome}"]`);
  }

  function segnaPassi(attivo, esito) {
    const indice = ORDINE.indexOf(attivo);
    ORDINE.forEach((nome, posizione) => {
      const voce = passo(nome);
      if (!voce) {
        return;
      }
      const finito = posizione < indice || (posizione === indice && Boolean(esito));
      voce.classList.toggle("fatto", finito && !(posizione === indice && esito === "avviso"));
      voce.classList.toggle("avviso", posizione === indice && esito === "avviso");
      voce.classList.toggle("attivo", posizione === indice && !esito);
      if (posizione > indice) {
        voce.classList.remove("fatto", "avviso", "attivo");
      }
    });
  }

  function scrivi(nodo, testo, senzaAnimazione) {
    if (nodo.textContent === testo) {
      return;
    }
    nodo.textContent = testo;
    if (senzaAnimazione) {
      return;
    }
    nodo.classList.remove("entra");
    void nodo.offsetWidth;
    nodo.classList.add("entra");
  }

  function barra(percentuale, modo) {
    const riempimento = $("avvio-riempimento");
    riempimento.classList.toggle("continuo", modo === "continuo");
    riempimento.classList.toggle("installa", modo === "installa");
    if (modo === "continuo" || modo === "installa") {
      riempimento.style.width = "";
      $("avvio-percentuale").textContent = modo === "installa" ? "100%" : "";
      return;
    }
    const valore = Math.max(0, Math.min(100, Math.round(percentuale || 0)));
    riempimento.style.width = `${valore}%`;
    $("avvio-percentuale").textContent = `${valore}%`;
  }

  function vistaAggiornamento(dati) {
    const versione = dati.versione ? `versione ${dati.versione}` : "nuova versione";
    switch (dati.fase) {
      case "controllo":
        return { testo: "Controllo aggiornamenti in corso", dettaglio: "Cerco una versione più nuova", passo: "aggiornamenti", modo: "continuo" };
      case "aggiornato":
        return { testo: "Hai l'ultima versione", dettaglio: `Partner Monitor ${dati.versione || ""} è aggiornato`, passo: "aggiornamenti", esito: "fatto", percentuale: 30 };
      case "sviluppo":
        return { testo: "Controllo aggiornamenti saltato", dettaglio: "Questa è una copia di prova del programma", passo: "aggiornamenti", esito: "fatto", percentuale: 30 };
      case "lento":
      case "errore-controllo":
        return { testo: "Aggiornamenti non controllati", dettaglio: "Il server non risponde, riprovo più tardi", passo: "aggiornamenti", esito: "avviso", percentuale: 30 };
      case "scarica":
        return { testo: `Trovata la ${versione}, la scarico`, dettaglio: `Scaricato il ${dati.percentuale || 0}%, non chiudere il programma`, passo: "aggiornamenti", percentuale: dati.percentuale || 0, veloce: true };
      case "installa":
        return { testo: `Installo la ${versione}`, dettaglio: "Il programma si chiude e si riapre da solo", passo: "aggiornamenti", modo: "installa" };
      case "errore":
        return { testo: "Aggiornamento non riuscito", dettaglio: "Continuo con la versione attuale", passo: "aggiornamenti", esito: "avviso", percentuale: 30 };
      default:
        return null;
    }
  }

  function vistaDi(dati) {
    if (!dati) {
      return null;
    }
    if (dati.tipo === "aggiornamento") {
      return vistaAggiornamento(dati);
    }
    if (dati.tipo === "pronto") {
      return { testo: "Pronto", dettaglio: "Apro Partner Monitor", passo: "monitor", esito: "fatto", percentuale: 100, finale: true };
    }
    if (dati.tipo === "caricamento") {
      return {
        testo: dati.testo || "Caricamento",
        dettaglio: dati.dettaglio || "",
        passo: ORDINE.includes(dati.passo) ? dati.passo : "monitor",
        percentuale: typeof dati.percentuale === "number" ? dati.percentuale : null,
        modo: typeof dati.percentuale === "number" ? null : "continuo"
      };
    }
    return null;
  }

  function applica(vista) {
    const continua = Boolean(vista.veloce && corrente && corrente.veloce);
    corrente = vista;
    scrivi($("avvio-testo"), vista.testo, continua);
    scrivi($("avvio-dettaglio"), vista.dettaglio || "", continua);
    segnaPassi(vista.passo, vista.esito || null);
    if (vista.modo) {
      barra(0, vista.modo);
    } else {
      barra(vista.percentuale, null);
    }
  }

  function prossimo() {
    if (!coda.length) {
      inMostra = false;
      return;
    }
    inMostra = true;
    const vista = coda.shift();
    applica(vista);
    if (vista.finale) {
      setTimeout(chiudi, PAUSA_FINALE);
      return;
    }
    setTimeout(prossimo, PAUSA_MINIMA);
  }

  function ricevi(dati) {
    const vista = vistaDi(dati);
    if (!vista || chiusa) {
      return;
    }
    if (vista.veloce && corrente && corrente.veloce) {
      applica(vista);
      return;
    }
    if (!coda.length && corrente && corrente.testo === vista.testo && corrente.dettaglio === vista.dettaglio) {
      return;
    }
    const ultima = coda[coda.length - 1];
    const stessaVista = ultima && ultima.testo === vista.testo && ultima.dettaglio === vista.dettaglio;
    const sostituibile = ultima && ultima.passo === vista.passo && !ultima.esito && vista.passo !== "aggiornamenti";
    if (ultima && !ultima.finale && ((ultima.veloce && vista.veloce) || stessaVista || sostituibile)) {
      coda.pop();
    }
    coda.push(vista);
    if (!inMostra) {
      prossimo();
    }
  }

  function chiudi() {
    if (chiusa) {
      return;
    }
    chiusa = true;
    if (avvio && avvio.chiudi) {
      avvio.chiudi();
    }
  }

  if (avvio) {
    avvio.versione().then((versione) => {
      $("avvio-versione").textContent = `Versione ${versione}`;
    }).catch(() => null);
    avvio.suStato(ricevi);
  }
})();
