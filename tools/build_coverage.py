#!/usr/bin/env python3
"""
build_coverage.py · 1clic · Conectando Colombia
================================================

Genera ``data/cobertura.geojson`` (áreas servibles por sector) a partir del
inventario de red, listo para el mapa y el buscador de cobertura del sitio.

Entrada
-------
1. Inventario de cajas NAP en CSV (coma o punto y coma, UTF-8):
       nap_id, lat, lon, municipio, sector, estado, fecha_estimada, hp
   - municipio: código de ``data/localidades.json`` (APT, TUR, SCR…).
   - estado: disponible | en_construccion | proximamente (se aceptan tildes y espacios).
   - fecha_estimada: AAAA-MM, AAAA-MM-DD, MM/AAAA o DD/MM/AAAA (solo para en_construccion).
   - hp: hogares y negocios pasados (home passes) que atiende la caja.
   Columnas opcionales: ``tipo`` (barrio, vereda, sector…) y ``actualizado`` (AAAA-MM-DD).
2. Opcional: polígonos de barrios o veredas (GeoJSON, GPKG o SHP) con columnas
   ``municipio`` y ``sector`` (y opcionalmente ``tipo``) para recortar las áreas.

Proceso
-------
- Modo ``buffer`` (por defecto): zona de influencia de ``--radio-m`` metros (150) alrededor
  de cada NAP, disuelta por municipio + sector + estado y recortada con el polígono del sector.
- Modo ``h3``: agrega las NAP en celdas H3 de resolución 9 (``--h3-res``).
- Privacidad: nunca exporta NAP, direcciones ni hogares individuales; elimina las áreas o
  celdas con menos de ``--min-hp`` hogares pasados (5).
- Resuelve solapes: cada punto del mapa pertenece a un solo sector (prioridad
  disponible > en_construccion > proximamente).
- Optimiza: simplifica (``--tolerancia-m`` 8), corrige geometrías con ``make_valid``,
  redondea a 5 decimales y controla el presupuesto de ≤ 250 KB por tramo. Si el archivo
  supera el presupuesto, se divide en ``cobertura-T1.geojson`` y ``cobertura-T2.geojson``
  y ``cobertura.geojson`` queda como índice (``metadata.partes``); el sitio lo entiende solo.

Salida
------
- ``data/cobertura.geojson`` en WGS84 con ``metadata`` (version, generado, fuente, es_muestra…).
- Actualiza ``estado_general`` en ``data/localidades.json`` (mejor estado de cada municipio).
- Regenera la tabla de respaldo sin JavaScript de ``index.html`` (entre los marcadores
  ``COBERTURA-RESPALDO``).
- Reporte en consola: sectores por estado, hogares pasados por municipio y tamaño de archivos.

Modo demostración
-----------------
``--demo`` genera un inventario sintético alrededor de cabeceras y centros poblados reales
y produce datos marcados ``es_muestra: true``. El sitio muestra entonces el aviso
"Mapa de demostración: los datos de cobertura son ilustrativos.".

Requisitos: Python 3.11+, pandas, geopandas (>= 0.14), shapely (>= 2.0), h3 (>= 4, solo modo h3).

Ejemplos
--------
    python tools/build_coverage.py --demo
    python tools/build_coverage.py --inventario red/inventario_nap.csv --fuente "Inventario NOC 2026-11"
    python tools/build_coverage.py --inventario red/inventario_nap.csv --poligonos red/barrios.gpkg
    python tools/build_coverage.py --inventario red/inventario_nap.csv --modo h3
"""
from __future__ import annotations

import argparse
import html
import json
import math
import random
import re
import sys
import unicodedata
from datetime import date, datetime, timezone
from pathlib import Path

try:
    import pandas as pd
    import geopandas as gpd
    import shapely
    from shapely.geometry import MultiPolygon, Point, Polygon, mapping, shape
    from shapely.validation import make_valid
except ImportError as exc:  # pragma: no cover - mensaje de ayuda
    sys.exit(f"Falta una dependencia ({exc.name}). Instala: pip install pandas geopandas shapely h3")

RAIZ = Path(__file__).resolve().parent.parent
ESTADOS = ("disponible", "en_construccion", "proximamente")
PRIORIDAD = {estado: i for i, estado in enumerate(ESTADOS)}
ETIQUETA_ESTADO = {
    "disponible": "Disponible",
    "en_construccion": "En construcción",
    "proximamente": "Próximamente",
}
SINONIMOS_ESTADO = {
    "disponible": "disponible", "activo": "disponible", "operativo": "disponible",
    "en_construccion": "en_construccion", "construccion": "en_construccion", "en_obra": "en_construccion",
    "proximamente": "proximamente", "planeado": "proximamente", "expansion": "proximamente",
    "plan_de_expansion": "proximamente",
}
TIPOS_POR_PREFIJO = (
    ("barrio", "barrio"), ("vereda", "vereda"), ("urbanizacion", "urbanizacion"),
    ("corregimiento", "corregimiento"), ("centro poblado", "centro_poblado"), ("sector", "sector"),
)
CRS_METRICO = ("EPSG:9377", "EPSG:32618")  # MAGNA-SIRGAS Origen-Nacional; respaldo UTM 18N
MESES = ("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
         "septiembre", "octubre", "noviembre", "diciembre")
MARCA_INICIO = "<!-- COBERTURA-RESPALDO:INICIO"
MARCA_FIN = "<!-- COBERTURA-RESPALDO:FIN -->"


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------
def sin_tildes(texto: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn")


def clave(texto: str) -> str:
    """Clave de comparación: minúsculas, sin tildes ni signos y con espacios simples."""
    return re.sub(r"[^a-z0-9]+", " ", sin_tildes(str(texto)).lower()).strip()


def normalizar_estado(valor) -> str | None:
    k = clave(valor).replace(" ", "_")
    return SINONIMOS_ESTADO.get(k)


ABREVIATURAS_SECTOR = (
    (r"^(?:b\s*/|brr?\.?|bo\.)\s*", "Barrio "),
    (r"^(?:vda|vrda|ver)\.?\s+", "Vereda "),
    (r"^urb\.?\s+", "Urbanización "),
    (r"^(?:sect?|sec)\.?\s+", "Sector "),
    (r"^(?:corr|cgto)\.?\s+", "Corregimiento "),
    (r"^c\.\s?p\.?\s+", "Centro poblado "),
)


def limpiar_sector(nombre: str) -> str:
    """Publica nombres legibles: 'B/ Ortiz' → 'Barrio Ortiz', 'Vda. El Llano' → 'Vereda El Llano'."""
    texto = re.sub(r"\s+", " ", str(nombre)).strip()
    for patron, reemplazo in ABREVIATURAS_SECTOR:
        nuevo = re.sub(patron, reemplazo, texto, count=1, flags=re.IGNORECASE)
        if nuevo != texto:
            return nuevo.strip()
    return texto


def inferir_tipo(sector: str, tipo: str | None = None) -> str:
    if tipo and clave(tipo):
        return clave(tipo).replace(" ", "_")
    k = clave(sector)
    for prefijo, valor in TIPOS_POR_PREFIJO:
        if k.startswith(prefijo + " "):
            return valor
    return "sector"


def normalizar_fecha(valor) -> str | None:
    """Devuelve AAAA-MM (precisión de mes, que es lo que publica el sitio)."""
    if valor is None or (isinstance(valor, float) and math.isnan(valor)):
        return None
    texto = str(valor).strip()
    if not texto or texto.lower() in {"nan", "none", "null", "-"}:
        return None
    for patron, orden in ((r"^(\d{4})-(\d{1,2})(?:-\d{1,2})?$", "am"),
                          (r"^(\d{1,2})/(\d{4})$", "ma"),
                          (r"^\d{1,2}/(\d{1,2})/(\d{4})$", "ma")):
        m = re.match(patron, texto)
        if m:
            anio, mes = (m.group(1), m.group(2)) if orden == "am" else (m.group(2), m.group(1))
            mes_i = int(mes)
            if 1 <= mes_i <= 12:
                return f"{int(anio):04d}-{mes_i:02d}"
    raise ValueError(f"fecha_estimada no reconocida: {texto!r}")


def fecha_larga(iso: str) -> str:
    d = date.fromisoformat(iso[:10])
    return f"{d.day} de {MESES[d.month - 1]} de {d.year}"


def mes_anio(aaaamm: str | None) -> str:
    if not aaaamm:
        return ""
    anio, mes = aaaamm.split("-")
    return f"{MESES[int(mes) - 1]} de {anio}"


def crs_metrico() -> str:
    from pyproj import CRS
    for codigo in CRS_METRICO:
        try:
            CRS.from_user_input(codigo)
            return codigo
        except Exception:  # noqa: BLE001 - se prueba el siguiente
            continue
    raise RuntimeError("No hay un CRS métrico disponible en PROJ.")


def redondear(coords, decimales: int = 5):
    if isinstance(coords, (list, tuple)):
        if coords and isinstance(coords[0], (int, float)):
            return [round(float(c), decimales) for c in coords]
        return [redondear(c, decimales) for c in coords]
    return coords


def solo_poligonos(geom):
    """make_valid puede devolver colecciones: conserva solo las partes poligonales."""
    if geom is None or geom.is_empty:
        return None
    if not geom.is_valid:
        geom = make_valid(geom)
    if isinstance(geom, (Polygon, MultiPolygon)):
        return geom
    partes = [g for g in getattr(geom, "geoms", []) if isinstance(g, (Polygon, MultiPolygon))]
    if not partes:
        return None
    return shapely.union_all(partes)


# ---------------------------------------------------------------------------
# Lectura de datos
# ---------------------------------------------------------------------------
def leer_localidades(ruta: Path) -> list[dict]:
    with ruta.open(encoding="utf-8") as f:
        localidades = json.load(f)
    if not isinstance(localidades, list) or not localidades:
        raise SystemExit(f"{ruta} debe ser una lista de localidades.")
    return localidades


def leer_inventario(ruta: Path, localidades: list[dict]) -> pd.DataFrame:
    df = pd.read_csv(ruta, sep=None, engine="python", encoding="utf-8-sig", dtype=str)
    df.columns = [clave(c).replace(" ", "_") for c in df.columns]
    requeridas = ["nap_id", "lat", "lon", "municipio", "sector", "estado", "fecha_estimada", "hp"]
    faltan = [c for c in requeridas if c not in df.columns]
    if faltan:
        raise SystemExit(f"Al inventario le faltan columnas: {', '.join(faltan)}")

    codigos = {l["codigo"] for l in localidades}
    errores: list[str] = []
    filas = []
    for i, fila in df.iterrows():
        linea = i + 2  # encabezado + índice base 0
        try:
            lat = float(str(fila["lat"]).replace(",", "."))
            lon = float(str(fila["lon"]).replace(",", "."))
            if not (-4.3 <= lat <= 13.5 and -82.0 <= lon <= -66.8):
                raise ValueError("coordenada fuera de Colombia")
            municipio = str(fila["municipio"]).strip().upper()
            if municipio not in codigos:
                raise ValueError(f"municipio desconocido {municipio!r}")
            estado = normalizar_estado(fila["estado"])
            if not estado:
                raise ValueError(f"estado desconocido {fila['estado']!r}")
            sector = limpiar_sector(fila["sector"])
            if not sector or sector.lower() == "nan":
                raise ValueError("sector vacío")
            hp_txt = str(fila["hp"]).strip()
            hp = int(float(hp_txt.replace(",", "."))) if hp_txt and hp_txt.lower() != "nan" else 0
            if hp < 0:
                raise ValueError("hp negativo")
            filas.append({
                "lat": lat, "lon": lon, "municipio": municipio, "sector": sector, "estado": estado,
                "fecha_estimada": normalizar_fecha(fila["fecha_estimada"]) if estado == "en_construccion" else None,
                "hp": hp,
                "tipo": inferir_tipo(sector, fila.get("tipo") if "tipo" in df.columns else None),
                "actualizado": str(fila["actualizado"])[:10] if "actualizado" in df.columns and isinstance(fila["actualizado"], str) else None,
            })
        except ValueError as exc:
            errores.append(f"  línea {linea}: {exc}")
    if errores:
        print(f"Aviso: se descartaron {len(errores)} filas del inventario:", file=sys.stderr)
        print("\n".join(errores[:30]), file=sys.stderr)
        if len(errores) > 30:
            print(f"  … y {len(errores) - 30} más.", file=sys.stderr)
    if not filas:
        raise SystemExit("El inventario no tiene filas válidas.")
    return pd.DataFrame(filas)


def leer_poligonos(ruta: Path | None, crs: str) -> dict[tuple[str, str], object]:
    if not ruta:
        return {}
    gdf = gpd.read_file(ruta)
    gdf.columns = [c if c == "geometry" else clave(c).replace(" ", "_") for c in gdf.columns]
    for col in ("municipio", "sector"):
        if col not in gdf.columns:
            raise SystemExit(f"El archivo de polígonos necesita la columna {col!r}.")
    gdf = gdf.to_crs(crs)
    poligonos = {}
    for _, fila in gdf.iterrows():
        geom = solo_poligonos(fila.geometry)
        if geom is not None:
            k = (str(fila["municipio"]).strip().upper(), clave(fila["sector"]))
            poligonos[k] = shapely.union_all([poligonos[k], geom]) if k in poligonos else geom
    return poligonos


# ---------------------------------------------------------------------------
# Datos de demostración
# ---------------------------------------------------------------------------
# Coordenadas de referencia de cabeceras y centros poblados (© colaboradores de OpenStreetMap, ODbL).
# Los sectores, estados, fechas y cajas NAP son INVENTADOS: solo sirven para probar el sitio.
DEMO_SECTORES = [
    # municipio, sector, tipo, lat, lon, radio_m, estado, fecha_estimada
    ("SCR", "Barrio Centro", "barrio", 6.2783, -75.6375, 380, "disponible", None),
    ("SCR", "Vereda El Llano", "vereda", 6.2978, -75.6471, 300, "en_construccion", "2027-02"),
    ("SCR", "Pajarito", "sector", 6.2950, -75.6077, 420, "disponible", None),
    ("PAL", "Barrio Centro", "barrio", 6.3439, -75.6908, 250, "en_construccion", "2027-04"),
    ("PAL", "Vereda La Aldea", "vereda", 6.3409, -75.7034, 220, "proximamente", None),
    ("SJE", "Barrio Centro", "barrio", 6.4427, -75.7279, 330, "proximamente", None),
    ("SFA", "Barrio Centro", "barrio", 6.5565, -75.8280, 380, "en_construccion", "2027-03"),
    ("SFA", "Paso Real", "centro_poblado", 6.5540, -75.8120, 220, "proximamente", None),
    ("GIR", "Barrio Centro", "barrio", 6.6805, -75.9534, 220, "proximamente", None),
    ("CNG", "Barrio Centro", "barrio", 6.7520, -76.0262, 260, "proximamente", None),
    ("UMT", "Barrio Centro", "barrio", 6.8993, -76.1742, 220, "proximamente", None),
    ("DAB", "Barrio Centro", "barrio", 7.0015, -76.2666, 300, "en_construccion", "2027-06"),
    ("DAB", "San José de Urama", "centro_poblado", 7.0175, -76.1447, 200, "proximamente", None),
    ("MUT", "Barrio Centro", "barrio", 7.2441, -76.4365, 280, "proximamente", None),
    ("MUT", "Pavarandocito", "centro_poblado", 7.2958, -76.5159, 200, "proximamente", None),
    ("CHI", "Barrio Centro", "barrio", 7.6662, -76.6767, 480, "disponible", None),
    ("CHI", "Barranquillita", "centro_poblado", 7.5695, -76.6961, 220, "en_construccion", "2027-05"),
    ("CAR", "Barrio Centro", "barrio", 7.7585, -76.6532, 450, "disponible", None),
    ("CAR", "Piedras Blancas", "centro_poblado", 7.7459, -76.5552, 220, "proximamente", None),
    ("APT", "Barrio Centro", "barrio", 7.8849, -76.6227, 480, "disponible", None),
    ("APT", "Barrio Ortiz", "barrio", 7.8935, -76.6262, 300, "disponible", None),
    ("APT", "El Reposo", "centro_poblado", 7.8011, -76.6534, 320, "en_construccion", "2027-01"),
    ("APT", "Churidó", "centro_poblado", 7.8657, -76.6670, 240, "proximamente", None),
    ("TUR", "Barrio Centro", "barrio", 8.0953, -76.7255, 420, "disponible", None),
    ("TUR", "Currulao", "centro_poblado", 7.9970, -76.6361, 380, "en_construccion", "2027-03"),
    ("TUR", "Nueva Colonia", "centro_poblado", 7.9351, -76.7164, 300, "proximamente", None),
    ("TUR", "El Dos", "centro_poblado", 8.1272, -76.6808, 200, "proximamente", None),
    ("NEC", "Barrio Centro", "barrio", 8.4243, -76.7805, 360, "en_construccion", "2027-04"),
    ("NEC", "Mulatos", "centro_poblado", 8.6384, -76.7209, 220, "proximamente", None),
]


def inventario_demo(semilla: int) -> pd.DataFrame:
    """Inventario sintético: cajas NAP en retícula irregular alrededor de cada sector."""
    rng = random.Random(semilla)
    filas = []
    for municipio, sector, tipo, lat, lon, radio, estado, fecha in DEMO_SECTORES:
        paso = 140.0  # separación típica entre cajas, en metros
        m_lat = 111_320.0
        m_lon = 111_320.0 * math.cos(math.radians(lat))
        n = int(radio // paso)
        for ix in range(-n, n + 1):
            for iy in range(-n, n + 1):
                dx = ix * paso + rng.uniform(-35, 35)
                dy = iy * paso + rng.uniform(-35, 35)
                if (dx / radio) ** 2 + (dy / (radio * 0.85)) ** 2 > 1:
                    continue
                filas.append({
                    "lat": lat + dy / m_lat, "lon": lon + dx / m_lon,
                    "municipio": municipio, "sector": sector, "estado": estado,
                    "fecha_estimada": fecha, "hp": rng.randint(6, 16), "tipo": tipo,
                    "actualizado": None,
                })
    return pd.DataFrame(filas)


# ---------------------------------------------------------------------------
# Geometría
# ---------------------------------------------------------------------------
def areas_buffer(puntos: gpd.GeoDataFrame, radio_m: float) -> gpd.GeoDataFrame:
    zonas = puntos.copy()
    zonas["geometry"] = zonas.geometry.buffer(radio_m, quad_segs=8)
    return agrupar(zonas)


def areas_h3(puntos: gpd.GeoDataFrame, resolucion: int, min_hp: int, crs: str) -> gpd.GeoDataFrame:
    try:
        import h3
    except ImportError:
        raise SystemExit("El modo h3 necesita la librería h3: pip install h3")
    a_celda = getattr(h3, "latlng_to_cell", None) or h3.geo_to_h3          # h3 v4 / v3
    borde = getattr(h3, "cell_to_boundary", None) or h3.h3_to_geo_boundary

    wgs = puntos.to_crs("EPSG:4326")
    wgs["celda"] = [a_celda(p.y, p.x, resolucion) for p in wgs.geometry]
    # Cada celda se asigna al sector con más hogares pasados dentro de ella.
    por_grupo = (wgs.groupby(["celda", "municipio", "sector", "estado", "tipo"], dropna=False)
                 .agg(hp=("hp", "sum"), fecha_estimada=("fecha_estimada", "max"), actualizado=("actualizado", "max"))
                 .reset_index())
    total_celda = por_grupo.groupby("celda")["hp"].transform("sum")
    por_grupo = por_grupo.assign(total_celda=total_celda, prio=por_grupo["estado"].map(PRIORIDAD))
    por_grupo = por_grupo.sort_values(["celda", "hp", "prio"], ascending=[True, False, True])
    ganadoras = por_grupo.drop_duplicates("celda", keep="first")
    descartadas = ganadoras[ganadoras["total_celda"] < min_hp]
    if len(descartadas):
        print(f"Privacidad: se eliminaron {len(descartadas)} celdas con menos de {min_hp} hogares pasados.")
    ganadoras = ganadoras[ganadoras["total_celda"] >= min_hp].copy()
    geoms = []
    for celda in ganadoras["celda"]:
        anillo = [(lng, lat) for lat, lng in borde(celda)]
        geoms.append(Polygon(anillo))
    celdas = gpd.GeoDataFrame(ganadoras.drop(columns=["celda", "prio"]), geometry=geoms, crs="EPSG:4326").to_crs(crs)
    celdas["hp"] = celdas["total_celda"]
    return agrupar(celdas.drop(columns=["total_celda"]))


def agrupar(zonas: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Disuelve por municipio + sector + estado y suma hogares pasados."""
    grupos = []
    for (municipio, sector, estado), g in zonas.groupby(["municipio", "sector", "estado"], sort=True):
        fechas = [f for f in g["fecha_estimada"] if isinstance(f, str)]
        actualizados = [a for a in g["actualizado"] if isinstance(a, str)]
        grupos.append({
            "municipio": municipio, "sector": sector, "estado": estado,
            "tipo": g["tipo"].iloc[0],
            # Fecha conservadora: la última del sector (cuando todo el sector esté listo).
            "fecha_estimada": max(fechas) if estado == "en_construccion" and fechas else None,
            "actualizado": max(actualizados) if actualizados else None,
            "hp": int(g["hp"].sum()),
            "geometry": shapely.union_all(list(g.geometry)),
        })
    return gpd.GeoDataFrame(grupos, geometry="geometry", crs=zonas.crs)


def recortar(areas: gpd.GeoDataFrame, poligonos: dict) -> gpd.GeoDataFrame:
    if not poligonos:
        return areas
    recortadas = 0
    geoms = []
    for _, fila in areas.iterrows():
        limite = poligonos.get((fila["municipio"], clave(fila["sector"])))
        if limite is not None:
            recortadas += 1
            geoms.append(solo_poligonos(fila.geometry.intersection(limite)))
        else:
            geoms.append(fila.geometry)
    print(f"Recorte: {recortadas} de {len(areas)} sectores tienen polígono de barrio o vereda.")
    areas = areas.copy()
    areas["geometry"] = geoms
    return areas[areas.geometry.notna()]


def resolver_solapes(areas: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Un punto pertenece a un solo sector: gana el mejor estado y, a igualdad, el de más hogares."""
    areas = areas.assign(prio=areas["estado"].map(PRIORIDAD)).sort_values(
        ["municipio", "prio", "hp"], ascending=[True, True, False])
    resultado = []
    for _, g in areas.groupby("municipio", sort=False):
        ocupado = None
        for _, fila in g.iterrows():
            geom = fila.geometry if ocupado is None else solo_poligonos(fila.geometry.difference(ocupado))
            if geom is None or geom.is_empty:
                continue
            ocupado = geom if ocupado is None else shapely.union_all([ocupado, geom])
            resultado.append({**fila.drop(labels=["prio"]).to_dict(), "geometry": geom})
    return gpd.GeoDataFrame(resultado, geometry="geometry", crs=areas.crs)


def simplificar(areas: gpd.GeoDataFrame, tolerancia_m: float) -> gpd.GeoDataFrame:
    """Simplifica en metros, pasa a WGS84 y fija la rejilla de 5 decimales con geometría válida."""
    simplificadas = areas.copy()
    simplificadas["geometry"] = simplificadas.geometry.simplify(tolerancia_m, preserve_topology=True)
    simplificadas = simplificadas.to_crs("EPSG:4326")
    simplificadas["geometry"] = [
        solo_poligonos(shapely.set_precision(solo_poligonos(g), 1e-5)) if g is not None else None
        for g in simplificadas.geometry
    ]
    return simplificadas[simplificadas.geometry.notna() & ~simplificadas.geometry.is_empty]


# ---------------------------------------------------------------------------
# Salida
# ---------------------------------------------------------------------------
def texto_o_nulo(valor) -> str | None:
    """pandas representa los vacíos como NaN; en JSON deben ser null."""
    return valor if isinstance(valor, str) and valor else None


def a_features(areas: gpd.GeoDataFrame, tramos: dict, hoy: str) -> list[dict]:
    features = []
    for municipio, g in areas.sort_values(["municipio", "sector"]).groupby("municipio", sort=False):
        for n, (_, fila) in enumerate(g.iterrows(), start=1):
            geom = mapping(fila.geometry)
            features.append({
                "type": "Feature",
                "properties": {
                    "id": f"{municipio}-{n:04d}",
                    "municipio": municipio,
                    "sector": fila["sector"],
                    "tipo": texto_o_nulo(fila["tipo"]) or "sector",
                    "estado": fila["estado"],
                    "fecha_estimada": texto_o_nulo(fila["fecha_estimada"]),
                    "tecnologia": "FTTH GPON",
                    "actualizado": texto_o_nulo(fila["actualizado"]) or hoy,
                    "tramo": tramos.get(municipio),
                },
                "geometry": {"type": geom["type"], "coordinates": redondear(geom["coordinates"])},
            })
    return features


def serializar(coleccion: dict) -> str:
    return json.dumps(coleccion, ensure_ascii=False, separators=(",", ":")) + "\n"


def coleccion(features: list[dict], metadata: dict) -> dict:
    return {"type": "FeatureCollection", "metadata": metadata, "features": features}


def escribir_salida(areas_metricas, tolerancia_m, tramos, hoy, metadata, carpeta: Path, presupuesto_kb: float):
    """Escribe un solo archivo o, si supera el presupuesto, uno por tramo más un índice."""
    limite = presupuesto_kb * 1024
    areas = simplificar(areas_metricas, tolerancia_m)
    features = a_features(areas, tramos, hoy)
    completo = serializar(coleccion(features, metadata))
    salida = carpeta / "cobertura.geojson"
    for viejo in carpeta.glob("cobertura-T*.geojson"):
        viejo.unlink()
    if len(completo.encode("utf-8")) <= limite:
        salida.write_text(completo, encoding="utf-8")
        return [(salida, len(completo.encode("utf-8")))], features

    print(f"El archivo supera {presupuesto_kb:.0f} KB: se divide por tramo.")
    escritos, todos = [], []
    partes = []
    for tramo in sorted({t for t in tramos.values() if t}):
        codigos = [c for c, t in tramos.items() if t == tramo]
        sub = areas_metricas[areas_metricas["municipio"].isin(codigos)]
        if sub.empty:
            continue
        tol = tolerancia_m
        for _ in range(7):
            feats = a_features(simplificar(sub, tol), tramos, hoy)
            texto = serializar(coleccion(feats, {**metadata, "tramo": tramo, "tolerancia_m": tol}))
            if len(texto.encode("utf-8")) <= limite:
                break
            tol = round(tol * 1.5, 1)
            print(f"  {tramo}: {len(texto.encode('utf-8')) / 1024:.0f} KB; se aumenta la tolerancia a {tol} m.")
        else:
            print(f"  Aviso: {tramo} sigue por encima del presupuesto. Revisa la tolerancia o el radio.", file=sys.stderr)
        nombre = f"cobertura-{tramo}.geojson"
        (carpeta / nombre).write_text(texto, encoding="utf-8")
        escritos.append((carpeta / nombre, len(texto.encode("utf-8"))))
        partes.append({"tramo": tramo, "archivo": nombre})
        todos.extend(feats)
    indice = serializar(coleccion([], {**metadata, "partes": partes}))
    salida.write_text(indice, encoding="utf-8")
    escritos.insert(0, (salida, len(indice.encode("utf-8"))))
    return escritos, todos


def actualizar_localidades(ruta: Path, localidades: list[dict], features: list[dict]) -> None:
    mejor: dict[str, str] = {}
    for f in features:
        p = f["properties"]
        actual = mejor.get(p["municipio"])
        if actual is None or PRIORIDAD[p["estado"]] < PRIORIDAD[actual]:
            mejor[p["municipio"]] = p["estado"]
    lineas = []
    for loc in localidades:
        loc["estado_general"] = mejor.get(loc["codigo"], "proximamente")
        lineas.append("  " + json.dumps(loc, ensure_ascii=False, separators=(", ", ": ")))
    ruta.write_text("[\n" + ",\n".join(lineas) + "\n]\n", encoding="utf-8")


def tabla_respaldo(localidades: list[dict], features: list[dict], metadata: dict) -> str:
    """Tabla HTML municipio → sectores → estado para el bloque <noscript> de index.html."""
    e = html.escape
    por_municipio: dict[str, list[dict]] = {}
    for f in features:
        por_municipio.setdefault(f["properties"]["municipio"], []).append(f["properties"])
    aviso = " · Datos de demostración: ilustrativos, no representan cobertura real" if metadata.get("es_muestra") else ""
    filas = [
        '<table class="tabla tabla-cobertura">',
        f'  <caption>Cobertura por municipio y sector{aviso} · Actualizado el {e(fecha_larga(metadata["generado"]))}</caption>',
        '  <thead><tr><th scope="col">Municipio</th><th scope="col">Sector</th><th scope="col">Estado</th></tr></thead>',
    ]
    for loc in localidades:
        sectores = sorted(por_municipio.get(loc["codigo"], []), key=lambda p: (PRIORIDAD[p["estado"]], clave(p["sector"])))
        nombre = f'{e(loc["nombre_completo"])} <span class="tabla-tramo">{e(loc["tramo"])}</span>'
        filas.append("  <tbody>")
        if not sectores:
            filas.append(f'    <tr><th scope="row">{nombre}</th><td>Sin sectores publicados</td>'
                         f'<td>{ETIQUETA_ESTADO["proximamente"]}</td></tr>')
        for i, p in enumerate(sectores):
            estado = ETIQUETA_ESTADO[p["estado"]]
            if p["estado"] == "en_construccion" and p.get("fecha_estimada"):
                estado += f' (fecha estimada: {mes_anio(p["fecha_estimada"])})'
            cabecera = (f'<th scope="rowgroup" rowspan="{len(sectores)}">{nombre}</th>' if i == 0 else "")
            filas.append(f'    <tr>{cabecera}<td>{e(p["sector"])}</td><td>{e(estado)}</td></tr>')
        filas.append("  </tbody>")
    filas.append("</table>")
    return "\n".join(filas)


def actualizar_html(ruta: Path, tabla: str) -> bool:
    if not ruta.exists():
        print(f"Aviso: no existe {ruta}; no se actualizó la tabla de respaldo.", file=sys.stderr)
        return False
    texto = ruta.read_text(encoding="utf-8")
    inicio = texto.find(MARCA_INICIO)
    fin = texto.find(MARCA_FIN)
    if inicio < 0 or fin < 0:
        print(f"Aviso: {ruta.name} no tiene los marcadores COBERTURA-RESPALDO.", file=sys.stderr)
        return False
    cierre = texto.index("-->", inicio) + 3
    linea = texto.rfind("\n", 0, inicio) + 1
    sangria = texto[linea:inicio]
    cuerpo = "\n".join(sangria + l for l in tabla.splitlines())
    nuevo = texto[:cierre] + "\n" + cuerpo + "\n" + sangria + texto[fin:]
    ruta.write_text(nuevo, encoding="utf-8")
    return True


def reporte(areas: gpd.GeoDataFrame, entrada: pd.DataFrame, escritos, localidades) -> None:
    nombres = {l["codigo"]: l["nombre"] for l in localidades}
    print("\nSectores publicados por estado")
    for estado in ESTADOS:
        print(f"  {ETIQUETA_ESTADO[estado]:<17}{int((areas['estado'] == estado).sum()):>5}")
    print("\nHogares pasados (HP) por municipio y estado · dato interno, no se publica")
    tabla = entrada.pivot_table(index="municipio", columns="estado", values="hp", aggfunc="sum", fill_value=0)
    for codigo in [l["codigo"] for l in localidades if l["codigo"] in tabla.index]:
        fila = tabla.loc[codigo]
        valores = "  ".join(f"{ETIQUETA_ESTADO[e][:12]}: {int(fila.get(e, 0)):>6,}".replace(",", ".") for e in ESTADOS)
        print(f"  {nombres[codigo]:<27}{valores}")
    print("\nArchivos")
    for ruta, peso in escritos:
        print(f"  {ruta.relative_to(RAIZ) if ruta.is_relative_to(RAIZ) else ruta}  {peso / 1024:.1f} KB")


# ---------------------------------------------------------------------------
# Programa principal
# ---------------------------------------------------------------------------
def main() -> None:
    p = argparse.ArgumentParser(description="Genera data/cobertura.geojson para el sitio de 1clic.")
    p.add_argument("--inventario", type=Path, help="CSV de cajas NAP (nap_id, lat, lon, municipio, sector, estado, fecha_estimada, hp).")
    p.add_argument("--poligonos", type=Path, help="Polígonos de barrios/veredas para recortar (GeoJSON, GPKG o SHP).")
    p.add_argument("--modo", choices=("buffer", "h3"), default="buffer", help="buffer (por defecto) o h3.")
    p.add_argument("--radio-m", type=float, default=150.0, help="Radio de acometida alrededor de cada NAP (m).")
    p.add_argument("--h3-res", type=int, default=9, help="Resolución H3 para --modo h3.")
    p.add_argument("--tolerancia-m", type=float, default=8.0, help="Tolerancia de simplificación (m).")
    p.add_argument("--min-hp", type=int, default=5, help="Mínimo de hogares pasados por área o celda publicada.")
    p.add_argument("--presupuesto-kb", type=float, default=250.0, help="Tamaño máximo por archivo/tramo (KB).")
    p.add_argument("--fuente", default="Inventario de red 1clic", help="Texto de la fuente para metadata.")
    p.add_argument("--version", default=None, help="Versión de los datos (por defecto, la fecha).")
    p.add_argument("--datos", type=Path, default=RAIZ / "data", help="Carpeta data/ del sitio.")
    p.add_argument("--html", type=Path, default=RAIZ / "index.html", help="index.html con la tabla de respaldo.")
    p.add_argument("--sin-html", action="store_true", help="No actualizar la tabla de respaldo de index.html.")
    p.add_argument("--sin-localidades", action="store_true", help="No actualizar estado_general en localidades.json.")
    p.add_argument("--demo", action="store_true", help="Genera datos de MUESTRA marcados es_muestra: true.")
    p.add_argument("--semilla", type=int, default=2026, help="Semilla del generador de muestra.")
    args = p.parse_args()

    if not args.demo and not args.inventario:
        p.error("indica --inventario RUTA.csv o usa --demo")

    ruta_localidades = args.datos / "localidades.json"
    localidades = leer_localidades(ruta_localidades)
    tramos = {l["codigo"]: l["tramo"] for l in localidades}
    crs = crs_metrico()
    ahora = datetime.now(timezone.utc).astimezone()
    hoy = ahora.date().isoformat()

    entrada = inventario_demo(args.semilla) if args.demo else leer_inventario(args.inventario, localidades)
    puntos = gpd.GeoDataFrame(
        entrada.drop(columns=["lat", "lon"]),
        geometry=[Point(xy) for xy in zip(entrada["lon"], entrada["lat"])],
        crs="EPSG:4326",
    ).to_crs(crs)
    print(f"Entrada: {len(puntos)} cajas NAP en {puntos['municipio'].nunique()} municipios · CRS métrico {crs}")

    if args.modo == "h3":
        areas = areas_h3(puntos, args.h3_res, args.min_hp, crs)
    else:
        areas = areas_buffer(puntos, args.radio_m)
        pocos = areas["hp"] < args.min_hp
        if pocos.any():
            print(f"Privacidad: se eliminaron {int(pocos.sum())} sectores con menos de {args.min_hp} hogares pasados.")
        areas = areas[~pocos]
    areas = recortar(areas, leer_poligonos(args.poligonos, crs))
    areas["geometry"] = [solo_poligonos(g) for g in areas.geometry]
    areas = resolver_solapes(areas[areas.geometry.notna()])

    metadata = {
        "version": args.version or ahora.strftime("%Y.%m.%d"),
        "generado": ahora.isoformat(timespec="seconds"),
        "fuente": ("Datos de MUESTRA generados con tools/build_coverage.py --demo. No representan cobertura real. "
                   "Coordenadas de referencia de cabeceras y centros poblados: © colaboradores de OpenStreetMap (ODbL).")
                  if args.demo else args.fuente,
        "es_muestra": bool(args.demo),
        "modo": args.modo,
        "parametros": {"radio_m": args.radio_m, "h3_res": args.h3_res if args.modo == "h3" else None,
                       "tolerancia_m": args.tolerancia_m, "min_hp": args.min_hp},
        "crs": "EPSG:4326",
    }
    escritos, features = escribir_salida(areas, args.tolerancia_m, tramos, hoy, metadata, args.datos, args.presupuesto_kb)

    if not args.sin_localidades:
        actualizar_localidades(ruta_localidades, localidades, features)
        print("localidades.json: estado_general actualizado.")
    if not args.sin_html and actualizar_html(args.html, tabla_respaldo(localidades, features, metadata)):
        print(f"{args.html.name}: tabla de respaldo sin JavaScript actualizada.")

    reporte(areas, entrada, escritos, localidades)
    if args.demo:
        print("\nATENCIÓN: datos de MUESTRA (es_muestra: true). No los publiques como cobertura real.")


if __name__ == "__main__":
    main()
