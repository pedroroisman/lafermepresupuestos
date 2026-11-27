// Archivo central de presupuestos.
//   Datos y numeración  → Upstash Redis (variables KV_REST_API_URL / KV_REST_API_TOKEN o UPSTASH_REDIS_REST_*)
//   PDFs y fotos subidas → Vercel Blob   (variable BLOB_READ_WRITE_TOKEN, la crea Vercel al conectar el Blob)
//
//   GET  /api/budgets?action=next              → próximo número sugerido
//   GET  /api/budgets?action=list              → lista de presupuestos guardados (resumen)
//   GET  /api/budgets?action=get&id=…          → presupuesto completo
//   GET  /api/budgets?action=pdf&id=…          → descarga el PDF guardado
//   GET  /api/budgets?action=file&u=…&a=…      → sirve una foto subida
//   POST /api/budgets?action=save              → guarda/actualiza los datos (y asigna número)
//   POST /api/budgets?action=pdf               → guarda el PDF de un presupuesto
//   POST /api/budgets?action=setnext           → cambia el próximo número

const START = 1700;
const P = 'lf:pres:';
const KEY = { counter: P + 'counter', idx: P + 'idx', sum: P + 'sum', rec: id => P + 'b:' + id };

// ---------- Configuración (busca las variables aunque tengan otro prefijo) ----------
function envFind(...patterns) {
  for (const p of patterns) {
    if (process.env[p]) return process.env[p];
    const k = Object.keys(process.env).find(k => k.endsWith('_' + p));
    if (k) return process.env[k];
  }
  return '';
}
const redisCfg = () => {
  const url = envFind('KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL');
  const token = envFind('KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN');
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
};
const blobToken = () => envFind('BLOB_READ_WRITE_TOKEN') || undefined;

// ---------- Redis (API REST de Upstash) ----------
async function redis(cmd) {
  const c = redisCfg();
  const r = await fetch(c.url, { method: 'POST', headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('Base de datos: ' + (j.error || r.status));
  return j.result;
}
async function pipeline(cmds) {
  const c = redisCfg();
  const r = await fetch(c.url + '/pipeline', { method: 'POST', headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(j)) throw new Error('Base de datos: ' + r.status);
  const bad = j.find(x => x && x.error); if (bad) throw new Error('Base de datos: ' + bad.error);
  return j.map(x => x.result);
}

// ---------- Blob ----------
let blobLib = null;
const blob = () => (blobLib = blobLib || require('@vercel/blob'));
let storeAccess = null;   // 'private' si el almacenamiento lo permite; si no, 'public'
async function putFile(pathname, buffer, contentType) {
  const opts = a => ({ access: a, contentType, addRandomSuffix: true, token: blobToken() });
  const order = storeAccess ? [storeAccess] : ['private', 'public'];
  let last;
  for (const a of order) {
    try { const r = await blob().put(pathname, buffer, opts(a)); storeAccess = a; return { url: r.url, access: a }; }
    catch (e) { last = e; }
  }
  throw new Error('Archivos: ' + (last && last.message || 'no se pudo guardar'));
}
async function readFile(url, access) {
  const r = await blob().get(url, { access: access || 'private', token: blobToken() });
  if (!r || r.statusCode !== 200) return null;
  return { buffer: Buffer.from(await new Response(r.stream).arrayBuffer()), type: r.blob.contentType };
}
const isBlobUrl = u => { try { const h = new URL(u).hostname; return h.endsWith('.blob.vercel-storage.com'); } catch (_) { return false; } };

// ---------- Utilidades ----------
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const cleanId = s => String(s || '').replace(/[^a-z0-9]/gi, '').slice(0, 40);
const slug = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'presupuesto';
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = []; for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
const summaryOf = r => ({ id: r.id, num: r.num, client: r.client, date: r.date, total: r.total, branch: r.branch, items: r.itemsCount, savedAt: r.savedAt, createdAt: r.createdAt, hasPdf: !!r.pdfUrl });

async function nextNumber() {
  const n = parseInt(await redis(['GET', KEY.counter]), 10);
  return isNaN(n) ? START : Math.max(START, n + 1);
}

// ---------- Handler ----------
module.exports = async (req, res) => {
  const q = req.query || {};
  const action = q.action || '';
  res.setHeader('Cache-Control', 'no-store');
  if (!redisCfg()) return res.status(503).json({ error: 'not_configured', message: 'Falta conectar la base de datos (Upstash Redis) al proyecto en Vercel.' });

  try {
    // ----- Lecturas -----
    if (req.method === 'GET') {
      if (action === 'next') return res.status(200).json({ next: await nextNumber() });

      if (action === 'list') {
        const ids = await redis(['ZREVRANGE', KEY.idx, '0', '1999']) || [];
        if (!ids.length) return res.status(200).json({ items: [] });
        const sums = await redis(['HMGET', KEY.sum, ...ids]) || [];
        return res.status(200).json({ items: sums.filter(Boolean).map(s => JSON.parse(s)) });
      }

      if (action === 'get') {
        const raw = await redis(['GET', KEY.rec(cleanId(q.id))]);
        if (!raw) return res.status(404).json({ error: 'No se encontró ese presupuesto.' });
        const r = JSON.parse(raw);
        return res.status(200).json({ id: r.id, num: r.num, budget: r.budget, hasPdf: !!r.pdfUrl });
      }

      if (action === 'pdf') {
        const raw = await redis(['GET', KEY.rec(cleanId(q.id))]);
        const r = raw && JSON.parse(raw);
        if (!r || !r.pdfUrl) return res.status(404).send('Este presupuesto no tiene PDF guardado.');
        const f = await readFile(r.pdfUrl, r.pdfAccess);
        if (!f) return res.status(404).send('No se encontró el PDF.');
        const name = `Presupuesto ${r.num || ''}${r.client ? ' - ' + r.client : ''}.pdf`.replace(/[\\/:*?"<>|]+/g, '');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${slug(name)}.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`);
        return res.status(200).send(f.buffer);
      }

      if (action === 'file') {
        const u = String(q.u || '');
        if (!isBlobUrl(u)) return res.status(403).send('No permitido');
        const f = await readFile(u, q.a === 'public' ? 'public' : 'private');
        if (!f) return res.status(404).send('No encontrado');
        res.setHeader('Content-Type', f.type || 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=86400');
        return res.status(200).send(f.buffer);
      }
      return res.status(400).json({ error: 'Acción inválida.' });
    }

    // ----- Escrituras -----
    if (req.method === 'POST') {
      const body = await readBody(req);

      if (action === 'save') {
        const budget = body.budget || {};
        let id = cleanId(body.id);
        const prevRaw = id ? await redis(['GET', KEY.rec(id)]) : null;
        const prev = prevRaw ? JSON.parse(prevRaw) : null;
        if (!prev) id = id || newId();

        // Número: el servidor lo asigna para presupuestos nuevos con número sugerido
        let num = String(budget.num || '').trim();
        if (!prev && (body.autoNum || !num)) {
          await redis(['SET', KEY.counter, String(START - 1), 'NX']);
          num = String(await redis(['INCR', KEY.counter]));
        } else {
          const n = parseInt(num.replace(/\D/g, ''), 10), cur = parseInt(await redis(['GET', KEY.counter]), 10);
          if (!isNaN(n) && (isNaN(cur) || n > cur)) await redis(['SET', KEY.counter, String(n)]);
        }
        budget.num = num;

        // Fotos subidas desde la computadora → Vercel Blob
        for (const it of budget.items || []) {
          const up = it.photo && it.photo.upload;
          if (up && up.startsWith('data:image/')) {
            const m = up.match(/^data:(image\/[a-z]+);base64,(.+)$/);
            if (m) {
              const f = await putFile(`presupuestos/fotos/${id}-${cleanId(it.id)}.${m[1].split('/')[1]}`, Buffer.from(m[2], 'base64'), m[1]);
              it.photo.upload = `/api/budgets?action=file&a=${f.access}&u=${encodeURIComponent(f.url)}`;
            }
          }
        }
        delete budget.serverId; delete budget.autoNum;

        const now = Date.now();
        const rec = {
          id, num, budget,
          client: String(budget.client || '').slice(0, 120), date: budget.date || '', branch: budget.branch || 0,
          total: +body.total || 0, itemsCount: (budget.items || []).length,
          createdAt: prev ? prev.createdAt : now, savedAt: now,
          pdfUrl: prev ? prev.pdfUrl : '', pdfAccess: prev ? prev.pdfAccess : '',
        };
        await pipeline([
          ['SET', KEY.rec(id), JSON.stringify(rec)],
          ['HSET', KEY.sum, id, JSON.stringify(summaryOf(rec))],
          ['ZADD', KEY.idx, String(now), id],
        ]);
        return res.status(200).json({ id, num, budget });
      }

      if (action === 'pdf') {
        const id = cleanId(body.id);
        const raw = await redis(['GET', KEY.rec(id)]);
        if (!raw) return res.status(404).json({ error: 'Primero hay que guardar el presupuesto.' });
        const pdf = String(body.pdf || '');
        if (!pdf) return res.status(400).json({ error: 'Falta el PDF.' });
        const rec = JSON.parse(raw);
        const old = rec.pdfUrl, oldAccess = rec.pdfAccess;
        const f = await putFile(`presupuestos/pdf/${slug(rec.num + '-' + rec.client)}.pdf`, Buffer.from(pdf, 'base64'), 'application/pdf');
        rec.pdfUrl = f.url; rec.pdfAccess = f.access;
        await pipeline([
          ['SET', KEY.rec(id), JSON.stringify(rec)],
          ['HSET', KEY.sum, id, JSON.stringify(summaryOf(rec))],
        ]);
        if (old && old !== f.url) { try { await blob().del(old, { token: blobToken() }); } catch (_) { /* queda la versión vieja */ } }
        return res.status(200).json({ ok: true, access: oldAccess || f.access });
      }

      if (action === 'setnext') {
        const n = parseInt(body.next, 10);
        if (isNaN(n) || n < 1) return res.status(400).json({ error: 'Número inválido.' });
        await redis(['SET', KEY.counter, String(n - 1)]);
        return res.status(200).json({ next: n });
      }
      return res.status(400).json({ error: 'Acción inválida.' });
    }

    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Error del servidor.' });
  }
};
