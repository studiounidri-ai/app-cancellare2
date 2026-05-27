# Appstudio

Appstudio è un'app web per musicisti che studiano cover e pezzi propri. Offre:

- playlist separata per canzoni YouTube e brani MP3 locali
- gestione playlist: aggiungi, rimuovi e riordina tracce
- caricamento MP3 sul dispositivo senza invio al server
- studio rapido con lettura/risorse su Ultimate Guitar e Chordify
- accesso tramite email e password
- recupero password via email

## Installazione

1. Copia `.env.example` in `.env`
2. Modifica le variabili in `.env` con i dati di PostgreSQL e SMTP
3. Esegui:

```bash
npm install
```

## Avvio in sviluppo

```bash
npm run dev
```

Il frontend sarà disponibile su `http://localhost:5173` mentre il backend gira su `http://localhost:3000`.

## Produzione

```bash
npm run build
npm start
```

## Variabili d'ambiente richieste

- `DATABASE_URL` - URL del database PostgreSQL
- `JWT_SECRET` - segreto JWT per l'autenticazione
- `BASE_URL` - URL base dell'app (es. `http://localhost:5173`)
- `SMTP_HOST` - host SMTP per invio mail
- `SMTP_PORT` - porta SMTP
- `SMTP_SECURE` - `true` o `false`
- `SMTP_USER` - email SMTP
- `SMTP_PASS` - password SMTP

## Funzionalità principali

- `Playlist`: visualizza separatamente i brani YouTube e i file MP3 caricati localmente.
- `Aggiungi/togli/ordina canzoni`: inserisci link YouTube, rimuovi tracce e riordina la playlist.
- `Carica canzoni tue in mp3`: salva i file nel browser del dispositivo, non sul server.
- `Inizia lo studio`: seleziona e ascolta canzoni, apri Ultimate Guitar o Chordify per accordi e testi.

## Email e recupero password

L'app invia email di recupero password tramite SMTP. Se il server SMTP non è configurato, la funzionalità di reset non sarà disponibile.

## Deploy su Railway

Il repository include:

- `Procfile` per avviare il server con `npm start`
- `railway.json` con i comandi di build e start

Su Railway crea un progetto PostgreSQL e imposta le variabili d'ambiente sopra indicate. Assicurati di collegare la repository GitHub e lanciare il deploy.
