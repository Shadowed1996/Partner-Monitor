# Partner Monitor - contratto

App desktop Electron 44.7.0 (Windows) per Slayer_Beard: monitora il percorso verso il Twitch Partner. Si apre, si collega a Twitch, e mostra in tempo reale spettatori, media della diretta e dirette confermate.

Regola ufficiale Partner: 6 dirette in 6 giorni distinti con media >= 75 spettatori negli ultimi 30 giorni, PIU 6 dirette analoghe nei 30-60 giorni precedenti. Dirette sotto 75 non penalizzano ma non contano. Nessuna soglia di ore o follower. Il dato ufficiale e nella Dashboard Creator > Obiettivi, il conteggio dell app e una stima.

## Regole di codice
Zero commenti in ogni file di codice. Niente em dash. Nomi in italiano. Nessun framework nel renderer (HTML/CSS/JS puro). Dipendenze minime (solo electron e electron-builder dev; HTTP con node:https). CommonJS. Test con node --test in prove/.

## Struttura
main/avvio.js        shell Electron: finestre, tray, overlay, IPC, notifiche   (agente INTERFACCIA)
main/preload.js      espone window.monitor                                     (agente INTERFACCIA)
renderer/            interfaccia                                               (agente INTERFACCIA)
main/dati/           livello dati, puro Node, niente import di electron        (agente DATI)
prove/               test                                                      (ognuno i suoi)

## Livello dati (agente DATI)
`const { creaMonitor } = require('./main/dati')`
`creaMonitor({ cartella, finestraTwitch, http })` ritorna un EventEmitter:
- cartella: dove salvare i JSON (userData). file: impostazioni.json, campioni.json, token.json
- finestraTwitch: funzione async (url, {mostra, estrai}) fornita dall interfaccia, apre una BrowserWindow con partition persist:twitch e ritorna il testo estratto della pagina (per il cruscotto ufficiale). Nei test e un finto.
- http: opzionale, per mockare le richieste.
Metodi: avvia(), ferma(), stato(), accedi(), esci(), impostazioni(), salvaImpostazioni(parziale), aggiungiManuale({giorno,media,ore}), rimuoviManuale(giorno), aggiornaUfficiale(), esportaCsv() -> stringa.
Eventi: 'stato' (oggetto Stato), 'accesso' ({codice, url, scadeTra}) durante il device flow, 'evento' ({tipo:'diretta-iniziata'|'diretta-finita'|'sta-contando'|'sotto-media'|'periodo-completato', testo}) per le notifiche.

Fonti:
1. Twitch Helix con Device Code Grant Flow (client pubblico, senza secret): impostazioni.clientId obbligatorio (se manca stato.clientIdMancante=true e l app guida a crearlo su dev.twitch.tv con tipo client Public). Scope: nessuno obbligatorio, opzionale moderator:read:followers. Salva e rinnova il token (refresh). Poll GET /streams?user_login=... ogni 30 s in onda e ogni 60 s offline; GET /channels/followers (total) ogni 10 min se c e lo scope; gestisci 401 con refresh, 429 con backoff.
2. Campionatore: un campione {t, v} per minuto in onda, compresso per giorno (fuso Europe/Rome): somma, numero, minuti. Tieni serie dettagliata solo della diretta corrente (ultime ~12 h) per il grafico. Una diretta = il giorno; conta se media del giorno >= obiettivo.media. Buchi <= 10 min = stessa diretta. L app puo restare chiusa: all avvio recupera dal VOD (GET /videos?user_id=...&type=archive, created_at e duration) i giorni di diretta mancanti come ore, senza media (fonte 'vod', non contano finche non c e media).
3. Cruscotto ufficiale: con finestraTwitch carica https://dashboard.twitch.tv/u/<login>/achievements e prova a estrarre testo/avanzamento Path to Partner (parser tollerante, regex su testo, salva sempre il testo grezzo in stato.ufficiale.testo + aggiornatoIl); prova anche stream-summary per importare la media di dirette passate come fonte 'cruscotto'. Poiche la struttura delle pagine non e verificabile senza il login di Slayer, scrivi un parser difensivo e una modalita diagnostica (salva il testo grezzo in cartella/diagnostica/*.txt) cosi si puo raffinare dopo. Mai azioni sull account, solo lettura.
5. Spettatori in lurk del sito: GET https://slayerbeard.com/api/lurk/presenti ogni 15 s (120 s dopo un errore), timer separato dal ciclo Twitch, errori silenziosi (stato.lurk.errore=true, mai ultimoErrore). Interruttore impostazioni.lurk (predefinito acceso). Risposta { presenti, vivi, aggiornato }: presenti = persone con il lurk acceso sul sito, vivi = con il video in riproduzione.
4. Opzionale TwitchTracker: GET https://twitchtracker.com/api/channels/summary/<login> al massimo 1 volta l ora, con cache, solo come riferimento (stato.tracker), disattivabile; loro ToS vietano lo scraping, quindi niente altro.

Stato (oggetto emesso e restituito da stato()):
{ canale:{login,nome}|null, collegato:bool, clientIdMancante:bool,
  inOnda:bool|null, spettatori:n, titolo:string, gioco:string, iniziataIl:ISO|null,
  mediaDiretta:n|null, contaOra:bool, follower:n|null,
  obiettivo:{media:75, dirette:6, giorni:30},
  periodi:[{chiave:'corrente'|'precedente', da, a, confermate:n (cap a richieste), totaleReale:n, richieste:6, ok:bool, dirette:[{giorno, media, ore, conta:bool, fonte:'campione'|'manuale'|'cruscotto'|'vod'}]}],
  completati:0..2, totali:2,
  serieDiretta:[{t:ISO, v:n}],
  ufficiale:{aggiornatoIl, testo, avanzamento}|null, tracker:{aggiornatoIl, media30, picco30, minuti30, follower}|null,
  lurk:{presenti, vivi, aggiornato, letto, errore}|null,
  ultimoErrore:string|null, aggiornatoIl:ISO }

## Interfaccia (agente INTERFACCIA)
window.monitor (preload, contextIsolation on, nodeIntegration off, CSP stretta): stato(), onStato(cb), onAccesso(cb), accedi(), esci(), impostazioni(), salvaImpostazioni(o), aggiungiManuale(o), rimuoviManuale(g), aggiornaUfficiale(), esportaCsv() (apre il dialogo salva), apriOverlay(bool).
Finestra principale (stile scuro viola/ciano coerente con Slayer Beard, font Manrope/JetBrains Mono locali come Schedule Studio via @fontsource): grande «LIVE 1 / 75 UTENTI IN LIVE / OBIETTIVO» con barra, media della diretta in corso e badge «STA CONTANDO»/«SOTTO LA MEDIA», grafico spettatori della diretta (SVG inline, linea a 75), due blocchi «ULTIMI 30 GIORNI» e «30-60 GIORNI FA» con «n / 6 CONFERMATI» e 6 tacche (tooltip giorno e media), «X / 2 PERIODI COMPLETATI», cronologia per giorno, riquadro «Dato ufficiale Twitch» con pulsante Aggiorna e avviso che il conteggio e una stima, pagina Impostazioni (canale, Client ID con guida passo passo, obiettivi, avvio con Windows, notifiche, TwitchTracker on/off), procedura di primo avvio guidata (canale, Client ID, accesso col codice del device flow), inserimento dirette manuali, esporta CSV.
Overlay opzionale: mini finestra senza bordi, sempre in primo piano, trascinabile, con LIVE n / 75, n/6 per periodo e in alto a destra il numero di spettatori in lurk sul sito (nascosto se stato.lurk e null, tenue se errore; al passaggio del mouse lascia il posto ai pulsanti apri/chiudi).
Launcher (renderer/avvio.html + css/avvio.css + js/avvio.js, preload main/preload-avvio.js, window.avvio {versione, suStato, chiudi}): finestra 460x300 senza bordi, centrata, aperta prima di tutto quando non si parte con --nascosto e non in collaudo. Passi: Aggiornamenti, Twitch, Monitor. Il main manda avvio:stato con {tipo:'aggiornamento', ...stato} (fasi sotto), {tipo:'caricamento', passo, testo, dettaglio, percentuale} e {tipo:'pronto'}; il launcher mostra ogni passo almeno 820 ms, al «pronto» aspetta 1,1 s e manda avvio:chiudi, il main mostra la principale e chiude il launcher (fallback 14 s). Il main aspetta l'esito del controllo con attendiEsitoAvvio(): continua su aggiornato/sviluppo/errore/errore-controllo, dopo 9 s di controllo segna «lento» e continua, durante lo scaricamento aspetta (45 s senza progressi = errore), in installazione non continua perche l'app si riavvia. Con --nascosto (avvio con Windows) niente launcher, controllo silenzioso.
Aggiornamenti (main/aggiornamenti.js): electron-updater sulle release di Partner-Monitor-Release, controllo all'avvio e ogni 6 ore, scarica da solo, installa e riapre. Emette uno stato {fase, versione, percentuale, controllatoIl} con fase controllo | aggiornato | scarica | installa | errore | errore-controllo | sviluppo (copia non pacchettizzata). L'interfaccia lo riceve con onAggiornamento e lo mostra nella banda in alto della finestra principale (controllo, scarico con barra e percentuale, installo, errore; «Hai l'ultima versione» per 5 secondi) e nella scheda Dati delle impostazioni, accanto alla versione, col pulsante «Controlla aggiornamenti» (controllaAggiornamenti). Variabile PARTNER_PROVA_AGGIORNAMENTO=1|scarica per simulare le fasi senza rete.
Finestra Twitch del cruscotto: l'app parte con --disable-blink-features=WebAuth, perche la pagina di login di Twitch prova le passkey e Windows chiedeva di inserire una chiave di sicurezza USB; senza WebAuth si entra con password e codice. Tray con menu (Apri, Overlay, Esci) e chiusura finestra = riduci nel tray. Notifiche Windows dagli eventi. Istanza singola. Avvio con Windows opzionale. electron-builder.yml per installer NSIS. Dichiara lo stato «offline» senza errori rumorosi, accessibilita (focus, aria), nessun dato personale in chiaro nei log.
