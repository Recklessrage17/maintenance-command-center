"""Validation-only inspector: retain Excel raster checks and locate actual LibreOffice vector squares."""
import json,sys
from pathlib import Path
import fitz
source=Path(sys.argv[1]);pages=[]
def quantity_header(page,spans,drawings):
 matches=[s for s in spans if s['text'].strip()=='QTY']
 if not matches:return None
 assert len(matches)==1,'Expected exactly one QTY header'
 span=matches[0];x,y,right,bottom=span['bbox'];cx=(x+right)/2;cy=(y+bottom)/2
 vertical=[fitz.Rect(d['rect'])for d in drawings if d['rect'][2]-d['rect'][0]<=2 and d['rect'][3]-d['rect'][1]>5 and d['rect'][1]<cy<d['rect'][3]]
 left=max((r.x1 for r in vertical if r.x1<=x),default=None);edge=min((r.x0 for r in vertical if r.x0>=right),default=None)
 assert left is not None and edge is not None,'QTY must be inside actual column borders'
 horizontal=[fitz.Rect(d['rect'])for d in drawings if d['rect'][2]-d['rect'][0]>5 and d['rect'][3]-d['rect'][1]<=2 and d['rect'][0]<cx<d['rect'][2]]
 top=max((r.y1 for r in horizontal if r.y1<=y),default=None);base=min((r.y0 for r in horizontal if r.y0>=bottom),default=None)
 assert top is not None and base is not None,'QTY must be inside actual header row borders'
 assert abs(cx-(left+edge)/2)<2,'QTY must be horizontally centered in its cell'
 assert abs(cy-(top+base)/2)<3,'QTY must be vertically centered in its cell'
 pixels=page.get_pixmap(matrix=fitz.Matrix(4,4),clip=fitz.Rect(span['bbox']),colorspace=fitz.csGRAY,alpha=False)
 ink=sum(v<150 for v in pixels.samples)/len(pixels.samples)
 assert ink>.02,'QTY text must be visibly printed, not hidden by a white overlay'
 return dict(text='QTY',bbox=span['bbox'],cell=[left,top,edge,base],ink=ink)

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
  pages.append(dict(width=page.rect.width,height=page.rect.height,text=page.get_text(),spans=spans,drawings=drawings,choices=choices,image=str(image),quantityHeader=quantity_header(page,spans,drawings)))
form_arg=next((arg.split('=',1)[1]for arg in sys.argv if arg.startswith('--assert-form=')),None)
if form_arg:
 identifier,revision={'under-100':('ACTPRC01_03B','01/28/04'),'over-100':('ACTPRC01_02H','05/03/06')}[form_arg]
 for page in pages:
  visible=[s for s in page['spans']if s['text']==identifier and s['bbox'][1]>page['height']-40]
  assert len(visible)==1,f'Expected exact visible form identifier {identifier}, including underscore'
  assert any(s['text']==revision and s['bbox'][1]>page['height']-30 for s in page['spans']),'Revision date must be visible in footer'
 with fitz.open(source)as document:
  for rendered,page in zip(document,pages):
   identifier_span=next(s for s in page['spans']if s['text']==identifier)
   characters=[c for b in rendered.get_text('rawdict')['blocks']for line in b.get('lines',[])for span in line['spans']for c in span['chars']]
   underscores=[c for c in characters if c['c']=='_'and abs(c['bbox'][1]-identifier_span['bbox'][1])<1 and identifier_span['bbox'][0]<=c['bbox'][0]<identifier_span['bbox'][2]]
   assert len(underscores)==1,'Exact identifier must contain one visible underscore glyph'
   box=fitz.Rect(underscores[0]['bbox']);box.x0+=.1;box.x1-=.1
   pixels=rendered.get_pixmap(matrix=fitz.Matrix(6,6),clip=box,colorspace=fitz.csGRAY,alpha=False)
   assert sum(v<150 for v in pixels.samples)/len(pixels.samples)>.01,'Underscore glyph must have actual printed ink'
   date=next(s for s in page['spans']if s['text']==revision)
   pixels=rendered.get_pixmap(matrix=fitz.Matrix(4,4),clip=fitz.Rect(date['bbox']),colorspace=fitz.csGRAY,alpha=False)
   assert sum(v<150 for v in pixels.samples)/len(pixels.samples)>.02,'Revision date must have actual printed ink'

if '--assert-quantity' in sys.argv:
 assert pages and all(p['quantityHeader']for p in pages),'QTY must appear on every representative requisition page'
result=dict(pages=pages);serialized=json.dumps(result,default=list,indent=2);source.with_suffix('.layout.json').write_text(serialized,encoding='utf-8');print(serialized)
