import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';

// Calc clips a two-line Excel footer to bottomMargin - footerMargin (9.3pt
// in these templates). The underscore descender and revision date disappear.
// Restore only the left form-identification block after Calc export. Keep the
// worksheet body, Purchasing label, page counter and Excel exporter untouched.
export async function restoreLibreOfficeRequisitionFooter(bytes:Buffer,kind:'under-100'|'over-100') {
  const document=await PDFDocument.load(bytes);
  const font=await document.embedFont(StandardFonts.Helvetica);
  const identifier=kind==='under-100'?'ACTPRC01_03B':'ACTPRC01_02H';
  const revision=kind==='under-100'?'01/28/04':'05/03/06';
  const size=kind==='under-100'?11:10;
  for(const page of document.getPages()){
    // This 18pt strip is the existing worksheet's reserved bottom margin.
    // Do not erase or move any of the worksheet body above it.
    page.drawRectangle({x:0,y:0,width:170,height:18,color:rgb(1,1,1)});
    page.drawText(identifier,{x:18,y:23,size,font,color:rgb(0,0,0)});
    page.drawText(revision,{x:18,y:11,size,font,color:rgb(0,0,0)});
  }
  return Buffer.from(await document.save());
}
