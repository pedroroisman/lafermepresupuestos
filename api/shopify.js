// Lee datos públicos de la tienda Shopify de La Ferme y los devuelve normalizados.
//   /api/shopify?type=collections                  → lista de colecciones
//   /api/shopify?type=collection&handle=lamparas-de-mesa
//   /api/shopify?type=product&handle=lampara-bayona-chica
// La tienda se puede cambiar con la variable de entorno SHOP_DOMAIN en Vercel.

const SHOP = (process.env.SHOP_DOMAIN || 'laferme.com.ar').replace(/^https?:\/\//, '').replace(/\/$/, '');
const UA = 'Mozilla/5.0 (compatible; LaFermeEstudio/1.0)';

const cleanHandle = h => decodeURIComponent(String(h || '')).toLowerCase().replace(/[^a-z0-9\-_]/g, '');

async function get(path) {
  const r = await fetch(`https://${SHOP}${path}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) {
    const e = new Error(r.status === 404 ? 'No se encontró en la tienda. Revisá el link.' : `La tienda respondió ${r.status}.`);
    e.status = r.status === 404 ? 404 : 502;
    throw e;
  }
  return r.json();
}

const abs = u => (u ? (u.startsWith('//') ? 'https:' + u : u) : '');

function htmlToText(html) {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

// products.json (precios como texto "325000.00")
function fromJson(p) {
  const vs = p.variants || [];
  const prices = vs.map(v => parseFloat(v.price)).filter(n => !isNaN(n));
  const compares = vs.map(v => parseFloat(v.compare_at_price)).filter(n => !isNaN(n));
  return {
    id: String(p.id),
    handle: p.handle,
    title: p.title,
    price: prices.length ? Math.min(...prices) : null,
    compareAt: compares.length ? Math.max(...compares) : null,
    available: vs.length ? vs.some(v => v.available !== false) : true,
    images: (p.images || []).map(i => abs(i.src)).filter(Boolean),
    description: htmlToText(p.body_html),
  };
}

// /products/handle.js (precios en centavos)
function fromJs(p) {
  return {
    id: String(p.id),
    handle: p.handle,
    title: p.title,
    price: p.price != null ? p.price / 100 : null,
    compareAt: p.compare_at_price ? p.compare_at_price / 100 : null,
    available: p.available !== false,
    images: (p.images || []).map(abs).filter(Boolean),
    description: htmlToText(p.description),
  };
}

// ---------- Búsqueda de productos por nombre ----------
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
let catalog = null, catalogAt = 0;   // caché en memoria de la función (se renueva cada 10 min)

async function allProducts() {
  if (catalog && Date.now() - catalogAt < 10 * 60 * 1000) return catalog;
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const j = await get(`/products.json?limit=250&page=${page}`);
    const ps = j.products || [];
    out.push(...ps.map(fromJson));
    if (ps.length < 250) break;
  }
  catalog = out; catalogAt = Date.now();
  return out;
}

async function search(term) {
  const toHit = p => ({ handle: p.handle, title: p.title, price: p.price, image: p.images[0] || '' });
  // 1) Búsqueda predictiva de Shopify
  try {
    const j = await get(`/search/suggest.json?q=${encodeURIComponent(term)}&resources[type]=product&resources[limit]=10&resources[options][unavailable_products]=last`);
    const ps = (((j || {}).resources || {}).results || {}).products || [];
    if (ps.length) {
      return ps.map(p => ({
        handle: p.handle,
        title: p.title,
        price: p.price != null ? parseFloat(p.price) : null,
        image: abs(p.image || (p.featured_image && p.featured_image.url) || ''),
      }));
    }
  } catch (_) { /* si no está disponible, sigue con el catálogo */ }
  // 2) Respaldo: filtra el catálogo completo por todas las palabras
  const words = norm(term).split(/\s+/).filter(w => w.length > 1);
  const all = await allProducts();
  return all.filter(p => { const t = norm(p.title); return words.every(w => t.includes(w)); }).slice(0, 12).map(toHit);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const q = req.query || {};
  try {
    let data;
    if (q.type === 'collections') {
      const j = await get('/collections.json?limit=250');
      data = {
        collections: (j.collections || []).map(c => ({ handle: c.handle, title: c.title, count: c.products_count ?? null })),
      };
    } else if (q.type === 'collection') {
      const h = cleanHandle(q.handle);
      if (!h) throw Object.assign(new Error('Falta la colección.'), { status: 400 });
      const products = [];
      for (let page = 1; page <= 8; page++) {
        const j = await get(`/collections/${h}/products.json?limit=250&page=${page}`);
        const ps = j.products || [];
        products.push(...ps.map(fromJson));
        if (ps.length < 250) break;
      }
      let title = h.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());
      try {
        const cs = await get('/collections.json?limit=250');
        const c = (cs.collections || []).find(c => c.handle === h);
        if (c) title = c.title;
      } catch (_) { /* el título es opcional */ }
      data = { handle: h, title, products };
    } else if (q.type === 'product') {
      const h = cleanHandle(q.handle);
      if (!h) throw Object.assign(new Error('Falta el producto.'), { status: 400 });
      data = { product: fromJs(await get(`/products/${h}.js`)) };
    } else if (q.type === 'search') {
      const term = String(q.q || '').trim().slice(0, 80);
      if (!term) throw Object.assign(new Error('Escribí qué buscar.'), { status: 400 });
      data = { products: await search(term) };
    } else {
      throw Object.assign(new Error('Tipo de consulta inválido.'), { status: 400 });
    }
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    res.status(200).json(data);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Error al leer la tienda.' });
  }
};

module.exports._test = { fromJson, fromJs, htmlToText, cleanHandle };
