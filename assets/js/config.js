/**
 * 1clic · config.js
 * -----------------------------------------------------------------------------
 * Configuración central del sitio: endpoints, proveedores externos y banderas.
 *
 * Reglas
 *  - Los DATOS DE LA EMPRESA (teléfonos, correos, NIT, horarios, oficina, redes y
 *    mensajes de WhatsApp) NO se editan aquí: se editan en /datos-empresa.ini y se
 *    aplican con `python3 tools/aplicar_datos.py` (o solos con tools/servidor_local.py).
 *    El script reescribe el bloque marcado más abajo y el HTML de las 13 páginas.
 *  - Este archivo es PÚBLICO: aquí no van claves privadas, tokens de API ni secretos.
 *  - Los valores marcados [•] (y los números con XXXX) los completa la empresa.
 *  - Si activas un servicio externo (analítica, Turnstile, geocodificador, otro
 *    proveedor de teselas o un endpoint en otro dominio), agrega su dominio a la
 *    Content-Security-Policy de /_headers (el README tiene cada línea).
 */
(function () {
  'use strict';

  /** Congela el objeto completo para que ningún script lo modifique por error. */
  function congelar(obj) {
    Object.values(obj).forEach(function (v) {
      if (v && typeof v === 'object') congelar(v);
    });
    return Object.freeze(obj);
  }

  window.CONFIG = congelar({
    version: '1.0.0',

    sitio: {
      url: 'https://1clic.company',
      nombre: '1clic',
      descriptor: 'Conectando Colombia',
      eslogan: 'Tu región, a un clic.'
    },

    /* >>> DATOS DE LA EMPRESA · generado por tools/aplicar_datos.py desde datos-empresa.ini.
       No edites este bloque: cambia datos-empresa.ini y ejecuta el script. */
    empresa: {
      razonSocial: '1 CLIC S.A.S.',
      nit: '[•]',
      registroTic: '[•]',
      domicilio: '[•]',
      direccion: '[•]'
    },

    /* Canales de atención. "numero" alimenta los enlaces (wa.me / tel:); "texto" es lo que se lee.
       "linea" se llama "línea gratuita" solo si es una 01 8000; si no, "línea de atención". */
    contacto: {
      whatsapp: { numero: '573118666709', texto: '+57 311 866 6709' },
      linea: { numero: '+573118666709', texto: '+57 311 866 6709', nombre: 'línea de atención', titulo: 'Línea de atención', nota: 'Llamadas de atención al cliente.' },
      celular: { numero: '+573118666709', texto: '+57 311 866 6709' },
      correos: {
        soporte: 'comercial@1clic.company',
        pqr: 'comercial@1clic.company',
        datosPersonales: 'comercial@1clic.company',
        empresas: 'comercial@1clic.company'
      },
      horarios: { comercial: '[•]', fallas: '[•]' },
      oficinaPrincipal: { municipio: '[•]', direccion: '[•]', horario: '[•]' },
      puntosAtencion: [],
      /* Redes: URL completa o null. Con null el enlace NO se muestra (nunca "#"). */
      redes: {
        facebook: null,
        instagram: null,
        tiktok: null,
        x: null,
        youtube: null,
        linkedin: null
      }
    },

    /* Mensajes prellenados de WhatsApp según el contexto. */
    whatsapp: {
      general: 'Hola 1clic, quiero información sobre el internet por fibra óptica.',
      soporte: 'Hola 1clic, necesito soporte técnico con mi servicio.',
      pqr: 'Hola 1clic, quiero radicar o consultar una PQR.',
      empresas: 'Hola 1clic, quiero hablar con un asesor de Empresas sobre un enlace dedicado.',
      datos: 'Hola 1clic, quiero ejercer mis derechos sobre mis datos personales.'
    },
    /* <<< FIN DE LOS DATOS DE LA EMPRESA */

    /* Endpoints del backend (null = no configurado). Contratos en el README.
       leads:     POST JSON          → { "radicado": "..." } (opcional)
       pqr:       POST multipart     → { "cun": "..." }
       pqrStatus: GET ?cun=...       → { "cun", "estado", "tipo", "fecha_radicacion", ... } */
    endpoints: {
      leads: null,
      pqr: null,
      pqrStatus: null,
      timeoutMs: 15000
    },

    /* Antispam: campo trampa (siempre activo) + tiempo mínimo de llenado.
       Cloudflare Turnstile es opcional: requiere siteKey pública y validar el token en el backend. */
    antispam: {
      tiempoMinimoMs: 3000
    },
    turnstile: {
      enabled: false,
      siteKey: '',
      script: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    },

    /* Mapa de cobertura. Para producción usa un proveedor con licencia comercial
       (MapTiler, Stadia Maps o CARTO): los servidores de teselas de OpenStreetMap
       no están pensados para uso comercial intensivo. */
    map: {
      tiles: {
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" rel="noopener noreferrer" target="_blank">colaboradores de OpenStreetMap</a>',
        maxZoom: 19
      },
      vistaInicial: { centro: [7.35, -76.2], zoom: 8 },
      leaflet: {
        js: '/assets/vendor/leaflet/leaflet.js',
        css: '/assets/vendor/leaflet/leaflet.css'
      }
    },

    /* Geocodificación de direcciones (opcional, desactivada). Nunca reemplaza la búsqueda por barrio.
       provider 'nominatim' usa la API pública de OSM (máx. 1 consulta/s; para volumen, servidor propio).
       provider 'custom' llama a url?q=...&municipio=... y espera { lat, lon }. */
    geocoder: {
      enabled: false,
      provider: 'nominatim',
      url: 'https://nominatim.openstreetmap.org/search',
      email: '',
      rateLimitMs: 1100,
      cacheMax: 50,
      timeoutMs: 8000
    },

    /* Analítica: solo se carga si la persona acepta las cookies de analítica.
       provider: 'plausible' | 'matomo' | 'ga4' | null. Nunca se envían datos personales. */
    analytics: {
      enabled: false,
      provider: null,
      plausible: { domain: '1clic.company', src: 'https://plausible.io/js/script.manual.js' },
      matomo: { url: '', siteId: '' },          // url terminada en "/", p. ej. https://analitica.1clic.company/
      ga4: { measurementId: '' },               // G-XXXXXXXXXX
      precisionCoordenadas: 3                    // 3 decimales ≈ 110 m; 0 = no enviar coordenadas
    },

    cookies: {
      version: '1.0',
      storageKey: '1clic.consentimiento',
      vigenciaDias: 365
    },

    legal: {
      borrador: true,                            // false cuando jurídica apruebe los textos
      ultimaActualizacion: '2026-10-22',
      politicaDatos: { version: '1.0', vigenteDesde: '2026-10-22' }
    },

    datos: {
      planes: '/data/planes.json',
      localidades: '/data/localidades.json',
      cobertura: '/data/cobertura.geojson',
      indicadores: '/data/indicadores.json',
      estadoServicio: '/data/estado-servicio.json'
    },

    flags: {
      estadoServicio: true,                      // barra superior y bloque de estado en Soporte
      ofertasJsonLd: true                        // datos estructurados de ofertas (solo si planes no es muestra)
    }
  });
})();
