from __future__ import annotations

import re
import sys
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PDF_NAME = "actividad_evaluativa_III_Orlain_Murillo.pdf"
REQUIRED = (
    "index.html",
    "styles.css",
    "app.js",
    "sim-worker.js",
    PDF_NAME,
    "actividad_evaluativa_III_Orlain_Murillo.tex",
    "scripts/generate_figures.py",
)
FIGURES = (
    "figures_clear/problema1_intervalos.png",
    "figures_clear/problema2_cobertura.png",
    "figures_clear/problema3_varianza.png",
    "figures_clear/problema3_cobertura_intervalos.png",
    "figures_clear/problema4_estimadores.png",
    "figures_clear/problema5_bootstrap.png",
)


class SiteParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.pdf_links: list[str] = []
        self.seed_values: dict[str, str] = {}
        self.text_fragments: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "a" and (href := attributes.get("href")) and href.lower().endswith(".pdf"):
            self.pdf_links.append(href)
        if tag == "input" and (input_id := attributes.get("id", "")).endswith("-seed"):
            self.seed_values[input_id] = attributes.get("value", "")

    def handle_data(self, data: str) -> None:
        if data.strip():
            self.text_fragments.append(data)


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    missing = [path for path in (*REQUIRED, *FIGURES) if not (ROOT / path).is_file()]
    if missing:
        fail(f"Faltan archivos requeridos: {', '.join(missing)}")

    source_paths = [
        ROOT / "index.html",
        ROOT / "styles.css",
        ROOT / "app.js",
        ROOT / "sim-worker.js",
        ROOT / "scripts" / "generate_figures.py",
        ROOT / "actividad_evaluativa_III_Orlain_Murillo.tex",
    ]
    sources = {path: path.read_text(encoding="utf-8") for path in source_paths}
    combined = "\n".join(sources.values())
    combined_lower = combined.casefold()

    forbidden_phrases = (
        "La teoría se demuestra",
        "La simulación la hace visible",
        "Cinco preguntas, cinco ideas estadísticas",
        "Qué hace válida una simulación",
        "Laboratorio en vivo",
        "Cómo usar este laboratorio",
        "Explorar soluciones",
        "Cuando el bootstrap automático falla",
    )
    for phrase in forbidden_phrases:
        if phrase.casefold() in combined_lower:
            fail(f"Quedó una frase editorial obsoleta: {phrase}.")

    legacy_colors = ("65f2c2", "88a7ff", "ffba72", "ff7f91")
    for color in legacy_colors:
        if color in combined_lower:
            fail(f"Quedó un color de la paleta anterior: #{color}.")

    styles = sources[ROOT / "styles.css"].casefold()
    required_colors = (
        "03045e", "023e8a", "0077b6", "0096c7", "00b4d8",
        "48cae4", "90e0ef", "ade8f4", "caf0f8",
    )
    missing_colors = [color for color in required_colors if color not in styles]
    if missing_colors:
        fail(f"Faltan colores de la paleta azul en styles.css: {', '.join(missing_colors)}.")

    forbidden_files = ("solucion-" + "taller.pdf", "main" + ".pdf")
    forbidden_terms = (
        re.compile(r"\b" + "M" + "LE" + r"\b", re.IGNORECASE),
        re.compile(r"\b" + "M" + "V" + r"\b"),
        re.compile("theta_" + "M" + "V", re.IGNORECASE),
        re.compile(r"\\theta_\{" + "M" + "V" + r"\}", re.IGNORECASE),
    )
    for forbidden in forbidden_files:
        if forbidden in combined:
            fail(f"Quedó una referencia al PDF obsoleto {forbidden}.")
    for pattern in forbidden_terms:
        if pattern.search(combined):
            fail("Quedó terminología obsoleta en las fuentes.")

    html = sources[ROOT / "index.html"]
    parser = SiteParser()
    parser.feed(html)
    visible_text = " ".join(" ".join(parser.text_fragments).split()).casefold()
    required_html_text = (
        "Inferencia estadística: desarrollo teórico y simulación",
        "Simulación interactiva",
        "Guía del simulador",
        "Estructura de las simulaciones",
    )
    for phrase in required_html_text:
        if phrase.casefold() not in visible_text:
            fail(f"Falta el texto académico requerido: {phrase}.")
    if "problemas del taller" not in html.casefold():
        fail("Falta la identificación de la sección Problemas del taller.")
    if not parser.pdf_links or any(link != PDF_NAME for link in parser.pdf_links):
        fail(f"Todos los enlaces PDF deben usar {PDF_NAME}.")
    expected_seed_inputs = {f"p{problem}-seed": "1966" for problem in range(1, 6)}
    if parser.seed_values != expected_seed_inputs:
        fail("Los cinco controles de semilla deben iniciar en 1966.")

    app = sources[ROOT / "app.js"]
    if len(re.findall(r"'p[1-5]-seed':\s*'1966'", app)) != 5:
        fail("Los cinco valores predeterminados de JavaScript deben usar la semilla 1966.")
    seed_2026 = re.compile(r"(?:seed|semilla)[^\n]{0,80}\b2026\b", re.IGNORECASE)
    if seed_2026.search(html) or seed_2026.search(app) or seed_2026.search(sources[ROOT / "sim-worker.js"]):
        fail("Se encontró 2026 usado como semilla; las fechas académicas sí están permitidas.")

    loaded = app.find("window.addEventListener('DOMContentLoaded'")
    unloaded = app.find("window.addEventListener('beforeunload'")
    if loaded < 0 or unloaded < loaded:
        fail("No se encontró la inicialización esperada de la página.")
    load_block = app[loaded:unloaded]
    if re.search(r"\brunP[1-5]\s*\(", load_block) or "new Worker" in load_block:
        fail("La carga inicial no debe ejecutar simulaciones ni crear workers.")

    reset_start = app.find("function resetLab")
    reset_end = app.find("function setupTabs", reset_start)
    reset_block = app[reset_start:reset_end]
    if "runners[" in reset_block or "new Worker" in reset_block:
        fail("Restablecer valores no debe volver a ejecutar una simulación.")

    print("Validación de redacción, paleta, archivos, enlaces, semillas, terminología y carga bajo demanda: correcta.")


if __name__ == "__main__":
    main()
