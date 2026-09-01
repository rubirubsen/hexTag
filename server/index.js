import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { initDatabase, getPool, isDbConnected } from './db.js';
import {
  generateToken,
  verifyToken,
  findOrCreateUser,
  getGoogleAuthURL,
  getTwitchAuthURL,
  getDiscordAuthURL
} from './auth.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || process.env.HEXTAG_PORT || 8480;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Auth Middleware
function authMiddleware(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    req.user = null;
    return next();
  }
  const user = verifyToken(token);
  req.user = user;
  next();
}

app.use(authMiddleware);

// --- 1. AUTH & SSO ENDPOINTS ---

// Get current user profile
app.get('/api/auth/me', (req, res) => {
  if (!req.user) {
    return res.json({ authenticated: false, user: null });
  }
  res.json({ authenticated: true, user: req.user });
});

// Guest Login (Sofort startklar)
app.post('/api/auth/guest', async (req, res) => {
  const guestName = req.body.username || `Tagger_${Math.floor(1000 + Math.random() * 9000)}`;
  const guestColor = req.body.color || '#ff8000';
  const guestId = `guest_${Date.now()}`;

  const user = await findOrCreateUser({
    ssoProvider: 'guest',
    ssoId: guestId,
    username: guestName,
    color: guestColor,
    avatarUrl: ''
  });

  const token = generateToken(user);
  res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
  res.json({ success: true, token, user });
});

// SSO Initiator Routes
app.get('/api/auth/google', (req, res) => res.redirect(getGoogleAuthURL(req)));
app.get('/api/auth/twitch', (req, res) => res.redirect(getTwitchAuthURL(req)));
app.get('/api/auth/discord', (req, res) => res.redirect(getDiscordAuthURL(req)));

// SSO Callback Handlers
app.get('/api/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/?error=no_code');

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_CALLBACK_URL || `${req.protocol}://${req.get('host')}/api/auth/google/callback`,
        grant_type: 'authorization_code'
      })
    });
    const tokens = await tokenRes.json();

    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const googleUser = await userRes.json();

    const user = await findOrCreateUser({
      ssoProvider: 'google',
      ssoId: googleUser.id,
      username: googleUser.name || googleUser.email.split('@')[0],
      email: googleUser.email,
      avatarUrl: googleUser.picture
    });

    const token = generateToken(user);
    res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
    res.redirect('/?login=success');
  } catch (err) {
    console.error('[SSO] Google Callback Error:', err);
    res.redirect('/?error=google_failed');
  }
});

app.get('/api/auth/twitch/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/?error=no_code');

  try {
    const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.TWITCH_CLIENT_ID,
        client_secret: process.env.TWITCH_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: process.env.TWITCH_CALLBACK_URL || `${req.protocol}://${req.get('host')}/api/auth/twitch/callback`
      })
    });
    const tokens = await tokenRes.json();

    const userRes = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        'Client-ID': process.env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${tokens.access_token}`
      }
    });
    const twitchData = await userRes.json();
    const twitchUser = twitchData.data[0];

    const user = await findOrCreateUser({
      ssoProvider: 'twitch',
      ssoId: twitchUser.id,
      username: twitchUser.display_name,
      email: twitchUser.email,
      avatarUrl: twitchUser.profile_image_url
    });

    const token = generateToken(user);
    res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
    res.redirect('/?login=success');
  } catch (err) {
    console.error('[SSO] Twitch Callback Error:', err);
    res.redirect('/?error=twitch_failed');
  }
});

app.get('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

// --- 2. MULTIPLAYER ZONES & TAGS API ---
const memoryZones = new Map();
const memoryTags = [];

app.get('/api/zones', async (req, res) => {
  if (isDbConnected()) {
    try {
      const pool = getPool();
      const result = await pool.request().query('SELECT * FROM HexZones');
      return res.json(result.recordset);
    } catch (e) {
      console.error(e);
    }
  }
  res.json(Array.from(memoryZones.values()));
});

app.post('/api/zones/capture', async (req, res) => {
  const { hexId, color, ownerName } = req.body;
  const ownerId = req.user?.id || 'guest';
  const name = req.user?.username || ownerName || 'Tagger';
  const now = Date.now();

  if (isDbConnected()) {
    try {
      const pool = getPool();
      await pool.request()
        .input('hex_id', hexId)
        .input('owner_id', ownerId)
        .input('owner_name', name)
        .input('color', color || '#ff8000')
        .input('captured_at', now)
        .query(`
          MERGE HexZones AS target
          USING (SELECT @hex_id AS hex_id) AS source
          ON (target.hex_id = source.hex_id)
          WHEN MATCHED THEN
            UPDATE SET owner_id = @owner_id, owner_name = @owner_name, color = @color, captured_at = @captured_at
          WHEN NOT MATCHED THEN
            INSERT (hex_id, owner_id, owner_name, color, captured_at)
            VALUES (@hex_id, @owner_id, @owner_name, @color, @captured_at);
        `);
    } catch (e) {
      console.error(e);
    }
  }

  const zone = { hex_id: hexId, owner_id: ownerId, owner_name: name, color, captured_at: now };
  memoryZones.set(hexId, zone);
  res.json({ success: true, zone });
});

app.get('/api/tags', async (req, res) => {
  if (isDbConnected()) {
    try {
      const pool = getPool();
      const result = await pool.request().query('SELECT * FROM GraffitiTags ORDER BY created_at DESC');
      return res.json(result.recordset);
    } catch (e) {
      console.error(e);
    }
  }
  res.json(memoryTags);
});

app.post('/api/tags', async (req, res) => {
  const { hexId, lat, lng, color, imageBase64, author } = req.body;
  const tagId = 'tag_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
  const now = Date.now();
  const authorName = req.user?.username || author || 'Tagger';
  const userId = req.user?.id || 'guest';

  if (isDbConnected()) {
    try {
      const pool = getPool();
      await pool.request()
        .input('id', tagId)
        .input('hex_id', hexId)
        .input('user_id', userId)
        .input('author', authorName)
        .input('color', color || '#ff8000')
        .input('lat', lat || 0)
        .input('lng', lng || 0)
        .input('image_data', imageBase64)
        .input('created_at', now)
        .query(`
          INSERT INTO GraffitiTags (id, hex_id, user_id, author, color, lat, lng, image_data, created_at)
          VALUES (@id, @hex_id, @user_id, @author, @color, @lat, @lng, @image_data, @created_at)
        `);
    } catch (e) {
      console.error(e);
    }
  }

  const newTag = { id: tagId, hex_id: hexId, user_id: userId, author: authorName, color, lat, lng, image_data: imageBase64, created_at: now };
  memoryTags.unshift(newTag);
  res.json({ success: true, tag: newTag });
});

// --- 3. STATIC FRONTEND SERVING (SPA) ---
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// Start Server & Database
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`[hexTag Server] Server läuft auf Port ${PORT} (http://localhost:${PORT})`);
  });
});
