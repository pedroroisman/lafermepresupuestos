# La Ferme · Estudio de historias

Herramienta web para armar historias (9:16) y posts (4:5) de Instagram con la identidad de La Ferme, cargando productos y fotos directamente desde la tienda Shopify.

## Qué hay en esta carpeta

```
index.html        La aplicación: inicio, editor y exportación a PNG / ZIP
api/shopify.js    Lee colecciones y productos de laferme.com.ar
api/img.js        Sirve las fotos de Shopify desde el mismo dominio (necesario para exportar)
presupuesto/      Herramienta de presupuestos en PDF (se abre en /presupuesto)
```

No necesita instalar nada ni base de datos.

## Publicar en Vercel

**Opción A: con GitHub (recomendada)**

1. Creá un repositorio nuevo en GitHub y subí el contenido de esta carpeta.
2. En vercel.com: *Add New → Project → Import* ese repositorio.
3. Framework Preset: **Other**. No hace falta configurar build. *Deploy*.
4. Cada cambio que subas al repositorio se publica solo.

**Opción B: desde la terminal**

```
cd la-ferme-estudio
npx vercel --prod
```

Opcional: en *Settings → Domains* podés asignarle un subdominio, por ejemplo `historias.laferme.com.ar`.

Opcional: si la tienda cambia de dominio, en *Settings → Environment Variables* agregá `SHOP_DOMAIN` con el dominio nuevo. También hay que cambiar `SHOP_DOMAIN` al principio del script en `index.html`.

## Cómo se usa

1. Elegí el formato (historia o post) y el tipo de publicación.
2. Pegá el link de una colección o de un producto de laferme.com.ar y tocá **Cargar**. También podés elegir la colección de la lista.
3. Ajustá textos, elegí qué productos mostrar, cambiá fotos y arrastralas para encuadrar.
4. **Descargar todo (.zip)** baja todas las imágenes numeradas en orden.

## Para tener en cuenta

- Lo que se arma queda guardado en el navegador de quien lo usa, no se comparte entre computadoras.
- Los productos agotados se cargan ocultos; se pueden mostrar con su casilla.
- Abierta como archivo (doble clic en `index.html`) la herramienta funciona, pero la carga desde la tienda solo funciona una vez publicada en Vercel.
- La carga usa los datos públicos de Shopify (`/collections/…/products.json` y `/products/….js`), que están activos por defecto en las tiendas.

## Contraseña

`middleware.js` pide usuario y contraseña antes de mostrar cualquier parte de la herramienta.
En Vercel → *Settings → Environment Variables* configurá:

- `APP_PASSWORD`: la contraseña (obligatoria; sin ella la herramienta no abre).
- `APP_USER`: el usuario (opcional, por defecto `laferme`).

Después de cambiarlas hay que volver a publicar (*Deployments → … → Redeploy*).

## Presupuestos (/presupuesto)

1. Copiá los datos del sistema (Fecha, Num, Cliente, Descripción producto, Precio Final) y pegalos en **Pegar datos del sistema**. Cada pegado suma un producto.
2. La herramienta busca sola la foto del producto en la tienda; se puede cambiar, buscar por nombre, pegar un link o subir una foto.
3. Ajustá cantidades, estado (A fabricar / Stock / A confirmar stock), ambiente, descuentos, seña y condiciones.
4. **Descargar PDF** baja el archivo con el nombre "Presupuesto N° - Cliente.pdf".

Las condiciones, descuentos y sucursales se pueden guardar como predeterminados. Los últimos 20 presupuestos descargados quedan en "Descargados recientemente" (en ese navegador).
