"""Validation-only inspector: retain Excel raster checks and locate actual LibreOffice vector squares."""
import json,sys
from pathlib import Path
import fitz
source=Path(sys.argv[1]);pages=[]
with fitz.open(source)as document:
 for index,page in enumerate(document):
  image=source.with_name(f'{source.stem}-page-{index+1}.png');page.get_pixmap(matrix=fitz.Matrix(1.5,1.5),alpha=False).save(image)
  spans=[dict(text=s['text'],bbox=s['bbox'],color=s['color'],font=s['font'])for b in page.get_text('dict')['blocks']if 'lines'in b for line in b['lines']for s in line['spans']]
  raw=page.get_drawings();drawings=[dict(rect=list(d['rect']),items=[list(item)for item in d['items']],color=d['color'],fill=d['fill'])for d in raw]
  images=[fitz.Rect(i['bbox'])for i in page.get_image_info()];choices=[]
  for span in sorted((s for s in spans if s['text']in ['YES','NO']),key=lambda s:(round(s['bbox'][1]/8),s['bbox'][0])):
   x,y,right,bottom=span['bbox'];middle=(y+bottom)/2
   raster=[r for r in images if r.x0<x and r.x1>right and r.y0<middle<r.y1]
   if raster:
    control=min(raster,key=lambda r:r.get_area());gap=x-control.x0
    clip=fitz.Rect(control.x0+gap*.36,middle-gap*.15,control.x0+gap*.66,middle+gap*.15);kind='raster'
   else:
    boxes={}
    for d in raw:
     r=d['rect'];black=lambda c:c is not None and max(c[:3])<.05
     if any(item[0]=='re'for item in d['items'])and (black(d['fill'])or black(d['color']))and 4<=r.width<=18 and r.height>0 and .85<=r.width/r.height<=1.15 and 0<x-r.x1<12 and r.y0-2<middle<r.y1+2:
      boxes[tuple(round(v,1)for v in r)]=r
    assert len(boxes)==1,f'Expected one actual vector checkbox square before {span["text"]}; found {len(boxes)}'
    control=next(iter(boxes.values()));inset=min(control.width,control.height)*.25
    clip=fitz.Rect(control.x0+inset,control.y0+inset,control.x1-inset,control.y1-inset);kind='vector'
   pixels=page.get_pixmap(matrix=fitz.Matrix(6,6),clip=clip,colorspace=fitz.csGRAY,alpha=False)
   assert pixels.samples,'Checkbox interior rendered no pixels'
   choices.append(dict(caption=span['text'],bbox=list(clip),ink=sum(v<150 for v in pixels.samples)/len(pixels.samples),renderer=kind,square_bbox=list(control)))
  pages.append(dict(width=page.rect.width,height=page.rect.height,text=page.get_text(),spans=spans,drawings=drawings,choices=choices,image=str(image)))
result=dict(pages=pages);serialized=json.dumps(result,default=list,indent=2);source.with_suffix('.layout.json').write_text(serialized,encoding='utf-8');print(serialized)
