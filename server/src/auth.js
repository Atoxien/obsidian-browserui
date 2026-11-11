// Einfache Passwort-Authentifizierung mit signiertem Session-Cookie.
import crypto from 'node:crypto';

const COOKIE = 'obui_session';
const MAX_AGE_S = 60 * 60 * 24 * 30; // 30 Tage (Cookie, eigener Server)
const TOKEN_AGE_S = 60 * 60 * 12; // 12 Stunden (Token, z.B. fremder Rechner über GitHub Pages)

export function createAuth({ password, secret, secureCookie }) {
  const enabled = Boolean(password);
  const sessionSecret = secret || crypto.randomBytes(32).toString('hex');
  const attempts = new Map(); // ip -> {count, until}

  function sign(value) {
    return crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url');
  }

  function issue(maxAge = MAX_AGE_S) {
    const exp = Math.floor(Date.now() / 1000) + maxAge;
    const payload = `v1.${exp}.${crypto.randomBytes(8).toString('hex')}`;
    return `${payload}.${sign(payload)}`;
  }

  function verify(token) {
    if (typeof token !== 'string') return false;
    const idx = token.lastIndexOf('.');
    if (idx < 0) return false;
    const payload = token.slice(0, idx);
    const sig = token.slice(idx + 1);
    const expected = sign(payload);
    if (sig.length !== expected.length) return false;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    const exp = Number(payload.split('.')[1]);
    return Number.isFinite(exp) && exp > Date.now() / 1000;
  }

  function checkPassword(input) {
    const a = crypto.createHash('sha256').update(String(input ?? '')).digest();
    const b = crypto.createHash('sha256').update(password).digest();
    return crypto.timingSafeEqual(a, b);
  }

  function bearer(req) {
    const h = req.headers.authorization;
    return typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7) : undefined;
  }

  function isLoggedIn(req) {
    return !enabled || verify(req.cookies?.[COOKIE]) || verify(bearer(req));
  }

  /** Fastify-Hook für /api/* (außer Login/Info). */
  async function guard(req, reply) {
    if (!isLoggedIn(req)) {
      reply.code(401).send({ error: 'Nicht angemeldet' });
      return reply;
    }
  }

  function register(app) {
    app.post('/api/login', async (req, reply) => {
      if (!enabled) return { ok: true };
      const ip = req.ip;
      const now = Date.now();
      const rec = attempts.get(ip);
      if (rec && rec.until > now) {
        return reply.code(429).send({ error: 'Zu viele Versuche – bitte kurz warten' });
      }
      const ok = checkPassword(req.body?.password);
      if (!ok) {
        const count = (rec?.count ?? 0) + 1;
        attempts.set(ip, { count, until: count >= 5 ? now + 60_000 * Math.min(count - 4, 15) : 0 });
        return reply.code(401).send({ error: 'Falsches Passwort' });
      }
      attempts.delete(ip);
      // Token-Modus für Zugriffe von einer anderen Herkunft (z.B. GitHub Pages): nichts im Cookie
      if (req.body?.token === true) return { ok: true, token: issue(TOKEN_AGE_S) };
      reply.setCookie(COOKIE, issue(), {
        path: '/',
        httpOnly: true,
        sameSite: 'strict',
        secure: secureCookie,
        maxAge: MAX_AGE_S,
      });
      return { ok: true };
    });

    app.post('/api/logout', async (_req, reply) => {
      reply.clearCookie(COOKIE, { path: '/' });
      return { ok: true };
    });
  }

  return { enabled, guard, register, isLoggedIn };
}
