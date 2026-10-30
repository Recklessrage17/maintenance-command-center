"""Independent pixel comparison plus a deliberately off-center QTY control."""
import sys
import fitz

with fitz.open(sys.argv[1])as original,fitz.open(sys.argv[2])as restored:
    assert len(original)==len(restored)
    for before,after in zip(original,restored):
        for region in [fitz.Rect(170,0,792,612),fitz.Rect(0,0,170,574)]:
            a=before.get_pixmap(matrix=fitz.Matrix(2,2),clip=region,alpha=False)
            b=after.get_pixmap(matrix=fitz.Matrix(2,2),clip=region,alpha=False)
            assert a.samples==b.samples,'Unrelated body pixels changed'
    print('body pixels identical')
    page=restored[0]
    spans=[s for b in page.get_text('dict')['blocks']for line in b.get('lines',[])for s in line['spans']]
    qty=next(s for s in spans if s['text']=='QTY')
    page.add_redact_annot(fitz.Rect(qty['bbox']),fill=(1,1,1))
    page.apply_redactions(images=0,graphics=0)
    page.insert_text((float(sys.argv[4])+.5,qty['origin'][1]),'QTY',fontsize=qty['size'],fontname='helv',color=(0,0,0))
    restored.save(sys.argv[3])
