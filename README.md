# Song Study App

App web per aiutare i musicisti a studiare canzoni:
- salva link YouTube in una playlist modificabile
- riordina le canzoni
- visualizza i video in embed
- cerca testi e accordi su Ultimate Guitar

## Installazione

1. Copia `.env.example` in `.env`
2. Imposta `DATABASE_URL` con il database PostgreSQL di Railway
3. Esegui:

```bash
npm install
```

## Avvio in sviluppo

```bash
npm run dev
```

Il frontend sarà disponibile su `http://localhost:5173` e l'API su `http://localhost:3000`.

## Build e avvio produzione

```bash
npm run build
npm start
```

## API usata dal progetto

- `GET /api/tracks` - elenca le canzoni
- `POST /api/tracks` - aggiunge un nuovo link
- `PUT /api/tracks/:id` - aggiorna titolo e URL
- `DELETE /api/tracks/:id` - elimina la canzone
- `PUT /api/tracks/order` - riordina la playlist

## Note Railway

Su Railway crea un progetto PostgreSQL e copia la `DATABASE_URL` nelle variabili di ambiente. Il backend usa PostgreSQL per memorizzare i link delle canzoni.

## Deploy su Railway

Il progetto include una configurazione di deploy per Railway:
- `Procfile` avvia il server con `npm start`
- `railway.json` definisce il comando di build e start

Assicurati di pubblicare il repository su GitHub e collegare il progetto Railway alla tua repository. Railway eseguirà `npm install` e poi `npm start`.
