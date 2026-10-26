"""Render every fixture page and expose text/geometry for export regressions.

Requires PyMuPDF (python -m pip install pymupdf). All outputs are testInfo-owned
diagnostics; this helper never opens a database or application storage.
"""
import json
import sys
from pathlib import Path

import fitz

source = Path(sys.argv[1])
document = fitz.open(source)
pages = []
for index, page in enumerate(document):
    image = source.with_name(f"{source.stem}-page-{index + 1}.png")
    page.get_pixmap(matrix=fitz.Matrix(1.25, 1.25), alpha=False).save(image)
    spans = [dict(text=span["text"], font=span["font"], size=span["size"],
                  bbox=span["bbox"], origin=span["origin"])
             for block in page.get_text("dict")["blocks"] if "lines" in block
             for line in block["lines"] for span in line["spans"]]
    pages.append(dict(width=page.rect.width, height=page.rect.height,
                      text=page.get_text(), spans=spans, image=str(image)))
document.close()
result = dict(pages=pages)
source.with_suffix(".layout.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result))
