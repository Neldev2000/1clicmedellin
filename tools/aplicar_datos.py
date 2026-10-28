#!/usr/bin/env python3
"""
aplicar_datos.py · 1clic
========================

Copia los datos de `datos-empresa.ini` (teléfonos, correos, NIT, horarios, oficina,
redes y mensajes de WhatsApp) a todo el sitio:

  - assets/js/config.js   bloque "DATOS DE LA EMPRESA" (lo usa el JavaScript);
  - las 13 páginas HTML   enlaces wa.me, tel: y mailto:, textos visibles y la versión
                          que se ve sin JavaScript (elementos con data-wa, data-contacto,
                          data-correo y data-config);
  - index.html            datos estructurados de la organización y de las preguntas
                          frecuentes (JSON-LD), que se recalculan desde el texto visible.

Teléfonos: el número "principal" se usa para WhatsApp, llamadas y la línea de atención,
salvo que se escriba uno distinto para alguno. La línea se anuncia como "línea de atención";
solo si es un número 01 8000 se anuncia como "línea gratuita" (nunca se llama gratuita a
un celular). La tarjeta "Celular" se oculta si repite el número de la línea.

    python3 tools/aplicar_datos.py               # aplica los cambios
    python3 tools/aplicar_datos.py --comprobar   # solo revisa (código 1 si falta aplicar)

Un campo vacío se publica como [•] (pendiente). Solo usa la biblioteca estándar.
tools/servidor_local.py lo ejecuta solo cuando cambia datos-empresa.ini.
"""
from __future__ import annotations

import argparse
import configparser
import difflib
import html
import json
import os
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ARCHIVO_DATOS = RAIZ / "datos-empresa.ini"
CONFIG_JS = RAIZ / "assets" / "js" / "config.js"
SITIO = "https://1clic.company"
PENDIENTE = "[•]"
MARCA_INICIO = "/* >>> DATOS DE LA EMPRESA"
MARCA_FIN = "/* <<< FIN DE LOS DATOS DE LA EMPRESA */"

CORREOS = {"soporte": "soporte", "pqr": "pqr", "datos_personales": "datosPersonales", "empresas": "empresas"}
REDES = ("facebook", "instagram", "tiktok", "x", "youtube", "linkedin")
MENSAJES = {
    "general": ("general", "Hola 1clic, quiero información sobre el internet por fibra óptica."),
    "soporte": ("soporte", "Hola 1clic, necesito soporte técnico con mi servicio."),
    "pqr": ("pqr", "Hola 1clic, quiero radicar o consultar una PQR."),
    "empresas": ("empresas", "Hola 1clic, quiero hablar con un asesor de Empresas sobre un enlace dedicado."),
    "datos_personales": ("datos", "Hola 1clic, quiero ejercer mis derechos sobre mis datos personales."),
}
# Valores de reserva mientras un teléfono esté pendiente.
RESERVA_TEL = {
    "whatsapp": {"numero": "+57XXXXXXXXXX", "wa": "57XXXXXXXXXX", "texto": "+57 [•]", "gratuita": False},
    "celular": {"numero": "+57XXXXXXXXXX", "wa": "", "texto": "+57 [•]", "gratuita": False},
    "linea": {"numero": "+57XXXXXXXXXX", "wa": "", "texto": "+57 [•]", "gratuita": False},
}
NOMBRES_LINEA = {
    True: {"nombre": "línea gratuita", "titulo": "Línea gratuita", "nota": "Línea nacional sin costo."},
    False: {"nombre": "línea de atención", "titulo": "Línea de atención", "nota": "Llamadas de atención al cliente."},
}


class ErrorDatos(Exception):
    """Datos inválidos en datos-empresa.ini (el mensaje explica cómo corregirlos)."""


# ---------------------------------------------------------------------------
# Lectura y validación
# ---------------------------------------------------------------------------
def leer_telefono(crudo: str, campo: str, errores: list, permite_gratuita: bool) -> dict | None:
    """Celular (3XX) o fijo (60X) de 10 dígitos, con o sin +57; o, si se permite, una línea 01 8000."""
    if not crudo:
        return None
    d = re.sub(r"\D", "", crudo)
    if d.startswith("018000"):
        if not permite_gratuita:
            errores.append(f"[telefonos] {campo} = {crudo}: una línea 01 8000 solo puede ir en linea_atencion.")
            return None
        if len(d) != 12:
            errores.append(f"[telefonos] {campo} = {crudo}: la línea gratuita tiene 12 dígitos (01 8000 XXX XXX).")
            return None
        return {"numero": d, "wa": "", "texto": f"01 8000 {d[6:9]} {d[9:]}", "gratuita": True}
    if len(d) == 12 and d.startswith("57"):
        d = d[2:]
    if len(d) != 10 or not (d.startswith("3") or d.startswith("60")):
        errores.append(f"[telefonos] {campo} = {crudo}: escribe un número colombiano de 10 dígitos "
                       "(celular que empieza por 3 o fijo que empieza por 60), con o sin +57.")
        return None
    return {"numero": "+57" + d, "wa": "57" + d, "texto": f"+57 {d[:3]} {d[3:6]} {d[6:]}", "gratuita": False}


def leer_datos(ruta: Path = ARCHIVO_DATOS) -> dict:
    if not ruta.exists():
        raise ErrorDatos(f"No existe {ruta.name} en {ruta.parent}.")
    cp = configparser.ConfigParser(interpolation=None)
    try:
        with ruta.open(encoding="utf-8") as f:
            cp.read_file(f)
    except configparser.Error as exc:
        raise ErrorDatos(f"{ruta.name} tiene un error de formato: {exc}") from None

    errores: list[str] = []
    valor = lambda seccion, clave: cp.get(seccion, clave, fallback="").strip()

    principal = leer_telefono(valor("telefonos", "principal"), "principal", errores, permite_gratuita=False)
    propio = {
        "whatsapp": leer_telefono(valor("telefonos", "whatsapp"), "whatsapp", errores, False),
        "celular": leer_telefono(valor("telefonos", "celular"), "celular", errores, False),
        # linea_gratuita: nombre anterior del campo (se sigue aceptando)
        "linea": leer_telefono(valor("telefonos", "linea_atencion") or valor("telefonos", "linea_gratuita"),
                               "linea_atencion", errores, True),
    }
    telefonos = {canal: numero or principal for canal, numero in propio.items()}

    def correo(clave: str) -> str:
        crudo = valor("correos", clave)
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[A-Za-z]{2,}", crudo or ""):
            errores.append(f"[correos] {clave} = {crudo or '(vacío)'}: escribe un correo válido "
                           "(puedes repetir el mismo en todas las líneas).")
        return crudo

    def texto(seccion: str, clave: str) -> str:
        return valor(seccion, clave) or PENDIENTE

    datos = {
        "empresa": {
            "nit": texto("empresa", "nit"),
            "registroTic": texto("empresa", "registro_tic"),
            "domicilio": texto("empresa", "domicilio"),
            "direccion": texto("empresa", "direccion"),
        },
        "tel": telefonos,
        "correos": {destino: correo(clave) for clave, destino in CORREOS.items()},
        "horarios": {"comercial": texto("horarios", "atencion_comercial"), "fallas": texto("horarios", "reporte_de_fallas")},
        "oficina": {
            "municipio": texto("oficina_principal", "municipio"),
            "direccion": texto("oficina_principal", "direccion"),
            "horario": texto("oficina_principal", "horario"),
        },
        "puntos": [],
        "redes": {},
        "mensajes": {},
    }
    for seccion in sorted((s for s in cp.sections() if re.fullmatch(r"punto_atencion_\d+", s)), key=lambda s: int(s.rsplit("_", 1)[1])):
        punto = {k: valor(seccion, k) for k in ("municipio", "direccion", "horario")}
        if not punto["direccion"]:
            errores.append(f"[{seccion}] falta la dirección.")
        datos["puntos"].append(punto)
    for red in REDES:
        url = valor("redes", red)
        if url and not re.fullmatch(r"https://[^\s\"'<>]+", url):
            errores.append(f"[redes] {red} = {url}: escribe la dirección completa que empieza por https://")
            url = ""
        datos["redes"][red] = url or None
    for clave, (destino, defecto) in MENSAJES.items():
        datos["mensajes"][destino] = valor("mensajes_whatsapp", clave) or defecto

    if errores:
        raise ErrorDatos("Revisa datos-empresa.ini:\n  - " + "\n  - ".join(errores))
    return datos


def tel(datos: dict, canal: str) -> dict:
    return datos["tel"].get(canal) or RESERVA_TEL[canal]


def nombres_linea(datos: dict) -> dict:
    return NOMBRES_LINEA[bool(tel(datos, "linea")["gratuita"])]


def celular_repetido(datos: dict) -> bool:
    """La tarjeta "Celular" sobra si muestra el mismo número que la línea de atención."""
    cel, linea = datos["tel"]["celular"], datos["tel"]["linea"]
    return bool(cel and linea and cel["numero"] == linea["numero"])


# ---------------------------------------------------------------------------
# config.js
# ---------------------------------------------------------------------------
def js(valor) -> str:
    if valor is None:
        return "null"
    return "'" + str(valor).replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ") + "'"


def bloque_config(datos: dict) -> str:
    e, c, h, o = datos["empresa"], datos["correos"], datos["horarios"], datos["oficina"]
    wa, cel, linea, nl = tel(datos, "whatsapp"), tel(datos, "celular"), tel(datos, "linea"), nombres_linea(datos)
    puntos = ",\n".join(
        f"        {{ municipio: {js(p['municipio'])}, direccion: {js(p['direccion'])}, horario: {js(p['horario'])} }}"
        for p in datos["puntos"])
    redes = ",\n".join(f"        {red}: {js(datos['redes'][red])}" for red in REDES)
    mensajes = ",\n".join(f"      {clave}: {js(texto)}" for clave, texto in datos["mensajes"].items())
    return f"""    {MARCA_INICIO} · generado por tools/aplicar_datos.py desde datos-empresa.ini.
       No edites este bloque: cambia datos-empresa.ini y ejecuta el script. */
    empresa: {{
      razonSocial: '1 CLIC S.A.S.',
      nit: {js(e['nit'])},
      registroTic: {js(e['registroTic'])},
      domicilio: {js(e['domicilio'])},
      direccion: {js(e['direccion'])}
    }},

    /* Canales de atención. "numero" alimenta los enlaces (wa.me / tel:); "texto" es lo que se lee.
       "linea" se llama "línea gratuita" solo si es una 01 8000; si no, "línea de atención". */
    contacto: {{
      whatsapp: {{ numero: {js(wa['wa'])}, texto: {js(wa['texto'])} }},
      linea: {{ numero: {js(linea['numero'])}, texto: {js(linea['texto'])}, nombre: {js(nl['nombre'])}, titulo: {js(nl['titulo'])}, nota: {js(nl['nota'])} }},
      celular: {{ numero: {js(cel['numero'])}, texto: {js(cel['texto'])} }},
      correos: {{
        soporte: {js(c['soporte'])},
        pqr: {js(c['pqr'])},
        datosPersonales: {js(c['datosPersonales'])},
        empresas: {js(c['empresas'])}
      }},
      horarios: {{ comercial: {js(h['comercial'])}, fallas: {js(h['fallas'])} }},
      oficinaPrincipal: {{ municipio: {js(o['municipio'])}, direccion: {js(o['direccion'])}, horario: {js(o['horario'])} }},
      puntosAtencion: [{chr(10) + puntos + chr(10) + '      ' if puntos else ''}],
      /* Redes: URL completa o null. Con null el enlace NO se muestra (nunca "#"). */
      redes: {{
{redes}
      }}
    }},

    /* Mensajes prellenados de WhatsApp según el contexto. */
    whatsapp: {{
{mensajes}
    }},
    {MARCA_FIN}"""


def actualizar_config(texto: str, datos: dict) -> str:
    inicio = texto.find(MARCA_INICIO)
    fin = texto.find(MARCA_FIN)
    if inicio < 0 or fin < 0:
        raise ErrorDatos("config.js no tiene las marcas del bloque DATOS DE LA EMPRESA.")
    inicio = texto.rfind("\n", 0, inicio) + 1
    fin = fin + len(MARCA_FIN)
    return texto[:inicio] + bloque_config(datos) + texto[fin:]


# ---------------------------------------------------------------------------
# HTML
# ---------------------------------------------------------------------------
RE_ETIQUETA_A = re.compile(r"<a\b[^>]*>")
RE_TEXTO = re.compile(r"<(a|span|dd)\b([^>]*)>([^<]*)</\1>")
RE_TARJETA_CELULAR = re.compile(r'<article class="canal" data-canal="celular"( hidden)?>')
RE_LD = re.compile(r'(  <script type="application/ld\+json">\n)(.*?)(\n  </script>)', re.S)
RE_FAQ = re.compile(r'<details class="faq-item" id="[^"]*">\s*<summary>(.*?)</summary>\s*'
                    r'<div class="faq-respuesta">\s*(.*?)\s*</div>\s*</details>', re.S)


def atributo(etiqueta: str, nombre: str) -> str | None:
    m = re.search(r"\b" + nombre + r'="([^"]*)"', etiqueta)
    return m.group(1) if m else None


def valor_config(datos: dict, ruta: str) -> str | None:
    nl = nombres_linea(datos)
    rutas = {
        "empresa.nit": datos["empresa"]["nit"],
        "empresa.registroTic": datos["empresa"]["registroTic"],
        "empresa.domicilio": datos["empresa"]["domicilio"],
        "empresa.direccion": datos["empresa"]["direccion"],
        "contacto.whatsapp.texto": tel(datos, "whatsapp")["texto"],
        "contacto.linea.nombre": nl["nombre"],
        "contacto.linea.titulo": nl["titulo"],
        "contacto.linea.nota": nl["nota"],
        "contacto.horarios.comercial": datos["horarios"]["comercial"],
        "contacto.horarios.fallas": datos["horarios"]["fallas"],
        "contacto.oficinaPrincipal.municipio": datos["oficina"]["municipio"],
        "contacto.oficinaPrincipal.direccion": datos["oficina"]["direccion"],
        "contacto.oficinaPrincipal.horario": datos["oficina"]["horario"],
    }
    return rutas.get(ruta)


def href_nuevo(etiqueta: str, datos: dict) -> str | None:
    canal = atributo(etiqueta, "data-contacto")
    if canal in ("linea", "celular"):
        return "tel:" + tel(datos, canal)["numero"]
    rol = atributo(etiqueta, "data-correo")
    if rol in datos["correos"]:
        return "mailto:" + datos["correos"][rol]
    if atributo(etiqueta, "data-wa") is not None or 'href="https://wa.me/' in etiqueta:
        return "https://wa.me/" + tel(datos, "whatsapp")["wa"]
    return None


def actualizar_enlaces(texto: str, datos: dict) -> str:
    def inicio(m):
        etiqueta = m.group(0)
        href = href_nuevo(etiqueta, datos)
        if href is None:
            return etiqueta
        return re.sub(r'\bhref="[^"]*"', 'href="' + html.escape(href) + '"', etiqueta, count=1)

    def contenido(m):
        nombre, attrs, interior = m.groups()
        nuevo = None
        ruta = atributo(attrs, "data-config")
        if ruta:
            nuevo = valor_config(datos, ruta)
        elif nombre == "a" and "data-solo-href" not in attrs:
            canal = atributo(attrs, "data-contacto")
            rol = atributo(attrs, "data-correo")
            if canal in ("linea", "celular"):
                nuevo = tel(datos, canal)["texto"]
            elif rol in datos["correos"]:
                nuevo = datos["correos"][rol]
        if nuevo is None:
            return m.group(0)
        return f"<{nombre}{attrs}>{html.escape(nuevo, quote=False)}</{nombre}>"

    texto = RE_ETIQUETA_A.sub(inicio, texto)
    texto = RE_TEXTO.sub(contenido, texto)
    oculta = " hidden" if celular_repetido(datos) else ""
    return RE_TARJETA_CELULAR.sub(f'<article class="canal" data-canal="celular"{oculta}>', texto)


def puntos_contacto(datos: dict) -> list[dict]:
    puntos = []
    linea, wa, cel = (datos["tel"][k] for k in ("linea", "whatsapp", "celular"))
    base = {"@type": "ContactPoint", "availableLanguage": "es"}
    if linea:
        puntos.append({**base, "contactType": "customer service", "name": nombres_linea(datos)["titulo"],
                       "telephone": linea["texto"], "areaServed": "CO"})
    if wa:
        puntos.append({**base, "contactType": "customer service", "name": "WhatsApp", "telephone": wa["texto"], "url": "https://wa.me/" + wa["wa"]})
    if cel and not celular_repetido(datos) and (not wa or cel["numero"] != wa["numero"]):
        puntos.append({**base, "contactType": "customer service", "name": "Celular", "telephone": cel["texto"]})
    c = datos["correos"]
    puntos += [
        {**base, "contactType": "technical support", "name": "Soporte por correo", "email": c["soporte"]},
        {**base, "contactType": "customer service", "name": "Peticiones, quejas y recursos (PQR)", "email": c["pqr"], "url": SITIO + "/legal/pqr.html"},
        {**base, "contactType": "sales", "name": "Empresas e instituciones", "email": c["empresas"]},
        {**base, "contactType": "customer service", "name": "Protección de datos personales", "email": c["datosPersonales"]},
    ]
    return puntos


def texto_plano(fragmento: str) -> str:
    """Texto visible de una respuesta: sin marcas [VALIDAR] ni etiquetas (igual que el FAQ de la página)."""
    t = re.sub(r'<mark class="validar">.*?</mark>', "", fragmento, flags=re.S)
    t = re.sub(r"<svg\b.*?</svg>", "", t, flags=re.S)
    t = re.sub(r"</(p|li)>", " ", t)
    t = html.unescape(re.sub(r"<[^>]+>", "", t))
    return re.sub(r"\s+", " ", t).replace(" .", ".").strip()


def actualizar_jsonld(texto: str, datos: dict) -> str:
    faq = [{"@type": "Question", "name": texto_plano(q), "acceptedAnswer": {"@type": "Answer", "text": texto_plano(a)}}
           for q, a in RE_FAQ.findall(texto)]

    def bloque(m):
        try:
            obj = json.loads(m.group(2))
        except json.JSONDecodeError:
            return m.group(0)
        if isinstance(obj, dict) and "@graph" in obj:
            for nodo in obj["@graph"]:
                if nodo.get("@type") == "Organization":
                    nodo["taxID"] = datos["empresa"]["nit"]
                    nodo.setdefault("address", {})["streetAddress"] = datos["empresa"]["direccion"]
                    nodo["address"]["addressLocality"] = datos["empresa"]["domicilio"]
                    nodo["contactPoint"] = puntos_contacto(datos)
        elif isinstance(obj, dict) and obj.get("@type") == "FAQPage" and faq:
            obj["mainEntity"] = faq
        else:
            return m.group(0)
        cuerpo = json.dumps(obj, ensure_ascii=False, indent=2).replace("\n", "\n  ").replace("</", "<\\/")
        return m.group(1) + cuerpo + m.group(3)

    return RE_LD.sub(bloque, texto)


# ---------------------------------------------------------------------------
# Programa
# ---------------------------------------------------------------------------
def paginas() -> list[Path]:
    return [RAIZ / "index.html", RAIZ / "404.html", *sorted((RAIZ / "legal").glob("*.html"))]


def escribir(ruta: Path, texto: str) -> None:
    """Escritura atómica: el servidor local nunca lee un archivo a medias."""
    temporal = ruta.with_name("." + ruta.name + ".tmp")
    temporal.write_text(texto, encoding="utf-8")
    os.replace(temporal, ruta)


def aplicar(escribir_cambios: bool = True) -> dict[str, int]:
    """Aplica datos-empresa.ini. Devuelve {archivo: líneas cambiadas}. Lanza ErrorDatos si hay errores."""
    datos = leer_datos()
    cambios: dict[str, int] = {}
    objetivos = [(CONFIG_JS, lambda t: actualizar_config(t, datos))]
    objetivos += [(p, lambda t: actualizar_jsonld(actualizar_enlaces(t, datos), datos)) for p in paginas()]
    for ruta, transformar in objetivos:
        actual = ruta.read_text(encoding="utf-8")
        nuevo = transformar(actual)
        if nuevo != actual:
            diferencia = difflib.unified_diff(actual.splitlines(), nuevo.splitlines(), lineterm="", n=0)
            cambios[str(ruta.relative_to(RAIZ))] = sum(1 for l in diferencia if l.startswith("+") and not l.startswith("+++"))
            if escribir_cambios:
                escribir(ruta, nuevo)
    return cambios


def resumen(datos: dict) -> str:
    filas = []
    for etiqueta, canal in (("WhatsApp", "whatsapp"), (nombres_linea(datos)["titulo"], "linea"), ("Celular", "celular")):
        x = datos["tel"][canal]
        nota = " (tarjeta oculta: repite la línea)" if canal == "celular" and celular_repetido(datos) else ""
        filas.append((etiqueta, (x["texto"] if x else "pendiente [•]") + nota))
    correos = datos["correos"]
    if len(set(correos.values())) == 1:
        filas.append(("Correos", f"{next(iter(correos.values()))} (soporte, PQR, datos personales y empresas)"))
    else:
        filas += [(f"Correo {k}", v) for k, v in correos.items()]
    pendientes = [n for n, v in (("NIT", datos["empresa"]["nit"]), ("Registro TIC", datos["empresa"]["registroTic"]),
                                 ("domicilio", datos["empresa"]["domicilio"]), ("dirección", datos["empresa"]["direccion"]),
                                 ("horarios", datos["horarios"]["comercial"]), ("oficina principal", datos["oficina"]["direccion"]))
                  if v == PENDIENTE]
    if pendientes:
        filas.append(("Pendientes [•]", ", ".join(pendientes)))
    return "\n".join(f"  {a:<18} {b}" for a, b in filas)


def main() -> None:
    p = argparse.ArgumentParser(description="Aplica datos-empresa.ini a config.js y a las 13 páginas del sitio.")
    p.add_argument("--comprobar", action="store_true", help="No escribe; termina con código 1 si falta aplicar algo.")
    args = p.parse_args()
    try:
        datos = leer_datos()
        cambios = aplicar(escribir_cambios=not args.comprobar)
    except ErrorDatos as exc:
        print(exc, file=sys.stderr)
        sys.exit(2)

    print("Datos de datos-empresa.ini\n" + resumen(datos) + "\n")
    if args.comprobar:
        if cambios:
            print("Falta aplicar los datos en:\n  " + "\n  ".join(cambios) + "\nEjecuta: python3 tools/aplicar_datos.py")
            sys.exit(1)
        print("OK: el sitio ya tiene estos datos.")
        return
    if cambios:
        print("Archivos actualizados:")
        for ruta, n in cambios.items():
            print(f"  {ruta:<36} {n} líneas")
        print("\nListo. Recarga el navegador para ver los cambios.")
    else:
        print("El sitio ya tenía estos datos: no hubo cambios.")


if __name__ == "__main__":
    main()
