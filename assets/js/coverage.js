/**
 * 1clic · coverage.js
 * -----------------------------------------------------------------------------
 * Buscador y mapa de cobertura (sección #cobertura de index.html).
 *    1. Normalización de texto y búsqueda difusa: ignora tildes y mayúsculas,
 *       expande abreviaturas ("B/" = Barrio, "Vda." = Vereda) y tolera errores
 *       de digitación con distancia de Levenshtein ≤ 2.
 *    2. Geometría: punto en polígono propio (ray casting) con MultiPolygon,
 *       huecos y prefiltro por bounding box. Sin Turf.
 *    3. Datos: localidades.json y cobertura.geojson (o sus partes por tramo).
 *    4. Buscador accesible (combobox ARIA) que funciona aunque el mapa no cargue.
 *    5. Resultado en una tarjeta con aria-live.
 *    6. Mapa Leaflet diferido (IntersectionObserver), capas por tramo, clic = consulta.
 *    7. "Usar mi ubicación": el permiso se pide solo al pulsar el botón.
 *    8. Tabla accesible municipio → sector → estado.
 *    9. Geocodificador opcional (desactivado): normalizador de direcciones
 *       colombianas, límite de peticiones y caché. Nunca bloquea la búsqueda por barrio.
 *   10. Buscador rápido del hero y parámetro ?municipio= de la URL.
 *   11. Medición de demanda (solo con consentimiento y sin datos personales).
 *
 * Depende de app.js (window.OneClic). Leaflet 1.9.4 está auto-alojado y solo se
 * descarga cuando la sección se acerca a la pantalla.
 */
(function () {
  'use strict';

  const APP = window.OneClic;
  const seccion = document.getElementById('cobertura');
  if (!APP || !seccion) return;

  const { CFG, el, icono, fmt, track } = APP;
  const doc = document;
  const $ = (sel, raiz = doc) => raiz.querySelector(sel);

  const form = $('#form-cobertura');
  const selectMunicipio = $('#cob-municipio');
  const inputBarrio = $('#cob-barrio');
  const lista = $('#cob-sugerencias');
  const botonUbicacion = $('#cob-ubicacion');
  const resultado = $('#cob-resultado');
  const contenedorMapa = $('#mapa');

  /** Estados de cobertura: etiqueta, estilo del mapa y prioridad (0 = mejor). */
  const ESTADOS = {
    disponible: { etiqueta: 'Disponible', icono: 'i-check-circulo', prioridad: 0, color: '#0E7A3E', relleno: '#0E7A3E', opacidad: 0.35, guiones: null },
    en_construccion: { etiqueta: 'En construcción', icono: 'i-instalacion', prioridad: 1, color: '#A15C00', relleno: '#A15C00', opacidad: 0.25, guiones: '8 6' },
    proximamente: { etiqueta: 'Próximamente', icono: 'i-calendario', prioridad: 2, color: '#432485', relleno: '#C9C0E6', opacidad: 0.6, guiones: '2 6' },
    sin_cobertura: { etiqueta: 'Sin cobertura confirmada', icono: 'i-info', prioridad: 3 }
  };
  const NOMBRE_TRAMO = { T1: 'Tramo 1 · Occidente', T2: 'Tramo 2 · Troncal Urabá' };

  /** Estado interno del componente. */
  const E = {
    localidades: [],
    porCodigo: {},
    features: [],
    meta: {},
    seleccion: null,          // sugerencia elegida en el combobox
    ultimaUbicacion: null,    // { lat, lon } del clic en el mapa o de la geolocalización
    mapa: null,
    marcador: null,
    cargaCobertura: null,
    cargaLeaflet: null,
    iniciandoMapa: false
  };

  /* ===========================================================================
     1. NORMALIZACIÓN Y BÚSQUEDA DIFUSA
     =========================================================================== */
  const ABREVIATURAS = [
    [/\bb\s*\/\s*/g, 'barrio '],                       // "B/ Centro"
    [/\b(?:brr|bri|bo)\b\.?/g, 'barrio'],
    [/\b(?:vda|vrda)\b\.?/g, 'vereda'],
    [/\burb\b\.?/g, 'urbanizacion'],
    [/\b(?:sect|sec|sct)\b\.?/g, 'sector'],
    [/\b(?:corr|cgto|correg)\b\.?/g, 'corregimiento'],
    [/\bc\s*\.\s*p\b\.?/g, 'centro poblado'],
    [/\bsta\b\.?/g, 'santa'],
    [/\bsto\b\.?/g, 'santo'],
    [/\bsn\b\.?/g, 'san'],
    [/\bkm\b\.?/g, 'kilometro']
  ];
  const TIPOS = ['centro poblado', 'corregimiento', 'urbanizacion', 'barrio', 'vereda', 'sector'];

  /** "Vda. El Llano" → "vereda el llano" · "B/ Churidó" → "barrio churido" */
  function normalizar(texto) {
    let t = String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    t = t.replace(/[^a-z0-9/.\s-]/g, ' ');
    for (const [patron, reemplazo] of ABREVIATURAS) t = t.replace(patron, reemplazo);
    return t.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /** Quita el tipo inicial para comparar el nombre: "barrio centro" → "centro". */
  function sinTipo(texto) {
    for (const tipo of TIPOS) {
      if (texto.startsWith(tipo + ' ')) return texto.slice(tipo.length + 1);
    }
    return texto;
  }

  /** Distancia de Levenshtein con corte temprano cuando supera "maximo". */
  function levenshtein(a, b, maximo) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > maximo) return maximo + 1;
    let previa = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const actual = [i];
      let minimoFila = i;
      for (let j = 1; j <= b.length; j++) {
        const costo = a[i - 1] === b[j - 1] ? 0 : 1;
        actual[j] = Math.min(previa[j] + 1, actual[j - 1] + 1, previa[j - 1] + costo);
        if (actual[j] < minimoFila) minimoFila = actual[j];
      }
      if (minimoFila > maximo) return maximo + 1;
      previa = actual;
    }
    return previa[b.length];
  }

  /**
   * Puntaje de coincidencia (menor = mejor; null = no coincide):
   * 0 exacta · 1 prefijo · 2 contiene · 3-5 Levenshtein ≤ 2 · 6-8 por palabras.
   */
  function puntaje(consulta, feature) {
    const q = consulta;
    const qBase = sinTipo(q);
    if (!qBase) return null;
    const { _norm: c, _base: base } = feature;
    if (c === q || base === qBase) return 0;
    if (base.startsWith(qBase) || c.startsWith(q)) return 1;
    if (qBase.length >= 3 && base.includes(qBase)) return 2;
    if (qBase.length < 4) return null;                  // evita coincidencias difusas con textos muy cortos
    const distancia = levenshtein(qBase, base, 2);
    if (distancia <= 2) return 3 + distancia;
    const palabrasC = base.split(' ');
    let total = 0;
    for (const pq of qBase.split(' ')) {
      let mejor = 3;
      for (const pc of palabrasC) {
        if (pq.length >= 3 && pc.startsWith(pq)) {
          mejor = 0;
          break;
        }
        const tolerancia = pq.length >= 6 ? 2 : pq.length >= 4 ? 1 : 0;
        const d = levenshtein(pq, pc, tolerancia);
        if (d <= tolerancia && d < mejor) mejor = d;
      }
      if (mejor > 2) return null;
      total += mejor;
    }
    return total <= 2 ? 6 + total : null;
  }

  /** Sugerencias ordenadas por coincidencia, estado y nombre. */
  function sugerencias(texto, municipio, maximo = 8) {
    const q = normalizar(texto);
    if (q.length < 2) return [];
    return E.features
      .filter((f) => !municipio || f.properties.municipio === municipio)
      .map((f) => ({ f, p: puntaje(q, f) }))
      .filter((x) => x.p !== null)
      .sort((a, b) => a.p - b.p ||
        ESTADOS[a.f.properties.estado].prioridad - ESTADOS[b.f.properties.estado].prioridad ||
        a.f.properties.sector.localeCompare(b.f.properties.sector, 'es'))
      .slice(0, maximo);
  }

  /* ===========================================================================
     2. GEOMETRÍA: PUNTO EN POLÍGONO (ray casting, coordenadas GeoJSON [lon, lat])
     =========================================================================== */
  function enAnillo(x, y, anillo) {
    let dentro = false;
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
      const xi = anillo[i][0];
      const yi = anillo[i][1];
      const xj = anillo[j][0];
      const yj = anillo[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
  }

  /** Dentro del anillo exterior y fuera de todos los huecos. */
  function enPoligono(x, y, anillos) {
    if (!anillos.length || !enAnillo(x, y, anillos[0])) return false;
    for (let k = 1; k < anillos.length; k++) {
      if (enAnillo(x, y, anillos[k])) return false;
    }
    return true;
  }

  function enGeometria(x, y, geometria) {
    if (geometria.type === 'Polygon') return enPoligono(x, y, geometria.coordinates);
    if (geometria.type === 'MultiPolygon') return geometria.coordinates.some((p) => enPoligono(x, y, p));
    return false;
  }

  /** Bounding box [minLon, minLat, maxLon, maxLat] para descartar rápido. */
  function cajaDe(geometria) {
    const caja = [Infinity, Infinity, -Infinity, -Infinity];
    (function recorrer(c) {
      if (typeof c[0] === 'number') {
        if (c[0] < caja[0]) caja[0] = c[0];
        if (c[1] < caja[1]) caja[1] = c[1];
        if (c[0] > caja[2]) caja[2] = c[0];
        if (c[1] > caja[3]) caja[3] = c[1];
      } else {
        c.forEach(recorrer);
      }
    })(geometria.coordinates);
    return caja;
  }

  /** Sector que contiene el punto; si hay varios, el de mejor estado. */
  function buscarPunto(lat, lon) {
    let mejor = null;
    for (const f of E.features) {
      const b = f._caja;
      if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
      if (!enGeometria(lon, lat, f.geometry)) continue;
      if (!mejor || ESTADOS[f.properties.estado].prioridad < ESTADOS[mejor.properties.estado].prioridad) mejor = f;
    }
    return mejor;
  }

  function distanciaKm(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad;
    const dLon = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  }

  /** Localidad más cercana a un punto (máximo 20 km); null si está fuera del corredor. */
  function municipioCercano(lat, lon) {
    let mejor = null;
    let distancia = 20;
    for (const l of E.localidades) {
      const d = distanciaKm([lat, lon], l.centro);
      if (d < distancia) {
        distancia = d;
        mejor = l.codigo;
      }
    }
    return mejor;
  }

  /* ===========================================================================
     3. DATOS
     =========================================================================== */
  function featureValida(f) {
    return f && f.type === 'Feature' && f.geometry && /^(Multi)?Polygon$/.test(f.geometry.type) &&
      f.properties && f.properties.municipio && f.properties.sector && ESTADOS[f.properties.estado];
  }

  async function cargarLocalidades() {
    if (E.localidades.length) return E.localidades;
    const datos = await APP.datosJSON('localidades');
    if (!Array.isArray(datos) || !datos.length) throw new Error('localidades.json vacío');
    E.localidades = datos.filter((l) => l && l.codigo && l.nombre && Array.isArray(l.centro));
    E.porCodigo = Object.fromEntries(E.localidades.map((l) => [l.codigo, l]));
    return E.localidades;
  }

  /** Carga cobertura.geojson; si trae metadata.partes, une los archivos por tramo. */
  function cargarCobertura() {
    if (!E.cargaCobertura) {
      E.cargaCobertura = (async () => {
        const url = CFG.datos.cobertura;
        const principal = await APP.cargarJSON(url);
        let features = Array.isArray(principal.features) ? principal.features : [];
        const partes = principal.metadata && Array.isArray(principal.metadata.partes) ? principal.metadata.partes : [];
        if (partes.length) {
          const carpeta = url.replace(/[^/]*$/, '');
          const lotes = await Promise.all(partes.map((p) => APP.cargarJSON(carpeta + p.archivo).then((fc) => fc.features || [])));
          features = features.concat(...lotes);
        }
        await cargarLocalidades().catch(() => []);
        E.meta = principal.metadata || {};
        E.features = features.filter(featureValida).map((f) => {
          const norm = normalizar(f.properties.sector);
          return Object.assign(f, { _norm: norm, _base: sinTipo(norm), _caja: cajaDe(f.geometry) });
        });
        const aviso = $('#cobertura-muestra');
        if (aviso) aviso.hidden = !E.meta.es_muestra;
        pintarTabla();
        return E.features;
      })().catch((error) => {
        E.cargaCobertura = null;
        throw error;
      });
    }
    return E.cargaCobertura;
  }

  /** El selector se arma desde localidades.json (el HTML trae la misma lista como respaldo). */
  function sincronizarSelectores() {
    ['#cob-municipio', '#hero-municipio'].forEach((selector) => {
      const select = $(selector);
      if (!select || !E.localidades.length) return;
      const valor = select.value;
      const grupos = Object.entries(NOMBRE_TRAMO).map(([tramo, etiqueta]) => {
        const opciones = E.localidades.filter((l) => l.tramo === tramo)
          .map((l) => el('option', { value: l.codigo }, l.nombre_completo || l.nombre));
        return opciones.length ? el('optgroup', { label: etiqueta }, ...opciones) : null;
      }).filter(Boolean);
      select.replaceChildren(el('option', { value: '' }, 'Elige tu municipio'), ...grupos);
      select.value = valor;
    });
  }

  const nombreMunicipio = (codigo) => (E.porCodigo[codigo] && E.porCodigo[codigo].nombre) || codigo || '';

  /* ===========================================================================
     4. BUSCADOR ACCESIBLE (combobox con lista de sugerencias)
     =========================================================================== */
  let opciones = [];
  let activa = -1;
  let temporizador = null;

  const estadoSugerencias = el('p', { class: 'sr-only', role: 'status', id: 'cob-sugerencias-estado' });
  if (lista) lista.after(estadoSugerencias);

  function cerrarLista() {
    if (!lista) return;
    lista.hidden = true;
    lista.replaceChildren();
    inputBarrio.setAttribute('aria-expanded', 'false');
    inputBarrio.removeAttribute('aria-activedescendant');
    opciones = [];
    activa = -1;
  }

  function marcarActiva(indice) {
    activa = indice;
    Array.from(lista.children).forEach((li, i) => li.setAttribute('aria-selected', String(i === indice)));
    if (indice >= 0) {
      const opcion = lista.children[indice];
      inputBarrio.setAttribute('aria-activedescendant', opcion.id);
      opcion.scrollIntoView({ block: 'nearest' });
    } else {
      inputBarrio.removeAttribute('aria-activedescendant');
    }
  }

  function elegir(feature) {
    inputBarrio.value = feature.properties.sector;
    E.seleccion = feature;
    if (selectMunicipio.value !== feature.properties.municipio) selectMunicipio.value = feature.properties.municipio;
    cerrarLista();
  }

  async function actualizarSugerencias() {
    const texto = inputBarrio.value;
    if (E.seleccion && texto !== E.seleccion.properties.sector) E.seleccion = null;
    if (normalizar(texto).length < 2) {
      cerrarLista();
      estadoSugerencias.textContent = '';
      return;
    }
    try {
      await cargarCobertura();
    } catch (e) {
      cerrarLista();
      return;
    }
    const encontradas = sugerencias(texto, selectMunicipio.value);
    opciones = encontradas.map((x) => x.f);
    activa = -1;
    lista.replaceChildren(...opciones.map((f, i) => {
      const p = f.properties;
      const li = el('li', { class: 'combobox-opcion', role: 'option', id: 'cob-opcion-' + i, 'aria-selected': 'false' },
        el('span', null, p.sector),
        el('small', null, `${nombreMunicipio(p.municipio)} · ${ESTADOS[p.estado].etiqueta}`));
      li.addEventListener('mousedown', (e) => e.preventDefault());   // conserva el foco en el campo
      li.addEventListener('click', () => elegir(f));
      return li;
    }));
    const hay = opciones.length > 0;
    lista.hidden = !hay;
    inputBarrio.setAttribute('aria-expanded', String(hay));
    inputBarrio.removeAttribute('aria-activedescendant');
    estadoSugerencias.textContent = hay
      ? `${opciones.length} ${opciones.length === 1 ? 'sugerencia' : 'sugerencias'}. Usa las flechas para elegir.`
      : 'Sin sugerencias para ese nombre.';
  }

  function iniciarBuscador() {
    if (!form || !selectMunicipio || !inputBarrio) return;
    form.noValidate = true;

    inputBarrio.addEventListener('input', () => {
      clearTimeout(temporizador);
      temporizador = setTimeout(actualizarSugerencias, 120);
    });
    inputBarrio.addEventListener('focus', () => cargarCobertura().catch(() => {}), { once: true });
    inputBarrio.addEventListener('keydown', (e) => {
      const abierta = !lista.hidden && opciones.length;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!abierta) actualizarSugerencias();
        else marcarActiva((activa + 1) % opciones.length);
      } else if (e.key === 'ArrowUp' && abierta) {
        e.preventDefault();
        marcarActiva(activa <= 0 ? opciones.length - 1 : activa - 1);
      } else if (e.key === 'Enter' && abierta && activa >= 0) {
        e.preventDefault();
        elegir(opciones[activa]);
      } else if (e.key === 'Escape') {
        if (abierta) {
          e.preventDefault();
          cerrarLista();
        } else if (inputBarrio.value) {
          inputBarrio.value = '';
          E.seleccion = null;
        }
      }
    });
    inputBarrio.addEventListener('blur', () => setTimeout(cerrarLista, 150));
    selectMunicipio.addEventListener('change', () => {
      E.seleccion = null;
      const error = $('#cob-municipio-error');
      if (error) error.textContent = '';
      selectMunicipio.removeAttribute('aria-invalid');
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      cerrarLista();
      consultar();
    });

    // Geolocalización: solo en contexto seguro (HTTPS) y si el navegador la ofrece.
    if (botonUbicacion && 'geolocation' in navigator && window.isSecureContext) {
      botonUbicacion.hidden = false;
      botonUbicacion.addEventListener('click', usarUbicacion);
    }
    // Campo de dirección: solo si el geocodificador está activado en config.js.
    const campoDireccion = $('#cob-campo-direccion');
    if (campoDireccion && CFG.geocoder && CFG.geocoder.enabled) campoDireccion.hidden = false;
  }

  /** Consulta desde el formulario: dirección (si hay geocodificador) → barrio → municipio. */
  async function consultar() {
    const municipio = selectMunicipio.value;
    const barrio = inputBarrio.value.trim();
    const errorMunicipio = $('#cob-municipio-error');
    if (!municipio && !barrio) {
      selectMunicipio.setAttribute('aria-invalid', 'true');
      if (errorMunicipio) errorMunicipio.textContent = 'Elige tu municipio o escribe tu barrio o vereda.';
      selectMunicipio.focus();
      return;
    }
    selectMunicipio.removeAttribute('aria-invalid');
    if (errorMunicipio) errorMunicipio.textContent = '';

    mostrarCargando('Consultando la cobertura…');
    try {
      await cargarCobertura();
    } catch (e) {
      mostrarError();
      return;
    }
    APP.estado.municipio = municipio || null;
    track('coverage_search', { municipio, metodo: 'selector', tramo: E.porCodigo[municipio] && E.porCodigo[municipio].tramo });

    // 1) Dirección con geocodificador (opcional). Si falla, sigue con el barrio.
    const direccion = $('#cob-direccion');
    if (geocodificador && direccion && direccion.value.trim() && municipio) {
      try {
        const punto = await geocodificador.buscar(direccion.value, nombreMunicipio(municipio));
        if (punto) {
          consultarPunto(punto.lat, punto.lon, 'direccion');
          return;
        }
      } catch (e) {
        /* sin geocodificación: se usa el barrio */
      }
    }

    // 2) Barrio, vereda o sector
    if (barrio) {
      const elegida = E.seleccion && E.seleccion.properties.sector === barrio ? E.seleccion : null;
      const mejor = elegida || (sugerencias(barrio, municipio, 1)[0] || {}).f;
      if (mejor) {
        if (!municipio) selectMunicipio.value = mejor.properties.municipio;
        mostrarResultado({ feature: mejor, metodo: 'selector', consulta: barrio });
        enfocarMapa(mejor);
      } else {
        mostrarResultado({ estado: 'sin_cobertura', municipio, barrio, metodo: 'selector' });
        enfocarMapa(null, municipio);
      }
      return;
    }

    // 3) Solo municipio: resumen por estado
    mostrarResumenMunicipio(municipio);
    enfocarMapa(null, municipio);
  }

  /** Consulta por coordenada (clic en el mapa, ubicación o dirección geocodificada). */
  function consultarPunto(lat, lon, metodo) {
    const feature = buscarPunto(lat, lon);
    const municipio = feature ? feature.properties.municipio : municipioCercano(lat, lon);
    E.ultimaUbicacion = { lat, lon };
    if (municipio && selectMunicipio.value !== municipio) selectMunicipio.value = municipio;
    APP.estado.municipio = municipio || null;
    if (metodo !== 'direccion') {
      track('coverage_search', { municipio, metodo, tramo: E.porCodigo[municipio] && E.porCodigo[municipio].tramo });
    }
    marcarPunto(lat, lon);
    mostrarResultado(feature
      ? { feature, metodo, lat, lon }
      : { estado: 'sin_cobertura', municipio, metodo, lat, lon });
  }

  /* ===========================================================================
     5. RESULTADO (tarjeta con aria-live en #cob-resultado)
     =========================================================================== */
  function mostrarCargando(texto) {
    resultado.replaceChildren(el('p', { class: 'resultado-detalle' }, texto));
  }

  function mostrarError() {
    resultado.replaceChildren(el('div', { class: 'resultado-tarjeta', 'data-estado': 'sin_cobertura' },
      el('p', { class: 'resultado-estado' }, icono('i-alerta'), 'Sin conexión con los datos'),
      el('h3', { class: 'resultado-titulo' }, 'No pudimos cargar los datos de cobertura.'),
      el('p', { class: 'resultado-detalle' }, 'Consulta tu dirección por ', APP.enlaceWA('WhatsApp', 'general', 'cobertura-error'),
        ` o en la ${APP.nombreLinea()} `, APP.enlaceLinea(), '.')));
  }

  function botonPreregistro(texto, datos) {
    return el('button', {
      class: 'btn btn-primario', type: 'button',
      onclick: () => APP.prefillLead(datos)
    }, texto);
  }

  function botonWhatsApp(mensaje, origen) {
    return el('a', { class: 'btn btn-secundario', href: APP.enlaceWhatsApp(mensaje), rel: 'noopener noreferrer', dataset: { origen } },
      icono('i-chat'), 'Escribir por WhatsApp');
  }

  function botonVerPlanes(municipio) {
    return el('button', {
      class: 'btn btn-primario', type: 'button',
      onclick: () => {
        APP.filtrarPlanes(municipio);
        const planes = $('#planes');
        const pestana = planes && planes.querySelector('[role="tab"][aria-selected="true"]');
        APP.irA(planes, pestana && !pestana.closest('[hidden]') ? pestana : null);
      }
    }, 'Ver planes disponibles');
  }

  function tarjeta(estado, titulo, detalles, acciones) {
    const e = ESTADOS[estado] || ESTADOS.sin_cobertura;
    return el('div', { class: 'resultado-tarjeta', 'data-estado': estado },
      el('p', { class: 'resultado-estado' }, icono(e.icono), e.etiqueta),
      el('h3', { class: 'resultado-titulo' }, titulo),
      ...detalles,
      E.meta.es_muestra ? el('p', { class: 'resultado-muestra' }, 'Dato de demostración: no representa cobertura real.') : null,
      acciones.length ? el('div', { class: 'resultado-acciones' }, ...acciones) : null);
  }

  /**
   * Mensajes por estado (sección 8.1 del encargo):
   * disponible → planes + WhatsApp · en_construccion → avísame · proximamente y sin cobertura → preregistro.
   */
  function mostrarResultado({ feature, estado, municipio, barrio, metodo, lat, lon, consulta }) {
    const p = feature ? feature.properties : null;
    const est = p ? p.estado : estado;
    const codigo = p ? p.municipio : municipio;
    const nombre = nombreMunicipio(codigo);
    const sector = p ? p.sector : barrio;
    const coords = Number.isFinite(lat) && Number.isFinite(lon) ? { lat: +lat.toFixed(6), lon: +lon.toFixed(6) } : {};
    const detalles = [];
    if (p && consulta && normalizar(consulta) !== p._norm) {
      detalles.push(el('p', { class: 'resultado-detalle' }, `Resultado para «${p.sector}», el nombre más parecido a «${consulta}».`));
    }
    let tarjetaFinal;

    if (est === 'disponible') {
      detalles.push(el('p', { class: 'resultado-detalle' },
        `Tecnología: ${p.tecnologia || 'FTTH GPON'} · Datos actualizados el ${fmt.fecha(p.actualizado)}.`));
      tarjetaFinal = tarjeta('disponible', `¡Hay cobertura en ${sector}, ${nombre}!`, detalles, [
        botonVerPlanes(codigo),
        botonWhatsApp(`Hola 1clic, consulté la cobertura en ${sector}, ${nombre}, y quiero contratar el servicio.`, 'cobertura')
      ]);
    } else if (est === 'en_construccion') {
      detalles.push(el('p', { class: 'resultado-detalle' },
        p.fecha_estimada ? `Fecha estimada: ${fmt.mesAnio(p.fecha_estimada)}. Sector: ${sector}, ${nombre}.` : `Sector: ${sector}, ${nombre}.`));
      tarjetaFinal = tarjeta('en_construccion', 'Estamos construyendo la red en tu zona.', detalles, [
        botonPreregistro('Avísame cuando esté lista', {
          municipio: codigo, barrio: sector, origen: 'cobertura:en_construccion', ...coords,
          mensaje: `Quiero que me avisen cuando la red esté lista en ${sector}, ${nombre}.`
        })
      ]);
    } else if (est === 'proximamente') {
      detalles.push(el('p', { class: 'resultado-detalle' }, `Sector: ${sector}, ${nombre}.`));
      tarjetaFinal = tarjeta('proximamente', 'Tu zona está en nuestro plan de expansión.', detalles, [
        botonPreregistro('Preregístrate', { municipio: codigo, barrio: sector, origen: 'cobertura:proximamente', ...coords })
      ]);
    } else {
      const lugar = [sector, nombre].filter(Boolean).join(', ');
      if (lugar) detalles.push(el('p', { class: 'resultado-detalle' }, `Consulta: ${lugar}.`));
      detalles.push(el('p', { class: 'resultado-detalle' },
        'Déjanos tus datos: así medimos la demanda para planear la expansión y te avisamos cuando lleguemos.'));
      tarjetaFinal = tarjeta('sin_cobertura', 'Aún no tenemos cobertura confirmada en ese punto.', detalles, [
        botonPreregistro('Preregístrate', { municipio: codigo || '', barrio: sector || '', origen: 'cobertura:sin_cobertura', ...coords })
      ]);
    }
    resultado.replaceChildren(tarjetaFinal);

    const conCoordenadas = metodo === 'mapa' || metodo === 'ubicacion' || metodo === 'direccion';
    track('coverage_result', {
      estado: est, municipio: codigo, metodo,
      tramo: E.porCodigo[codigo] && E.porCodigo[codigo].tramo,
      lat: conCoordenadas ? lat : undefined, lon: conCoordenadas ? lon : undefined
    });
  }

  /** Solo municipio: estado general y sectores agrupados por estado. */
  function mostrarResumenMunicipio(codigo) {
    const nombre = nombreMunicipio(codigo);
    const sectores = E.features.filter((f) => f.properties.municipio === codigo);
    const porEstado = {};
    sectores.forEach((f) => (porEstado[f.properties.estado] = porEstado[f.properties.estado] || []).push(f.properties));
    const mejor = Object.keys(ESTADOS).find((e) => porEstado[e]) || 'proximamente';
    const detalles = [];
    if (sectores.length) {
      detalles.push(el('ul', { class: 'resultado-lista' }, ...Object.keys(ESTADOS).filter((e) => porEstado[e]).map((e) =>
        el('li', null, el('strong', null, ESTADOS[e].etiqueta + ': '),
          porEstado[e].map((p) => p.sector + (e === 'en_construccion' && p.fecha_estimada ? ` (${fmt.mesAnio(p.fecha_estimada)})` : '')).join(', ')))));
    }
    detalles.push(el('p', { class: 'resultado-detalle' }, 'Escribe tu barrio o vereda, toca el mapa o usa tu ubicación para confirmar tu punto exacto.'));
    const titulos = {
      disponible: `En ${nombre} ya hay cobertura en algunos sectores.`,
      en_construccion: `Estamos construyendo la red en ${nombre}.`,
      proximamente: `${nombre} está en nuestro plan de expansión.`
    };
    const acciones = mejor === 'disponible'
      ? [botonVerPlanes(codigo), botonWhatsApp(`Hola 1clic, quiero saber si hay cobertura en mi dirección en ${nombre}.`, 'cobertura')]
      : [botonPreregistro('Preregístrate', { municipio: codigo, origen: 'cobertura:' + mejor })];
    resultado.replaceChildren(tarjeta(mejor, titulos[mejor], detalles, acciones));
    track('coverage_result', { estado: mejor, municipio: codigo, metodo: 'selector', tramo: E.porCodigo[codigo] && E.porCodigo[codigo].tramo });
  }

  /* ===========================================================================
     6. MAPA LEAFLET DIFERIDO
     =========================================================================== */
  /** Inserta leaflet.css ANTES de styles.css para que los ajustes de marca prevalezcan. */
  function cargarLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (!E.cargaLeaflet) {
      E.cargaLeaflet = new Promise((resolver, rechazar) => {
        const { js, css } = CFG.map.leaflet;
        const hoja = el('link', { rel: 'stylesheet', href: css });
        const propia = doc.querySelector('link[rel="stylesheet"][href*="styles.css"]');
        if (propia) propia.before(hoja);
        else doc.head.append(hoja);
        const script = el('script', { src: js, async: true });
        script.addEventListener('load', () => (window.L ? resolver(window.L) : rechazar(new Error('Leaflet no disponible'))));
        script.addEventListener('error', () => rechazar(new Error('No se pudo cargar Leaflet')));
        doc.head.append(script);
      }).catch((error) => {
        E.cargaLeaflet = null;
        throw error;
      });
    }
    return E.cargaLeaflet;
  }

  function estilo(feature) {
    const e = ESTADOS[feature.properties.estado] || ESTADOS.proximamente;
    return { color: e.color, weight: 2, opacity: 0.95, dashArray: e.guiones, fillColor: e.relleno, fillOpacity: e.opacidad };
  }

  const animar = () => !APP.menosMovimiento();

  async function iniciarMapa() {
    if (E.mapa || E.iniciandoMapa || !contenedorMapa) return;
    E.iniciandoMapa = true;
    try {
      const [L] = await Promise.all([cargarLeaflet(), cargarCobertura()]);
      contenedorMapa.replaceChildren();
      const vista = CFG.map.vistaInicial || { centro: [7.35, -76.2], zoom: 8 };
      const mapa = L.map(contenedorMapa, { scrollWheelZoom: false, zoomSnap: 0.5 }).setView(vista.centro, vista.zoom);
      L.tileLayer(CFG.map.tiles.url, {
        attribution: CFG.map.tiles.attribution,
        maxZoom: CFG.map.tiles.maxZoom || 19,
        referrerPolicy: 'strict-origin-when-cross-origin'
      }).addTo(mapa);

      // Capas por tramo (control de capas). Los textos se crean como nodos: sin innerHTML con datos.
      const capas = {};
      const porTramo = {};
      E.features.forEach((f) => (porTramo[f.properties.tramo || 'T?'] = porTramo[f.properties.tramo || 'T?'] || []).push(f));
      Object.keys(porTramo).sort().forEach((tramo) => {
        const capa = L.geoJSON({ type: 'FeatureCollection', features: porTramo[tramo] }, {
          style: estilo,
          onEachFeature: (f, capaSector) => capaSector.bindTooltip(
            el('span', null, `${f.properties.sector} · ${ESTADOS[f.properties.estado].etiqueta}`), { sticky: true })
        }).addTo(mapa);
        capas[NOMBRE_TRAMO[tramo] || tramo] = capa;
      });
      L.control.layers(null, capas, { collapsed: window.matchMedia('(max-width: 767.98px)').matches }).addTo(mapa);
      L.control.scale({ imperial: false }).addTo(mapa);

      // La rueda del ratón solo hace zoom cuando el mapa tiene el foco (no "secuestra" el scroll).
      mapa.on('focus', () => mapa.scrollWheelZoom.enable());
      mapa.on('blur', () => mapa.scrollWheelZoom.disable());
      mapa.on('click', (ev) => consultarPunto(ev.latlng.lat, ev.latlng.lng, 'mapa'));
      E.mapa = mapa;

      // Si ya hay una consulta hecha, el mapa la muestra.
      if (E.ultimaUbicacion) marcarPunto(E.ultimaUbicacion.lat, E.ultimaUbicacion.lon, true);
      else if (selectMunicipio.value) enfocarMapa(E.seleccion, selectMunicipio.value);
    } catch (error) {
      contenedorMapa.replaceChildren(el('p', { class: 'mapa-espera' }, icono('i-alerta'),
        'No pudimos cargar el mapa. Usa el buscador o consulta la tabla de cobertura.'));
    } finally {
      E.iniciandoMapa = false;
    }
  }

  function enfocarMapa(feature, codigo) {
    if (!E.mapa || !window.L) return;
    if (feature) {
      const capa = window.L.geoJSON(feature);
      E.mapa.fitBounds(capa.getBounds(), { padding: [32, 32], maxZoom: 16, animate: animar() });
    } else if (codigo && E.porCodigo[codigo]) {
      const l = E.porCodigo[codigo];
      E.mapa.setView(l.centro, l.zoom || 14, { animate: animar() });
    }
  }

  function marcarPunto(lat, lon, centrar) {
    if (!E.mapa || !window.L) return;
    if (!E.marcador) {
      E.marcador = window.L.circleMarker([lat, lon], { radius: 9, color: '#FFFFFF', weight: 3, fillColor: '#F75B4D', fillOpacity: 1 }).addTo(E.mapa);
    } else {
      E.marcador.setLatLng([lat, lon]);
    }
    if (centrar) E.mapa.setView([lat, lon], Math.max(E.mapa.getZoom(), 15), { animate: animar() });
  }

  /**
   * Carga diferida: Leaflet y el GeoJSON solo cuando el mapa entra en pantalla, y
   * nunca antes del evento "load" (no compite con el primer pintado ni con el LCP).
   */
  function observarSeccion() {
    if (!contenedorMapa) return;
    const observar = () => {
      if (!('IntersectionObserver' in window)) {
        iniciarMapa();
        return;
      }
      const observador = new IntersectionObserver((entradas) => {
        if (entradas.some((e) => e.isIntersecting)) {
          observador.disconnect();
          iniciarMapa();
        }
      }, { rootMargin: '0px 0px 120px 0px' });
      observador.observe(contenedorMapa);
    };
    if (doc.readyState === 'complete') observar();
    else window.addEventListener('load', observar, { once: true });
  }

  /* ===========================================================================
     7. USAR MI UBICACIÓN (permiso solo al pulsar)
     =========================================================================== */
  function usarUbicacion() {
    botonUbicacion.disabled = true;
    botonUbicacion.setAttribute('aria-busy', 'true');
    mostrarCargando('Buscando tu ubicación…');
    const terminar = () => {
      botonUbicacion.disabled = false;
      botonUbicacion.removeAttribute('aria-busy');
    };
    navigator.geolocation.getCurrentPosition(async (posicion) => {
      try {
        await cargarCobertura();
      } catch (e) {
        terminar();
        mostrarError();
        return;
      }
      const { latitude: lat, longitude: lon } = posicion.coords;
      consultarPunto(lat, lon, 'ubicacion');
      if (E.mapa) marcarPunto(lat, lon, true);
      else iniciarMapa();
      terminar();
    }, (error) => {
      terminar();
      const motivos = {
        1: 'no diste permiso para usar tu ubicación',
        2: 'tu dispositivo no pudo determinar la ubicación',
        3: 'se agotó el tiempo de espera'
      };
      resultado.replaceChildren(el('p', { class: 'aviso aviso-info' }, icono('i-info'),
        el('span', null, `No pudimos usar tu ubicación: ${motivos[error.code] || 'error desconocido'}. Puedes buscar por municipio y barrio o tocar el mapa.`)));
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }

  /* ===========================================================================
     8. TABLA ACCESIBLE: municipio → sectores → estado
     =========================================================================== */
  function pintarTabla() {
    const detalles = $('#cobertura-tabla-js');
    const contenedor = $('[data-cobertura-tabla]');
    if (!detalles || !contenedor || !E.localidades.length) return;
    const leyenda = ['Cobertura por municipio y sector'];
    if (E.meta.es_muestra) leyenda.push('Datos de demostración: ilustrativos, no representan cobertura real');
    if (E.meta.generado) leyenda.push('actualizado el ' + fmt.fecha(E.meta.generado));
    const cuerpos = E.localidades.map((l) => {
      const sectores = E.features.filter((f) => f.properties.municipio === l.codigo).map((f) => f.properties)
        .sort((a, b) => ESTADOS[a.estado].prioridad - ESTADOS[b.estado].prioridad || a.sector.localeCompare(b.sector, 'es'));
      const encabezado = (filas) => el('th', { scope: 'rowgroup', rowspan: String(filas) },
        l.nombre_completo || l.nombre, el('span', { class: 'tabla-tramo' }, l.tramo));
      if (!sectores.length) {
        return el('tbody', null, el('tr', null, encabezado(1), el('td', null, 'Sin sectores publicados'),
          el('td', null, el('span', { class: 'estado-pastilla estado-proximamente' }, ESTADOS.proximamente.etiqueta))));
      }
      return el('tbody', null, ...sectores.map((p, i) => el('tr', null,
        i === 0 ? encabezado(sectores.length) : null,
        el('td', null, p.sector),
        el('td', null, el('span', { class: 'estado-pastilla estado-' + p.estado },
          ESTADOS[p.estado].etiqueta + (p.estado === 'en_construccion' && p.fecha_estimada ? ` (fecha estimada: ${fmt.mesAnio(p.fecha_estimada)})` : ''))))));
    });
    contenedor.replaceChildren(el('table', { class: 'tabla tabla-cobertura' },
      el('caption', null, leyenda.join(' · ')),
      el('thead', null, el('tr', null, ...['Municipio', 'Sector', 'Estado'].map((t) => el('th', { scope: 'col' }, t)))),
      ...cuerpos));
    detalles.hidden = false;
  }

  /* ===========================================================================
     9. GEOCODIFICADOR OPCIONAL (CONFIG.geocoder.enabled = false por defecto)
     =========================================================================== */
  const VIAS = [
    [/\b(?:calle|clle|cll|cl)\b\.?/g, 'Calle'],
    [/\b(?:carrera|carr|cra|kra|kr|cr)\b\.?/g, 'Carrera'],
    [/\b(?:diagonal|diag|dg)\b\.?/g, 'Diagonal'],
    [/\b(?:transversal|transv|trans|trv|tv|tr)\b\.?/g, 'Transversal'],
    [/\b(?:avenida|avda|av)\b\.?/g, 'Avenida'],
    [/\b(?:circular|circ|cir)\b\.?/g, 'Circular'],
    [/\b(?:autopista|autop|aut)\b\.?/g, 'Autopista']
  ];

  /** "cl 45 #12-30" → "Calle 45 # 12 - 30" · "Cra. 8 No. 3-14" → "Carrera 8 # 3 - 14" */
  function normalizarDireccion(texto) {
    let t = String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    t = t.replace(/\b(?:no|nro|num|numero)\b\.?\s*(?=\d)/g, '# ').replace(/n\s*[°º]\s*/g, '# ');
    for (const [patron, via] of VIAS) t = t.replace(patron, via);
    return t.replace(/\s*#\s*/g, ' # ').replace(/(\d+[a-z]?)\s*-\s*(\d+)/g, '$1 - $2').replace(/\s+/g, ' ').trim();
  }

  function crearGeocodificador(cfg) {
    const cache = new Map();
    let ultima = 0;
    let cola = Promise.resolve();

    async function consultarServicio(consulta) {
      if (cache.has(consulta)) return cache.get(consulta);
      const espera = Math.max(0, ultima + (cfg.rateLimitMs || 1100) - Date.now());   // límite de peticiones
      if (espera) await new Promise((r) => setTimeout(r, espera));
      ultima = Date.now();
      let punto = null;
      if (cfg.provider === 'nominatim') {
        const params = new URLSearchParams({ q: consulta, format: 'jsonv2', limit: '1', countrycodes: 'co', 'accept-language': 'es' });
        if (cfg.email) params.set('email', cfg.email);
        const datos = await APP.cargarJSON(cfg.url + '?' + params, { timeout: cfg.timeoutMs });
        if (Array.isArray(datos) && datos[0]) punto = { lat: +datos[0].lat, lon: +datos[0].lon };
      } else {
        const datos = await APP.cargarJSON(cfg.url + (cfg.url.includes('?') ? '&' : '?') + new URLSearchParams({ q: consulta }), { timeout: cfg.timeoutMs });
        if (datos && Number.isFinite(+datos.lat) && Number.isFinite(+datos.lon)) punto = { lat: +datos.lat, lon: +datos.lon };
      }
      cache.set(consulta, punto);
      if (cache.size > (cfg.cacheMax || 50)) cache.delete(cache.keys().next().value);   // caché acotada
      return punto;
    }

    return {
      /** Una consulta a la vez (cola) para respetar el límite del proveedor. */
      buscar(direccion, municipio) {
        const consulta = `${normalizarDireccion(direccion)}, ${municipio}, Antioquia, Colombia`;
        const tarea = cola.then(() => consultarServicio(consulta));
        cola = tarea.catch(() => null);
        return tarea;
      }
    };
  }

  const geocodificador = CFG.geocoder && CFG.geocoder.enabled && CFG.geocoder.url ? crearGeocodificador(CFG.geocoder) : null;

  /* ===========================================================================
     10. BUSCADOR DEL HERO Y PARÁMETROS DE LA URL
     =========================================================================== */
  function iniciarHero() {
    const formHero = $('[data-hero-buscador]');
    if (!formHero) return;
    formHero.addEventListener('submit', (e) => {
      const valor = $('#hero-municipio', formHero).value;
      if (!valor) return;                 // la validación nativa (required) muestra el aviso
      e.preventDefault();
      selectMunicipio.value = valor;
      inputBarrio.value = '';
      E.seleccion = null;
      APP.irA(seccion, inputBarrio);
      consultar();
    });
  }

  /** /?municipio=APT#cobertura (llega del hero sin JS o de un enlace compartido). */
  function procesarUrl() {
    const params = new URLSearchParams(location.search);
    const municipio = (params.get('municipio') || '').toUpperCase();
    const barrio = (params.get('barrio') || '').slice(0, 80);
    if (!municipio && !barrio) return;
    cargarLocalidades().then(() => {
      if (municipio && E.porCodigo[municipio]) selectMunicipio.value = municipio;
      if (barrio) inputBarrio.value = barrio;
      if (selectMunicipio.value || barrio) consultar();
    }).catch(() => {});
  }

  /* ===========================================================================
     11. INICIO
     =========================================================================== */
  iniciarBuscador();
  iniciarHero();
  cargarLocalidades().then(sincronizarSelectores).catch(() => {});
  observarSeccion();
  procesarUrl();

  // Para pruebas automatizadas y depuración (sin datos personales).
  window.OneClicCobertura = Object.freeze({ normalizar, levenshtein, puntaje, enGeometria, buscarPunto, normalizarDireccion, sugerencias });
})();
