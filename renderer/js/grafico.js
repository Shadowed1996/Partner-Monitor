(function () {
  const SVG = "http://www.w3.org/2000/svg";
  const orario = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" });

  function nodo(nome, attributi, genitore) {
    const elemento = document.createElementNS(SVG, nome);
    for (const [chiave, valore] of Object.entries(attributi || {})) {
      elemento.setAttribute(chiave, String(valore));
    }
    if (genitore) {
      genitore.appendChild(elemento);
    }
    return elemento;
  }

  function passoTondo(massimo) {
    const grezzo = massimo / 4;
    const potenza = Math.pow(10, Math.floor(Math.log10(Math.max(grezzo, 1))));
    for (const fattore of [1, 2, 2.5, 5, 10]) {
      if (fattore * potenza >= grezzo) {
        return fattore * potenza;
      }
    }
    return 10 * potenza;
  }

  function percorsoMorbido(punti) {
    if (punti.length < 3) {
      return punti.map((punto, indice) => `${indice ? "L" : "M"}${punto[0].toFixed(1)},${punto[1].toFixed(1)}`).join(" ");
    }
    let percorso = `M${punti[0][0].toFixed(1)},${punti[0][1].toFixed(1)}`;
    for (let indice = 1; indice < punti.length; indice += 1) {
      const [x0, y0] = punti[indice - 1];
      const [x1, y1] = punti[indice];
      const mezzo = (x0 + x1) / 2;
      percorso += ` C${mezzo.toFixed(1)},${y0.toFixed(1)} ${mezzo.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
    }
    return percorso;
  }

  function sfoltisci(serie, massimoPunti) {
    if (serie.length <= massimoPunti) {
      return serie;
    }
    const passo = serie.length / massimoPunti;
    const esito = [];
    for (let indice = 0; indice < massimoPunti; indice += 1) {
      const inizio = Math.floor(indice * passo);
      const fine = Math.max(inizio + 1, Math.floor((indice + 1) * passo));
      const fetta = serie.slice(inizio, fine);
      const media = fetta.reduce((somma, punto) => somma + punto.v, 0) / fetta.length;
      esito.push({ t: fetta[Math.floor(fetta.length / 2)].t, v: media });
    }
    esito[esito.length - 1] = serie[serie.length - 1];
    return esito;
  }

  function vuoto(contenitore, titolo, testo) {
    contenitore.replaceChildren();
    contenitore.classList.add("grafico-vuoto");
    const disegno = nodo("svg", { viewBox: "0 0 160 64", class: "vuoto-disegno", "aria-hidden": "true" });
    nodo("line", { x1: 8, y1: 26, x2: 152, y2: 26, class: "vuoto-soglia" }, disegno);
    nodo("path", { d: "M8 54 C 30 54, 36 40, 58 42 S 92 30, 108 34 S 136 18, 152 14", class: "vuoto-linea" }, disegno);
    nodo("circle", { cx: 152, cy: 14, r: 4, class: "vuoto-punto" }, disegno);
    const titoloElemento = document.createElement("p");
    titoloElemento.className = "vuoto-titolo";
    titoloElemento.textContent = titolo;
    const testoElemento = document.createElement("p");
    testoElemento.className = "vuoto-testo";
    testoElemento.textContent = testo;
    contenitore.append(disegno, titoloElemento, testoElemento);
  }

  function disegna(contenitore, serieGrezza, soglia, opzioni) {
    const impostazioni = opzioni || {};
    const serie = (Array.isArray(serieGrezza) ? serieGrezza : [])
      .map((punto) => ({ t: new Date(punto.t).getTime(), v: Number(punto.v) }))
      .filter((punto) => Number.isFinite(punto.t) && Number.isFinite(punto.v))
      .sort((a, b) => a.t - b.t);
    if (serie.length < 2) {
      vuoto(contenitore, impostazioni.titoloVuoto || "Ancora nessun dato", impostazioni.testoVuoto || "Il grafico si riempie minuto per minuto quando sei in diretta.");
      return;
    }
    contenitore.classList.remove("grafico-vuoto");
    const larghezza = Math.max(260, Math.round(contenitore.clientWidth || 600));
    const altezza = Math.max(170, Math.round(contenitore.clientHeight || 240));
    const margine = { sinistra: 40, destra: 16, alto: 14, basso: 28 };
    const larghezzaUtile = larghezza - margine.sinistra - margine.destra;
    const altezzaUtile = altezza - margine.alto - margine.basso;
    const punti = sfoltisci(serie, Math.max(30, Math.floor(larghezzaUtile / 3)));
    const inizio = serie[0].t;
    const fine = Math.max(serie[serie.length - 1].t, inizio + 60000);
    const massimoValori = Math.max(...serie.map((punto) => punto.v));
    const passo = passoTondo(Math.max(massimoValori, soglia) * 1.12);
    const massimo = Math.ceil((Math.max(massimoValori, soglia) * 1.08) / passo) * passo;
    const x = (tempo) => margine.sinistra + ((tempo - inizio) / (fine - inizio)) * larghezzaUtile;
    const y = (valore) => margine.alto + altezzaUtile - (valore / massimo) * altezzaUtile;

    const svg = nodo("svg", { viewBox: `0 0 ${larghezza} ${altezza}`, width: larghezza, height: altezza, class: "grafico-svg", "aria-hidden": "true" });
    const definizioni = nodo("defs", {}, svg);
    const sfumatura = nodo("linearGradient", { id: "grafico-area", x1: 0, y1: 0, x2: 0, y2: 1 }, definizioni);
    nodo("stop", { offset: "0", class: "area-alta" }, sfumatura);
    nodo("stop", { offset: "1", class: "area-bassa" }, sfumatura);
    const ritaglioSopra = nodo("clipPath", { id: "grafico-sopra" }, definizioni);
    nodo("rect", { x: 0, y: 0, width: larghezza, height: Math.max(0, y(soglia)) }, ritaglioSopra);

    const griglia = nodo("g", { class: "griglia-assi" }, svg);
    for (let valore = 0; valore <= massimo; valore += passo) {
      nodo("line", { x1: margine.sinistra, x2: larghezza - margine.destra, y1: y(valore), y2: y(valore), class: "riga-griglia" }, griglia);
      const etichetta = nodo("text", { x: margine.sinistra - 8, y: y(valore) + 4, class: "testo-asse", "text-anchor": "end" }, griglia);
      etichetta.textContent = String(Math.round(valore));
    }
    const durata = fine - inizio;
    const intervalli = [5, 10, 15, 30, 60, 120, 180, 240].map((minuti) => minuti * 60000);
    const intervallo = intervalli.find((valore) => durata / valore <= Math.max(2, Math.floor(larghezzaUtile / 90))) || 360 * 60000;
    const primo = Math.ceil(inizio / intervallo) * intervallo;
    for (let tempo = primo; tempo <= fine; tempo += intervallo) {
      const posizione = x(tempo);
      if (posizione < margine.sinistra + 18 || posizione > larghezza - margine.destra - 18) {
        continue;
      }
      const etichetta = nodo("text", { x: posizione, y: altezza - 8, class: "testo-asse", "text-anchor": "middle" }, griglia);
      etichetta.textContent = orario.format(new Date(tempo));
    }

    const coordinate = punti.map((punto) => [x(punto.t), y(punto.v)]);
    const linea = percorsoMorbido(coordinate);
    const base = y(0);
    nodo("path", { d: `${linea} L${coordinate[coordinate.length - 1][0].toFixed(1)},${base} L${coordinate[0][0].toFixed(1)},${base} Z`, class: "area", fill: "url(#grafico-area)" }, svg);
    nodo("path", { d: linea, class: "linea" }, svg);
    nodo("path", { d: linea, class: "linea-sopra", "clip-path": "url(#grafico-sopra)" }, svg);

    nodo("line", { x1: margine.sinistra, x2: larghezza - margine.destra, y1: y(soglia), y2: y(soglia), class: "soglia" }, svg);
    const targhetta = nodo("g", { class: "soglia-targhetta", transform: `translate(${larghezza - margine.destra - 34},${y(soglia) - 20})` }, svg);
    nodo("rect", { width: 34, height: 16, rx: 5 }, targhetta);
    const testoSoglia = nodo("text", { x: 17, y: 12, "text-anchor": "middle" }, targhetta);
    testoSoglia.textContent = String(soglia);

    const ultimo = coordinate[coordinate.length - 1];
    nodo("circle", { cx: ultimo[0], cy: ultimo[1], r: 9, class: "punto-alone" }, svg);
    nodo("circle", { cx: ultimo[0], cy: ultimo[1], r: 4.5, class: "punto-ultimo" }, svg);

    const cursore = nodo("g", { class: "cursore", visibility: "hidden" }, svg);
    const cursoreLinea = nodo("line", { y1: margine.alto, y2: base, class: "cursore-linea" }, cursore);
    const cursorePunto = nodo("circle", { r: 4.5, class: "cursore-punto" }, cursore);
    const suggerimento = document.createElement("div");
    suggerimento.className = "grafico-suggerimento";
    suggerimento.hidden = true;

    const superficie = nodo("rect", { x: margine.sinistra, y: margine.alto, width: larghezzaUtile, height: altezzaUtile, class: "superficie" }, svg);
    const mostra = (clientX) => {
      const riquadro = svg.getBoundingClientRect();
      const scala = larghezza / riquadro.width;
      const posizione = (clientX - riquadro.left) * scala;
      const tempo = inizio + ((posizione - margine.sinistra) / larghezzaUtile) * (fine - inizio);
      let vicino = serie[0];
      for (const punto of serie) {
        if (Math.abs(punto.t - tempo) < Math.abs(vicino.t - tempo)) {
          vicino = punto;
        }
      }
      const cx = x(vicino.t);
      const cy = y(vicino.v);
      cursore.setAttribute("visibility", "visible");
      cursoreLinea.setAttribute("x1", cx);
      cursoreLinea.setAttribute("x2", cx);
      cursorePunto.setAttribute("cx", cx);
      cursorePunto.setAttribute("cy", cy);
      suggerimento.hidden = false;
      suggerimento.replaceChildren();
      const valore = document.createElement("strong");
      valore.textContent = `${Math.round(vicino.v)} spettatori`;
      const quando = document.createElement("span");
      quando.textContent = orario.format(new Date(vicino.t));
      suggerimento.append(valore, quando);
      const sinistra = cx / scala;
      suggerimento.style.left = `${Math.min(Math.max(sinistra, 70), riquadro.width - 70)}px`;
      suggerimento.style.top = `${cy / scala}px`;
      suggerimento.classList.toggle("sopra-soglia", vicino.v >= soglia);
    };
    superficie.addEventListener("pointermove", (evento) => mostra(evento.clientX));
    superficie.addEventListener("pointerleave", () => {
      cursore.setAttribute("visibility", "hidden");
      suggerimento.hidden = true;
    });
    contenitore.replaceChildren(svg, suggerimento);
  }

  window.Grafico = { disegna };
})();
