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

export async function findOrCreateUser({ ssoProvider, ssoId, username, email, avatarUrl, color = '#ff8000' }) {
  const userId = `u_${ssoProvider}_${ssoId}`;

  if (isDbConnected()) {
    const pool = getPool();
    try {
      const checkRes = await pool.request()
        .input('id', userId)
        .query('SELECT * FROM Users WHERE id = @id');

      if (checkRes.recordset.length > 0) {
        return checkRes.recordset[0];
      }

      // Neu anlegen
      const now = Date.now();
      await pool.request()
        .input('id', userId)
        .input('username', username)
        .input('email', email || '')
        .input('avatar_url', avatarUrl || '')
        .input('sso_provider', ssoProvider)
        .input('sso_id', ssoId)
        .input('color', color)
        .input('xp', 0)
        .input('level', 1)
        .input('created_at', now)
        .query(`
          INSERT INTO Users (id, username, email, avatar_url, sso_provider, sso_id, color, xp, level, created_at)
          VALUES (@id, @username, @email, @avatar_url, @sso_provider, @sso_id, @color, @xp, @level, @created_at)
        `);

      return {
        id: userId,
        username,
        email,
        avatar_url: avatarUrl,
        sso_provider: ssoProvider,
        color,
        xp: 0,
        level: 1
      };
    } catch (e) {
      console.error('[Auth] MSSQL Error findOrCreateUser:', e.message);
    }
  }

  // Fallback In-Memory
  if (memoryUsers.has(userId)) {
    return memoryUsers.get(userId);
  }

  const user = {
    id: userId,
    username,
    email: email || '',
    avatar_url: avatarUrl || '',
    sso_provider: ssoProvider,
    color,
    xp: 0,
    level: 1
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
