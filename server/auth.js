import jwt from 'jsonwebtoken';
import { getPool, isDbConnected } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'hextag_cyber_secret_key_998877';

// In-Memory User Fallback
const memoryUsers = new Map();

export function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      color: user.color,
      avatar_url: user.avatar_url,
      level: user.level || 1,
      xp: user.xp || 0
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export async function getUserById(userId) {
  if (!userId) return null;

  if (isDbConnected()) {
    const pool = getPool();
    try {
      const res = await pool.request()
        .input('id', userId)
        .query('SELECT * FROM Users WHERE id = @id');
      if (res.recordset.length > 0) {
        return res.recordset[0];
      }
    } catch (e) {
      console.error('[Auth] MSSQL Error getUserById:', e.message);
    }
  }

  return memoryUsers.get(userId) || null;
}

export async function updateUserProfile(userId, updates = {}) {
  if (!userId) return null;

  const now = Date.now();
  let currentUser = await getUserById(userId);

  const updatedData = {
    username: updates.username !== undefined ? updates.username : (currentUser?.username || 'Tagger'),
    color: updates.color !== undefined ? updates.color : (currentUser?.color || '#ff8000'),
    xp: updates.xp !== undefined ? Number(updates.xp) : (currentUser?.xp || 0),
    level: updates.level !== undefined ? Number(updates.level) : (currentUser?.level || 1),
    avatar_url: updates.avatar_url !== undefined ? updates.avatar_url : (currentUser?.avatar_url || '')
  };

  if (isDbConnected()) {
    const pool = getPool();
    try {
      await pool.request()
        .input('id', userId)
        .input('username', updatedData.username)
        .input('color', updatedData.color)
        .input('xp', updatedData.xp)
        .input('level', updatedData.level)
        .input('avatar_url', updatedData.avatar_url)
        .input('last_login', now)
        .query(`
          UPDATE Users 
          SET username = @username, 
              color = @color, 
              xp = @xp, 
              level = @level, 
              avatar_url = @avatar_url,
              last_login = @last_login
          WHERE id = @id
        `);
    } catch (e) {
      console.error('[Auth] MSSQL Error updateUserProfile:', e.message);
    }
  }

  const merged = {
    ...(currentUser || {}),
    id: userId,
    ...updatedData,
    last_login: now
  };

  memoryUsers.set(userId, merged);
  return merged;
}

import crypto from 'crypto';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, storedHash) {
  if (!storedHash || !password) return false;
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, key] = parts;
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return hash === key;
}

export async function loginOrRegisterGuestUser({ username, password, color = '#ff8000' }) {
  const cleanName = (username || '').trim();
  if (!cleanName || cleanName.length < 2) {
    return { success: false, error: 'Der Name muss mindestens 2 Zeichen lang sein.' };
  }
  if (!password || password.length < 3) {
    return { success: false, error: 'Das Passwort muss mindestens 3 Zeichen lang sein.' };
  }

  const userId = `u_guest_${cleanName.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;
  const now = Date.now();

  if (isDbConnected()) {
    const pool = getPool();
    try {
      // Pruefe ob ID oder Username bereits existieren
      const checkRes = await pool.request()
        .input('id', userId)
        .input('username', cleanName)
        .query('SELECT * FROM Users WHERE id = @id OR LOWER(username) = LOWER(@username)');

      if (checkRes.recordset.length > 0) {
        const existing = checkRes.recordset[0];
        if (existing.password_hash) {
          if (!verifyPassword(password, existing.password_hash)) {
            return { success: false, error: 'Dieser Spielername ist bereits reserviert. Falsches Passwort!' };
          }
        } else {
          // Bisher kein Passwort gesetzt -> jetzt mit Passwort schuetzen
          const pHash = hashPassword(password);
          await pool.request()
            .input('id', existing.id)
            .input('password_hash', pHash)
            .query('UPDATE Users SET password_hash = @password_hash WHERE id = @id');
          existing.password_hash = pHash;
        }

        await pool.request()
          .input('id', existing.id)
          .input('last_login', now)
          .query('UPDATE Users SET last_login = @last_login WHERE id = @id');

        existing.last_login = now;
        memoryUsers.set(existing.id, existing);
        return { success: true, user: existing };
      }

      // Neu registrieren
      const pHash = hashPassword(password);
      await pool.request()
        .input('id', userId)
        .input('username', cleanName)
        .input('email', '')
        .input('avatar_url', '')
        .input('password_hash', pHash)
        .input('sso_provider', 'guest')
        .input('sso_id', cleanName.toLowerCase())
        .input('color', color)
        .input('xp', 0)
        .input('level', 1)
        .input('created_at', now)
        .input('last_login', now)
        .query(`
          INSERT INTO Users (id, username, email, avatar_url, password_hash, sso_provider, sso_id, color, xp, level, created_at, last_login)
          VALUES (@id, @username, @email, @avatar_url, @password_hash, @sso_provider, @sso_id, @color, @xp, @level, @created_at, @last_login)
        `);

      const newUser = {
        id: userId,
        username: cleanName,
        email: '',
        avatar_url: '',
        password_hash: pHash,
        sso_provider: 'guest',
        sso_id: cleanName.toLowerCase(),
        color,
        xp: 0,
        level: 1,
        created_at: now,
        last_login: now
      };
      memoryUsers.set(userId, newUser);
      return { success: true, user: newUser };
    } catch (e) {
      console.error('[Auth] MSSQL Error loginOrRegisterGuestUser:', e.message);
    }
  }

  // In-Memory Fallback
  for (const [id, u] of memoryUsers.entries()) {
    if (id === userId || u.username.toLowerCase() === cleanName.toLowerCase()) {
      if (u.password_hash) {
        if (!verifyPassword(password, u.password_hash)) {
          return { success: false, error: 'Dieser Spielername ist bereits reserviert. Falsches Passwort!' };
        }
      } else {
        u.password_hash = hashPassword(password);
      }
      u.last_login = now;
      return { success: true, user: u };
    }
  }

  const pHash = hashPassword(password);
  const newUser = {
    id: userId,
    username: cleanName,
    email: '',
    avatar_url: '',
    password_hash: pHash,
    sso_provider: 'guest',
    sso_id: cleanName.toLowerCase(),
    color,
    xp: 0,
    level: 1,
    created_at: now,
    last_login: now
  };
  memoryUsers.set(userId, newUser);
  return { success: true, user: newUser };
}

export async function findOrCreateUser({ ssoProvider, ssoId, username, email, avatarUrl, color = '#ff8000', existingUserId = null }) {
  const now = Date.now();

  // Fall: Bestehendes Gast-Konto mit SSO verknuepfen
  if (existingUserId) {
    const existing = await getUserById(existingUserId);
    if (existing) {
      if (isDbConnected()) {
        const pool = getPool();
        try {
          await pool.request()
            .input('id', existingUserId)
            .input('sso_provider', ssoProvider)
            .input('sso_id', ssoId)
            .input('email', email || existing.email || '')
            .input('avatar_url', avatarUrl || existing.avatar_url || '')
            .input('last_login', now)
            .query(`
              UPDATE Users 
              SET sso_provider = @sso_provider,
                  sso_id = @sso_id,
                  email = @email,
                  avatar_url = @avatar_url,
                  last_login = @last_login
              WHERE id = @id
            `);
        } catch (e) {
          console.error('[Auth] Error linking SSO to existing user:', e.message);
        }
      }

      existing.sso_provider = ssoProvider;
      existing.sso_id = ssoId;
      if (email) existing.email = email;
      if (avatarUrl) existing.avatar_url = avatarUrl;
      existing.last_login = now;
      memoryUsers.set(existingUserId, existing);
      return existing;
    }
  }

  const userId = `u_${ssoProvider}_${ssoId}`;

  if (isDbConnected()) {
    const pool = getPool();
    try {
      const checkRes = await pool.request()
        .input('id', userId)
        .input('sso_provider', ssoProvider)
        .input('sso_id', ssoId)
        .query('SELECT * FROM Users WHERE id = @id OR (sso_provider = @sso_provider AND sso_id = @sso_id)');

      if (checkRes.recordset.length > 0) {
        const found = checkRes.recordset[0];
        await pool.request()
          .input('id', found.id)
          .input('last_login', now)
          .query('UPDATE Users SET last_login = @last_login WHERE id = @id');
        found.last_login = now;
        return found;
      }

      // Neu anlegen
      await pool.request()
        .input('id', userId)
        .input('username', username)
        .input('email', email || '')
        .input('avatar_url', avatarUrl || '')
        .input('password_hash', null)
        .input('sso_provider', ssoProvider)
        .input('sso_id', ssoId)
        .input('color', color)
        .input('xp', 0)
        .input('level', 1)
        .input('created_at', now)
        .input('last_login', now)
        .query(`
          INSERT INTO Users (id, username, email, avatar_url, password_hash, sso_provider, sso_id, color, xp, level, created_at, last_login)
          VALUES (@id, @username, @email, @avatar_url, @password_hash, @sso_provider, @sso_id, @color, @xp, @level, @created_at, @last_login)
        `);

      const newUser = {
        id: userId,
        username,
        email: email || '',
        avatar_url: avatarUrl || '',
        password_hash: null,
        sso_provider: ssoProvider,
        sso_id: ssoId,
        color,
        xp: 0,
        level: 1,
        created_at: now,
        last_login: now
      };
      memoryUsers.set(userId, newUser);
      return newUser;
    } catch (e) {
      console.error('[Auth] MSSQL Error findOrCreateUser:', e.message);
    }
  }

  // Fallback In-Memory
  if (memoryUsers.has(userId)) {
    const existing = memoryUsers.get(userId);
    existing.last_login = now;
    return existing;
  }

  const user = {
    id: userId,
    username,
    email: email || '',
    avatar_url: avatarUrl || '',
    password_hash: null,
    sso_provider: ssoProvider,
    sso_id: ssoId,
    color,
    xp: 0,
    level: 1,
    created_at: now,
    last_login: now
  };
  memoryUsers.set(userId, user);
  return user;
}

// OAuth2 Redirect URL Generatoren
export function getGoogleAuthURL(req) {
  const rootUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
  const redirectUri = process.env.GOOGLE_CALLBACK_URL || `${getBaseUrl(req)}/api/auth/google/callback`;
  const options = {
    redirect_uri: redirectUri,
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    access_type: 'offline',
    response_type: 'code',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/userinfo.email'].join(' ')
  };
  return `${rootUrl}?${new URLSearchParams(options).toString()}`;
}

export function getTwitchAuthURL(req) {
  const rootUrl = 'https://id.twitch.tv/oauth2/authorize';
  const redirectUri = process.env.TWITCH_CALLBACK_URL || `${getBaseUrl(req)}/api/auth/twitch/callback`;
  const options = {
    client_id: process.env.TWITCH_CLIENT_ID || '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'user:read:email'
  };
  return `${rootUrl}?${new URLSearchParams(options).toString()}`;
}

export function getDiscordAuthURL(req) {
  const rootUrl = 'https://discord.com/api/oauth2/authorize';
  const redirectUri = process.env.DISCORD_CALLBACK_URL || `${getBaseUrl(req)}/api/auth/discord/callback`;
  const options = {
    client_id: process.env.DISCORD_CLIENT_ID || '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify email'
  };
  return `${rootUrl}?${new URLSearchParams(options).toString()}`;
}

function getBaseUrl(req) {
  return process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
}
