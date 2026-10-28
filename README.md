# 1clic-web · Sitio de 1clic · Conectando Colombia

Sitio estático multipágina del operador de fibra óptica **1clic** (1 CLIC S.A.S.) para el corredor
Medellín – Occidente – Urabá. HTML + CSS + JavaScript sin frameworks ni compilación obligatoria.
Única dependencia externa: **Leaflet 1.9.4**, auto-alojada.

> **Estado:** versión 1.0.0 · 22 oct. 2026 · **borrador para aprobación**. Los textos legales tienen el aviso
> "Borrador sujeto a revisión jurídica", los planes y la cobertura son **datos de muestra** y quedan
> marcadores `[•]` (datos que completa la empresa) y `[VALIDAR]` (puntos para jurídica).

---

## 1. Estructura

```
1clic-web/
├── datos-empresa.ini          ★ Teléfonos, correos, NIT, horarios, oficina, redes y mensajes de WhatsApp (se edita aquí)
├── index.html                 Landing: hero, cobertura, planes, cómo funciona, beneficios, soporte, FAQ, contacto, Internet Sano
├── 404.html
├── legal/                     11 páginas legales (protección de usuarios, PQR, datos, términos, cookies,
│                              Internet Sano, control parental, neutralidad, indicadores, seguridad, normatividad)
├── assets/
│   ├── css/styles.css         Único CSS (tokens de marca, componentes, impresión)
│   ├── js/config.js           Configuración: endpoints, proveedores y banderas (los datos de la empresa los escribe aplicar_datos.py)
│   ├── js/app.js              Navegación, planes, formularios, cookies, analítica, estado del servicio
│   ├── js/coverage.js         Buscador y mapa de cobertura (punto en polígono propio, búsqueda difusa)
│   ├── fonts/                 Poppins 600/700, Inter 400/500/600, JetBrains Mono 500/700 (woff2 latino) + licencias OFL
│   ├── img/                   Logos SVG optimizados, íconos (icons.svg), favicons, og-image 1200×630
│   └── vendor/leaflet/        Leaflet 1.9.4 (verificado contra el hash del registro npm) + LICENSE
├── data/
│   ├── planes.json            Planes y tarifas (MUESTRA)
│   ├── localidades.json       14 localidades del corredor (código, tramo, centro, estado general)
│   ├── cobertura.geojson      Áreas de cobertura (MUESTRA, metadata.es_muestra = true)
│   ├── indicadores.json       Indicadores de calidad (vacío: "en proceso de medición")
│   └── estado-servicio.json   Incidentes y mantenimientos (vacío)
├── docs/                      PDF: política de datos v1.0 (impresa desde la página) y 2 marcadores de contrato
├── tools/
│   ├── aplicar_datos.py       Copia datos-empresa.ini a config.js, a las 13 páginas y al JSON-LD
│   ├── build_coverage.py      Pipeline: inventario de cajas NAP → cobertura.geojson (+ tabla sin JS)
│   ├── servidor_local.py      Vista previa local con los encabezados de seguridad de _headers
│   └── sincronizar_layout.py  Copia el encabezado y el pie de index.html a las demás páginas
├── _headers                   CSP, HSTS y demás encabezados (Cloudflare Pages)
├── robots.txt · sitemap.xml · site.webmanifest · favicon.ico
└── README.md
```

---

## 2. Vista previa local

```bash
python3 tools/servidor_local.py          # http://127.0.0.1:8080
```

Aplica las mismas cabeceras de `_headers` (CSP incluida), comprime con gzip, responde la `404.html` y aplica
`datos-empresa.ini` cada vez que lo guardas (basta con recargar el navegador).
Las rutas del sitio son absolutas (`/assets/...`), por eso **no** funciona abriendo los archivos con doble clic.

---

## 3. Datos de la empresa (`datos-empresa.ini`) y configuración (`assets/js/config.js`)

**Teléfonos, correos, NIT, Registro TIC, domicilio, dirección, horarios, oficina principal, puntos de atención,
redes sociales y mensajes de WhatsApp se editan en un solo archivo: `datos-empresa.ini`** (formato `clave = valor`,
sin comillas; vacío = pendiente `[•]`). Para publicarlos en el sitio:

```bash
python3 tools/aplicar_datos.py               # aplica y muestra qué archivos cambió
python3 tools/aplicar_datos.py --comprobar   # solo revisa (código 1 si falta aplicar)
```

El programa valida lo escrito (celular de 10 dígitos, línea 01 8000, correos, direcciones https) y, si todo está
bien, reescribe el bloque "DATOS DE LA EMPRESA" de `config.js`, los enlaces `wa.me`, `tel:` y `mailto:`, los textos
visibles (también la versión sin JavaScript) y el JSON-LD de la organización y de las preguntas frecuentes. Si hay
un error, no cambia nada y dice qué línea corregir. Con `tools/servidor_local.py` abierto se aplica solo al recargar.

**Teléfonos:** `principal` se usa para WhatsApp, llamadas y la línea de atención; `whatsapp`, `celular` y
`linea_atencion` solo se llenan si alguno debe ser distinto. La línea se anuncia como "línea de atención" y solo se
anuncia como "línea gratuita · Línea nacional sin costo" si `linea_atencion` es un número 01 8000. La tarjeta
"Celular" se oculta si repite el número de la línea.

Cómo encuentra cada dato en el HTML: atributos `data-wa` (WhatsApp), `data-contacto="linea|celular"`,
`data-correo="soporte|pqr|datosPersonales|empresas"` y `data-config="ruta"` (NIT, horarios, oficina, nombre de la
línea…). Si agregas un
teléfono o correo nuevo a una página, ponle su atributo para que el programa lo mantenga al día.

El resto de `config.js` (endpoints, proveedores, banderas) se edita directamente. Es un archivo **público**: nunca
pongas claves privadas.

| Bloque | Qué controla |
|---|---|
| `empresa` | Razón social, NIT, Registro TIC, domicilio y dirección (pie y páginas legales) |
| `contacto` | WhatsApp, línea gratuita, celular, correos, horarios, oficina principal, puntos de atención, redes (null = oculta) |
| `whatsapp` | Mensajes prellenados por contexto |
| `endpoints` | `leads`, `pqr`, `pqrStatus` (null = no configurado; ver sección 6) |
| `antispam`, `turnstile` | Tiempo mínimo de llenado (3 s) y Cloudflare Turnstile opcional |
| `map` | Teselas y atribución, vista inicial, rutas de Leaflet |
| `geocoder` | Geocodificación de direcciones (desactivada) |
| `analytics` | Proveedor (Plausible, Matomo o GA4; desactivado) y precisión de coordenadas |
| `cookies` | Versión del consentimiento (subirla obliga a preguntar de nuevo) y vigencia |
| `legal` | `borrador` (aviso de revisión jurídica), versión y vigencia de la política de datos |
| `flags` | Barra de estado del servicio y JSON-LD de ofertas |

### Otros marcadores `[•]`

Los `[•]` que no son datos de contacto (router, medios de pago, planes, textos legales) se completan en su archivo.
Para ver qué falta:

```bash
grep -rn "XXXX\|\[•\]" --include=*.html --include=*.js --include=*.json .
```

---

## 4. Datos (`data/`)

**`planes.json`** · `metadata.es_muestra: true` muestra el aviso "Planes y precios de ejemplo…" y **no** publica
JSON-LD de ofertas. Con precios aprobados ponlo en `false`: el sitio publica un `Offer` por plan (`priceCurrency: COP`).
Campos por plan: `id, segmento (hogar|negocio|empresas), nombre, bajada_mbps, subida_mbps, precio_mensual,
iva_incluido, promocion {precio, meses, desde, hasta, condiciones}, permanencia {aplica, meses, detalle},
instalacion {valor, detalle}, consumo, incluye[], localidades ("todas" o códigos), destacado, condiciones_url`.
Fuera de su vigencia (`desde`–`hasta`) la promoción se oculta sola.

**`localidades.json`** · 14 localidades con `codigo, nombre, nombre_completo, tipo, tramo (T1|T2), departamento,
centro [lat, lon], zoom, estado_general`. `build_coverage.py` actualiza `estado_general`.

**`indicadores.json`** · Mientras `indicadores` esté vacío, la página dice "Indicadores en proceso de medición…".
Solo se publican filas completas. Formato (ejemplo de estructura, **no es un dato**):

```json
{ "indicador": "Nombre del indicador", "descripcion": "Qué mide", "periodo": "2027-T1",
  "valor": 0, "unidad": "%", "meta_regulatoria": null, "fuente": "Sistema de medición",
  "fecha_publicacion": "2027-04-15" }
```

**`estado-servicio.json`** · Lo actualiza el centro de operación de red. Un incidente activo muestra la barra
superior y la lista por tramo en Soporte (caché de 0 s):

```json
{ "id": "INC-2026-0042", "tramo": "T2", "municipios": ["DAB", "MUT"],
  "titulo": "Falla en la red entre Dabeiba y Mutatá",
  "descripcion": "La cuadrilla ya está en sitio. Te avisamos al restablecer.",
  "estado": "activo", "inicio": "2026-11-04T14:20:00-05:00",
  "fin_estimado": "2026-11-04T17:20:00-05:00", "actualizado": "2026-11-04T14:35:00-05:00" }
```

Al resolverlo: `"estado": "resuelto"` (o retíralo). `mantenimientos` usa el mismo formato.

---

## 5. Cobertura: `tools/build_coverage.py`

Requisitos: Python 3.11+, `pip install pandas geopandas shapely h3`.

```bash
python tools/build_coverage.py --demo                                    # datos de MUESTRA
python tools/build_coverage.py --inventario red/inventario_nap.csv \
       --fuente "Inventario NOC 2026-11"                                  # datos reales
python tools/build_coverage.py --inventario red/inventario_nap.csv --poligonos red/barrios.gpkg
python tools/build_coverage.py --inventario red/inventario_nap.csv --modo h3
```

- **Entrada:** CSV `nap_id, lat, lon, municipio, sector, estado, fecha_estimada, hp` (coma o punto y coma; decimales con
  punto o coma; estados con o sin tildes). Las filas inválidas se descartan con un reporte por línea.
- **Proceso:** zona de influencia de `--radio-m` (150 m) por caja NAP, disuelta por sector y estado y recortada con el
  polígono del barrio o vereda; alternativa en celdas H3 resolución 9. Resuelve solapes (un punto = un sector).
- **Privacidad:** nunca exporta cajas NAP, direcciones ni hogares; elimina áreas o celdas con menos de 5 hogares pasados.
- **Optimización:** simplificación de 8 m, `make_valid`, 5 decimales y presupuesto de 250 KB por tramo (si se supera,
  divide en `cobertura-T1/T2.geojson` y el sitio los une solo).
- **Salidas:** `data/cobertura.geojson`, `estado_general` en `localidades.json` y la tabla sin JavaScript de
  `index.html` (entre los comentarios `COBERTURA-RESPALDO`). Reporte en consola con hogares pasados por municipio
  (**dato interno: no se publica**).

Con datos reales (`es_muestra: false`) desaparece el aviso "Mapa de demostración".

---

## 6. Backend (contratos de los endpoints)

El sitio no guarda nada: envía a los endpoints de `CONFIG.endpoints`. Si un endpoint está en otro dominio, agrégalo a
`connect-src` en `_headers` y responde CORS (`Access-Control-Allow-Origin: https://1clic.company`).
**Valida todo de nuevo en el servidor** (el front es solo ayuda) y aplica límite de peticiones.

**`POST leads`** (JSON) → `2xx { "radicado": "..." }` (opcional; el sitio lo muestra)
```json
{ "nombre": "", "celular": "3001234567", "correo": null, "municipio": "APT", "municipio_nombre": "Apartadó",
  "barrio": "", "direccion": null, "segmento": "hogar|negocio|empresa", "plan": "hogar-300", "mensaje": null,
  "ubicacion": { "lat": 7.884900, "lon": -76.622700, "fuente": "geolocalizacion_navegador" },
  "consentimiento": { "tratamiento_datos": true, "texto": "Autorizo a 1 CLIC S.A.S. …", "politica_version": "1.0",
                      "politica_vigente_desde": "2026-10-22", "politica_url": "…", "fecha_hora": "ISO-8601" },
  "comunicaciones_comerciales": { "aceptado": false, "canales": ["whatsapp", "llamada", "correo"], "fecha_hora": null },
  "origen": "contacto | plan:hogar-300 | cobertura:sin_cobertura …", "utm": { "utm_source": "…" },
  "pagina": "/", "turnstile_token": "…", "enviado_en": "ISO-8601" }
```
Guarda `consentimiento` como prueba de la autorización (Ley 1581 de 2012). Sin endpoint, el formulario arma el
mensaje y lo envía por WhatsApp.

**`POST pqr`** (multipart/form-data) → `2xx { "cun": "..." }`
Campos: `tipo, cun_previo, nombre, tipo_documento, documento, celular, correo, municipio, contrato, direccion,
descripcion, adjuntos` (0–3 archivos PDF/JPG/PNG ≤ 5 MB), `consentimiento` (JSON), `canal`, `enviado_en`,
`turnstile_token`. El CUN lo asigna el sistema de PQR conforme al procedimiento regulatorio. Sin endpoint, el sitio
ofrece enviar la PQR por correo o WhatsApp y avisa que el CUN llegará por correo o SMS.

**`GET pqrStatus?cun=...`** → `200 { "cun", "estado", "tipo", "fecha_radicacion", "fecha_limite_respuesta",
"ultima_actualizacion", "detalle" }` · `404` si no existe. Sin endpoint, la sección muestra los canales.

---

## 7. Analítica, embudo y KPI

Desactivada por defecto. Se carga **solo** si la persona acepta "Analítica" en el banner de cookies.
Activar: `analytics.enabled = true`, `analytics.provider = 'plausible' | 'matomo' | 'ga4'` y sus datos, y la CSP (sección 8).

Eventos (sin nombres, teléfonos, correos ni coordenadas exactas; las coordenadas van a 3 decimales ≈ 110 m):

| Evento | Propiedades |
|---|---|
| `coverage_search` | municipio, metodo (selector · mapa · ubicacion), tramo |
| `coverage_result` | estado, municipio, tramo, metodo, lat/lon redondeadas (solo mapa o ubicación) |
| `plan_view` · `plan_cta` | plan_id (y municipio en el CTA) |
| `whatsapp_click` | origen (pie, soporte, plan, cobertura, formulario…) |
| `lead_submit` | segmento, municipio, origen |
| `pqr_open` | origen |

**Embudo por municipio y tramo:** búsqueda de cobertura → resultado positivo (`disponible`) → vista de plan → clic en
"Lo quiero" → solicitud enviada. KPI sugeridos: tasa de resultado positivo, conversión búsqueda → solicitud, solicitudes
por plan y por segmento.

**Demanda sin cobertura (expansión):** `coverage_result` con estado `sin_cobertura` o `proximamente` agregado por celda
H3 resolución 7 a partir de las coordenadas redondeadas, más los preregistros (`origen` = `cobertura:*`). Cruzado con
los hogares pasados planeados por municipio del plan de dimensionamiento (dato interno, nunca publicado), permite
priorizar sectores por "búsquedas sin cobertura por cada 1.000 hogares pasados".

---

## 8. Seguridad y CSP

`_headers` define: CSP estricta (`script-src 'self'`, `style-src 'self'`, sin `unsafe-inline`), HSTS, `nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (geolocalización solo propia; cámara y
micrófono desactivados), `X-Frame-Options: DENY` y COOP.

- **JSON-LD:** los `<script type="application/ld+json">` son bloques de datos que el navegador no ejecuta, por eso
  `script-src` no los evalúa y no necesitan hash ni `'unsafe-inline'`. El JSON-LD de ofertas lo agrega `app.js`.
- **Sin estilos en línea:** ni en el HTML ni en el JS (Leaflet cambia estilos por CSSOM, que la CSP permite).
- **Sin `innerHTML` con datos:** todo el contenido dinámico se crea con `createElement`/`textContent`.

Al activar servicios, agrega a la línea `Content-Security-Policy`:

| Servicio | Directivas |
|---|---|
| Endpoints en otro dominio | `connect-src https://api.1clic.company` (ejemplo) |
| Teselas comerciales | `img-src https://api.maptiler.com` (o el dominio del proveedor) |
| Plausible | `script-src https://plausible.io` · `connect-src https://plausible.io` |
| Matomo propio | `script-src`, `connect-src` e `img-src https://analitica.1clic.company` |
| GA4 | `script-src https://www.googletagmanager.com` · `connect-src https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com` · `img-src https://*.google-analytics.com https://www.googletagmanager.com` |
| Turnstile | `script-src https://challenges.cloudflare.com` · cambia `frame-src 'none'` por `frame-src https://challenges.cloudflare.com` |
| Geocodificador Nominatim | `connect-src https://nominatim.openstreetmap.org` |

Verifica con `python3 tools/servidor_local.py` y la consola del navegador (no debe haber "Refused to…").

---

## 9. Publicación (Cloudflare Pages)

1. **Carpeta a publicar sin archivos de mantenimiento** (no tienen secretos, pero no hace falta servirlos):
   ```bash
   rsync -a --delete --exclude tools --exclude README.md --exclude datos-empresa.ini --exclude .DS_Store ./ ../1clic-web-dist/
   npx wrangler pages deploy ../1clic-web-dist --project-name 1clic-web
   ```
   Con Git: proyecto Pages conectado al repositorio, sin comando de compilación y con esta carpeta como salida
   (`_headers` agrega `noindex` a `tools/` y `README.md` si se publican).
2. **Dominio:** agrega `1clic.company` (y redirige `www`). HTTPS automático.
3. **Comprueba los encabezados:** `curl -sI https://1clic.company/ | grep -i -E "content-security|strict-transport|x-content|referrer|permissions"`.
4. **HSTS preload** solo cuando todos los subdominios usen HTTPS: agrega `preload` y regístralo en hstspreload.org.
5. **Google Search Console:** verifica el dominio y envía `https://1clic.company/sitemap.xml`.

Otro hosting estático: replica `_headers` en su configuración y sirve `404.html` para rutas inexistentes.

---

## 10. Mantenimiento

| Tarea | Cómo |
|---|---|
| Cambiar teléfonos, correos, NIT, horarios u oficinas | Edita `datos-empresa.ini` y ejecuta `python3 tools/aplicar_datos.py` |
| Cambiar encabezado o pie | Edítalo en `index.html` y ejecuta `python3 tools/sincronizar_layout.py` (`--comprobar` para revisar) |
| Cambiar CSS o JS | Sube la versión `?v=` en los HTML: `grep -rl "?v=1.0.0" --include=*.html . \| xargs sed -i '' 's/?v=1.0.0/?v=1.0.1/g'` (en Linux, `sed -i` sin `''`) |
| Aprobar textos legales | `CONFIG.legal.borrador = false`, borra los `<p … data-legal-borrador>` del HTML y quita los `[VALIDAR]` aprobados |
| Actualizar una página legal | Cambia "Última actualización" y el `lastmod` de `sitemap.xml` |
| Regenerar el PDF de la política | Abre `/legal/tratamiento-datos.html` en Chrome → Imprimir → Guardar como PDF, tamaño Carta (los estilos de impresión ocultan menú y pie) → `docs/politica-tratamiento-datos-v1.0.pdf` (sube la versión si cambia el texto) |
| Contratos | Reemplaza los 2 PDF marcadores de `docs/` por los modelos aprobados (mismos nombres) |
| Cobertura | `build_coverage.py` con el inventario nuevo; publica `data/` e `index.html` |
| Planes | Edita `data/planes.json` (caché de 5 min) |
| Fallas | Edita `data/estado-servicio.json` (sin caché) |

**Calidad antes de publicar:** Lighthouse móvil ≥ 90 en las 4 categorías, sin errores ni violaciones CSP en consola,
`npx html-validate` sin errores y revisión con lector de pantalla (VoiceOver o NVDA) del buscador, el menú y los formularios.

---

## 11. Marca y licencias

- Activos del manual de identidad v2.0. Los SVG se optimizaron sin cambiar la forma (diferencia de píxeles solo en
  bordes). La versión **Inverso** se derivó del maestro Color cambiando Morado por Blanco (regla del manual: cohete
  Coral, palabra y descriptor en blanco); reemplázala por el archivo oficial `1clic_Horizontal_Inverso.svg` si existe.
- Logo del encabezado a 50 px de alto (mínimo del manual para la versión con descriptor); bajo 360 px, versión sin descriptor.
- Leaflet 1.9.4: BSD-2-Clause (`assets/vendor/leaflet/LICENSE`). Fuentes: SIL Open Font License 1.1 (`assets/fonts/OFL-*.txt`).
- Mapa base y coordenadas de referencia de la muestra: © colaboradores de OpenStreetMap (ODbL). Los servidores de
  teselas de OpenStreetMap no son para uso comercial intensivo: en producción usa MapTiler, Stadia Maps o CARTO.
# 1CLICMEDELLIN
