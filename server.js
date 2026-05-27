import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { Pool } from 'pg';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;
const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET || 'appstudio-secret-change-it';
const baseUrl = process.env.BASE_URL || 'http://localhost:5173';
const smtpHost = process.env.SMTP_HOST;
const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
const smtpSecure = process.env.SMTP_SECURE === 'true';
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;

if (!databaseUrl) {
  console.error('Errore: imposta DATABASE_URL nel file .env o nelle variabili di ambiente.');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
const canSendEmail = Boolean(smtpHost && smtpUser && smtpPass);
const transporter = canSendEmail
  ? nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: {
        user: smtpUser,
        pass: smtpPass
      }
    })
  : null;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tracks (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('youtube', 'local')),
      youtube_url TEXT,
      local_id TEXT,
      file_name TEXT,
      mime_type TEXT,
      position INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);
}

function createToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, jwtSecret, { expiresIn: '7d' });
}

function authMiddleware(req, res, next) {
  const authorization = req.headers.authorization;
  if (!authorization || !authorization.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token mancante' });
  }
  const token = authorization.replace('Bearer ', '').trim();
  try {
    const payload = jwt.verify(token, jwtSecret);
    req.user = payload;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token non valido' });
  }
}

async function sendResetEmail(email, token) {
  if (!transporter) {
    throw new Error('SMTP non configurato correttamente.');
  }
  const resetLink = `${baseUrl}/?action=reset&token=${encodeURIComponent(token)}`;
  await transporter.sendMail({
    from: smtpUser,
    to: email,
    subject: 'Recupero password Appstudio',
    text: `Usa il link seguente per ripristinare la tua password:\n${resetLink}\n\nIl link scade in un'ora.`,
    html: `<p>Usa il link seguente per ripristinare la tua password:</p><p><a href="${resetLink}">${resetLink}</a></p><p>Il link scade in un'ora.</p>`
  });
}

app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email e password sono obbligatorie' });
  }
  try {
    const hashedPassword = bcrypt.hashSync(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [email.trim().toLowerCase(), hashedPassword]
    );
    const token = createToken(result.rows[0]);
    return res.json({ token, user: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Email già in uso' });
    }
    console.error(error);
    return res.status(500).json({ error: 'Impossibile creare l\'account' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email e password sono obbligatorie' });
  }
  try {
    const result = await pool.query('SELECT id, email, password_hash FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    const user = result.rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Email o password non validi' });
    }
    const token = createToken(user);
    return res.json({ token, user: { id: user.id, email: user.email } });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Impossibile eseguire il login' });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, email FROM users WHERE id = $1', [req.user.id]);
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Utente non trovato' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Impossibile recuperare l\'utente' });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email obbligatoria' });
  }
  try {
    const result = await pool.query('SELECT id FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    const user = result.rows[0];
    if (!user) {
      return res.json({ message: 'Se l\'email esiste, hai ricevuto istruzioni per ripristinare la password.' });
    }
    if (!canSendEmail) {
      return res.status(500).json({ error: 'Server email non configurato. Contatta l\'amministratore.' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60);
    await pool.query(
      'INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)',
      [token, user.id, expiresAt.toISOString()]
    );
    await sendResetEmail(email.trim().toLowerCase(), token);
    return res.json({ message: 'Se l\'email esiste, hai ricevuto istruzioni per ripristinare la password.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Impossibile inviare la mail per il recupero password' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ error: 'Token e password sono obbligatori' });
  }
  try {
    const tokenResult = await pool.query(
      'SELECT user_id FROM password_reset_tokens WHERE token = $1 AND expires_at > NOW()',
      [token]
    );
    const tokenRow = tokenResult.rows[0];
    if (!tokenRow) {
      return res.status(400).json({ error: 'Token non valido o scaduto' });
    }
    const hashedPassword = bcrypt.hashSync(password, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedPassword, tokenRow.user_id]);
    await pool.query('DELETE FROM password_reset_tokens WHERE token = $1', [token]);
    return res.json({ message: 'Password aggiornata con successo' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Impossibile ripristinare la password' });
  }
});

app.get('/api/tracks', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, title, type, youtube_url, local_id, file_name, mime_type, position FROM tracks WHERE user_id = $1 ORDER BY position ASC, id ASC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Impossibile caricare le canzoni' });
  }
});

app.post('/api/tracks', authMiddleware, async (req, res) => {
  const { title, type, youtube_url, local_id, file_name, mime_type } = req.body;

  if (!title || !type || !['youtube', 'local'].includes(type)) {
    return res.status(400).json({ error: 'Titolo e tipo di traccia obbligatori' });
  }

  if (type === 'youtube' && !youtube_url) {
    return res.status(400).json({ error: 'URL YouTube obbligatorio per le tracce YouTube' });
  }

  if (type === 'local' && !local_id) {
    return res.status(400).json({ error: 'ID locale obbligatorio per le tracce MP3 caricate' });
  }

  try {
    const positionResult = await pool.query(
      'SELECT COALESCE(MAX(position), 0) AS max_position FROM tracks WHERE user_id = $1',
      [req.user.id]
    );
    const nextPosition = parseInt(positionResult.rows[0].max_position, 10) + 1;
    const result = await pool.query(
      'INSERT INTO tracks (user_id, title, type, youtube_url, local_id, file_name, mime_type, position) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [req.user.id, title.trim(), type, youtube_url || null, local_id || null, file_name || null, mime_type || null, nextPosition]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Impossibile salvare la canzone' });
  }
});

app.put('/api/tracks/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { title } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Titolo obbligatorio' });
  }
  try {
    const result = await pool.query(
      'UPDATE tracks SET title = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
      [title.trim(), id, req.user.id]
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

app.delete('/api/tracks/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM tracks WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    res.status(204).end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Impossibile eliminare la canzone' });
  }
});

app.put('/api/tracks/order', authMiddleware, async (req, res) => {
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
        await client.query(
          'UPDATE tracks SET position = $1 WHERE id = $2 AND user_id = $3',
          [index + 1, id, req.user.id]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const result = await pool.query(
      'SELECT id, title, type, youtube_url, local_id, file_name, mime_type, position FROM tracks WHERE user_id = $1 ORDER BY position ASC, id ASC',
      [req.user.id]
    );
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
