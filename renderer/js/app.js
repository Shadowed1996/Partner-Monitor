(function () {
  const monitor = window.monitor;
  const $ = (selettore) => document.querySelector(selettore);
  const $$ = (selettore) => Array.from(document.querySelectorAll(selettore));
  const formatoNumero = new Intl.NumberFormat("it-IT");
  const formatoDecimale = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });
  const formatoGiorno = new Intl.DateTimeFormat("it-IT", { weekday: "short", day: "numeric", month: "short" });
  const formatoGiornoCorto = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short" });
  const formatoSettimana = new Intl.DateTimeFormat("it-IT", { weekday: "short" });
  const formatoMese = new Intl.DateTimeFormat("it-IT", { month: "short" });
  const formatoOra = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" });
  const URL_CONSOLE = "https://dev.twitch.tv/console/apps/create";
  const PASSI_CLIENT = [
    { testo: "Apri la console sviluppatori di Twitch ed entra con l'account del canale. Se te lo chiede, attiva prima l'autenticazione a due fattori.", link: true },
    { testo: "Premi Registra la tua applicazione. Come nome scrivi quello che vuoi, per esempio Partner Monitor Slayer." },
    { testo: "In URL di reindirizzamento OAuth scrivi http://localhost e premi Aggiungi." },
    { testo: "Categoria: Application Integration. Tipo di client: Pubblico. Questo passo è importante." },
    { testo: "Premi Crea, poi Gestisci accanto all'app: copia il Client ID e incollalo qui sotto. Il segreto non serve." }
  ];

  let stato = null;
  let impostazioni = {};
  let accesso = null;
  let guidaAperta = false;
  let guidaRimandata = false;
  let guidaForzata = false;
  let passoGuida = 1;
  let accessoRichiesto = false;
  let timerAccesso = null;
  let aggiornamento = null;
  let timerAggiornamento = null;

  function crea(tag, classe, testo) {
    const elemento = document.createElement(tag);
    if (classe) {
      elemento.className = classe;
    }
    if (testo !== undefined && testo !== null) {
      elemento.textContent = String(testo);
    }
    return elemento;
  }

  function dataDaGiorno(giorno) {
    const [anno, mese, numero] = String(giorno).split("-").map(Number);
    return new Date(anno, (mese || 1) - 1, numero || 1, 12);
  }

  function giornoIso(data) {
    return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
  }

  function numero(valore) {
    return Number.isFinite(Number(valore)) ? formatoNumero.format(Math.round(Number(valore))) : "0";
  }

  function durata(da) {
    const minuti = Math.max(0, Math.floor((Date.now() - new Date(da).getTime()) / 60000));
    if (!Number.isFinite(minuti)) {
      return "0 min";
    }
    const ore = Math.floor(minuti / 60);
    return ore ? `${ore} h ${String(minuti % 60).padStart(2, "0")} min` : `${minuti} min`;
  }

  function tempoFa(iso) {
    const differenza = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(differenza)) {
      return "";
    }
    const minuti = Math.round(differenza / 60000);
    if (minuti < 1) {
      return "adesso";
    }
    if (minuti < 60) {
      return minuti === 1 ? "1 minuto fa" : `${minuti} minuti fa`;
    }
    const ore = Math.round(minuti / 60);
    if (ore < 24) {
      return ore === 1 ? "1 ora fa" : `${ore} ore fa`;
    }
    const giorni = Math.round(ore / 24);
    return giorni === 1 ? "ieri" : `${giorni} giorni fa`;
  }

  function avviso(testo, tipo) {
    const contenitore = $("#avvisi");
    const elemento = crea("div", `avviso-flottante ${tipo || ""}`.trim());
    elemento.setAttribute("role", tipo === "errore" ? "alert" : "status");
    elemento.append(crea("span", "avviso-punto"), crea("p", null, testo));
    contenitore.append(elemento);
    setTimeout(() => elemento.classList.add("uscita"), 4200);
    setTimeout(() => elemento.remove(), 4600);
  }

  function obiettivo() {
    const base = stato && stato.obiettivo ? stato.obiettivo : {};
    return { media: Number(base.media) || 75, dirette: Number(base.dirette) || 6, giorni: Number(base.giorni) || 30 };
  }

  function tutteLeDirette() {
    if (!stato || !Array.isArray(stato.periodi)) {
      return [];
    }
    return stato.periodi.flatMap((periodo) => (Array.isArray(periodo.dirette) ? periodo.dirette.map((voce) => ({ ...voce, periodo: periodo.chiave })) : []));
  }

  function mostraErroreCampo(selettore, testo) {
    const elemento = $(selettore);
    elemento.textContent = testo || "";
    elemento.hidden = !testo;
  }

  function aggiornaTestata() {
    const canale = stato && stato.canale;
    $("#testata-canale").textContent = canale ? canale.nome || canale.login : "Nessun canale";
    const pillola = $("#pillola-stato");
    let classe = "neutra";
    let testo = "In attesa";
    if (!stato) {
      testo = "Avvio";
    } else if (stato.clientIdMancante || !canale) {
      testo = "Da configurare";
      classe = "ambra";
    } else if (!stato.collegato) {
      testo = "Non collegato";
      classe = "ambra";
    } else if (stato.inOnda === true) {
      testo = "In diretta";
      classe = "live";
    } else if (stato.inOnda === false) {
      testo = "Offline";
    } else if (stato.ultimoErrore) {
      testo = "Problema";
      classe = "rossa";
    }
    pillola.className = `pillola ${classe}`;
    pillola.textContent = testo;
  }

  function aggiornaBanda() {
    const banda = $("#banda");
    const azione = $("#banda-azione");
    banda.className = "banda";
    azione.hidden = true;
    azione.onclick = null;
    if (!stato) {
      banda.hidden = true;
      return;
    }
    if (stato.ultimoErrore) {
      banda.hidden = false;
      banda.classList.add("errore");
      $("#banda-testo").textContent = stato.ultimoErrore;
      return;
    }
    if ((stato.clientIdMancante || !stato.canale || !stato.collegato) && !guidaAperta) {
      banda.hidden = false;
      banda.classList.add("attenzione");
      $("#banda-testo").textContent = stato.clientIdMancante || !stato.canale ? "Manca la configurazione di Twitch." : "Non sei collegato a Twitch: i dati non si aggiornano.";
      azione.hidden = false;
      azione.textContent = stato.clientIdMancante || !stato.canale ? "Configura" : "Collega";
      azione.onclick = () => apriGuida(true);
      return;
    }
    banda.hidden = true;
  }

  function aggiornaAggiornamento(dati) {
    aggiornamento = dati || null;
    const banda = $("#banda-aggiornamento");
    const testo = $("#banda-aggiornamento-testo");
    const barra = $("#banda-aggiornamento-barra");
    const riga = $("#imp-aggiornamento");
    const pulsante = $("#imp-controlla");
    clearTimeout(timerAggiornamento);
    banda.className = "banda aggiornamento";
    barra.hidden = true;
    pulsante.disabled = false;
    const versione = aggiornamento && aggiornamento.versione ? `versione ${aggiornamento.versione}` : "nuova versione";
    const quando = aggiornamento && aggiornamento.controllatoIl ? `, controllato alle ${formatoOra.format(new Date(aggiornamento.controllatoIl))}` : "";
    switch (aggiornamento ? aggiornamento.fase : "") {
      case "controllo":
        banda.hidden = false;
        testo.textContent = "Controllo aggiornamenti in corso, cerco una versione più nuova.";
        riga.textContent = "Controllo aggiornamenti in corso";
        pulsante.disabled = true;
        break;
      case "scarica":
        banda.hidden = false;
        testo.textContent = `Trovata la ${versione}, la scarico: ${aggiornamento.percentuale || 0}%. Non chiudere il programma.`;
        barra.hidden = false;
        barra.querySelector("span").style.width = `${Math.min(100, aggiornamento.percentuale || 0)}%`;
        riga.textContent = `Scarico la ${versione}, ${aggiornamento.percentuale || 0}%`;
        pulsante.disabled = true;
        break;
      case "installa":
        banda.hidden = false;
        banda.classList.add("ok");
        testo.textContent = `Installo la ${versione}: il programma si chiude e si riapre da solo.`;
        riga.textContent = `Installo la ${versione}`;
        pulsante.disabled = true;
        break;
      case "aggiornato":
        banda.hidden = false;
        banda.classList.add("ok");
        testo.textContent = `Hai l'ultima versione, Partner Monitor ${aggiornamento.versione} è aggiornato.`;
        riga.textContent = `Hai l'ultima versione${quando}`;
        timerAggiornamento = setTimeout(() => {
          banda.hidden = true;
        }, 5000);
        break;
      case "errore":
        banda.hidden = false;
        banda.classList.add("errore");
        testo.textContent = "Aggiornamento non riuscito: continuo con la versione attuale e riprovo più tardi.";
        riga.textContent = `Aggiornamento non riuscito${quando}`;
        break;
      case "lento":
      case "errore-controllo":
        banda.hidden = true;
        riga.textContent = `Aggiornamenti non controllati: il server non risponde${quando}`;
        break;
      case "sviluppo":
        banda.hidden = true;
        riga.textContent = "Copia di prova: gli aggiornamenti automatici sono spenti";
        break;
      default:
        banda.hidden = true;
        riga.textContent = "";
    }
  }

  function ultimaDiretta() {
    return tutteLeDirette()
      .filter((voce) => voce.giorno)
      .sort((a, b) => (a.giorno < b.giorno ? 1 : -1))[0];
  }

  function aggiornaEroe() {
    const meta = obiettivo();
    const eroe = $("#eroe");
    const badge = $("#eroe-badge");
    const conta = $("#eroe-conta");
    const spettatori = stato && stato.inOnda ? Number(stato.spettatori) || 0 : 0;
    const datiDl = $$(".eroe-dati > div");
    eroe.classList.remove("live", "offline", "in-attesa", "conta", "sotto");
    $("#eroe-obiettivo").textContent = numero(meta.media);
    $("#eroe-barra").setAttribute("aria-valuemax", String(meta.media));
    $("#eroe-barra").setAttribute("aria-valuenow", String(spettatori));
    $("#eroe-barra-riempimento").style.width = `${Math.min(100, (spettatori / meta.media) * 100)}%`;
    $("#eroe-barra").classList.toggle("piena", spettatori >= meta.media);
    $("#eroe-spettatori").textContent = numero(spettatori);
    $("#eroe-didascalia").textContent = "UTENTI IN LIVE / OBIETTIVO";
    conta.hidden = true;
    if (stato && stato.inOnda === true) {
      eroe.classList.add("live");
      badge.className = "stato-live acceso";
      $("#eroe-badge-testo").textContent = "LIVE";
      $("#eroe-titolo").textContent = stato.titolo || "Diretta in corso";
      $("#eroe-sotto").textContent = stato.gioco || "Categoria non indicata";
      const media = stato.mediaDiretta;
      $("#eroe-media").textContent = media === null || media === undefined ? "0" : numero(media);
      $(".eroe-media .etichetta").textContent = "MEDIA DELLA DIRETTA";
      if (media !== null && media !== undefined) {
        conta.hidden = false;
        const staContando = Boolean(stato.contaOra);
        eroe.classList.add(staContando ? "conta" : "sotto");
        conta.className = `badge ${staContando ? "verde" : "ambra"}`;
        conta.textContent = staContando ? "STA CONTANDO" : "SOTTO LA MEDIA";
        const scarto = Math.round(media - meta.media);
        $("#eroe-media-nota").textContent = scarto >= 0 ? (scarto === 0 ? "Esattamente sull'obiettivo" : `${scarto} sopra l'obiettivo`) : `Mancano ${Math.abs(scarto)} spettatori di media`;
      } else {
        $("#eroe-media-nota").textContent = "Si calcola dopo i primi minuti";
      }
      const serie = Array.isArray(stato.serieDiretta) ? stato.serieDiretta : [];
      const picco = serie.reduce((massimo, punto) => Math.max(massimo, Number(punto.v) || 0), spettatori);
      impostaDato(datiDl[0], "In onda da", stato.iniziataIl ? durata(stato.iniziataIl) : "0 min");
      impostaDato(datiDl[1], "Picco", numero(picco));
      impostaDato(datiDl[2], "Follower", stato.follower === null || stato.follower === undefined ? "Non letti" : numero(stato.follower));
      return;
    }
    const ultima = ultimaDiretta();
    if (stato && stato.inOnda === false) {
      eroe.classList.add("offline");
      badge.className = "stato-live";
      $("#eroe-badge-testo").textContent = "OFFLINE";
      $("#eroe-titolo").textContent = "Nessuna diretta in corso";
      $("#eroe-sotto").textContent = "Il monitor controlla Twitch ogni minuto e ti avvisa quando parti.";
    } else {
      eroe.classList.add("in-attesa");
      badge.className = "stato-live in-attesa";
      $("#eroe-badge-testo").textContent = "IN ATTESA";
      $("#eroe-titolo").textContent = stato && stato.collegato ? "Controllo il canale" : "Twitch non è ancora collegato";
      $("#eroe-sotto").textContent = stato && stato.collegato ? "Il primo dato arriva tra pochi secondi." : "Completa la configurazione per vedere gli spettatori in tempo reale.";
    }
    $(".eroe-media .etichetta").textContent = "MEDIA ULTIMA DIRETTA";
    if (ultima && ultima.media !== null && ultima.media !== undefined) {
      $("#eroe-media").textContent = numero(ultima.media);
      conta.hidden = false;
      conta.className = `badge ${ultima.conta ? "verde" : "neutro"}`;
      conta.textContent = ultima.conta ? "CONTATA" : "NON CONTATA";
      $("#eroe-media-nota").textContent = formatoGiorno.format(dataDaGiorno(ultima.giorno));
    } else {
      $("#eroe-media").textContent = "0";
      $("#eroe-media-nota").textContent = "Nessuna diretta registrata";
    }
    const valide = tutteLeDirette().filter((voce) => voce.conta).length;
    impostaDato(datiDl[0], "Ultima diretta", ultima ? formatoGiornoCorto.format(dataDaGiorno(ultima.giorno)) : "Nessuna");
    impostaDato(datiDl[1], `Valide in ${meta.giorni * 2} g`, numero(valide));
    impostaDato(datiDl[2], "Follower", stato && stato.follower !== null && stato.follower !== undefined ? numero(stato.follower) : "Non letti");
  }

  function aggiornaLurk() {
    const blocco = $("#dato-lurk-blocco");
    if (!blocco) {
      return;
    }
    const dd = blocco.querySelector("dd");
    const lurk = stato && stato.lurk ? stato.lurk : null;
    const spento = Boolean(impostazioni && impostazioni.lurk === false);
    blocco.hidden = spento;
    blocco.classList.toggle("tenue", !lurk || Boolean(lurk.errore));
    dd.textContent = "";
    if (!lurk) {
      dd.textContent = "Non letto";
      blocco.title = "Il sito slayerbeard.com non ha ancora risposto";
      return;
    }
    dd.append(document.createTextNode(numero(lurk.presenti)));
    const vivi = Number(lurk.vivi) || 0;
    if (lurk.presenti > 0) {
      dd.append(crea("small", "", `${numero(vivi)} col video`));
    }
    const quando = lurk.letto ? `letto ${tempoFa(lurk.letto)}` : "";
    blocco.title = lurk.errore ? `Ultimo dato valido ${quando}: il sito adesso non risponde` : `${numero(lurk.presenti)} con il lurk acceso sul sito, ${numero(vivi)} con il video in riproduzione, ${quando}`;
  }

  function impostaDato(blocco, etichetta, valore) {
    blocco.querySelector("dt").textContent = etichetta;
    blocco.querySelector("dd").textContent = valore;
  }

  function aggiornaGrafico() {
    const meta = obiettivo();
    $("#legenda-soglia").textContent = `soglia ${meta.media}`;
    const inOnda = stato && stato.inOnda === true;
    const serie = inOnda ? stato.serieDiretta : [];
    window.Grafico.disegna($("#grafico"), serie, meta.media, {
      titoloVuoto: inOnda ? "La diretta è appena iniziata" : "Nessuna diretta in corso",
      testoVuoto: inOnda ? "Il primo punto compare entro un minuto." : "Quando vai in diretta qui vedi gli spettatori minuto per minuto, con la linea dei 75."
    });
  }

  function titoloPeriodo(periodo, meta) {
    return periodo.chiave === "precedente" ? `${meta.giorni}-${meta.giorni * 2} GIORNI FA` : `ULTIMI ${meta.giorni} GIORNI`;
  }

  function creaTacche(periodo, meta) {
    const richieste = Number(periodo.richieste) || meta.dirette;
    const valide = (periodo.dirette || []).filter((voce) => voce.conta).sort((a, b) => (a.giorno < b.giorno ? -1 : 1));
    const tacche = crea("ul", "tacche");
    tacche.setAttribute("aria-label", `${Math.min(valide.length, richieste)} dirette confermate su ${richieste}`);
    for (let indice = 0; indice < richieste; indice += 1) {
      const voce = valide[indice];
      const tacca = crea("li", voce ? "tacca piena" : "tacca");
      tacca.tabIndex = 0;
      const testo = voce ? `${formatoGiorno.format(dataDaGiorno(voce.giorno))}, media ${numero(voce.media)}` : `Manca una diretta da almeno ${meta.media}`;
      tacca.dataset.suggerimento = testo;
      tacca.setAttribute("aria-label", testo);
      if (voce) {
        tacca.append(crea("span", "tacca-numero", numero(voce.media)));
      }
      tacche.append(tacca);
    }
    return tacche;
  }

  function aggiornaPeriodi() {
    const meta = obiettivo();
    const griglia = $("#periodi-griglia");
    const periodi = stato && Array.isArray(stato.periodi) ? stato.periodi : [];
    const totali = Number(stato && stato.totali) || 2;
    const completati = Number(stato && stato.completati) || 0;
    $("#periodi-completati").textContent = `${completati} / ${totali}`;
    $("#periodi-soglia").textContent = numero(meta.media);
    $(".periodi").classList.toggle("tutti", completati >= totali);
    griglia.replaceChildren();
    const ordinati = [...periodi].sort((a, b) => (a.chiave === "corrente" ? 0 : 1) - (b.chiave === "corrente" ? 0 : 1));
    if (!ordinati.length) {
      ordinati.push({ chiave: "corrente", dirette: [], confermate: 0, richieste: meta.dirette }, { chiave: "precedente", dirette: [], confermate: 0, richieste: meta.dirette });
    }
    for (const periodo of ordinati) {
      const richieste = Number(periodo.richieste) || meta.dirette;
      const confermate = Math.min(Number(periodo.confermate) || 0, richieste);
      const scheda = crea("article", `scheda periodo${periodo.ok ? " ok" : ""}`);
      const testa = crea("header", "periodo-testa");
      const titolo = crea("h3", null, titoloPeriodo(periodo, meta));
      testa.append(titolo);
      if (periodo.ok) {
        testa.append(crea("span", "badge verde", "COMPLETATO"));
      } else if (periodo.da && periodo.a) {
        testa.append(crea("span", "periodo-date", `${formatoGiornoCorto.format(dataDaGiorno(periodo.da))} - ${formatoGiornoCorto.format(dataDaGiorno(periodo.a))}`));
      }
      const cifra = crea("p", "periodo-cifra");
      cifra.append(crea("span", "periodo-confermate", confermate), crea("span", "periodo-richieste", `/ ${richieste}`));
      const didascalia = crea("p", "didascalia", "CONFERMATI");
      const corpo = crea("div", "periodo-corpo");
      const sinistra = crea("div", "periodo-numeri");
      sinistra.append(cifra, didascalia);
      corpo.append(sinistra, creaTacche(periodo, meta));
      scheda.append(testa, corpo);
      const note = [];
      const dirette = periodo.dirette || [];
      const sotto = dirette.filter((voce) => voce.media !== null && voce.media !== undefined && !voce.conta).length;
      const senzaMedia = dirette.filter((voce) => voce.media === null || voce.media === undefined).length;
      const reali = Number(periodo.totaleReale) || 0;
      if (!dirette.length) {
        note.push("Nessuna diretta in questo periodo.");
      }
      if (reali > richieste) {
        note.push(`${reali} dirette valide, ne bastano ${richieste}.`);
      } else if (!periodo.ok && dirette.length) {
        const mancano = richieste - confermate;
        note.push(mancano === 1 ? "Manca 1 diretta." : `Mancano ${mancano} dirette.`);
      }
      if (sotto) {
        note.push(sotto === 1 ? `1 sotto i ${meta.media}, non conta.` : `${sotto} sotto i ${meta.media}, non contano.`);
      }
      if (senzaMedia) {
        note.push(senzaMedia === 1 ? "1 senza media: aggiungila in Dirette." : `${senzaMedia} senza media: aggiungile in Dirette.`);
      }
      if (periodo.chiave === "corrente") {
        const piuVecchia = dirette.filter((voce) => voce.conta).sort((a, b) => (a.giorno < b.giorno ? -1 : 1))[0];
        if (piuVecchia) {
          const esce = Math.round((dataDaGiorno(piuVecchia.giorno).getTime() + meta.giorni * 86400000 - dataDaGiorno(giornoIso(new Date())).getTime()) / 86400000);
          if (esce > 0 && esce <= meta.giorni) {
            note.push(esce === 1 ? "La più vecchia passa al periodo precedente domani." : `La più vecchia passa al periodo precedente tra ${esce} giorni.`);
          }
        }
      }
      scheda.append(crea("p", "nota periodo-nota", note.join(" ")));
      griglia.append(scheda);
    }
  }

  function aggiornaUfficiale() {
    const ufficiale = stato && stato.ufficiale;
    const valore = $("#ufficiale-valore");
    if (ufficiale) {
      valore.textContent = ufficiale.avanzamento || "Letto, ma senza un numero riconoscibile";
      valore.classList.toggle("tenue", !ufficiale.avanzamento);
      $("#ufficiale-quando").textContent = ufficiale.aggiornatoIl ? `Aggiornato ${tempoFa(ufficiale.aggiornatoIl)}, alle ${formatoOra.format(new Date(ufficiale.aggiornatoIl))}.` : "Aggiornato.";
      $("#ufficiale-dettagli").hidden = !ufficiale.testo;
      $("#ufficiale-grezzo").textContent = ufficiale.testo || "";
      $("#ufficiale-accedi").hidden = !ufficiale.richiedeAccesso;
      const voci = (Array.isArray(ufficiale.voci) ? ufficiale.voci : []).filter((voce) => Number(voce.richiesto) > 0).slice(0, 4);
      const lista = $("#ufficiale-voci");
      lista.hidden = !voci.length;
      lista.replaceChildren(
        ...voci.map((voce) => {
          const riga = crea("li", Number(voce.attuale) >= Number(voce.richiesto) ? "fatta" : "");
          const testa = crea("div", "voce-testa");
          testa.append(crea("span", null, voce.etichetta || "Obiettivo"), crea("strong", "mono", `${numero(voce.attuale)} / ${numero(voce.richiesto)}`));
          const barra = crea("div", "mini-barra");
          const riempimento = crea("span", "mini-riempimento");
          riempimento.style.width = `${Math.min(100, (Number(voce.attuale) / Number(voce.richiesto)) * 100)}%`;
          barra.append(riempimento);
          riga.append(testa, barra);
          return riga;
        })
      );
    } else {
      valore.textContent = "Non ancora letto";
      valore.classList.add("tenue");
      $("#ufficiale-accedi").hidden = true;
      $("#ufficiale-voci").hidden = true;
      $("#ufficiale-quando").textContent = "Premi Aggiorna: si apre Twitch in una finestra solo se serve l'accesso, poi legge il Percorso verso il Partner.";
      $("#ufficiale-dettagli").hidden = true;
    }
    const tracker = stato && stato.tracker;
    const riga = $("#tracker");
    riga.hidden = !tracker;
    if (tracker) {
      riga.replaceChildren(
        crea("span", "fonte fonte-tracker", "TWITCHTRACKER"),
        crea("span", null, `media 30 g ${numero(tracker.media30)}, picco ${numero(tracker.picco30)}${tracker.minuti30 ? `, ${formatoDecimale.format(tracker.minuti30 / 60)} h in diretta` : ""}`)
      );
    }
  }

  function nomeFonte(fonte) {
    return { campione: "APP", manuale: "MANUALE", cruscotto: "CRUSCOTTO", vod: "VOD" }[fonte] || String(fonte || "").toUpperCase();
  }

  function statoVuoto(titolo, testo) {
    const blocco = crea("div", "stato-vuoto");
    blocco.innerHTML = '<svg viewBox="0 0 120 80" aria-hidden="true"><rect x="10" y="18" width="100" height="52" rx="10" class="vuoto-cornice"/><rect x="22" y="44" width="10" height="16" rx="3" class="vuoto-colonna"/><rect x="38" y="36" width="10" height="24" rx="3" class="vuoto-colonna"/><rect x="54" y="48" width="10" height="12" rx="3" class="vuoto-colonna"/><rect x="70" y="30" width="10" height="30" rx="3" class="vuoto-colonna accesa"/><rect x="86" y="40" width="10" height="20" rx="3" class="vuoto-colonna"/><line x1="18" y1="34" x2="102" y2="34" class="vuoto-soglia"/></svg>';
    blocco.append(crea("p", "vuoto-titolo", titolo), crea("p", "vuoto-testo", testo));
    return blocco;
  }

  function aggiornaCronologia() {
    const meta = obiettivo();
    const elenco = $("#cronologia-elenco");
    const dirette = tutteLeDirette().sort((a, b) => (a.giorno < b.giorno ? 1 : -1));
    elenco.replaceChildren();
    if (!dirette.length) {
      elenco.append(statoVuoto("Nessuna diretta registrata", "Compaiono qui appena l'app ne misura una. Quelle fatte prima puoi aggiungerle a mano."));
      return;
    }
    const scala = Math.max(meta.media * 1.5, ...dirette.map((voce) => Number(voce.media) || 0));
    let periodoCorrente = null;
    let lista = null;
    for (const voce of dirette) {
      if (voce.periodo !== periodoCorrente) {
        periodoCorrente = voce.periodo;
        const gruppo = crea("section", "gruppo");
        gruppo.append(crea("h3", "gruppo-titolo", titoloPeriodo({ chiave: voce.periodo }, meta)));
        lista = crea("ul", "dirette");
        gruppo.append(lista);
        elenco.append(gruppo);
      }
      const senzaMedia = voce.media === null || voce.media === undefined;
      const riga = crea("li", `diretta${voce.conta ? " conta" : ""}${senzaMedia ? " senza" : ""}`);
      const data = dataDaGiorno(voce.giorno);
      const giorno = crea("div", "diretta-giorno");
      giorno.append(crea("span", "diretta-settimana", formatoSettimana.format(data)), crea("strong", null, data.getDate()), crea("span", "diretta-mese", formatoMese.format(data)));
      const centro = crea("div", "diretta-centro");
      const linea = crea("div", "diretta-linea");
      const media = crea("span", "diretta-media", senzaMedia ? "?" : numero(voce.media));
      linea.append(media, crea("span", "diretta-unita", senzaMedia ? "media sconosciuta" : "di media"), crea("span", "diretta-ore", `${formatoDecimale.format(Number(voce.ore) || 0)} h`), crea("span", `fonte fonte-${voce.fonte}`, nomeFonte(voce.fonte)));
      const barra = crea("div", "mini-barra");
      const riempimento = crea("span", "mini-riempimento");
      riempimento.style.width = `${senzaMedia ? 0 : Math.min(100, ((Number(voce.media) || 0) / scala) * 100)}%`;
      const soglia = crea("span", "mini-soglia");
      soglia.style.left = `${(meta.media / scala) * 100}%`;
      barra.append(riempimento, soglia);
      centro.append(linea, barra);
      const esito = crea("span", `badge ${voce.conta ? "verde" : senzaMedia ? "neutro" : "ambra"}`, voce.conta ? "CONTA" : senzaMedia ? "DA COMPLETARE" : "NON CONTA");
      riga.append(giorno, centro, esito);
      if (voce.fonte === "manuale") {
        const rimuovi = crea("button", "pulsante-icona piccolo rimuovi");
        rimuovi.type = "button";
        rimuovi.setAttribute("aria-label", `Rimuovi la diretta del ${formatoGiorno.format(data)}`);
        rimuovi.title = "Rimuovi";
        rimuovi.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
        rimuovi.addEventListener("click", async () => {
          try {
            await monitor.rimuoviManuale(voce.giorno);
            avviso("Diretta rimossa");
          } catch (errore) {
            avviso(errore.message, "errore");
          }
        });
        riga.append(rimuovi);
      } else if (senzaMedia) {
        const completa = crea("button", "pulsante fantasma piccolo", "Completa");
        completa.type = "button";
        completa.addEventListener("click", () => {
          $("#manuale-giorno").value = voce.giorno;
          $("#manuale-ore").value = Number(voce.ore) || "";
          $("#manuale-media").focus();
        });
        riga.append(completa);
      } else {
        riga.append(crea("span", "segnaposto-azione"));
      }
      lista.append(riga);
    }
  }

  function aggiornaImpostazioniStato() {
    const pillola = $("#imp-collegamento");
    const collegato = Boolean(stato && stato.collegato);
    pillola.className = `pillola ${collegato ? "verde" : "ambra"}`;
    pillola.textContent = collegato ? `Collegato${stato.canale ? ` come ${stato.canale.nome || stato.canale.login}` : ""}` : "Non collegato";
    $("#imp-esci").hidden = !collegato;
    $("#imp-accedi").textContent = collegato ? "Ricollega" : "Accedi a Twitch";
  }

  async function caricaImpostazioni() {
    try {
      impostazioni = (await monitor.impostazioni()) || {};
    } catch {
      impostazioni = {};
    }
    const meta = { media: 75, dirette: 6, giorni: 30, ...(impostazioni.obiettivo || {}) };
    $("#imp-canale").value = impostazioni.canale || (stato && stato.canale ? stato.canale.login : "");
    $("#imp-client").value = impostazioni.clientId || "";
    $("#imp-media").value = meta.media;
    $("#imp-dirette").value = meta.dirette;
    $("#imp-giorni").value = meta.giorni;
    $("#imp-avvio").checked = Boolean(impostazioni.avvioConWindows);
    $("#imp-notifiche").checked = impostazioni.notifiche !== false;
    $("#imp-tracker").checked = Boolean(impostazioni.tracker);
    $("#imp-lurk").checked = impostazioni.lurk !== false;
    $("#imp-follower").checked = impostazioni.follower !== false;
    $("#imp-cruscotto").checked = impostazioni.importaCruscotto !== false;
    $("#imp-diagnostica").checked = Boolean(impostazioni.diagnostica);
    try {
      $("#imp-overlay").checked = await monitor.overlayAperto();
    } catch {
      $("#imp-overlay").checked = false;
    }
  }

  function pulisciCanale(valore) {
    return String(valore || "")
      .trim()
      .replace(/^https?:\/\/(www\.)?twitch\.tv\//i, "")
      .replace(/^@/, "")
      .replace(/\/.*$/, "")
      .toLowerCase();
  }

  function canaleValido(valore) {
    return /^[a-z0-9_]{3,25}$/.test(valore);
  }

  function clientValido(valore) {
    return /^[a-z0-9]{20,40}$/i.test(valore);
  }

  async function salva(parziale, messaggio) {
    await monitor.salvaImpostazioni(parziale);
    impostazioni = { ...impostazioni, ...parziale };
    if (messaggio) {
      avviso(messaggio, "ok");
    }
  }

  function aggiorna() {
    aggiornaTestata();
    aggiornaBanda();
    aggiornaEroe();
    aggiornaLurk();
    aggiornaGrafico();
    aggiornaPeriodi();
    aggiornaUfficiale();
    aggiornaCronologia();
    aggiornaImpostazioniStato();
    valutaGuida();
  }

  function cambiaVista(nome) {
    for (const scheda of $$(".schede [role=tab]")) {
      const attiva = scheda.dataset.vista === nome;
      scheda.setAttribute("aria-selected", String(attiva));
      scheda.tabIndex = attiva ? 0 : -1;
    }
    for (const vista of $$(".vista")) {
      vista.hidden = vista.id !== `vista-${nome}`;
    }
    if (nome === "impostazioni") {
      caricaImpostazioni();
    }
    if (nome === "monitor") {
      aggiornaGrafico();
    }
    document.body.dataset.vista = nome;
  }

  function riempiPassiClient() {
    for (const lista of $$(".passi-client")) {
      lista.replaceChildren();
      for (const passo of PASSI_CLIENT) {
        const voce = crea("li");
        voce.append(crea("span", null, passo.testo));
        if (passo.link) {
          const pulsante = crea("button", "pulsante secondario piccolo", "Apri dev.twitch.tv");
          pulsante.type = "button";
          pulsante.addEventListener("click", () => monitor.apriLink(URL_CONSOLE).catch((errore) => avviso(errore.message, "errore")));
          voce.append(pulsante);
        }
        lista.append(voce);
      }
    }
  }

  function passoIniziale() {
    if (!stato || !stato.canale) {
      return 1;
    }
    if (stato.clientIdMancante) {
      return 2;
    }
    if (!stato.collegato) {
      return 3;
    }
    return 4;
  }

  function mostraPasso(passo) {
    passoGuida = passo;
    for (const pagina of $$(".guida-pagina")) {
      pagina.hidden = Number(pagina.dataset.pagina) !== passo;
    }
    for (const voce of $$(".guida-passi li")) {
      const numeroPasso = Number(voce.dataset.passo);
      voce.classList.toggle("attivo", numeroPasso === passo);
      voce.classList.toggle("fatto", numeroPasso < passo);
      if (numeroPasso === passo) {
        voce.setAttribute("aria-current", "step");
      } else {
        voce.removeAttribute("aria-current");
      }
    }
    $(".guida-passi").hidden = passo === 4;
    if (passo === 1) {
      $("#guida-canale").value = $("#guida-canale").value || impostazioni.canale || (stato && stato.canale ? stato.canale.login : "") || "slayer_beard";
    }
    if (passo === 2) {
      $("#guida-client").value = $("#guida-client").value || impostazioni.clientId || "";
    }
    if (passo === 3) {
      aggiornaAccesso();
    }
    const pagina = $(`.guida-pagina[data-pagina="${passo}"]`);
    const primo = pagina && pagina.querySelector("input, button.pulsante:not(.fantasma)");
    if (primo && guidaAperta) {
      setTimeout(() => primo.focus(), 30);
    }
  }

  async function apriGuida(forzata) {
    guidaForzata = Boolean(forzata);
    guidaRimandata = false;
    try {
      impostazioni = (await monitor.impostazioni()) || {};
    } catch {
      impostazioni = impostazioni || {};
    }
    guidaAperta = true;
    $("#guida").hidden = false;
    document.body.classList.add("con-guida");
    mostraPasso(forzata && passoIniziale() === 4 ? 1 : passoIniziale());
    aggiornaBanda();
  }

  function chiudiGuida() {
    guidaAperta = false;
    guidaForzata = false;
    $("#guida").hidden = true;
    document.body.classList.remove("con-guida");
    aggiornaBanda();
  }

  function valutaGuida() {
    if (!stato) {
      return;
    }
    const serve = stato.clientIdMancante || !stato.canale || (!stato.collegato && !guidaRimandata);
    if (guidaAperta) {
      if (passoGuida === 3 && stato.collegato) {
        mostraPasso(4);
      }
      return;
    }
    if (serve) {
      apriGuida(false);
    }
  }

  function aggiornaAccesso() {
    const scheda = $("#guida-codice-scheda");
    const pulsante = $("#guida-accedi");
    clearInterval(timerAccesso);
    const valido = accesso && accesso.codice && (!accesso.scadeTra || Date.now() < (accesso.ricevutoIl || Date.now()) + accesso.scadeTra * 1000);
    if (!valido) {
      scheda.hidden = true;
      pulsante.hidden = false;
      pulsante.textContent = accesso ? "Ottieni un nuovo codice" : accessoRichiesto ? "Attendo il codice" : "Ottieni il codice";
      pulsante.disabled = accessoRichiesto && !accesso;
      if (accesso) {
        mostraErroreCampo("#guida-errore-3", "Il codice è scaduto. Chiedine uno nuovo.");
      }
      return;
    }
    mostraErroreCampo("#guida-errore-3", "");
    scheda.hidden = false;
    pulsante.hidden = true;
    $("#guida-codice").textContent = accesso.codice;
    $("#guida-accesso-intro").textContent = "Apri la pagina di Twitch, controlla che il codice sia questo e premi Attiva. L app si collega da sola appena confermi.";
    const scadenza = () => {
      if (!accesso) {
        clearInterval(timerAccesso);
        return;
      }
      const resto = Math.max(0, Math.round(((accesso.ricevutoIl || Date.now()) + (accesso.scadeTra || 0) * 1000 - Date.now()) / 1000));
      if (!accesso.scadeTra) {
        $("#guida-scade").textContent = "In attesa della conferma su Twitch";
        return;
      }
      if (resto <= 0) {
        aggiornaAccesso();
        return;
      }
      $("#guida-scade").textContent = `In attesa della conferma. Il codice scade tra ${Math.floor(resto / 60)}:${String(resto % 60).padStart(2, "0")}`;
    };
    scadenza();
    timerAccesso = setInterval(scadenza, 1000);
  }

  async function chiediAccesso() {
    accessoRichiesto = true;
    accesso = null;
    mostraErroreCampo("#guida-errore-3", "");
    aggiornaAccesso();
    try {
      const esito = await monitor.accedi();
      if (esito && esito.ok === false && esito.motivo !== "annullato") {
        accessoRichiesto = false;
        accesso = null;
        const testi = {
          scaduto: "Il codice è scaduto prima della conferma. Chiedine uno nuovo.",
          negato: "L'accesso è stato rifiutato su Twitch.",
          "client-id-non-valido": "Twitch non riconosce il Client ID. Controlla che sia giusto e che il tipo di client sia Pubblico.",
          "client-id-mancante": "Manca il Client ID: torna al passo 2.",
          "avvio-fallito": "Twitch non ha avviato l'accesso. Riprova tra poco."
        };
        mostraErroreCampo("#guida-errore-3", testi[esito.motivo] || "Accesso non riuscito. Riprova.");
        aggiornaAccesso();
      }
    } catch (errore) {
      accessoRichiesto = false;
      mostraErroreCampo("#guida-errore-3", errore.message || "Accesso non riuscito");
      aggiornaAccesso();
    }
  }

  function collegaEventi() {
    for (const scheda of $$(".schede [role=tab]")) {
      scheda.addEventListener("click", () => cambiaVista(scheda.dataset.vista));
      scheda.addEventListener("keydown", (evento) => {
        const schede = $$(".schede [role=tab]");
        const indice = schede.indexOf(scheda);
        let nuovo = null;
        if (evento.key === "ArrowRight") {
          nuovo = schede[(indice + 1) % schede.length];
        } else if (evento.key === "ArrowLeft") {
          nuovo = schede[(indice - 1 + schede.length) % schede.length];
        }
        if (nuovo) {
          evento.preventDefault();
          nuovo.focus();
          cambiaVista(nuovo.dataset.vista);
        }
      });
    }

    $("#pulsante-overlay").addEventListener("click", async () => {
      const aperto = $("#pulsante-overlay").getAttribute("aria-pressed") === "true";
      try {
        await monitor.apriOverlay(!aperto);
      } catch (errore) {
        avviso(errore.message, "errore");
      }
    });

    const leggiUfficiale = async (mostra) => {
      const pulsante = $("#ufficiale-aggiorna");
      pulsante.disabled = true;
      $("#ufficiale-accedi").disabled = true;
      pulsante.classList.add("in-corso");
      pulsante.textContent = "Leggo";
      try {
        const esito = await monitor.aggiornaUfficiale({ mostra });
        if (esito && esito.richiedeAccesso) {
          avviso("Serve accedere a Twitch per leggere il cruscotto", "attenzione");
        } else {
          avviso("Dato ufficiale aggiornato", "ok");
        }
      } catch (errore) {
        avviso(errore.message || "Lettura non riuscita", "errore");
      } finally {
        pulsante.disabled = false;
        $("#ufficiale-accedi").disabled = false;
        pulsante.classList.remove("in-corso");
        pulsante.textContent = "Aggiorna";
      }
    };
    $("#ufficiale-aggiorna").addEventListener("click", () => leggiUfficiale(false));
    $("#ufficiale-accedi").addEventListener("click", () => leggiUfficiale(true));

    const esporta = async () => {
      try {
        const esito = await monitor.esportaCsv();
        if (esito && esito.salvato) {
          avviso(`Salvato ${esito.nome}`, "ok");
        }
      } catch (errore) {
        avviso(errore.message, "errore");
      }
    };
    $("#esporta-csv").addEventListener("click", esporta);
    $("#imp-csv").addEventListener("click", esporta);

    $("#manuale-giorno").max = giornoIso(new Date());
    $("#modulo-manuale").addEventListener("submit", async (evento) => {
      evento.preventDefault();
      const giorno = $("#manuale-giorno").value;
      const media = Number($("#manuale-media").value);
      const ore = Number(String($("#manuale-ore").value).replace(",", "."));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(giorno)) {
        mostraErroreCampo("#manuale-errore", "Scegli il giorno della diretta.");
        $("#manuale-giorno").focus();
        return;
      }
      if (giorno > giornoIso(new Date())) {
        mostraErroreCampo("#manuale-errore", "Il giorno non può essere nel futuro.");
        return;
      }
      if (!$("#manuale-media").value || !Number.isFinite(media) || media < 0) {
        mostraErroreCampo("#manuale-errore", "Scrivi la media degli spettatori.");
        $("#manuale-media").focus();
        return;
      }
      if (!Number.isFinite(ore) || ore <= 0 || ore > 24) {
        mostraErroreCampo("#manuale-errore", "Le ore vanno da 0,1 a 24.");
        $("#manuale-ore").focus();
        return;
      }
      mostraErroreCampo("#manuale-errore", "");
      try {
        await monitor.aggiungiManuale({ giorno, media, ore });
        $("#modulo-manuale").reset();
        avviso(`Diretta del ${formatoGiorno.format(dataDaGiorno(giorno))} aggiunta`, "ok");
      } catch (errore) {
        mostraErroreCampo("#manuale-errore", errore.message);
      }
    });

    $("#modulo-twitch").addEventListener("submit", async (evento) => {
      evento.preventDefault();
      const canale = pulisciCanale($("#imp-canale").value);
      const clientId = $("#imp-client").value.trim();
      if (!canaleValido(canale)) {
        mostraErroreCampo("#imp-twitch-errore", "Il nome del canale ha da 3 a 25 caratteri: lettere, numeri e trattino basso.");
        return;
      }
      if (clientId && !clientValido(clientId)) {
        mostraErroreCampo("#imp-twitch-errore", "Il Client ID sembra incompleto: sono circa 30 lettere e numeri.");
        return;
      }
      mostraErroreCampo("#imp-twitch-errore", "");
      try {
        await salva({ canale, clientId }, "Impostazioni di Twitch salvate");
        $("#imp-canale").value = canale;
      } catch (errore) {
        mostraErroreCampo("#imp-twitch-errore", errore.message);
      }
    });
    $("#imp-accedi").addEventListener("click", () => {
      apriGuida(false).then(() => {
        mostraPasso(3);
        chiediAccesso();
      });
    });
    $("#imp-esci").addEventListener("click", async () => {
      try {
        await monitor.esci();
        guidaRimandata = true;
        avviso("Scollegato da Twitch");
      } catch (errore) {
        avviso(errore.message, "errore");
      }
    });

    $("#modulo-obiettivo").addEventListener("submit", async (evento) => {
      evento.preventDefault();
      const media = Number($("#imp-media").value);
      const dirette = Number($("#imp-dirette").value);
      const giorni = Number($("#imp-giorni").value);
      if (![media, dirette, giorni].every((valore) => Number.isInteger(valore) && valore > 0) || dirette > 30 || giorni > 90) {
        avviso("Controlla i valori: numeri interi, dirette fino a 30, giorni fino a 90.", "errore");
        return;
      }
      try {
        await salva({ obiettivo: { media, dirette, giorni } }, "Obiettivo salvato");
      } catch (errore) {
        avviso(errore.message, "errore");
      }
    });
    $("#imp-ripristina").addEventListener("click", async () => {
      $("#imp-media").value = 75;
      $("#imp-dirette").value = 6;
      $("#imp-giorni").value = 30;
      try {
        await salva({ obiettivo: { media: 75, dirette: 6, giorni: 30 } }, "Tornato ai valori di Twitch");
      } catch (errore) {
        avviso(errore.message, "errore");
      }
    });

    const interruttore = (selettore, chiave, testoAcceso, testoSpento) => {
      $(selettore).addEventListener("change", async (evento) => {
        const acceso = evento.target.checked;
        try {
          await salva({ [chiave]: acceso }, acceso ? testoAcceso : testoSpento);
        } catch (errore) {
          evento.target.checked = !acceso;
          avviso(errore.message, "errore");
        }
      });
    };
    interruttore("#imp-avvio", "avvioConWindows", "Partirà con Windows", "Non partira più con Windows");
    interruttore("#imp-notifiche", "notifiche", "Notifiche accese", "Notifiche spente");
    interruttore("#imp-tracker", "tracker", "TwitchTracker acceso", "TwitchTracker spento");
    interruttore("#imp-lurk", "lurk", "Spettatori in lurk accesi", "Spettatori in lurk spenti");
    interruttore("#imp-follower", "follower", "Follower attivi: ricollega Twitch per dare il permesso", "Follower spenti");
    interruttore("#imp-cruscotto", "importaCruscotto", "Importazione dal cruscotto accesa", "Importazione dal cruscotto spenta");
    interruttore("#imp-diagnostica", "diagnostica", "Diagnostica accesa", "Diagnostica spenta");
    $("#imp-overlay").addEventListener("change", (evento) => monitor.apriOverlay(evento.target.checked).catch((errore) => avviso(errore.message, "errore")));
    $("#imp-guida").addEventListener("click", () => apriGuida(true));
    $("#imp-controlla").addEventListener("click", async () => {
      $("#imp-controlla").disabled = true;
      try {
        const esito = await monitor.controllaAggiornamenti();
        aggiornaAggiornamento(esito);
        if (esito && esito.fase === "aggiornato") {
          avviso(`Hai l'ultima versione, la ${esito.versione}`, "ok");
        } else if (esito && esito.fase === "errore-controllo") {
          avviso("Il server degli aggiornamenti non risponde", "attenzione");
        } else if (esito && esito.fase === "sviluppo") {
          avviso("Copia di prova: aggiornamenti spenti", "attenzione");
        }
      } catch (errore) {
        $("#imp-controlla").disabled = false;
        avviso(errore.message, "errore");
      }
    });
    monitor.onAggiornamento(aggiornaAggiornamento);

    $("#guida-modulo-canale").addEventListener("submit", async (evento) => {
      evento.preventDefault();
      const canale = pulisciCanale($("#guida-canale").value);
      if (!canaleValido(canale)) {
        mostraErroreCampo("#guida-errore-1", "Scrivi il nome del canale come appare nell'indirizzo twitch.tv, per esempio slayer_beard.");
        return;
      }
      mostraErroreCampo("#guida-errore-1", "");
      try {
        await salva({ canale });
        $("#guida-canale").value = canale;
        mostraPasso(2);
      } catch (errore) {
        mostraErroreCampo("#guida-errore-1", errore.message);
      }
    });
    $("#guida-modulo-client").addEventListener("submit", async (evento) => {
      evento.preventDefault();
      const clientId = $("#guida-client").value.trim();
      if (!clientValido(clientId)) {
        mostraErroreCampo("#guida-errore-2", "Il Client ID sono circa 30 lettere e numeri. Copialo dalla pagina Gestisci della tua app su dev.twitch.tv.");
        return;
      }
      mostraErroreCampo("#guida-errore-2", "");
      try {
        await salva({ clientId });
        mostraPasso(stato && stato.collegato ? 4 : 3);
      } catch (errore) {
        mostraErroreCampo("#guida-errore-2", errore.message);
      }
    });
    for (const indietro of $$("[data-indietro]")) {
      indietro.addEventListener("click", () => mostraPasso(Number(indietro.dataset.indietro)));
    }
    $("#guida-accedi").addEventListener("click", chiediAccesso);
    $("#guida-apri").addEventListener("click", () => {
      if (accesso && accesso.url) {
        monitor.apriLink(accesso.url).catch((errore) => avviso(errore.message, "errore"));
      }
    });
    $("#guida-copia").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(accesso ? accesso.codice : "");
        avviso("Codice copiato", "ok");
      } catch {
        avviso("Copia non riuscita, scrivilo a mano", "errore");
      }
    });
    $("#guida-dopo").addEventListener("click", () => {
      guidaRimandata = true;
      chiudiGuida();
    });
    $("#guida-fine").addEventListener("click", () => {
      chiudiGuida();
      cambiaVista("monitor");
    });
    document.addEventListener("keydown", (evento) => {
      if (evento.key === "Escape" && guidaAperta && stato && !stato.clientIdMancante && stato.canale) {
        guidaRimandata = true;
        chiudiGuida();
      }
    });

    let attesaRidisegno = null;
    new ResizeObserver(() => {
      cancelAnimationFrame(attesaRidisegno);
      attesaRidisegno = requestAnimationFrame(() => {
        if (!$("#vista-monitor").hidden) {
          aggiornaGrafico();
        }
      });
    }).observe($("#grafico"));
  }

  function impostaOverlay(aperto) {
    $("#pulsante-overlay").setAttribute("aria-pressed", String(Boolean(aperto)));
    $("#imp-overlay").checked = Boolean(aperto);
  }

  async function inizia() {
    riempiPassiClient();
    collegaEventi();
    cambiaVista("monitor");
    monitor.onStato((nuovo) => {
      stato = nuovo;
      if (stato && stato.collegato) {
        accesso = null;
        accessoRichiesto = false;
      }
      aggiorna();
    });
    monitor.onAccesso((dati) => {
      accesso = dati ? { ...dati, ricevutoIl: dati.ricevutoIl || Date.now() } : null;
      accessoRichiesto = false;
      if (!guidaAperta) {
        apriGuida(false).then(() => mostraPasso(3));
      } else if (passoGuida !== 3) {
        mostraPasso(3);
      } else {
        aggiornaAccesso();
      }
    });
    monitor.onEvento((evento) => {
      if (evento && evento.testo) {
        avviso(evento.testo, evento.tipo === "sotto-media" ? "attenzione" : "ok");
      }
    });
    monitor.onOverlay(impostaOverlay);
    try {
      impostaOverlay(await monitor.overlayAperto());
    } catch {
      impostaOverlay(false);
    }
    try {
      impostazioni = (await monitor.impostazioni()) || {};
    } catch {
      impostazioni = {};
    }
    try {
      const dati = await monitor.accessoCorrente();
      if (dati) {
        accesso = dati;
      }
    } catch {
      accesso = null;
    }
    try {
      stato = await monitor.stato();
    } catch {
      stato = null;
    }
    aggiorna();
    if (accesso && guidaAperta) {
      mostraPasso(3);
    }
    try {
      const info = await monitor.versione();
      $("#imp-versione").textContent = `Versione ${info.versione}${info.finto ? ", dati di prova" : ""}`;
    } catch {
      $("#imp-versione").textContent = "";
    }
    try {
      aggiornaAggiornamento(await monitor.statoAggiornamento());
    } catch {
      aggiornaAggiornamento(null);
    }
    setInterval(() => {
      if (stato) {
        aggiornaEroe();
      }
    }, 30000);
  }

  inizia();
})();
