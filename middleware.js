// Protege toda la herramienta (páginas, fotos y /api) con usuario y contraseña.
// La contraseña se configura en Vercel → Settings → Environment Variables:
//   APP_PASSWORD  (obligatoria)
//   APP_USER      (opcional, por defecto "laferme")
import { next } from '@vercel/functions';

export const config = { runtime: 'nodejs' };

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function denied(msg) {
  return new Response(msg, {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="La Ferme - Estudio de historias", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export default function middleware(request) {
  const password = process.env.APP_PASSWORD;
  const user = process.env.APP_USER || 'laferme';
  if (!password) {
    return new Response('Falta configurar APP_PASSWORD en Vercel (Settings → Environment Variables).', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const header = request.headers.get('authorization') || '';
  if (header.startsWith('Basic ')) {
    let decoded = '';
    try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch (_) {}
    const i = decoded.indexOf(':');
    if (i >= 0 && safeEqual(decoded.slice(0, i), user) && safeEqual(decoded.slice(i + 1), password)) {
      return next();
    }
  }
  return denied('Acceso restringido.');
}
