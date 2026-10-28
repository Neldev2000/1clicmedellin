#!/usr/bin/env python3
"""
servidor_local.py · 1clic
=========================

Vista previa local del sitio con los MISMOS encabezados de seguridad de producción
(lee el archivo /_headers en formato Cloudflare Pages) y la página 404.html.

    python3 tools/servidor_local.py              # http://127.0.0.1:8080
    python3 tools/servidor_local.py --puerto 9000

Además vigila datos-empresa.ini: si lo guardas con cambios, los aplica al sitio
(tools/aplicar_datos.py) en la siguiente recarga del navegador.

Solo usa la biblioteca estándar. Por servir en HTTP local, omite HSTS y la directiva
upgrade-insecure-requests (en producción, con HTTPS, se aplican tal cual).
"""
from __future__ import annotations

import argparse
import gzip
import http.server
import re
import socketserver
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import aplicar_datos  # noqa: E402  (mismo directorio tools/)

RAIZ = Path(__file__).resolve().parent.parent
TIPOS_EXTRA = {
    ".webmanifest": "application/manifest+json",
    ".geojson": "application/geo+json",
    ".woff2": "font/woff2",
    ".svg": "image/svg+xml",
    ".json": "application/json",
    ".js": "text/javascript",
}
COMPRIMIBLES = {"application/json", "application/geo+json", "application/manifest+json", "image/svg+xml", "application/xml"}


class VigilanteDatos:
    """Aplica datos-empresa.ini cuando cambia (una vez por guardado, sin bloquear el servidor)."""

    def __init__(self) -> None:
        self.candado = threading.Lock()
        self.ultima = None

    def revisar(self) -> None:
        try:
            marca = aplicar_datos.ARCHIVO_DATOS.stat().st_mtime
        except FileNotFoundError:
            return
        with self.candado:
            if marca == self.ultima:
                return
            self.ultima = marca
            try:
                cambios = aplicar_datos.aplicar(escribir_cambios=True)
            except aplicar_datos.ErrorDatos as exc:
                print(f"\n⚠ No se aplicó datos-empresa.ini (el sitio conserva los datos anteriores):\n{exc}\n", flush=True)
                return
            if cambios:
                print(f"✓ datos-empresa.ini aplicado: {len(cambios)} archivos actualizados.", flush=True)


VIGILANTE = VigilanteDatos()


def leer_headers(ruta: Path) -> list[tuple[re.Pattern, list[tuple[str, str]]]]:
    """Convierte las reglas de _headers en (patrón, [(nombre, valor)])."""
    reglas: list[tuple[re.Pattern, list[tuple[str, str]]]] = []
    if not ruta.exists():
        return reglas
    actual = None
    for linea in ruta.read_text(encoding="utf-8").splitlines():
        if not linea.strip() or linea.lstrip().startswith("#"):
            continue
        if not linea[0].isspace():
            patron = "^" + re.escape(linea.strip()).replace(r"\*", ".*") + "$"
            actual = (re.compile(patron), [])
            reglas.append(actual)
        elif actual is not None and ":" in linea:
            nombre, valor = linea.strip().split(":", 1)
            actual[1].append((nombre.strip(), valor.strip()))
    return reglas


class Manejador(http.server.SimpleHTTPRequestHandler):
    reglas: list = []

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(RAIZ), **kwargs)

    def guess_type(self, path):
        sufijo = Path(str(path)).suffix.lower()
        return TIPOS_EXTRA.get(sufijo) or super().guess_type(path)

    def end_headers(self):
        ruta = self.path.split("?", 1)[0].split("#", 1)[0]
        combinados: dict[str, list[str]] = {}
        for patron, cabeceras in self.reglas:
            if patron.match(ruta):
                for nombre, valor in cabeceras:
                    combinados.setdefault(nombre, []).append(valor)
        for nombre, valores in combinados.items():
            valor = ", ".join(valores)
            if nombre.lower() == "strict-transport-security":
                continue                                    # sin HTTPS en local
            if nombre.lower() == "content-security-policy":
                valor = re.sub(r";?\s*upgrade-insecure-requests", "", valor)
            if nombre.lower() in ("content-type", "cache-control"):
                continue                                    # los define este servidor (tipo y no-store)
            self.send_header(nombre, valor)
        self.send_header("Cache-Control", "no-store")       # en local, siempre lo último
        super().end_headers()

    def do_GET(self):
        """Comprime con gzip los archivos de texto, como lo hace Cloudflare en producción."""
        if self.path.split("?")[0].endswith(("/", ".html", "config.js")):
            VIGILANTE.revisar()
        ruta = Path(self.translate_path(self.path))
        if ruta.is_dir():
            ruta = ruta / "index.html"
        tipo = self.guess_type(str(ruta))
        comprimible = tipo.startswith("text/") or tipo in COMPRIMIBLES
        if not (ruta.is_file() and comprimible and "gzip" in self.headers.get("Accept-Encoding", "")):
            return super().do_GET()
        cuerpo = gzip.compress(ruta.read_bytes(), compresslevel=6)
        self.send_response(200)
        self.send_header("Content-Type", tipo + ("; charset=utf-8" if tipo.startswith("text/") else ""))
        self.send_header("Content-Encoding", "gzip")
        self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def send_error(self, code, message=None, explain=None):
        pagina = RAIZ / "404.html"
        if code == 404 and pagina.exists():
            cuerpo = pagina.read_bytes()
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(cuerpo)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(cuerpo)
            return
        super().send_error(code, message, explain)


def main() -> None:
    p = argparse.ArgumentParser(description="Vista previa local de 1clic con los encabezados de _headers.")
    p.add_argument("--puerto", type=int, default=8080)
    p.add_argument("--host", default="127.0.0.1", help="Usa 0.0.0.0 solo para probar desde otro equipo de tu red.")
    args = p.parse_args()
    Manejador.reglas = leer_headers(RAIZ / "_headers")
    VIGILANTE.revisar()
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer((args.host, args.puerto), Manejador) as servidor:
        print(f"1clic · vista previa en http://{args.host}:{args.puerto}  (Ctrl+C para salir)")
        print(f"Encabezados: {len(Manejador.reglas)} reglas de _headers aplicadas.")
        print("Datos: edita datos-empresa.ini, guarda y recarga el navegador.", flush=True)
        try:
            servidor.serve_forever()
        except KeyboardInterrupt:
            print("\nServidor detenido.")


if __name__ == "__main__":
    main()
