import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {backendFixture, owner, request, root} from './helpers/security-process.mjs';

type Inspection = {pages: Array<{width:number;height:number;text:string;image:string;spans:Array<{text:string;bbox:number[];color:number;font:string}>;drawings:Array<{rect:number[];items:unknown[]}>;choices:Array<{caption:string;ink:number}>}>};
const itemNumber=(i:number)=>i===2?'I':i===3?'ITEM-12345678901234567890':`ITEM-${i}`;

for (const kind of ['under', 'over']) for (const scenario of [{tax:'Yes',count:1,notes:''},{tax:'No',count:3,notes:'Synthetic comment one: inspect the replacement assembly before service.\nSynthetic comment two: verify fit and operation.'},{tax:'Yes',count:13,notes:'Synthetic comment: inspect before service.'}]) {
  const {tax,count}=scenario;
  test(`${kind} $100 official PDF preserves ${tax} tax choice with ${count} items through preview/create/reprint`, async ({}, info) => {
    test.setTimeout(180_000);
    const runtime = await backendFixture('p1', {}, {observeRequisitionExports:true});
    try {
      fs.cpSync(path.join(root, 'backend/templates'), path.join(runtime.appRoot, 'backend/templates'), {recursive:true});
      const cookie = await owner(runtime.base);
      const post = async (url:string, body:unknown) => {
        const result = await request(runtime.base, url, {method:'POST', cookie, body});
        expect(result.response.ok, JSON.stringify(result.data)).toBe(true);
        return result.data;
      };
      const batch = (await post('/api/requisition-batches', {name:'Synthetic PDF QA'})).batch;
      const ids:number[] = [];
      for (let i=0; i<count; i++) {
        const result = await post('/api/requisition-staging', {batchId:batch.id,partNumber:`QA-${i+1}`,supplierPartNumber:itemNumber(i+1),description:i===0?'Synthetic wrapped maintenance item description with extra detail to exercise the full row height safely.':'Short synthetic description',vendor:'Synthetic Vendor',quantityRequested:1,unitCost:kind==='under'?5:125,location:'QA Stores',priority:'Normal',status:'Need to Order'});
        ids.push(result.item.id);
      }
      const body = {stagingItemIds:ids,poInitiator:'Local Security Owner',requisitionedByName:'Local Security Owner',taxExempt:tax,materialCert:tax==='Yes'?'No':'Yes',fob:'Destination',notes:scenario.notes};
      const preview = await post('/api/requisition-staging/preview', body);
      const inspect = async (url:string, label:string, inline:boolean) => {
        const response = await fetch(runtime.base+url, {headers:{Cookie:cookie},signal:AbortSignal.timeout(90_000)});
        expect(response.status, await (response.ok?Promise.resolve(''):response.text())).toBe(200);
        expect(response.headers.get('content-type')).toContain('application/pdf');
        expect(response.headers.get('content-disposition')).toContain(inline?'inline':'attachment');
        const file = info.outputPath(`${kind}-${tax.toLowerCase()}-${label}.pdf`);
        fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
        await info.attach(label, {path:file,contentType:'application/pdf'});
        const result:Inspection = JSON.parse(execFileSync(process.env.PYTHON||'python', ['-B','tests/helpers/inspect-requisition-pdf.py',file],{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024}));
        const rowsPerPage=kind==='under'?11:12;
        expect(result.pages).toHaveLength(Math.ceil(count/rowsPerPage));
        for(const [pageIndex,page] of result.pages.entries()) {
        expect(page.width).toBeGreaterThan(page.height);
        expect(page.text).toContain('Local Security Owner');
        expect(page.text.replace(/\s/g,'')).toContain(kind==='under'?'Under$100.00':'ACTPRC01_02H');
        expect(page.text).toContain(kind==='under'?'ACTPRC01_03B':'ACTPRC01_02H');
        expect(page.text).toContain(kind==='under'?'01/28/04':'05/03/06');
        const comments = page.spans.find(s=>s.text.trim()==='COMMENTS:');
        expect(comments).toBeDefined();
        expect(comments!.color).toBe(0);
        expect(page.choices.map(c=>c.caption)).toEqual(['YES','NO','YES','NO']);
        expect(page.choices.map(c=>c.ink>0.03)).toEqual([tax==='Yes',tax==='No',tax==='No',tax==='Yes']);
        const sample=page.spans.find(s=>s.text.startsWith('ITEM-')||s.text==='I')!;
        const sampleY=(sample.bbox[1]+sample.bbox[3])/2;
        const columnBorders=page.drawings.map(d=>d.rect).filter(r=>r[2]-r[0]<3&&r[3]-r[1]>10&&r[1]<sampleY&&r[3]>sampleY);
        const columnLeft=columnBorders.filter(r=>r[2]<=sample.bbox[0]).sort((a,b)=>b[2]-a[2])[0];
        const columnRight=columnBorders.filter(r=>r[0]>=sample.bbox[2]).sort((a,b)=>a[0]-b[0])[0];
        const heading=page.spans.find(s=>s.text==='Number')!;
        const numberSpans=page.spans.filter(s=>s.bbox[0]>=columnLeft[2]&&s.bbox[2]<=columnRight[0]&&s.bbox[1]>heading.bbox[3]&&s.bbox[3]<comments!.bbox[1]).sort((a,b)=>a.bbox[1]-b.bbox[1]||a.bbox[0]-b.bbox[0]);
        let nextSpan=0;
        for(let i=pageIndex*rowsPerPage+1;i<=Math.min(count,(pageIndex+1)*rowsPerPage);i++) {
          const number=itemNumber(i);
          expect(page.text.replace(/\s/g,'')).toContain(number);
          const spans:typeof page.spans=[];
          // Let the actual exporter wrap within the cell; do not assume that
          // workbook newlines and extracted PDF text spans are one-to-one.
          while(spans.map(s=>s.text).join('').length<number.length&&nextSpan<numberSpans.length)spans.push(numberSpans[nextSpan++]);
          expect(spans.map(s=>s.text).join('')).toBe(number);
          const x=Math.min(...spans.map(s=>s.bbox[0])),y=Math.min(...spans.map(s=>s.bbox[1]));
          const right=Math.max(...spans.map(s=>s.bbox[2])),bottom=Math.max(...spans.map(s=>s.bbox[3]));
          const cx=(x+right)/2,cy=(y+bottom)/2;
          const borders=page.drawings.map(d=>d.rect).filter(r=>r[2]-r[0]<3&&r[3]-r[1]>10&&r[1]<cy&&r[3]>cy);
          const left=borders.filter(r=>r[2]<=x).sort((a,b)=>b[2]-a[2])[0];
          const edge=borders.filter(r=>r[0]>=right).sort((a,b)=>a[0]-b[0])[0];
          expect(left).toBeDefined();expect(edge).toBeDefined();
          expect(Math.abs(cx-(left[2]+edge[0])/2)).toBeLessThan(1.5);
          // Excel can coalesce a vertical border over several adjacent rows;
          // use the actual horizontal row boundaries for vertical centering.
          const horizontal=page.drawings.map(d=>d.rect).filter(r=>r[2]-r[0]>10&&r[3]-r[1]<3&&r[0]<cx&&r[2]>cx);
          const top=horizontal.filter(r=>r[3]<=y).sort((a,b)=>b[3]-a[3])[0];
          const base=horizontal.filter(r=>r[1]>=bottom).sort((a,b)=>a[1]-b[1])[0];
          expect(top).toBeDefined();expect(base).toBeDefined();
          expect(Math.abs(cy-(top[3]+base[1])/2)).toBeLessThan(2);
        }
        if (body.notes) {
          const normalized=body.notes.replace(/\s/g,'');
          expect(page.text.replace(/\s/g,'')).toContain(normalized);
          // Comment spans may include an appended page annotation; the separate
          // black page footer is not employee-entered comment text.
          const commentSpans=page.spans.filter(s=>s.text.trim().length>4&&(body.notes.replace(/\s+/g,' ').includes(s.text.trim())||s.text.startsWith('Synthetic comment')));
          expect(commentSpans.length).toBeGreaterThan(0);
          expect(commentSpans.map(s=>s.text).join('').replace(/\s/g,'')).toContain(normalized);
          for(const span of commentSpans)expect(span.color).toBe(kind==='under'?0xc00000:0xff0000);
        } else {
          expect(page.text).not.toContain('Synthetic comment');
          expect(page.text).not.toContain('Maintenance inventory restock.');
        }
        for(const span of page.spans.filter(s=>/REQUISITIONED|AUTHORIZED BY|P\.O\. Initiator:|DEPARTMENT MANAGER/.test(s.text)))expect(span.color).toBe(0);
        await info.attach(`${label}-render-${pageIndex+1}`, {path:page.image,contentType:'image/png'});
        }
        return result;
      };
      await inspect(preview.previews[0].pdfUrl, 'preview', true);
      const created = await post('/api/requisition-staging/create-requisitions', {token:preview.token});
      const id = created.requisitions[0].id;
      let saved = await request(runtime.base, `/api/requisitions/${id}`, {cookie});
      expect(saved.data.requisition.poInitiator).toBe(body.poInitiator);
      expect(saved.data.requisition.taxExempt).toBe(tax);
      expect(saved.data.requisition.lineCount).toBe(count);
      expect(saved.data.requisition.totalCost).toBe(count*(kind==='under'?5:125));
      await inspect(`/api/requisitions/${id}/pdf`, 'saved', false);
      const edit = await request(runtime.base, `/api/requisitions/${id}`, {method:'PATCH',cookie,body:{workOrderNumber:'QA-WO',notes:body.notes}});
      expect(edit.response.status).toBe(200);
      saved = await request(runtime.base, `/api/requisitions/${id}`, {cookie});
      expect(saved.data.requisition.poInitiator).toBe(body.poInitiator);
      expect(saved.data.requisition.taxExempt).toBe(tax);
      await inspect(`/api/requisitions/${id}/pdf?preview=true`, 'reprint', true);
      const denied = await fetch(runtime.base+`/api/requisitions/${id}/pdf`);
      expect(denied.status).toBe(401);
    } finally {
      await runtime.close();
      const exports = path.join(runtime.fixture,'requisition-exports');
      if(fs.existsSync(exports)) for(const name of fs.readdirSync(exports)) {
        const target=info.outputPath(name);fs.copyFileSync(path.join(exports,name),target);
        await info.attach(name,{path:target,contentType:name.endsWith('.xlsx')?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/plain'});
      }
    }
  });
}
