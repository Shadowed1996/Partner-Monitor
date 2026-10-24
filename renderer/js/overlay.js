(function () {
  const monitor = window.monitor;
  const $ = (selettore) => document.querySelector(selettore);

  function crea(tag, classe, testo) {
    const elemento = document.createElement(tag);
    if (classe) {
      elemento.className = classe;
    }
    if (testo !== undefined) {
      elemento.textContent = String(testo);
    }
    return elemento;
  }

  function disegna(stato) {
    const obiettivo = stato && stato.obiettivo ? Number(stato.obiettivo.media) || 75 : 75;
    const inOnda = Boolean(stato && stato.inOnda);
    const spettatori = inOnda ? Number(stato.spettatori) || 0 : 0;
    const riquadro = $("#riquadro");
    riquadro.classList.toggle("spenta", !inOnda);
    riquadro.classList.toggle("pieno", spettatori >= obiettivo);
    riquadro.classList.toggle("conta", inOnda && Boolean(stato.contaOra));
    $("#badge").className = `badge-live${inOnda ? " acceso" : ""}`;
    $("#badge-testo").textContent = inOnda ? "LIVE" : "OFFLINE";
    $("#spettatori").textContent = String(spettatori);
    $("#obiettivo").textContent = String(obiettivo);
    $("#riempimento").style.width = `${Math.min(100, (spettatori / obiettivo) * 100)}%`;
    const lurk = stato && stato.lurk ? stato.lurk : null;
    const bloccoLurk = $("#lurk-blocco");
    bloccoLurk.hidden = !lurk;
    if (lurk) {
      const presenti = Number(lurk.presenti) || 0;
      const vivi = Number(lurk.vivi) || 0;
      bloccoLurk.classList.toggle("tenue", Boolean(lurk.errore));
      $("#lurk").textContent = String(presenti);
      bloccoLurk.title = lurk.errore ? `Ultimo dato valido: ${presenti} in lurk sul sito, il sito adesso non risponde` : `${presenti} con il lurk acceso sul sito, ${vivi} con il video in riproduzione`;
    }
    const giorni = stato && stato.obiettivo ? Number(stato.obiettivo.giorni) || 30 : 30;
    const periodi = stato && Array.isArray(stato.periodi) ? [...stato.periodi].sort((a, b) => (a.chiave === "corrente" ? 0 : 1) - (b.chiave === "corrente" ? 0 : 1)) : [];
    const contenitore = $("#periodi");
    contenitore.replaceChildren();
    for (const periodo of periodi) {
      const richieste = Number(periodo.richieste) || 6;
      const confermate = Math.min(Number(periodo.confermate) || 0, richieste);
      const blocco = crea("div", `periodo${periodo.ok ? " ok" : ""}`);
      blocco.append(crea("span", null, periodo.chiave === "corrente" ? `${giorni} G` : `${giorni * 2} G`));
      const tacchette = crea("span", "tacchette");
      for (let indice = 0; indice < richieste; indice += 1) {
        tacchette.append(crea("span", indice < confermate ? "piena" : ""));
      }
      blocco.append(tacchette, crea("strong", null, `${confermate}/${richieste}`));
      contenitore.append(blocco);
    }
  }

  $("#chiudi").addEventListener("click", () => monitor.apriOverlay(false));
  $("#apri").addEventListener("click", () => monitor.apriPrincipale());
  monitor.onStato(disegna);
  monitor.stato().then(disegna).catch(() => disegna(null));
})();
