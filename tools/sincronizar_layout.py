#!/usr/bin/env python3
"""
sincronizar_layout.py · 1clic
=============================

El encabezado y el pie van escritos en el HTML de cada página (SEO y sitio sin JS).
Para no editarlos 13 veces: se editan en index.html y este script los copia a
404.html y a las 11 páginas legales, marcando en cada página legal su enlace actual
(aria-current="page") y el menú "Legal" como activo.

    python3 tools/sincronizar_layout.py               # copia encabezado y pie
    python3 tools/sincronizar_layout.py --comprobar   # solo revisa (código 1 si hay diferencias)

Solo usa la biblioteca estándar.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
BLOQUES = {
    "encabezado": re.compile(r'<header class="site-header".*?</header>', re.S),
    "pie": re.compile(r'<footer class="site-footer".*?</footer>', re.S),
}


def adaptar_encabezado(html: str, slug: str | None) -> str:
    """Quita marcas de página actual y, si es página legal, marca la suya."""
    html = html.replace(' aria-current="page"', "").replace("nav-enlace is-activo", "nav-enlace")
    if slug:
        enlace = f'<a href="/legal/{slug}.html">'
        if enlace not in html:
            raise SystemExit(f"El menú Legal de index.html no tiene el enlace a /legal/{slug}.html")
        html = html.replace(enlace, f'<a href="/legal/{slug}.html" aria-current="page">', 1)
        html = html.replace('<summary class="nav-enlace">', '<summary class="nav-enlace is-activo">', 1)
    return html


def main() -> None:
    p = argparse.ArgumentParser(description="Copia el encabezado y el pie de index.html a las demás páginas.")
    p.add_argument("--comprobar", action="store_true", help="No escribe; termina con código 1 si hay diferencias.")
    args = p.parse_args()

    origen = (RAIZ / "index.html").read_text(encoding="utf-8")
    plantilla = {}
    for nombre, patron in BLOQUES.items():
        m = patron.search(origen)
        if not m:
            raise SystemExit(f"index.html no tiene el bloque de {nombre}.")
        plantilla[nombre] = m.group(0)

    destinos = [RAIZ / "404.html", *sorted((RAIZ / "legal").glob("*.html"))]
    diferentes = []
    for pagina in destinos:
        texto = pagina.read_text(encoding="utf-8")
        slug = pagina.stem if pagina.parent.name == "legal" else None
        nuevo = texto
        for nombre, patron in BLOQUES.items():
            bloque = adaptar_encabezado(plantilla[nombre], slug) if nombre == "encabezado" else plantilla[nombre]
            if not patron.search(nuevo):
                raise SystemExit(f"{pagina.relative_to(RAIZ)} no tiene el bloque de {nombre}.")
            nuevo = patron.sub(lambda _m: bloque, nuevo, count=1)
        if nuevo != texto:
            diferentes.append(pagina.relative_to(RAIZ))
            if not args.comprobar:
                pagina.write_text(nuevo, encoding="utf-8")

    if args.comprobar:
        if diferentes:
            print("Encabezado o pie distintos de index.html en:\n  " + "\n  ".join(map(str, diferentes)))
            sys.exit(1)
        print(f"OK: encabezado y pie idénticos en {len(destinos) + 1} páginas.")
    else:
        print(f"Actualizadas {len(diferentes)} de {len(destinos)} páginas." if diferentes else "Todo estaba sincronizado.")


if __name__ == "__main__":
    main()
