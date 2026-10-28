/**
 * 1clic · app.js
 * -----------------------------------------------------------------------------
 * Mejora progresiva del sitio estático. Todo el contenido ya viene en el HTML;
 * este archivo solo agrega comportamiento:
 *    1. Utilidades: DOM seguro, formatos es-CO, JSON con tiempo límite, almacenamiento.
 *    2. Datos de contacto desde config.js.
 *    3. Navegación: menú móvil accesible y desplegable "Legal".
 *    4. Aviso de borrador legal (bandera CONFIG.legal.borrador).
 *    5. Analítica (Plausible, Matomo o GA4) solo con consentimiento.
 *    6. Consentimiento de cookies: banner y preferencias.
 *    7. Estado del servicio: barra superior y bloque en Soporte.
 *    8. Planes: pestañas, tarjetas, tablas legales y JSON-LD de ofertas.
 *    9. Formularios: validación, contacto/preregistro, PQR y consulta por CUN.
 *   10. Indicadores de calidad.
 *   11. Detalles: anclas a <details>, tablas desplazables y eventos.
 *   12. API pública window.OneClic (la usa coverage.js).
 *
 * Reglas: sin dependencias; nunca innerHTML con datos externos (todo se crea con
 * createElement/textContent); la analítica nunca recibe datos personales.
 */
(function () {
  'use strict';

  const CFG = window.CONFIG || {};
  const doc = document;

  /* ===========================================================================
     1. UTILIDADES
     =========================================================================== */
  const $ = (sel, raiz = doc) => raiz.querySelector(sel);
  const $$ = (sel, raiz = doc) => Array.from(raiz.querySelectorAll(sel));
  const leerRuta = (obj, ruta) => ruta.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** Agrega hijos (nodos o texto) a un nodo. Ignora null, undefined, false y ''. */
  function agregar(nodo, hijos) {
    for (const hijo of [hijos].flat(Infinity)) {
      if (hijo === null || hijo === undefined || hijo === false || hijo === '') continue;
      nodo.append(hijo instanceof Node ? hijo : doc.createTextNode(String(hijo)));
    }
    return nodo;
  }

  /**
   * Crea un elemento sin innerHTML: el('a', { href, class }, 'texto', otroNodo).
   * Atributos especiales: class, text, dataset y on<evento> (función).
   */
  function el(tag, attrs, ...hijos) {
    const nodo = doc.createElement(tag);
    for (const [clave, valor] of Object.entries(attrs || {})) {
      if (valor === null || valor === undefined || valor === false) continue;
      if (clave === 'class') nodo.className = valor;
      else if (clave === 'text') nodo.textContent = valor;
      else if (clave === 'dataset') Object.assign(nodo.dataset, valor);
      else if (clave.startsWith('on') && typeof valor === 'function') nodo.addEventListener(clave.slice(2), valor);
      else nodo.setAttribute(clave, valor === true ? '' : String(valor));
    }
    return agregar(nodo, hijos);
  }

  /** Ícono del sprite /assets/img/icons.svg (decorativo: aria-hidden). */
  function icono(nombre, clase = 'icon') {
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', clase);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = doc.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '/assets/img/icons.svg#' + nombre);
    svg.append(use);
    return svg;
  }

  /* ---- Fechas y formatos es-CO: $89.900/mes · 99,9 % · 220.800 · 14:20 · 300 Mbps ---- */
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MESES_CORTOS = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sep.', 'oct.', 'nov.', 'dic.'];
  const SOLO_FECHA = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;
  const PARTES_BOGOTA = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
  });

  /** "2026-12-31" se lee como fecha local (no UTC) para no correr un día. */
  function parseFecha(valor) {
    if (!valor) return null;
    if (valor instanceof Date) return valor;
    const m = SOLO_FECHA.exec(valor);
    const d = m ? new Date(+m[1], +m[2] - 1, m[3] ? +m[3] : 1) : new Date(valor);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /** Partes de una fecha u hora en la zona horaria de Colombia. */
  function enBogota(valor) {
    const d = parseFecha(valor);
    if (!d) return null;
    if (typeof valor === 'string' && SOLO_FECHA.test(valor)) {
      return { anio: d.getFullYear(), mes: d.getMonth(), dia: d.getDate(), hora: 0, minuto: 0 };
    }
    const p = Object.fromEntries(PARTES_BOGOTA.formatToParts(d).map((x) => [x.type, x.value]));
    return { anio: +p.year, mes: +p.month - 1, dia: +p.day, hora: +p.hour % 24, minuto: +p.minute };
  }

  const dosDigitos = (n) => String(n).padStart(2, '0');

  const fmt = {
    /** Punto de miles y coma decimal: 220.800 · 99,9 */
    numero(n, decimales) {
      const valor = Number(n);
      const texto = typeof decimales === 'number' ? Math.abs(valor).toFixed(decimales) : String(Math.round(Math.abs(valor) * 100) / 100);
      const [entero, dec] = texto.split('.');
      return (valor < 0 ? '-' : '') + entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (dec ? ',' + dec : '');
    },
    moneda: (n) => '$' + fmt.numero(Math.round(n)),
    mensual: (n) => fmt.moneda(n) + '/mes',
    porcentaje: (n, decimales = 1) => fmt.numero(n, decimales) + ' %',
    velocidad: (mbps) => (mbps >= 1000 && mbps % 1000 === 0 ? fmt.numero(mbps / 1000) + ' Gbps' : fmt.numero(mbps) + ' Mbps'),
    /** 4 nov. 2026 */
    fecha(valor) {
      const p = enBogota(valor);
      return p ? `${p.dia} ${MESES_CORTOS[p.mes]} ${p.anio}` : '';
    },
    /** 4 de noviembre de 2026 */
    fechaLarga(valor) {
      const p = enBogota(valor);
      return p ? `${p.dia} de ${MESES[p.mes]} de ${p.anio}` : '';
    },
    /** noviembre de 2026 */
    mesAnio(valor) {
      const p = enBogota(valor);
      return p ? `${MESES[p.mes]} de ${p.anio}` : '';
    },
    /** 14:20 (24 h, hora de Colombia) */
    hora(valor) {
      const p = enBogota(valor);
      return p ? `${dosDigitos(p.hora)}:${dosDigitos(p.minuto)}` : '';
    },
    /** 3 h 20 min · 45 min */
    duracion(minutos) {
      const total = Math.max(0, Math.round(minutos));
      const h = Math.floor(total / 60);
      const m = total % 60;
      if (h && m) return `${h} h ${m} min`;
      return h ? `${h} h` : `${m} min`;
    }
  };

  /* ---- Datos JSON ---- */
  /** fetch con tiempo límite; falla si la respuesta no es 2xx o no es JSON. */
  async function cargarJSON(url, opciones = {}) {
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), opciones.timeout || 10000);
    try {
      const respuesta = await fetch(url, {
        signal: control.signal,
        cache: opciones.cache || 'default',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      if (!respuesta.ok) throw new Error('HTTP ' + respuesta.status + ' en ' + url);
      return await respuesta.json();
    } finally {
      clearTimeout(temporizador);
    }
  }

  /** Carga compartida de data/*.json (app.js y coverage.js reciben la misma promesa). */
  const memoriaDatos = new Map();
  function datosJSON(nombre, opciones) {
    const url = leerRuta(CFG, 'datos.' + nombre);
    if (!url) return Promise.reject(new Error('Ruta no configurada: datos.' + nombre));
    if (!memoriaDatos.has(url)) {
      memoriaDatos.set(url, cargarJSON(url, opciones).catch((error) => {
        memoriaDatos.delete(url);
        throw error;
      }));
    }
    return memoriaDatos.get(url);
  }

  /** Código de municipio → nombre (si localidades.json no carga, se usan los códigos). */
  let promesaNombres = null;
  function nombresMunicipios() {
    if (!promesaNombres) {
      promesaNombres = datosJSON('localidades')
        .then((lista) => Object.fromEntries((Array.isArray(lista) ? lista : []).map((l) => [l.codigo, l.nombre])))
        .catch(() => ({}));
    }
    return promesaNombres;
  }

  /* ---- Almacenamiento: puede no existir (navegación privada, bloqueos); nunca rompe el sitio ---- */
  function almacen(tipo) {
    return {
      leer(clave) {
        try {
          const valor = window[tipo].getItem(clave);
          return valor ? JSON.parse(valor) : null;
        } catch (e) {
          return null;
        }
      },
      guardar(clave, valor) {
        try {
          window[tipo].setItem(clave, JSON.stringify(valor));
          return true;
        } catch (e) {
          return false;
        }
      },
      borrar(clave) {
        try {
          window[tipo].removeItem(clave);
        } catch (e) {
          /* sin almacenamiento disponible */
        }
      }
    };
  }
  const local = almacen('localStorage');
  const sesion = almacen('sessionStorage');

  /* ---- Enlaces de contacto ---- */
  const correo = (clave) => leerRuta(CFG, 'contacto.correos.' + clave) || '';
  const mensajeWA = (clave) => leerRuta(CFG, 'whatsapp.' + clave) || leerRuta(CFG, 'whatsapp.general') || '';

  function enlaceWhatsApp(mensaje) {
    const numero = String(leerRuta(CFG, 'contacto.whatsapp.numero') || '').replace(/[^\dX]/gi, '');
    return 'https://wa.me/' + numero + (mensaje ? '?text=' + encodeURIComponent(mensaje) : '');
  }

  function enlaceWA(texto, clave, origen, mensaje) {
    return el('a', { href: enlaceWhatsApp(mensaje || mensajeWA(clave)), rel: 'noopener noreferrer', dataset: { origen: origen || 'enlace' } }, texto);
  }

  /** "línea de atención" o, si es una 01 8000, "línea gratuita" (lo decide aplicar_datos.py). */
  const nombreLinea = () => leerRuta(CFG, 'contacto.linea.nombre') || 'línea de atención';

  function enlaceLinea(texto) {
    const linea = leerRuta(CFG, 'contacto.linea') || {};
    return el('a', { href: 'tel:' + String(linea.numero || '').replace(/[^\d+X]/gi, '') }, texto || linea.texto || '');
  }

  /* ---- Movimiento y desplazamiento ---- */
  const menosMovimiento = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Desplaza hasta un elemento y, si se indica, mueve el foco sin un segundo salto. */
  function irA(destino, enfocar) {
    if (!destino) return;
    destino.scrollIntoView({ behavior: menosMovimiento() ? 'auto' : 'smooth', block: 'start' });
    if (enfocar) enfocar.focus({ preventScroll: true });
  }

  /* ===========================================================================
     2. DATOS DE CONTACTO DESDE CONFIG.JS
     El HTML trae los mismos datos como respaldo sin JS; aquí se reemplazan por
     los de config.js para que haya una sola fuente al operar el sitio.
     =========================================================================== */
  const NOMBRES_REDES = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', x: 'X', youtube: 'YouTube', linkedin: 'LinkedIn' };

  function hidratarContacto() {
    // Textos: <span data-config="empresa.nit">
    $$('[data-config]').forEach((nodo) => {
      const valor = leerRuta(CFG, nodo.dataset.config);
      if (typeof valor === 'string' && valor) {
        nodo.textContent = valor;
        nodo.classList.toggle('pendiente', valor.includes('[•]'));
      }
    });

    // Teléfonos: <a data-contacto="linea"> (data-solo-href conserva el texto del botón)
    $$('[data-contacto]').forEach((a) => {
      const canal = leerRuta(CFG, 'contacto.' + a.dataset.contacto);
      if (!canal || !canal.numero) return;
      a.href = 'tel:' + String(canal.numero).replace(/[^\d+X]/gi, '');
      if (!('soloHref' in a.dataset) && canal.texto) a.textContent = canal.texto;
    });

    // Correos: <a data-correo="pqr">
    $$('[data-correo]').forEach((a) => {
      const direccion = correo(a.dataset.correo);
      if (!direccion) return;
      a.href = 'mailto:' + direccion;
      if (!a.children.length) a.textContent = direccion;
    });

    // WhatsApp con mensaje prellenado según el contexto: <a data-wa="soporte">
    $$('[data-wa]').forEach((a) => {
      a.href = enlaceWhatsApp(mensajeWA(a.dataset.wa));
    });

    // Redes sociales: solo las configuradas (URL https). Nunca enlaces a "#".
    const redes = Object.entries(leerRuta(CFG, 'contacto.redes') || {})
      .filter(([, url]) => typeof url === 'string' && /^https:\/\//.test(url));
    $$('[data-redes]').forEach((lista) => {
      lista.replaceChildren(...redes.map(([red, url]) =>
        el('li', null, el('a', { href: url, rel: 'noopener noreferrer' }, NOMBRES_REDES[red] || red))));
      lista.hidden = redes.length === 0;
    });
    $$('[data-canal-redes]').forEach((tarjeta) => { tarjeta.hidden = redes.length === 0; });

    // Puntos de atención por municipio
    const puntos = (leerRuta(CFG, 'contacto.puntosAtencion') || []).filter((p) => p && p.direccion);
    $$('[data-puntos-atencion]').forEach((lista) => {
      lista.replaceChildren(...puntos.map((p) =>
        el('li', null, el('span', null, p.municipio || ''), `${p.direccion}${p.horario ? ' · ' + p.horario : ''}`)));
      lista.hidden = puntos.length === 0;
    });
  }

  /* ===========================================================================
     3. NAVEGACIÓN
     Sin JS, "Menú" es un enlace al menú del pie. Con JS se convierte en un
     <button> que abre el panel: aria-expanded, cierre con Esc, foco atrapado.
     =========================================================================== */
  function iniciarNavegacion() {
    const encabezado = $('#encabezado');
    const enlace = $('#nav-toggle');
    const menu = $('#menu-principal');
    if (!encabezado || !enlace || !menu) return;

    const boton = el('button', {
      class: enlace.className, id: 'nav-toggle', type: 'button',
      'aria-expanded': 'false', 'aria-controls': 'menu-principal'
    });
    boton.append(...enlace.childNodes);
    enlace.replaceWith(boton);
    const textoBoton = $('.nav-toggle-texto', boton);
    const usoIcono = $('use', boton);
    const escritorio = window.matchMedia('(min-width: 1024px)');

    const abierto = () => boton.getAttribute('aria-expanded') === 'true';
    const enfocables = () => [boton, ...$$('a[href], button:not([disabled]), summary', menu)]
      .filter((n) => n.offsetParent !== null || n === boton);

    function abrir() {
      encabezado.classList.add('nav-abierto');
      doc.body.classList.add('nav-abierto');
      boton.setAttribute('aria-expanded', 'true');
      if (textoBoton) textoBoton.textContent = 'Cerrar';
      if (usoIcono) usoIcono.setAttribute('href', '/assets/img/icons.svg#i-cerrar');
      const primero = $('a[href], summary', menu);
      if (primero) primero.focus();
    }

    function cerrar(devolverFoco) {
      if (!abierto()) return;
      encabezado.classList.remove('nav-abierto');
      doc.body.classList.remove('nav-abierto');
      boton.setAttribute('aria-expanded', 'false');
      if (textoBoton) textoBoton.textContent = 'Menú';
      if (usoIcono) usoIcono.setAttribute('href', '/assets/img/icons.svg#i-menu');
      if (devolverFoco) boton.focus();
    }

    boton.addEventListener('click', () => (abierto() ? cerrar(false) : abrir()));

    encabezado.addEventListener('keydown', (e) => {
      if (!abierto()) return;
      if (e.key === 'Escape') {
        cerrar(true);
      } else if (e.key === 'Tab') {
        const lista = enfocables();
        const primero = lista[0];
        const ultimo = lista[lista.length - 1];
        if (e.shiftKey && doc.activeElement === primero) {
          e.preventDefault();
          ultimo.focus();
        } else if (!e.shiftKey && doc.activeElement === ultimo) {
          e.preventDefault();
          primero.focus();
        }
      }
    });

    // Al elegir un enlace del panel (por ejemplo, /#planes) el panel se cierra.
    menu.addEventListener('click', (e) => {
      if (e.target.closest('a[href]')) cerrar(false);
    });
    escritorio.addEventListener('change', () => cerrar(false));

    // Desplegable "Legal" (<details>): se cierra con Esc y al hacer clic afuera.
    $$('.nav-desplegable').forEach((desplegable) => {
      doc.addEventListener('click', (e) => {
        if (desplegable.open && !desplegable.contains(e.target)) desplegable.open = false;
      });
      desplegable.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && desplegable.open) {
          e.stopPropagation();
          desplegable.open = false;
          $('summary', desplegable).focus();
        }
      });
    });
  }

  /* ===========================================================================
     4. AVISO DE BORRADOR LEGAL
     Visible por defecto en el HTML (exactitud ante todo). Se oculta cuando
     jurídica apruebe los textos y CONFIG.legal.borrador = false.
     =========================================================================== */
  function avisoBorrador() {
    if (leerRuta(CFG, 'legal.borrador') === false) $$('[data-legal-borrador]').forEach((n) => n.remove());
  }

  /* ===========================================================================
     5. ANALÍTICA
     Adaptador para Plausible, Matomo o GA4. Desactivado por defecto y cargado
     SOLO si la persona acepta las cookies de analítica. Cada evento pasa por una
     lista blanca de campos: nunca nombres, teléfonos, correos ni coordenadas
     exactas (se redondean a 3 decimales, ~110 m, o no se envían).
     =========================================================================== */
  const Analitica = (() => {
    const cfg = CFG.analytics || {};
    const proveedor = cfg.enabled ? cfg.provider : null;
    let permitida = false;
    let cargada = false;

    const CAMPOS = {
      coverage_search: ['municipio', 'metodo', 'tramo'],
      coverage_result: ['estado', 'municipio', 'tramo', 'metodo', 'lat', 'lon'],
      plan_view: ['plan_id'],
      plan_cta: ['plan_id', 'municipio'],
      whatsapp_click: ['origen'],
      lead_submit: ['segmento', 'municipio', 'origen'],
      pqr_open: ['origen']
    };

    function limpiar(evento, props) {
      const salida = {};
      for (const campo of CAMPOS[evento] || []) {
        let valor = props ? props[campo] : undefined;
        if (valor === undefined || valor === null || valor === '') continue;
        if (campo === 'lat' || campo === 'lon') {
          const precision = Math.min(Number(cfg.precisionCoordenadas) || 0, 3);
          if (!precision || !Number.isFinite(Number(valor))) continue;
          valor = Number(valor).toFixed(precision);
        }
        salida[campo] = String(valor).slice(0, 64);
      }
      return salida;
    }

    function cargar() {
      if (cargada || !proveedor) return;
      if (proveedor === 'plausible' && cfg.plausible && cfg.plausible.src) {
        window.plausible = window.plausible || function () {
          (window.plausible.q = window.plausible.q || []).push(arguments);
        };
        doc.head.append(el('script', { src: cfg.plausible.src, defer: true, 'data-domain': cfg.plausible.domain }));
        window.plausible('pageview');
      } else if (proveedor === 'matomo' && cfg.matomo && cfg.matomo.url && cfg.matomo.siteId) {
        const paq = (window._paq = window._paq || []);
        paq.push(['setTrackerUrl', cfg.matomo.url + 'matomo.php'], ['setSiteId', String(cfg.matomo.siteId)],
          ['trackPageView'], ['enableLinkTracking']);
        doc.head.append(el('script', { src: cfg.matomo.url + 'matomo.js', async: true }));
      } else if (proveedor === 'ga4' && cfg.ga4 && cfg.ga4.measurementId) {
        window.dataLayer = window.dataLayer || [];
        window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
        window.gtag('js', new Date());
        window.gtag('config', cfg.ga4.measurementId, { allow_google_signals: false, allow_ad_personalization_signals: false });
        doc.head.append(el('script', { src: 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(cfg.ga4.measurementId), async: true }));
      } else {
        return;
      }
      cargada = true;
    }

    /** Si la persona retira el permiso, se borran las cookies conocidas de analítica. */
    function borrarCookies() {
      const dominio = location.hostname.replace(/^www\./, '');
      doc.cookie.split(';').map((c) => c.split('=')[0].trim()).filter((n) => /^(_ga|_gid|_pk_)/.test(n)).forEach((nombre) => {
        ['', '; domain=' + location.hostname, '; domain=.' + dominio].forEach((d) => {
          doc.cookie = `${nombre}=; Max-Age=0; path=/${d}`;
        });
      });
    }

    return {
      permitir() {
        permitida = true;
        cargar();
      },
      bloquear() {
        permitida = false;
        borrarCookies();
      },
      evento(nombre, props) {
        if (!permitida || !cargada) return;
        const datos = limpiar(nombre, props);
        try {
          if (proveedor === 'plausible') window.plausible(nombre, { props: datos });
          else if (proveedor === 'matomo') window._paq.push(['trackEvent', 'sitio', nombre, Object.entries(datos).map(([k, v]) => k + '=' + v).join(';') || undefined]);
          else if (proveedor === 'ga4') window.gtag('event', nombre, datos);
        } catch (e) {
          /* la analítica nunca debe romper el sitio */
        }
      }
    };
  })();

  const track = (nombre, props) => Analitica.evento(nombre, props);

  /** Parámetros UTM: se leen de la URL; solo se recuerdan en la sesión si hay permiso de analítica. */
  const UTM = (() => {
    const CLAVE = '1clic.utm';
    const CAMPOS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
    const params = new URLSearchParams(location.search);
    const deUrl = {};
    CAMPOS.forEach((c) => {
      const v = params.get(c);
      if (v) deUrl[c] = v.slice(0, 100);
    });
    let permitido = false;
    return {
      recordar() {
        permitido = true;
        if (Object.keys(deUrl).length) sesion.guardar(CLAVE, deUrl);
      },
      olvidar() {
        permitido = false;
        sesion.borrar(CLAVE);
      },
      obtener() {
        if (Object.keys(deUrl).length) return deUrl;
        return permitido ? sesion.leer(CLAVE) || {} : {};
      }
    };
  })();

  /* ===========================================================================
     6. CONSENTIMIENTO DE COOKIES
     Primera visita: banner con Aceptar · Rechazar (mismo estilo) · Configurar.
     Por defecto solo lo esencial. La decisión se guarda en localStorage con
     versión y fecha, y se cambia desde "Preferencias de cookies" del pie.
     =========================================================================== */
  const Consentimiento = (() => {
    const cfg = CFG.cookies || {};
    const CLAVE = cfg.storageKey || '1clic.consentimiento';
    let actual = null;
    let banner = null;
    let dialogo = null;
    let origenFoco = null;

    function vigente(c) {
      if (!c || c.version !== cfg.version || typeof c.analitica !== 'boolean') return false;
      const dias = (Date.now() - Date.parse(c.fecha)) / 864e5;
      return dias >= 0 && dias <= (cfg.vigenciaDias || 365);
    }

    function aplicar(c) {
      actual = c;
      if (c && c.analitica) {
        Analitica.permitir();
        UTM.recordar();
      } else {
        Analitica.bloquear();
        UTM.olvidar();
      }
    }

    function decidir(analitica) {
      const c = { version: cfg.version, fecha: new Date().toISOString(), analitica: Boolean(analitica) };
      local.guardar(CLAVE, c);
      aplicar(c);
      if (banner) {
        banner.remove();
        banner = null;
      }
    }

    function mostrarBanner() {
      banner = el('section', { class: 'cookies', 'aria-labelledby': 'cookies-titulo' },
        el('h2', { id: 'cookies-titulo' }, 'Tu privacidad'),
        el('p', null,
          'Usamos solo lo esencial para que el sitio funcione. Con tu permiso también usaremos analítica para mejorar el sitio, sin datos que te identifiquen. Lee la ',
          el('a', { href: '/legal/cookies.html' }, 'Política de cookies'), '.'),
        el('div', { class: 'cookies-botones' },
          el('button', { class: 'btn btn-morado', type: 'button', onclick: () => decidir(true) }, 'Aceptar'),
          el('button', { class: 'btn btn-morado', type: 'button', onclick: () => decidir(false) }, 'Rechazar'),
          el('button', { class: 'btn-texto', type: 'button', onclick: (e) => abrir(e.currentTarget) }, 'Configurar')));
      const salto = $('.skip-link');
      if (salto) salto.after(banner);
      else doc.body.prepend(banner);
    }

    function crearDialogo() {
      const casilla = el('input', { type: 'checkbox', id: 'pref-analitica' });
      const cerrarCon = (analitica) => () => {
        decidir(typeof analitica === 'boolean' ? analitica : casilla.checked);
        dialogo.close();
      };
      dialogo = el('dialog', { class: 'dialogo', 'aria-labelledby': 'pref-titulo' },
        el('div', { class: 'dialogo-contenido' },
          el('h2', { id: 'pref-titulo' }, 'Preferencias de cookies'),
          el('p', null, 'Elige qué permites. Puedes cambiarlo cuando quieras desde "Preferencias de cookies", en el pie de página.'),
          el('div', { class: 'preferencia' },
            el('label', { for: 'pref-esenciales' }, 'Esenciales'),
            el('input', { type: 'checkbox', id: 'pref-esenciales', checked: true, disabled: true }),
            el('p', null, 'Guardan tu decisión sobre cookies y recuerdan los avisos que cerraste. Siempre activas.')),
          el('div', { class: 'preferencia' },
            el('label', { for: 'pref-analitica' }, 'Analítica'),
            casilla,
            el('p', null, 'Estadísticas de uso sin datos que te identifiquen. Desactivada por defecto.')),
          el('div', { class: 'dialogo-botones' },
            el('button', { class: 'btn btn-morado', type: 'button', onclick: cerrarCon(null) }, 'Guardar preferencias'),
            el('button', { class: 'btn btn-secundario', type: 'button', onclick: cerrarCon(true) }, 'Aceptar todas'),
            el('button', { class: 'btn btn-secundario', type: 'button', onclick: cerrarCon(false) }, 'Rechazar todas'))));
      dialogo.addEventListener('close', () => {
        const destino = origenFoco && origenFoco.isConnected ? origenFoco : $('#contenido');
        if (destino) destino.focus();
      });
      doc.body.append(dialogo);
    }

    function abrir(origen) {
      origenFoco = origen || doc.activeElement;
      if (!dialogo) crearDialogo();
      $('#pref-analitica', dialogo).checked = Boolean(actual && actual.analitica);
      if (typeof dialogo.showModal === 'function') dialogo.showModal();
      else dialogo.setAttribute('open', '');
    }

    function iniciar() {
      const guardado = local.leer(CLAVE);
      if (vigente(guardado)) {
        aplicar(guardado);
      } else {
        aplicar(null);
        mostrarBanner();
      }
      // Enlace del pie y botón de la página de cookies
      $$('[data-abrir-cookies]').forEach((n) => {
        n.hidden = false;
        n.addEventListener('click', (e) => {
          e.preventDefault();
          abrir(n);
        });
      });
    }

    return { iniciar, abrir, analitica: () => Boolean(actual && actual.analitica) };
  })();

  /* ===========================================================================
     7. ESTADO DEL SERVICIO
     Lee data/estado-servicio.json. Con incidentes activos: barra bajo el
     encabezado (sin mover el contenido) y lista por tramo en Soporte, con hora
     de inicio y tiempo estimado de reparación.
     =========================================================================== */
  const TRAMOS = { T1: 'Tramo 1 · Occidente', T2: 'Tramo 2 · Troncal Urabá' };

  function tarjetaIncidente(incidente, nombres) {
    const inicio = parseFecha(incidente.inicio);
    const fin = parseFecha(incidente.fin_estimado);
    const tiempos = [];
    if (inicio) tiempos.push(`Desde las ${fmt.hora(incidente.inicio)} del ${fmt.fecha(incidente.inicio)}`);
    if (inicio && fin && fin > inicio) {
      tiempos.push(`Tiempo estimado de reparación: ${fmt.duracion((fin - inicio) / 60000)} (hasta las ${fmt.hora(incidente.fin_estimado)})`);
    } else if (fin) {
      tiempos.push(`Fin estimado: ${fmt.hora(incidente.fin_estimado)} del ${fmt.fecha(incidente.fin_estimado)}`);
    }
    const municipios = (incidente.municipios || []).map((c) => nombres[c] || c).join(', ');
    return el('article', { class: 'incidente' },
      el('p', { class: 'incidente-tramo' }, [TRAMOS[incidente.tramo] || incidente.tramo, municipios].filter(Boolean).join(' · ')),
      el('h4', null, incidente.titulo || 'Falla en la red'),
      incidente.descripcion ? el('p', null, incidente.descripcion) : null,
      tiempos.length ? el('p', { class: 'incidente-tiempos' }, ...tiempos.map((t) => el('span', null, t))) : null);
  }

  function pintarBarraEstado(barra, activos) {
    const CLAVE = '1clic.aviso-estado';
    const firma = activos.map((i) => String(i.id || i.inicio)).sort().join('|');
    if (sesion.leer(CLAVE) === firma) return;
    const tramos = [...new Set(activos.map((i) => TRAMOS[i.tramo] || i.tramo).filter(Boolean))].join(' y ');
    const texto = activos.length === 1
      ? `Hay una falla activa en ${tramos || 'la red'}.`
      : `Hay ${activos.length} fallas activas en ${tramos || 'la red'}.`;
    const cerrar = el('button', { class: 'barra-estado-cerrar', type: 'button', 'aria-label': 'Cerrar el aviso de fallas' }, icono('i-cerrar'));
    barra.replaceChildren(el('div', { class: 'container barra-estado-contenido', role: 'status' },
      icono('i-alerta'),
      el('p', null, texto + ' ', el('a', { href: '/#estado-servicio' }, 'Ver estado del servicio')),
      cerrar));
    cerrar.addEventListener('click', () => {
      barra.hidden = true;
      sesion.guardar(CLAVE, firma);
    });
    barra.hidden = false;
  }

  async function iniciarEstadoServicio() {
    if (!leerRuta(CFG, 'flags.estadoServicio')) return;
    const bloque = $('[data-estado-servicio]');
    const barra = $('#barra-estado');
    let datos;
    try {
      datos = await cargarJSON(CFG.datos.estadoServicio, { cache: 'no-cache' });
    } catch (e) {
      if (bloque) {
        bloque.replaceChildren(el('p', null, 'No pudimos consultar el estado del servicio. Si tienes una falla, repórtala por ',
          enlaceWA('WhatsApp', 'soporte', 'estado'), ` o en la ${nombreLinea()} `, enlaceLinea(), '.'));
      }
      return;
    }
    const ahora = new Date();
    const activos = (Array.isArray(datos.incidentes) ? datos.incidentes : [])
      .filter((i) => i && i.estado !== 'resuelto')
      .sort((a, b) => String(a.tramo).localeCompare(String(b.tramo)) || String(a.inicio).localeCompare(String(b.inicio)));
    const mantenimientos = (Array.isArray(datos.mantenimientos) ? datos.mantenimientos : [])
      .filter((m) => m && (!m.fin_estimado || parseFecha(m.fin_estimado) > ahora));
    const nombres = await nombresMunicipios();

    if (bloque) {
      const hijos = [];
      if (activos.length) activos.forEach((i) => hijos.push(tarjetaIncidente(i, nombres)));
      else hijos.push(el('p', { class: 'estado-ok' }, icono('i-check-circulo'), 'Sin fallas activas reportadas en la red.'));
      if (mantenimientos.length) {
        hijos.push(el('h4', null, 'Mantenimientos programados'));
        mantenimientos.forEach((m) => hijos.push(tarjetaIncidente({ titulo: 'Mantenimiento programado', ...m }, nombres)));
      }
      const actualizado = datos.metadata && datos.metadata.actualizado;
      if (actualizado) hijos.push(el('p', { class: 'estado-actualizado' }, `Actualizado: ${fmt.fecha(actualizado)}, ${fmt.hora(actualizado)}`));
      bloque.replaceChildren(...hijos);
    }
    if (barra && activos.length) pintarBarraEstado(barra, activos);
  }

  /* ===========================================================================
     8. PLANES
     Tarjetas generadas desde data/planes.json con pestañas Hogar · Negocio ·
     Empresas. Cada tarjeta muestra, sin letra pequeña: bajada/subida, precio
     mensual con o sin IVA, promoción con vigencia y precio posterior,
     permanencia, instalación, qué incluye y dónde está disponible.
     =========================================================================== */
  const SEGMENTOS = { hogar: 'Hogar', negocio: 'Negocio', empresas: 'Empresas' };
  const SEGMENTO_FORM = { hogar: 'hogar', negocio: 'negocio', empresas: 'empresa' };
  const Planes = { datos: null, nombres: {}, municipio: null };
  const estado = { municipio: null };   // municipio consultado en cobertura (lo actualiza coverage.js)

  function planValido(p) {
    if (!p || !p.id || !p.nombre || !SEGMENTOS[p.segmento]) return false;
    if (p.segmento === 'empresas') return true;
    return [p.bajada_mbps, p.subida_mbps, p.precio_mensual].every((n) => typeof n === 'number' && n > 0);
  }

  /** La promoción solo se muestra dentro de su vigencia. */
  function promocionVigente(promo, hoy = new Date()) {
    if (!promo || typeof promo.precio !== 'number') return null;
    const desde = parseFecha(promo.desde);
    const hasta = parseFecha(promo.hasta);
    if (hasta) hasta.setHours(23, 59, 59, 999);
    if ((desde && hoy < desde) || (hasta && hoy > hasta)) return null;
    return promo;
  }

  function textoVigencia(promo) {
    if (promo.desde && promo.hasta) return `del ${fmt.fecha(promo.desde)} al ${fmt.fecha(promo.hasta)}`;
    if (promo.hasta) return `hasta el ${fmt.fecha(promo.hasta)}`;
    return '';
  }

  const disponibleEn = (plan, codigo) =>
    !codigo || plan.localidades === 'todas' || (Array.isArray(plan.localidades) && plan.localidades.includes(codigo));

  const municipioActivo = () => Planes.municipio || estado.municipio;

  function mensajePlan(plan, codigo) {
    const lugar = codigo ? ` en ${Planes.nombres[codigo] || codigo}` : '';
    if (plan.segmento === 'empresas') return mensajeWA('empresas') + (lugar ? ` Ubicación:${lugar}.` : '');
    return `Hola 1clic, me interesa el plan ${plan.nombre} (${plan.bajada_mbps}/${plan.subida_mbps} Mbps)${lugar}. ¿Me ayudan a contratarlo?`;
  }

  function bloquePrecio(plan, promo) {
    const iva = plan.iva_incluido === true ? 'IVA incluido.'
      : plan.iva_incluido === false ? 'Más IVA: el precio publicado no incluye IVA.' : '';
    if (promo) {
      const duracion = promo.meses
        ? (promo.meses === 1 ? 'durante el primer mes' : `durante los primeros ${promo.meses} meses`)
        : 'durante la promoción';
      return el('div', { class: 'plan-precio' },
        el('p', { class: 'plan-precio-valor' }, fmt.moneda(promo.precio), el('small', null, '/mes')),
        el('p', { class: 'plan-precio-nota' }, `Precio promocional ${duracion}. ${iva}`),
        el('p', { class: 'plan-precio-despues' }, 'Después: ', el('strong', null, fmt.mensual(plan.precio_mensual))));
    }
    return el('div', { class: 'plan-precio' },
      el('p', { class: 'plan-precio-valor' }, fmt.moneda(plan.precio_mensual), el('small', null, '/mes')),
      el('p', { class: 'plan-precio-nota' }, iva));
  }

  function localidadesPlan(plan) {
    if (plan.localidades === 'todas') return 'Todas las localidades con cobertura';
    const nombres = (plan.localidades || []).map((c) => Planes.nombres[c] || c);
    if (!nombres.length) return '[•]';
    return el('details', { class: 'plan-localidades' },
      el('summary', null, `${nombres.length} localidades`),
      el('ul', null, ...nombres.map((n) => el('li', null, n))));
  }

  function detallesPlan(plan) {
    const filas = [];
    const permanencia = plan.permanencia;
    filas.push(['Permanencia', permanencia && permanencia.aplica
      ? [`Cláusula de permanencia de ${permanencia.meses} meses. `, permanencia.detalle || '', ' ',
        el('a', { href: plan.condiciones_url || '/legal/proteccion-usuarios.html#permanencia' }, 'Ver condiciones')]
      : ['Sin cláusula de permanencia']]);
    if (plan.instalacion) {
      const valor = plan.instalacion.valor;
      filas.push(['Instalación', [typeof valor === 'number' ? fmt.moneda(valor) : '[•]',
        plan.instalacion.detalle ? ' · ' + plan.instalacion.detalle : '']]);
    }
    if (plan.consumo) filas.push(['Consumo', [plan.consumo]]);
    filas.push(['Disponible en', [localidadesPlan(plan)]]);
    return el('dl', { class: 'plan-detalles' },
      ...filas.map(([termino, definicion]) => el('div', null, el('dt', null, termino), el('dd', null, ...definicion))));
  }

  function listaIncluye(items) {
    if (!Array.isArray(items) || !items.length) return null;
    return el('ul', { class: 'plan-incluye', 'aria-label': 'Incluye' },
      ...items.map((t) => el('li', null, icono('i-check'), el('span', null, t))));
  }

  function accionesPlan(plan, textoBoton, textoWA) {
    const boton = el('button', { class: 'btn btn-primario', type: 'button' }, textoBoton);
    boton.addEventListener('click', () => {
      track('plan_cta', { plan_id: plan.id, municipio: municipioActivo() });
      prefillLead({ plan: plan.id, segmento: SEGMENTO_FORM[plan.segmento], municipio: municipioActivo(), origen: 'plan:' + plan.id });
    });
    const whatsapp = el('a', {
      class: 'btn btn-secundario', href: enlaceWhatsApp(mensajePlan(plan, municipioActivo())),
      rel: 'noopener noreferrer', dataset: { origen: 'plan' }
    }, icono('i-chat'), textoWA);
    // El mensaje incluye el municipio consultado en cobertura, aunque cambie después de pintar.
    const actualizar = () => { whatsapp.href = enlaceWhatsApp(mensajePlan(plan, municipioActivo())); };
    whatsapp.addEventListener('pointerdown', actualizar);
    whatsapp.addEventListener('focus', actualizar);
    return el('div', { class: 'plan-acciones' }, boton, whatsapp);
  }

  function tarjetaEmpresas(plan) {
    return el('article', { class: 'plan plan-ancho', 'aria-labelledby': `plan-${plan.id}-nombre`, dataset: { planId: plan.id } },
      el('span', { class: 'plan-etiqueta plan-etiqueta-neutra' }, 'Empresas e instituciones'),
      el('div', { class: 'plan-cuerpo-ancho' },
        el('div', null,
          el('h3', { class: 'plan-nombre', id: `plan-${plan.id}-nombre` }, plan.nombre),
          el('p', { class: 'plan-descripcion' }, plan.descripcion || 'Enlace dedicado 1:1 con disponibilidad contratada'),
          el('p', null, 'El precio depende de la capacidad y de la ubicación: te enviamos una propuesta con el contrato y el SLA.')),
        listaIncluye(plan.incluye)),
      accionesPlan(plan, 'Hablar con un asesor', 'Escribir por WhatsApp'));
  }

  function tarjetaPlan(plan) {
    if (plan.segmento === 'empresas' || plan.tipo === 'dedicado') return tarjetaEmpresas(plan);
    const promo = promocionVigente(plan.promocion);
    return el('article', {
      class: 'plan' + (plan.destacado ? ' plan-destacado' : ''),
      'aria-labelledby': `plan-${plan.id}-nombre`, dataset: { planId: plan.id }
    },
      promo ? el('span', { class: 'plan-etiqueta' }, 'Promoción') : null,
      el('h3', { class: 'plan-nombre', id: `plan-${plan.id}-nombre` }, plan.nombre),
      el('p', { class: 'plan-velocidad' },
        el('span', { class: 'sr-only' }, `${plan.bajada_mbps} Mbps de bajada y ${plan.subida_mbps} Mbps de subida`),
        el('span', { class: 'plan-velocidad-cifra', 'aria-hidden': 'true' }, String(plan.bajada_mbps), el('span', { class: 'sep' }, '/'), String(plan.subida_mbps)),
        el('span', { class: 'plan-velocidad-unidad', 'aria-hidden': 'true' }, 'Mbps · bajada / subida')),
      bloquePrecio(plan, promo),
      promo ? el('p', { class: 'plan-promo' }, el('strong', null, `Promoción vigente ${textoVigencia(promo)}.`), ' ', promo.condiciones || '') : null,
      detallesPlan(plan),
      listaIncluye(plan.incluye),
      accionesPlan(plan, 'Lo quiero', 'Pedirlo por WhatsApp'));
  }

  /* Evento plan_view: una vez por tarjeta, cuando se ve al menos el 60 %. */
  const planesVistos = new Set();
  let observadorPlanes = null;
  function observarVistasPlanes(raiz) {
    if (!('IntersectionObserver' in window)) return;
    if (!observadorPlanes) {
      observadorPlanes = new IntersectionObserver((entradas) => {
        entradas.forEach((entrada) => {
          if (!entrada.isIntersecting) return;
          const id = entrada.target.dataset.planId;
          if (!planesVistos.has(id)) {
            planesVistos.add(id);
            track('plan_view', { plan_id: id });
          }
          observadorPlanes.unobserve(entrada.target);
        });
      }, { threshold: 0.6 });
    }
    $$('.plan', raiz).forEach((t) => { if (!planesVistos.has(t.dataset.planId)) observadorPlanes.observe(t); });
  }

  function pintarFiltroPlanes() {
    const caja = $('#planes-filtro');
    if (!caja) return;
    if (!Planes.municipio) {
      caja.hidden = true;
      caja.replaceChildren();
      return;
    }
    caja.replaceChildren(
      el('span', null, 'Mostrando los planes disponibles en ', el('strong', null, Planes.nombres[Planes.municipio] || Planes.municipio), '.'),
      el('button', { class: 'btn-texto', type: 'button', onclick: () => filtrarPlanes(null) }, 'Ver todos los planes'));
    caja.hidden = false;
  }

  function pintarPlanes() {
    const raiz = $('[data-planes]');
    if (!raiz || !Planes.datos) return;
    for (const segmento of Object.keys(SEGMENTOS)) {
      const panel = $('#panel-' + segmento, raiz);
      if (!panel) continue;
      const lista = Planes.datos.planes.filter((p) => p.segmento === segmento && disponibleEn(p, Planes.municipio));
      panel.replaceChildren(...(lista.length ? lista.map(tarjetaPlan) : [
        el('p', { class: 'aviso aviso-info plan-ancho' }, icono('i-info'),
          el('span', null, 'No hay planes de este tipo publicados para el municipio elegido. Escríbenos por ',
            enlaceWA('WhatsApp', 'general', 'planes'), ' y te contamos las opciones.'))]));
    }
    pintarFiltroPlanes();
    observarVistasPlanes(raiz);
  }

  /** Filtra las tarjetas por municipio (lo usa "Ver planes disponibles" en cobertura). */
  function filtrarPlanes(codigo) {
    Planes.municipio = codigo || null;
    pintarPlanes();
  }

  /** Pestañas accesibles: flechas, Inicio y Fin; activación automática. */
  function iniciarPestanas(raiz) {
    const lista = $('[role="tablist"]', raiz);
    if (!lista) return;
    const pestanas = $$('[role="tab"]', lista);
    function activar(pestana, enfocar) {
      pestanas.forEach((t) => {
        const activa = t === pestana;
        t.setAttribute('aria-selected', String(activa));
        t.tabIndex = activa ? 0 : -1;
        const panel = doc.getElementById(t.getAttribute('aria-controls'));
        if (panel) panel.hidden = !activa;
      });
      if (enfocar) pestana.focus();
      observarVistasPlanes(raiz);
    }
    pestanas.forEach((t) => t.addEventListener('click', () => activar(t, false)));
    lista.addEventListener('keydown', (e) => {
      const i = pestanas.indexOf(doc.activeElement);
      if (i < 0) return;
      const destino = {
        ArrowRight: pestanas[(i + 1) % pestanas.length],
        ArrowLeft: pestanas[(i - 1 + pestanas.length) % pestanas.length],
        Home: pestanas[0],
        End: pestanas[pestanas.length - 1]
      }[e.key];
      if (destino) {
        e.preventDefault();
        activar(destino, true);
      }
    });
    lista.hidden = false;
    activar(pestanas.find((t) => t.getAttribute('aria-selected') === 'true') || pestanas[0], false);
  }

  function errorPlanes() {
    const caja = $('#planes-error');
    if (caja) {
      caja.replaceChildren(
        el('p', null, el('strong', null, 'No pudimos cargar los planes en este momento.')),
        el('p', null, 'Consulta los planes y precios vigentes por ', enlaceWA('WhatsApp', 'general', 'planes-error'),
          `, en la ${nombreLinea()} `, enlaceLinea(), ' o en ', el('a', { href: 'mailto:' + correo('soporte') }, correo('soporte')), '.'));
      caja.hidden = false;
    }
    $$('[data-tabla-tarifas], [data-tabla-velocidades]').forEach((c) => c.replaceChildren(
      el('p', { class: 'aviso aviso-error' }, icono('i-alerta'),
        el('span', null, `No pudimos cargar la tabla. Consulta las tarifas en la ${nombreLinea()} `, enlaceLinea(), '.'))));
  }

  function tabla(caption, encabezados, filas) {
    return el('table', { class: 'tabla' },
      el('caption', null, caption),
      el('thead', null, el('tr', null, ...encabezados.map((t) => el('th', { scope: 'col' }, t)))),
      el('tbody', null, ...filas));
  }

  function leyendaTabla(base, datos) {
    const meta = datos.metadata || {};
    const partes = [base];
    if (meta.actualizado) partes.push('actualizado el ' + fmt.fecha(meta.actualizado));
    if (meta.es_muestra) partes.push(meta.aviso_muestra || 'datos de ejemplo');
    return partes.join(' · ');
  }

  /** Protección de usuarios: tarifas vigentes con condiciones de promociones. */
  function tablaTarifas(contenedor, datos) {
    const filas = datos.planes.filter((p) => p.segmento !== 'empresas').map((p) => {
      const promo = promocionVigente(p.promocion);
      return el('tr', null,
        el('th', { scope: 'row' }, p.nombre),
        el('td', { class: 'tabla-num' }, `${p.bajada_mbps}/${p.subida_mbps} Mbps`),
        el('td', { class: 'tabla-num' }, fmt.mensual(p.precio_mensual)),
        el('td', null, p.iva_incluido ? 'Incluido' : 'No incluido (más IVA)'),
        el('td', null, promo
          ? `${fmt.mensual(promo.precio)}${promo.meses ? ` por ${promo.meses} meses` : ''}, vigente ${textoVigencia(promo)}. ${promo.condiciones || ''}`
          : 'Sin promoción vigente'),
        el('td', null, p.permanencia && p.permanencia.aplica ? `${p.permanencia.meses} meses` : 'No'),
        el('td', { class: 'tabla-num' }, p.instalacion && typeof p.instalacion.valor === 'number' ? fmt.moneda(p.instalacion.valor) : '[•]'));
    });
    const hayEmpresas = datos.planes.some((p) => p.segmento === 'empresas');
    contenedor.replaceChildren(
      tabla(leyendaTabla('Tarifas vigentes', datos),
        ['Plan', 'Bajada/subida', 'Precio mensual', 'IVA', 'Promoción', 'Permanencia', 'Instalación'], filas),
      hayEmpresas ? el('p', { class: 'nota' }, 'Enlace dedicado para empresas: precio según la propuesta técnica y comercial.') : null);
  }

  /** Neutralidad de red: velocidades contratadas y consumo por plan. */
  function tablaVelocidades(contenedor, datos) {
    const filas = datos.planes.filter((p) => p.segmento !== 'empresas').map((p) => el('tr', null,
      el('th', { scope: 'row' }, p.nombre),
      el('td', { class: 'tabla-num' }, fmt.velocidad(p.bajada_mbps)),
      el('td', { class: 'tabla-num' }, fmt.velocidad(p.subida_mbps)),
      el('td', null, p.consumo || '[•]')));
    contenedor.replaceChildren(tabla(leyendaTabla('Velocidades contratadas', datos), ['Plan', 'Bajada', 'Subida', 'Consumo'], filas));
  }

  /** Opciones del campo "Plan de interés" del formulario de contacto. */
  function opcionesPlanFormulario(datos) {
    const select = $('#lead-plan');
    if (!select) return;
    agregar(select, Object.entries(SEGMENTOS).map(([segmento, etiqueta]) => {
      const planes = datos.planes.filter((p) => p.segmento === segmento);
      return planes.length ? el('optgroup', { label: etiqueta }, ...planes.map((p) =>
        el('option', { value: p.id }, p.nombre + (p.bajada_mbps ? ` (${p.bajada_mbps}/${p.subida_mbps} Mbps)` : '')))) : null;
    }));
    if (select.dataset.pendiente) {
      select.value = select.dataset.pendiente;
      delete select.dataset.pendiente;
    }
  }

  /**
   * JSON-LD de ofertas (Offer por plan, priceCurrency COP). Solo con precios
   * aprobados: si planes.json es de muestra, no se publica (veracidad primero).
   */
  function publicarOfertas(datos) {
    if (!leerRuta(CFG, 'flags.ofertasJsonLd') || (datos.metadata && datos.metadata.es_muestra) || $('#ld-ofertas')) return;
    const base = (CFG.sitio && CFG.sitio.url) || location.origin;
    const organizacion = { '@id': base + '/#organizacion' };
    const ofertas = datos.planes.filter((p) => typeof p.precio_mensual === 'number').map((p) => {
      const promo = promocionVigente(p.promocion);
      const precio = promo ? promo.precio : p.precio_mensual;
      return {
        '@type': 'Offer',
        name: p.nombre,
        url: base + '/#planes',
        price: String(precio),
        priceCurrency: 'COP',
        priceSpecification: { '@type': 'UnitPriceSpecification', price: precio, priceCurrency: 'COP', unitText: 'mes', valueAddedTaxIncluded: p.iva_incluido === true },
        ...(promo && promo.hasta ? { priceValidUntil: promo.hasta } : {}),
        availability: 'https://schema.org/InStock',
        seller: organizacion,
        itemOffered: {
          '@type': 'Service',
          name: p.nombre,
          serviceType: 'Internet por fibra óptica hasta el hogar (FTTH)',
          description: `${p.bajada_mbps} Mbps de bajada y ${p.subida_mbps} Mbps de subida`,
          provider: organizacion
        }
      };
    });
    if (!ofertas.length) return;
    const script = el('script', { type: 'application/ld+json', id: 'ld-ofertas' });
    script.textContent = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'OfferCatalog',
      name: 'Planes de internet por fibra óptica de 1clic', url: base + '/#planes', itemListElement: ofertas
    });
    doc.head.append(script);
  }

  async function iniciarPlanes() {
    const raiz = $('[data-planes]');
    if (!raiz && !$('[data-tabla-tarifas]') && !$('[data-tabla-velocidades]') && !$('#lead-plan')) return;
    let datos;
    try {
      const [planes, nombres] = await Promise.all([datosJSON('planes'), nombresMunicipios()]);
      if (!planes || !Array.isArray(planes.planes)) throw new Error('planes.json no tiene la lista "planes"');
      datos = { metadata: planes.metadata || {}, planes: planes.planes.filter(planValido) };
      if (!datos.planes.length) throw new Error('planes.json no tiene planes válidos');
      Planes.nombres = nombres;
    } catch (e) {
      errorPlanes();
      return;
    }
    Planes.datos = datos;

    if (raiz) {
      const aviso = $('#planes-muestra');
      if (aviso && datos.metadata.es_muestra) {
        const texto = $('[data-planes-aviso]', aviso);
        if (texto && datos.metadata.aviso_muestra) texto.textContent = datos.metadata.aviso_muestra;
        aviso.hidden = false;
      }
      pintarPlanes();
      iniciarPestanas(raiz);
    }
    $$('[data-tabla-tarifas]').forEach((c) => tablaTarifas(c, datos));
    $$('[data-tabla-velocidades]').forEach((c) => tablaVelocidades(c, datos));
    opcionesPlanFormulario(datos);
    publicarOfertas(datos);
    tablasDesplazables();
  }

  /* ===========================================================================
     9. FORMULARIOS
     Validación nativa (required, pattern, type…) + mensajes en español junto
     a cada campo (aria-describedby, aria-invalid). Nunca alert().
     Antispam: campo trampa + tiempo mínimo de llenado (3 s); Turnstile opcional.
     =========================================================================== */
  const MENSAJES = {
    obligatorio: 'Este campo es obligatorio.',
    casilla: 'Marca esta casilla para continuar.',
    opcion: 'Elige una opción.',
    lista: 'Elige una opción de la lista.',
    correo: 'Escribe un correo válido, por ejemplo nombre@correo.com.',
    celular: 'Escribe un celular de 10 dígitos que empiece por 3.',
    documento: 'Escribe solo números y letras, sin espacios.',
    cun: 'Escribe el CUN tal como te llegó: solo números y guiones.',
    formato: 'Revisa el formato de este campo.',
    corto: (n) => `Escribe al menos ${n} caracteres.`,
    largo: (n) => `Escribe máximo ${n} caracteres.`
  };

  /** "300 123 4567" o "+57 300 123 4567" → "3001234567" */
  function normalizarCelular(valor) {
    let digitos = String(valor || '').replace(/\D/g, '');
    if (digitos.length === 12 && digitos.startsWith('57')) digitos = digitos.slice(2);
    return digitos;
  }

  function mensajePara(campo) {
    const v = campo.validity;
    if (v.valid) return '';
    if (v.customError) return campo.validationMessage;
    if (v.valueMissing) {
      if (campo.type === 'checkbox') return MENSAJES.casilla;
      if (campo.type === 'radio') return MENSAJES.opcion;
      return campo.tagName === 'SELECT' ? MENSAJES.lista : MENSAJES.obligatorio;
    }
    if (v.typeMismatch && campo.type === 'email') return MENSAJES.correo;
    if (v.patternMismatch) return MENSAJES[campo.dataset.tipo] || (campo.name === 'documento' ? MENSAJES.documento : MENSAJES.formato);
    if (v.tooShort) return MENSAJES.corto(campo.minLength);
    if (v.tooLong) return MENSAJES.largo(campo.maxLength);
    return MENSAJES.formato;
  }

  function cajaError(campo) {
    if (campo.type === 'radio') {
      const grupo = campo.closest('fieldset');
      const id = grupo && (grupo.getAttribute('aria-describedby') || '').split(/\s+/).find((x) => x.endsWith('-error'));
      return id ? doc.getElementById(id) : null;
    }
    return campo.id ? doc.getElementById(campo.id + '-error') : null;
  }

  /** Valida un campo, pinta el mensaje junto a él y devuelve true si es válido. */
  function validarCampo(campo) {
    if (campo.dataset.tipo === 'celular' && campo.value) campo.value = normalizarCelular(campo.value);
    if (campo.dataset.tipo === 'cun') {
      campo.value = campo.value.trim();
      campo.setCustomValidity(!campo.value || /^[0-9][0-9\s-]{5,39}$/.test(campo.value) ? '' : MENSAJES.cun);
    }
    const mensaje = mensajePara(campo);
    const grupo = campo.type === 'radio' && campo.form
      ? $$(`input[type="radio"][name="${CSS.escape(campo.name)}"]`, campo.form)
      : [campo];
    grupo.forEach((c) => (mensaje ? c.setAttribute('aria-invalid', 'true') : c.removeAttribute('aria-invalid')));
    const caja = cajaError(campo);
    if (caja) caja.textContent = mensaje;
    return !mensaje;
  }

  function camposValidables(form) {
    return $$('input, select, textarea', form).filter((c) =>
      c.willValidate && c.type !== 'hidden' && !c.closest('.hp') && !c.closest('[hidden]'));
  }

  /** Valida todo el formulario y lleva el foco al primer campo con error. */
  function validarFormulario(form) {
    let primero = null;
    const radiosVistos = new Set();
    for (const campo of camposValidables(form)) {
      if (campo.type === 'radio') {
        if (radiosVistos.has(campo.name)) continue;
        radiosVistos.add(campo.name);
      }
      if (!validarCampo(campo) && !primero) primero = campo;
    }
    if (primero) primero.focus();
    return !primero;
  }

  /** Revalida al salir de un campo con contenido y corrige el error mientras se escribe. */
  function validacionEnVivo(form) {
    form.addEventListener('focusout', (e) => {
      const c = e.target;
      if (!c.matches || !c.matches('input, select, textarea') || c.closest('.hp') || c.type === 'radio' || c.type === 'file') return;
      if (c.value || c.getAttribute('aria-invalid') === 'true') validarCampo(c);
    });
    form.addEventListener('input', (e) => {
      if (e.target.getAttribute && e.target.getAttribute('aria-invalid') === 'true') validarCampo(e.target);
    });
    form.addEventListener('change', (e) => {
      const c = e.target;
      if (c.type === 'radio' || ((c.type === 'checkbox' || c.tagName === 'SELECT') && c.getAttribute('aria-invalid') === 'true')) validarCampo(c);
    });
  }

  /** Mensaje accesible bajo el formulario (la caja tiene role="status" y aria-live="polite"). */
  function mensajeFormulario(caja, tipo, ...contenido) {
    if (!caja) return;
    const iconos = { ok: 'i-check-circulo', error: 'i-alerta', info: 'i-info' };
    caja.replaceChildren(el('div', { class: `form-mensaje form-mensaje-${tipo}` }, icono(iconos[tipo]), el('div', null, ...contenido)));
  }

  /** '' si todo está bien; 'bot' si se llenó el campo trampa; 'rapido' si se envió en menos de 3 s. */
  function antispam(form) {
    const trampa = $('.hp input', form);
    if (trampa && trampa.value.trim()) return 'bot';
    const minimo = Number(leerRuta(CFG, 'antispam.tiempoMinimoMs')) || 3000;
    return Date.now() - Number(form.dataset.inicio || 0) < minimo ? 'rapido' : '';
  }

  /** Cloudflare Turnstile (opcional): se carga solo si CONFIG.turnstile.enabled y hay siteKey. */
  const Turnstile = (() => {
    const cfg = CFG.turnstile || {};
    const activo = () => Boolean(cfg.enabled && cfg.siteKey && cfg.script);
    let carga = null;
    function cargar() {
      if (!carga) {
        carga = new Promise((resolver, rechazar) => {
          const script = el('script', { src: cfg.script, async: true });
          script.addEventListener('load', () => (window.turnstile ? resolver(window.turnstile) : rechazar(new Error('Turnstile no disponible'))));
          script.addEventListener('error', rechazar);
          doc.head.append(script);
        });
      }
      return carga;
    }
    async function montar(form, contenedor) {
      if (!activo() || !contenedor) return;
      contenedor.hidden = false;
      try {
        const ts = await cargar();
        ts.render(contenedor, {
          sitekey: cfg.siteKey,
          language: 'es',
          callback: (token) => { form.dataset.turnstile = token; },
          'expired-callback': () => { delete form.dataset.turnstile; },
          'error-callback': () => { delete form.dataset.turnstile; }
        });
      } catch (e) {
        contenedor.replaceChildren(el('p', { class: 'campo-error' },
          `No pudimos cargar la verificación de seguridad. Escríbenos por WhatsApp o llama a la ${nombreLinea()}.`));
      }
    }
    function reiniciar(form) {
      delete form.dataset.turnstile;
      if (activo() && window.turnstile) {
        try {
          window.turnstile.reset();
        } catch (e) {
          /* sin widget */
        }
      }
    }
    return { activo, montar, reiniciar };
  })();

  /** Envía al backend con tiempo límite. Devuelve el JSON de respuesta (o {}). */
  async function enviar(url, opciones) {
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), Number(leerRuta(CFG, 'endpoints.timeoutMs')) || 15000);
    try {
      const respuesta = await fetch(url, { ...opciones, signal: control.signal, credentials: 'omit' });
      let cuerpo = null;
      try {
        cuerpo = await respuesta.json();
      } catch (e) {
        cuerpo = null;
      }
      if (!respuesta.ok) {
        const error = new Error('HTTP ' + respuesta.status);
        error.status = respuesta.status;
        throw error;
      }
      return cuerpo || {};
    } finally {
      clearTimeout(temporizador);
    }
  }

  /** Prueba de la autorización: texto aceptado, versión de la política y marca de tiempo. */
  function consentimiento(casillaId) {
    const casilla = doc.getElementById(casillaId);
    const etiqueta = $(`label[for="${casillaId}"]`);
    return {
      tratamiento_datos: Boolean(casilla && casilla.checked),
      texto: etiqueta ? etiqueta.textContent.replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim() : '',
      politica_version: leerRuta(CFG, 'legal.politicaDatos.version') || '',
      politica_vigente_desde: leerRuta(CFG, 'legal.politicaDatos.vigenteDesde') || '',
      politica_url: ((CFG.sitio && CFG.sitio.url) || location.origin) + '/legal/tratamiento-datos.html',
      fecha_hora: new Date().toISOString()
    };
  }

  const nombreOpcion = (select) => (select && select.selectedIndex > 0 ? select.options[select.selectedIndex].textContent.trim() : '');
  const SEGMENTO_TEXTO = { hogar: 'Hogar', negocio: 'Negocio', empresa: 'Empresa' };

  /* ---- Contacto y preregistro ---- */
  function datosContacto(form) {
    const f = new FormData(form);
    const txt = (k) => String(f.get(k) || '').trim();
    const lat = parseFloat(txt('lat'));
    const lon = parseFloat(txt('lon'));
    const municipio = txt('municipio');
    const comercial = $('#lead-comercial', form);
    const aceptaComercial = Boolean(comercial && comercial.checked);
    return {
      nombre: txt('nombre'),
      celular: normalizarCelular(txt('celular')),
      correo: txt('correo') || null,
      municipio,
      municipio_nombre: Planes.nombres[municipio] || nombreOpcion($('#lead-municipio', form)),
      barrio: txt('barrio'),
      direccion: txt('direccion') || null,
      segmento: txt('segmento'),
      plan: txt('plan') || null,
      mensaje: txt('mensaje') || null,
      ubicacion: Number.isFinite(lat) && Number.isFinite(lon)
        ? { lat: +lat.toFixed(6), lon: +lon.toFixed(6), fuente: 'geolocalizacion_navegador' }
        : null,
      consentimiento: consentimiento('lead-autorizacion'),
      comunicaciones_comerciales: {
        aceptado: aceptaComercial,
        canales: ['whatsapp', 'llamada', 'correo'],
        fecha_hora: aceptaComercial ? new Date().toISOString() : null
      },
      origen: txt('origen') || 'contacto',
      utm: UTM.obtener(),
      pagina: location.pathname,
      turnstile_token: form.dataset.turnstile || undefined,
      enviado_en: new Date().toISOString()
    };
  }

  function mensajeLead(d) {
    return [
      'Hola 1clic, quiero solicitar el servicio de internet.',
      `Nombre: ${d.nombre}`,
      `Celular: ${d.celular}`,
      d.correo ? `Correo: ${d.correo}` : null,
      `Municipio: ${d.municipio_nombre || d.municipio}`,
      `Barrio o vereda: ${d.barrio}`,
      d.direccion ? `Dirección: ${d.direccion}` : null,
      `Segmento: ${SEGMENTO_TEXTO[d.segmento] || d.segmento}`,
      `Plan de interés: ${d.plan ? nombreOpcion($('#lead-plan')) || d.plan : 'Aún no lo sé'}`,
      d.mensaje ? `Mensaje: ${d.mensaje}` : null,
      d.ubicacion ? `Ubicación aproximada: ${d.ubicacion.lat.toFixed(5)}, ${d.ubicacion.lon.toFixed(5)}` : null,
      `Autorizo el tratamiento de mis datos personales (política v${d.consentimiento.politica_version}).`,
      d.comunicaciones_comerciales.aceptado ? 'Acepto recibir información comercial.' : null
    ].filter(Boolean).join('\n');
  }

  /** Sin endpoint configurado: la solicitud se envía por WhatsApp con el mensaje ya armado. */
  function alternativaWhatsApp(caja, d) {
    const enlace = el('a', {
      class: 'btn btn-primario', href: enlaceWhatsApp(mensajeLead(d)),
      target: '_blank', rel: 'noopener noreferrer', dataset: { origen: 'formulario' }
    }, icono('i-chat'), 'Enviar por WhatsApp');
    mensajeFormulario(caja, 'info',
      el('p', null, el('strong', null, 'Último paso: envíanos tu solicitud por WhatsApp.')),
      el('p', null, 'Ya preparamos el mensaje con tus datos; solo tienes que enviarlo. Se abre en una pestaña nueva.'),
      enlace);
    enlace.focus();
  }

  function iniciarFormularioContacto() {
    const form = $('[data-form-lead]');
    if (!form) return;
    form.hidden = false;
    form.dataset.inicio = String(Date.now());
    validacionEnVivo(form);
    Turnstile.montar(form, $('#lead-turnstile'));
    const caja = $('#lead-estado');
    const boton = $('button[type="submit"]', form);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (form.dataset.enviando) return;
      if (!validarFormulario(form)) {
        mensajeFormulario(caja, 'error', el('p', null, 'Revisa los campos marcados para continuar.'));
        return;
      }
      const spam = antispam(form);
      if (spam === 'bot') {               // respuesta neutra para no dar pistas al robot
        form.reset();
        mensajeFormulario(caja, 'ok', el('p', null, 'Recibimos tu solicitud.'));
        return;
      }
      if (spam === 'rapido') {
        mensajeFormulario(caja, 'error', el('p', null, 'No pudimos enviar tu solicitud. Revisa los datos y vuelve a intentarlo en unos segundos.'));
        return;
      }
      if (Turnstile.activo() && !form.dataset.turnstile) {
        mensajeFormulario(caja, 'error', el('p', null, 'Completa la verificación de seguridad para enviar.'));
        return;
      }

      const datos = datosContacto(form);
      track('lead_submit', { segmento: datos.segmento, municipio: datos.municipio, origen: datos.origen });
      const url = leerRuta(CFG, 'endpoints.leads');
      if (!url) {
        alternativaWhatsApp(caja, datos);
        return;
      }

      form.dataset.enviando = '1';
      boton.setAttribute('aria-disabled', 'true');
      mensajeFormulario(caja, 'info', el('p', null, 'Enviando tu solicitud…'));
      try {
        const respuesta = await enviar(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(datos)
        });
        const radicado = respuesta.radicado || respuesta.id;
        mensajeFormulario(caja, 'ok',
          el('p', null, el('strong', null, '¡Recibimos tu solicitud!'), ' Te contactaremos para continuar.'),
          radicado ? el('p', null, 'Número de radicado: ', el('span', { class: 'radicado' }, String(radicado))) : null);
        form.reset();
        form.dataset.inicio = String(Date.now());
      } catch (error) {
        mensajeFormulario(caja, 'error',
          el('p', null, el('strong', null, 'No pudimos enviar tu solicitud.'), ' Tus datos siguen en el formulario.'),
          el('p', null, 'Inténtalo de nuevo o escríbenos por ', enlaceWA('WhatsApp', 'general', 'contacto-error', mensajeLead(datos)),
            ` o a la ${nombreLinea()} `, enlaceLinea(), '.'));
      } finally {
        delete form.dataset.enviando;
        boton.removeAttribute('aria-disabled');
        Turnstile.reiniciar(form);
      }
    });
  }

  /**
   * Precarga el formulario de contacto (plan, municipio, barrio, segmento,
   * origen y coordenada si la persona dio permiso) y lleva hasta él.
   */
  function prefillLead(opciones = {}) {
    const form = $('#form-contacto');
    const seccion = $('#contacto');
    if (!form || !seccion) {
      location.href = '/#contacto';
      return;
    }
    const fijar = (selector, valor) => {
      const campo = $(selector, form);
      if (campo && valor !== undefined && valor !== null) campo.value = valor;
    };
    if (opciones.municipio) fijar('#lead-municipio', opciones.municipio);
    if (opciones.barrio) fijar('#lead-barrio', opciones.barrio);
    if (opciones.segmento) {
      const radio = $(`input[name="segmento"][value="${CSS.escape(opciones.segmento)}"]`, form);
      if (radio) radio.checked = true;
    }
    if (opciones.plan) {
      const select = $('#lead-plan', form);
      if (select) {
        if ($(`option[value="${CSS.escape(opciones.plan)}"]`, select)) select.value = opciones.plan;
        else select.dataset.pendiente = opciones.plan;
      }
    }
    if (opciones.mensaje) {
      const mensaje = $('#lead-mensaje', form);
      if (mensaje && !mensaje.value) mensaje.value = opciones.mensaje;
    }
    fijar('input[name="origen"]', opciones.origen || 'contacto');
    fijar('input[name="lat"]', Number.isFinite(opciones.lat) ? String(opciones.lat) : '');
    fijar('input[name="lon"]', Number.isFinite(opciones.lon) ? String(opciones.lon) : '');
    $$('[aria-invalid="true"]', form).forEach((c) => validarCampo(c));
    const primero = ['#lead-nombre', '#lead-celular', '#lead-barrio'].map((s) => $(s, form)).find((c) => c && !c.value);
    irA(seccion, primero || $('#lead-nombre', form));
  }

  /* ---- PQR: radicar y consultar por CUN ---- */
  const TIPOS_ADJUNTO = ['application/pdf', 'image/jpeg', 'image/png'];
  const TIPOS_PQR = { peticion: 'Petición', queja: 'Queja', recurso: 'Recurso' };

  /** Hasta 3 archivos PDF/JPG/PNG de 5 MB: el error se muestra junto al campo. */
  function revisarAdjuntos(input) {
    const maximo = Number(input.dataset.maxArchivos) || 3;
    const maxMB = Number(input.dataset.maxMb) || 5;
    const archivos = Array.from(input.files || []);
    let error = '';
    if (archivos.length > maximo) {
      error = `Puedes adjuntar máximo ${maximo} archivos.`;
    } else {
      const tipoMalo = archivos.find((a) => (a.type ? !TIPOS_ADJUNTO.includes(a.type) : !/\.(pdf|jpe?g|png)$/i.test(a.name)));
      const pesado = archivos.find((a) => a.size > maxMB * 1024 * 1024);
      if (tipoMalo) error = `"${tipoMalo.name}" no es un PDF, JPG ni PNG.`;
      else if (pesado) error = `"${pesado.name}" pesa más de ${maxMB} MB.`;
    }
    input.setCustomValidity(error);
    const lista = doc.getElementById(input.id + '-lista');
    if (lista) lista.replaceChildren(...archivos.map((a) => el('li', null, `${a.name} · ${fmt.numero(a.size / 1048576, 1)} MB`)));
    validarCampo(input);
  }

  /** Sin endpoint de PQR: se ofrece enviar el mismo contenido por correo o WhatsApp. */
  function alternativaPQR(caja, form) {
    const f = new FormData(form);
    const txt = (k) => String(f.get(k) || '').trim();
    const cuerpo = [
      `Tipo: ${TIPOS_PQR[txt('tipo')] || txt('tipo')}`,
      txt('cun_previo') ? `CUN de la PQR que recurro: ${txt('cun_previo')}` : null,
      `Nombre: ${txt('nombre')}`,
      `Documento: ${txt('tipo_documento')} ${txt('documento')}`,
      `Celular: ${normalizarCelular(txt('celular'))}`,
      txt('correo') ? `Correo: ${txt('correo')}` : null,
      `Municipio del servicio: ${nombreOpcion($('#pqr-municipio', form))}`,
      txt('contrato') ? `Contrato o cuenta: ${txt('contrato')}` : null,
      txt('direccion') ? `Dirección del servicio: ${txt('direccion')}` : null,
      '',
      'Descripción:',
      txt('descripcion'),
      '',
      `Autorizo el tratamiento de mis datos personales para atender esta PQR (política v${leerRuta(CFG, 'legal.politicaDatos.version') || ''}).`
    ].filter((linea) => linea !== null).join('\n');
    const asunto = `PQR · ${TIPOS_PQR[txt('tipo')] || ''} · ${txt('nombre')}`;
    const adjuntos = $('#pqr-adjuntos', form);
    mensajeFormulario(caja, 'info',
      el('p', null, el('strong', null, 'La radicación en línea aún no está habilitada.')),
      el('p', null, 'Envía tu PQR por correo o por WhatsApp con los datos que ya escribiste. El CUN te llegará por correo o SMS.'),
      adjuntos && adjuntos.files.length ? el('p', null, 'Recuerda adjuntar tus archivos al correo.') : null,
      el('div', { class: 'resultado-acciones' },
        el('a', { class: 'btn btn-primario', href: `mailto:${correo('pqr')}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}` },
          icono('i-correo'), 'Enviar por correo'),
        el('a', { class: 'btn btn-secundario', href: enlaceWhatsApp(mensajeWA('pqr') + '\n\n' + cuerpo), rel: 'noopener noreferrer', dataset: { origen: 'pqr' } },
          icono('i-chat'), 'Enviar por WhatsApp')),
      el('p', null, `También puedes llamar a la ${nombreLinea()} `, enlaceLinea(), '.'));
  }

  function pintarEstadoCun(caja, r, cun) {
    const filas = [
      ['CUN', r.cun || cun],
      ['Estado', r.estado],
      ['Tipo', r.tipo],
      ['Radicada', r.fecha_radicacion && fmt.fecha(r.fecha_radicacion)],
      ['Fecha límite de respuesta', r.fecha_limite_respuesta && fmt.fecha(r.fecha_limite_respuesta)],
      ['Última actualización', r.ultima_actualizacion && `${fmt.fecha(r.ultima_actualizacion)}, ${fmt.hora(r.ultima_actualizacion)}`],
      ['Detalle', r.detalle]
    ].filter(([, valor]) => valor);
    mensajeFormulario(caja, 'info', el('dl', { class: 'definiciones definiciones-compactas' },
      ...filas.flatMap(([termino, valor]) => [el('dt', null, termino), el('dd', null, String(valor))])));
  }

  function iniciarPQR() {
    if (/\/legal\/pqr\.html$/.test(location.pathname)) track('pqr_open', { origen: 'pagina' });

    const form = $('[data-form-pqr]');
    if (form) {
      form.hidden = false;
      form.dataset.inicio = String(Date.now());
      validacionEnVivo(form);
      Turnstile.montar(form, $('#pqr-turnstile'));
      const caja = $('#pqr-estado');
      const boton = $('button[type="submit"]', form);
      const campoCun = $('#pqr-campo-cun-previo', form);
      const cunPrevio = $('#pqr-cun-previo', form);
      const adjuntos = $('#pqr-adjuntos', form);

      // "Recurso" pide el CUN de la PQR que se recurre.
      form.addEventListener('change', (e) => {
        if (e.target.name !== 'tipo' || !campoCun) return;
        const recurso = e.target.value === 'recurso';
        campoCun.hidden = !recurso;
        cunPrevio.required = recurso;
        if (!recurso) {
          cunPrevio.value = '';
          validarCampo(cunPrevio);
        }
      });
      if (adjuntos) adjuntos.addEventListener('change', () => revisarAdjuntos(adjuntos));

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (form.dataset.enviando) return;
        if (adjuntos) revisarAdjuntos(adjuntos);
        if (!validarFormulario(form)) {
          mensajeFormulario(caja, 'error', el('p', null, 'Revisa los campos marcados para continuar.'));
          return;
        }
        const spam = antispam(form);
        if (spam === 'bot') {
          form.reset();
          mensajeFormulario(caja, 'ok', el('p', null, 'Recibimos tu PQR.'));
          return;
        }
        if (spam === 'rapido') {
          mensajeFormulario(caja, 'error', el('p', null, 'No pudimos radicar tu PQR. Revisa los datos y vuelve a intentarlo en unos segundos.'));
          return;
        }
        if (Turnstile.activo() && !form.dataset.turnstile) {
          mensajeFormulario(caja, 'error', el('p', null, 'Completa la verificación de seguridad para enviar.'));
          return;
        }
        const url = leerRuta(CFG, 'endpoints.pqr');
        if (!url) {
          alternativaPQR(caja, form);
          return;
        }

        const datos = new FormData(form);
        datos.delete('sitio_web');
        datos.delete('autorizacion');
        if (adjuntos && !adjuntos.files.length) datos.delete('adjuntos');
        datos.set('celular', normalizarCelular(datos.get('celular')));
        datos.append('consentimiento', JSON.stringify(consentimiento('pqr-autorizacion')));
        datos.append('canal', 'web');
        datos.append('enviado_en', new Date().toISOString());
        if (form.dataset.turnstile) datos.append('turnstile_token', form.dataset.turnstile);

        form.dataset.enviando = '1';
        boton.setAttribute('aria-disabled', 'true');
        mensajeFormulario(caja, 'info', el('p', null, 'Radicando tu PQR…'));
        try {
          const respuesta = await enviar(url, { method: 'POST', headers: { Accept: 'application/json' }, body: datos });
          mensajeFormulario(caja, 'ok',
            el('p', null, el('strong', null, 'Radicamos tu PQR.')),
            respuesta.cun
              ? el('p', null, 'Tu CUN es ', el('span', { class: 'radicado' }, String(respuesta.cun)), '. Guárdalo para consultar el estado.')
              : el('p', null, 'El CUN te llegará por correo o SMS.'),
            el('p', null, 'Te responderemos al correo o al celular que registraste.'));
          form.reset();
          if (campoCun) campoCun.hidden = true;
          if (adjuntos) revisarAdjuntos(adjuntos);
          form.dataset.inicio = String(Date.now());
        } catch (error) {
          mensajeFormulario(caja, 'error',
            el('p', null, el('strong', null, 'No pudimos radicar tu PQR en línea.'), ' Tus datos siguen en el formulario.'),
            el('p', null, `Inténtalo de nuevo o radícala por la ${nombreLinea()} `, enlaceLinea(), ', por ',
              enlaceWA('WhatsApp', 'pqr', 'pqr-error'), ' o en ', el('a', { href: 'mailto:' + correo('pqr') }, correo('pqr')), '.'));
        } finally {
          delete form.dataset.enviando;
          boton.removeAttribute('aria-disabled');
          Turnstile.reiniciar(form);
        }
      });
    }

    // Consulta por CUN: solo si existe el endpoint. Si no, quedan visibles los canales.
    const formCun = $('[data-form-cun]');
    const urlEstado = leerRuta(CFG, 'endpoints.pqrStatus');
    if (formCun && urlEstado) {
      formCun.hidden = false;
      validacionEnVivo(formCun);
      const resultado = $('#cun-resultado', formCun);
      formCun.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!validarFormulario(formCun)) return;
        const cun = $('#cun-numero', formCun).value.trim();
        mensajeFormulario(resultado, 'info', el('p', null, 'Consultando…'));
        try {
          const separador = urlEstado.includes('?') ? '&' : '?';
          const respuesta = await enviar(urlEstado + separador + 'cun=' + encodeURIComponent(cun), { method: 'GET', headers: { Accept: 'application/json' } });
          pintarEstadoCun(resultado, respuesta, cun);
        } catch (error) {
          mensajeFormulario(resultado, 'error', el('p', null, error.status === 404
            ? 'No encontramos una PQR con ese CUN. Revisa el número o consulta por los canales de abajo.'
            : 'No pudimos consultar el estado en este momento. Inténtalo más tarde o usa los canales de abajo.'));
        }
      });
    }
  }

  /* ===========================================================================
     10. INDICADORES DE CALIDAD
     Solo se publican indicadores medidos y completos. Si no hay, se mantiene
     el mensaje "Indicadores en proceso de medición" del HTML.
     =========================================================================== */
  const indicadorValido = (i) => i && i.indicador && i.periodo && typeof i.valor === 'number' &&
    Number.isFinite(i.valor) && i.unidad && i.fuente && i.fecha_publicacion;

  function valorIndicador(valor, unidad) {
    return unidad === '%' ? fmt.porcentaje(valor, Number.isInteger(valor) ? 0 : 2) : `${fmt.numero(valor)} ${unidad}`;
  }

  async function iniciarIndicadores() {
    const caja = $('[data-indicadores]');
    if (!caja) return;
    let datos;
    try {
      datos = await datosJSON('indicadores');
    } catch (e) {
      caja.replaceChildren(el('p', { class: 'aviso aviso-error' }, icono('i-alerta'),
        el('span', null, 'No pudimos cargar los indicadores en este momento. Inténtalo más tarde.')));
      return;
    }
    const lista = (Array.isArray(datos.indicadores) ? datos.indicadores : []).filter(indicadorValido);
    if (!lista.length) return;
    const filas = lista.map((i) => el('tr', null,
      el('th', { scope: 'row' }, i.indicador, i.descripcion ? el('span', { class: 'tabla-descripcion' }, i.descripcion) : null),
      el('td', null, i.periodo),
      el('td', { class: 'tabla-num' }, valorIndicador(i.valor, i.unidad)),
      el('td', null, i.meta_regulatoria == null ? 'No aplica' : String(i.meta_regulatoria)),
      el('td', null, i.fuente),
      el('td', { class: 'tabla-num' }, fmt.fecha(i.fecha_publicacion))));
    caja.replaceChildren(el('div', { class: 'tabla-contenedor' },
      tabla('Indicadores de calidad publicados', ['Indicador', 'Periodo', 'Valor', 'Meta regulatoria', 'Fuente', 'Publicado'], filas)));
    tablasDesplazables();
  }

  /* ===========================================================================
     11. DETALLES
     =========================================================================== */
  /** Si el ancla apunta a un <details> (p. ej. #faq-requisitos), lo abre. */
  function abrirDetallesDelAncla() {
    let id = '';
    try {
      id = decodeURIComponent(location.hash.slice(1));
    } catch (e) {
      return;
    }
    const destino = id && doc.getElementById(id);
    if (!destino) return;
    const detalles = destino.tagName === 'DETAILS' ? destino : destino.closest('details');
    if (detalles && !detalles.open) detalles.open = true;
  }

  /** Tablas más anchas que la pantalla: región desplazable y enfocable con teclado. */
  function tablasDesplazables() {
    $$('.tabla-contenedor').forEach((c) => {
      if (c.scrollWidth > c.clientWidth + 1) {
        if (!c.hasAttribute('tabindex')) {
          const leyenda = $('caption', c);
          c.setAttribute('tabindex', '0');
          c.setAttribute('role', 'region');
          c.setAttribute('aria-label', (leyenda ? leyenda.textContent.trim() : 'Tabla') + ' (desplazable)');
        }
      } else if (c.getAttribute('role') === 'region') {
        c.removeAttribute('tabindex');
        c.removeAttribute('role');
        c.removeAttribute('aria-label');
      }
    });
  }

  function eventosGlobales() {
    window.addEventListener('hashchange', abrirDetallesDelAncla);
    let pendiente = false;
    window.addEventListener('resize', () => {
      if (pendiente) return;
      pendiente = true;
      requestAnimationFrame(() => {
        pendiente = false;
        tablasDesplazables();
      });
    });
    doc.addEventListener('click', (e) => {
      const a = e.target.closest ? e.target.closest('a') : null;
      if (!a) return;
      // Mismo ancla dos veces: no hay "hashchange", así que se abre aquí.
      if (a.getAttribute('href') === location.hash) abrirDetallesDelAncla();
      if (/^https:\/\/wa\.me\//.test(a.href)) track('whatsapp_click', { origen: a.dataset.origen || 'enlace' });
      if (a.dataset.evento === 'pqr_open') track('pqr_open', { origen: a.closest('footer') ? 'pie' : 'soporte' });
    });
  }

  /* ===========================================================================
     12. API PÚBLICA (para coverage.js) E INICIO
     =========================================================================== */
  window.OneClic = Object.freeze({
    CFG, el, agregar, icono, fmt, parseFecha, cargarJSON, datosJSON, nombresMunicipios,
    local, sesion, enlaceWhatsApp, mensajeWA, enlaceWA, enlaceLinea, nombreLinea, menosMovimiento, irA,
    track, prefillLead, filtrarPlanes, estado
  });

  hidratarContacto();
  iniciarNavegacion();
  avisoBorrador();
  Consentimiento.iniciar();
  iniciarFormularioContacto();
  iniciarPQR();
  iniciarPlanes();
  iniciarEstadoServicio();
  iniciarIndicadores();
  eventosGlobales();
  abrirDetallesDelAncla();
  tablasDesplazables();
})();
