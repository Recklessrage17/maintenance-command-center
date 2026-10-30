import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import pdfLib from '../backend/node_modules/pdf-lib/cjs/index.js';
const {PDFDocument,rgb}=pdfLib;
import {restoreLibreOfficeRequisitionFooter} from '../backend/dist/server/requisitionPdfFooter.js';
const fixtures=path.resolve('tests/fixtures/native-requisition-pdf');
const records=JSON.parse(fs.readFileSync(path.join(fixtures,'provenance.json'),'utf8'));
for(const record of records)test(`native PDF ${record.file}: exact footer and centered QTY`,async({},info)=>{
  const kind=record.file.startsWith('under')?'under-100':'over-100';
  const input=info.outputPath('native-original.pdf');fs.copyFileSync(path.join(fixtures,record.file),input);
  const inspect=(file:string,...flags:string[])=>spawnSync(process.env.PYTHON||'python',['-B','tests/helpers/inspect-requisition-pdf.py',file,...flags],{encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});
  // The retained real defect must remain rejected. Do not normalize away '_'.
  const broken=inspect(input,`--assert-form=${kind}`);
  expect(broken.status).not.toBe(0);expect(broken.stderr).toContain('exact visible form identifier');
  const original=inspect(input,'--assert-quantity');expect(original.status,original.stderr).toBe(0);
  const fixed=info.outputPath('native-restored.pdf');fs.writeFileSync(fixed,await restoreLibreOfficeRequisitionFooter(fs.readFileSync(input),kind));
  const verified=inspect(fixed,'--assert-quantity',`--assert-form=${kind}`);expect(verified.status,verified.stderr).toBe(0);
  const layout=JSON.parse(verified.stdout);
  for(const [index,page]of layout.pages.entries()){
    expect(page.width).toBe(792);expect(page.height).toBe(612);
    expect(page.quantityHeader.ink).toBeGreaterThan(.02);
    await info.attach(`restored-page-${index+1}`,{path:page.image,contentType:'image/png'});
  }
  // Compare rendered pixels everywhere outside the left footer block. This
  // includes tables, comments, signatures, totals and the other footer labels.
  const offCenter=info.outputPath('off-center-qty-negative-control.pdf');
  const same=execFileSync(process.env.PYTHON||'python',['-B','tests/helpers/check-native-pdf-body.py',input,fixed,offCenter,String(layout.pages[0].quantityHeader.cell[0])],{encoding:'utf8',windowsHide:true});
  expect(same).toContain('body pixels identical');
  const misplaced=inspect(offCenter,'--assert-quantity');expect(misplaced.status).not.toBe(0);expect(misplaced.stderr).toContain('horizontally centered');
  // A white-painted QTY is textually present but not visibly printed. The
  // semantic inspector must reject it, unlike the former stream regex.
  const doc=await PDFDocument.load(fs.readFileSync(fixed));const page=doc.getPage(0);const bbox=layout.pages[0].quantityHeader.bbox;
  page.drawRectangle({x:bbox[0]-.2,y:page.getHeight()-bbox[3]-.2,width:bbox[2]-bbox[0]+.4,height:bbox[3]-bbox[1]+.4,color:rgb(1,1,1)});
  const hidden=info.outputPath('hidden-qty-negative-control.pdf');fs.writeFileSync(hidden,await doc.save());
  const rejected=inspect(hidden,'--assert-quantity');expect(rejected.status).not.toBe(0);expect(rejected.stderr).toContain('visibly printed');
  await info.attach('restored-native-pdf',{path:fixed,contentType:'application/pdf'});
});
