// Proxy de imágenes de Shopify: sirve las fotos desde el mismo dominio de la herramienta
// para que se puedan recortar y exportar a PNG sin bloqueos del navegador (CORS).
//   /api/img?url=https://cdn.shopify.com/...

const SHOP = (process.env.SHOP_DOMAIN || 'laferme.com.ar').replace(/^https?:\/\//, '').replace(/\/$/, '');

function allowed(host) {
  return (
    host === 'cdn.shopify.com' ||
    host === SHOP ||
    host === 'www.' + SHOP ||
    host.endsWith('.myshopify.com')
  );
}

module.exports = async (req, res) => {
  let u;
  try {
    u = new URL(String((req.query || {}).url || ''));
  } catch (_) {
    return res.status(400).send('URL inválida');
  }
  if (u.protocol !== 'https:' || !allowed(u.hostname)) return res.status(403).send('Dominio no permitido');

  // Pedimos una versión liviana pero nítida (Shopify redimensiona con ?width=)
  if (!u.searchParams.has('width')) u.searchParams.set('width', '1600');

  try {
    const r = await fetch(u.toString(), { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LaFermeEstudio/1.0)' } });
    if (!r.ok) return res.status(r.status).send('No se pudo obtener la imagen');
    const type = r.headers.get('content-type') || 'image/jpeg';
    if (!type.startsWith('image/')) return res.status(415).send('No es una imagen');
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).send(buf);
  } catch (e) {
    res.status(502).send('Error al obtener la imagen');
  }
};
