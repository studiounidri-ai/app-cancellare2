import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('Errore: imposta DATABASE_URL nel file .env o nelle variabili di ambiente.');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tracks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      youtube_url TEXT NOT NULL,
      position INT NOT NULL DEFAULT 0
    )
  `);
}

app.get('/api/tracks', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tracks ORDER BY position ASC, id ASC');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Impossibile caricare le canzoni' });
  }
});

app.post('/api/tracks', async (req, res) => {
  const { title, youtube_url } = req.body;
  if (!title || !youtube_url) {
    return res.status(400).json({ error: 'Titolo e link YouTube sono obbligatori' });
  }

  try {
    const maxRes = await pool.query('SELECT COALESCE(MAX(position), 0) AS max_position FROM tracks');
    const nextPosition = parseInt(maxRes.rows[0].max_position, 10) + 1;
    const result = await pool.query(
      'INSERT INTO tracks (title, youtube_url, position) VALUES ($1, $2, $3) RETURNING *',
      [title, youtube_url, nextPosition]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Impossibile salvare la canzone' });
  }
});

app.put('/api/tracks/:id', async (req, res) => {
  const { id } = req.params;
  const { title, youtube_url } = req.body;
  if (!title || !youtube_url) {
    return res.status(400).json({ error: 'Titolo e link YouTube sono obbligatori' });
  }

  try {
    const result = await pool.query(
      'UPDATE tracks SET title = $1, youtube_url = $2 WHERE id = $3 RETURNING *',
      [title, youtube_url, id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Canzone non trovata' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Impossibile aggiornare la canzone' });
  }
});

app.delete('/api/tracks/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM tracks WHERE id = $1', [id]);
    res.status(204).end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Impossibile eliminare la canzone' });
  }
});

app.put('/api/tracks/order', async (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) {
    return res.status(400).json({ error: 'Ordine non valido' });
  }

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let index = 0; index < order.length; index += 1) {
        const id = order[index];
        await client.query('UPDATE tracks SET position = $1 WHERE id = $2', [index + 1, id]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const result = await pool.query('SELECT * FROM tracks ORDER BY position ASC, id ASC');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Impossibile aggiornare l\'ordine' });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

ensureSchema()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server avviato su http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error('Errore inizializzando il database:', error);
    process.exit(1);
  });
