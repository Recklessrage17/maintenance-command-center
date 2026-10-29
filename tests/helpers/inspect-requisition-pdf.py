"""Inspect and render synthetic, testInfo-owned requisition PDF evidence."""
import json
import sys
from pathlib import Path

import fitz

source = Path(sys.argv[1])
pages = []
with fitz.open(source) as document:
    for index, page in enumerate(document):
        image = source.with_name(f'{source.stem}-page-{index + 1}.png')
        page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False).save(image)
        spans = [dict(text=s['text'], bbox=s['bbox'], color=s['color'], font=s['font'])
                 for b in page.get_text('dict')['blocks'] if 'lines' in b
                 for line in b['lines'] for s in line['spans']]
        drawings = [dict(rect=list(d['rect']), items=[list(item) for item in d['items']],
                         color=d['color'], fill=d['fill']) for d in page.get_drawings()]
        # Excel renders its native controls into the PDF. Measure ink inside
        # each square, excluding its border and the adjacent YES/NO caption.
        choices = []
        control_images = [fitz.Rect(image['bbox']) for image in page.get_image_info()]
        for span in sorted((s for s in spans if s['text'] in ['YES', 'NO']), key=lambda s: (round(s['bbox'][1]/8), s['bbox'][0])):
            x, y, right, bottom = span['bbox']
            middle = (y + bottom) / 2
            # Fit-to-page scales native controls as item counts grow. Locate
            # each exported control image rather than using a fixed-point box.
            control = min((r for r in control_images if r.x0 < x and r.x1 > right and r.y0 < middle < r.y1), key=lambda r: r.get_area())
            gap = x-control.x0
            clip = fitz.Rect(control.x0+gap*.36, middle-gap*.15, control.x0+gap*.66, middle+gap*.15)
            pixels = page.get_pixmap(matrix=fitz.Matrix(6, 6), clip=clip, colorspace=fitz.csGRAY, alpha=False)
            choices.append(dict(caption=span['text'], bbox=list(clip), ink=sum(v < 150 for v in pixels.samples)/len(pixels.samples)))
        pages.append(dict(width=page.rect.width, height=page.rect.height,
                          text=page.get_text(), spans=spans, drawings=drawings, choices=choices, image=str(image)))
result = dict(pages=pages)
# Points and Rects in drawing items are diagnostic geometry.
serialized = json.dumps(result, default=list, indent=2)
source.with_suffix('.layout.json').write_text(serialized, encoding='utf-8')
print(serialized)
