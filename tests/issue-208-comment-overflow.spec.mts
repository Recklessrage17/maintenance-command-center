import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {backendFixture,owner,request,root} from './helpers/security-process.mjs';

type Span={text:string;bbox:number[];color:number;font:string};
type Page={width:number;height:number;text:string;spans:Span[];choices:{ink:number}[];image:string};
const normalize=(text:string)=>text.replace(/\s/g,'');
const cases=[
  {name:'explicit multiline and blank line',notes:'Synthetic comment first line.\n\nSynthetic comment third line.\nSynthetic comment fourth line.'},
  {name:'long prose without truncation',notes:Array.from({length:8},(_,i)=>`Synthetic paragraph ${i+1}: inspect assembly and verify fit before returning to service.`).join(' ')},
  {name:'wide unbroken token and Unicode',notes:`Synthetic wide token ${'W'.repeat(240)} café résumé Ω 測試 END.`},
  {name:'multiple continuation pages',notes:Array.from({length:39},(_,i)=>`Synthetic comment line ${String(i+1).padStart(2,'0')}: verify safe operation.`).join('\n')},
];
for(const kind of ['under','over'])for(const scenario of cases)test(`${kind} comments preserve ${scenario.name}`,async({},info)=>{
  test.setTimeout(180000);
  const runtime=await backendFixture('p1-comments',{},{observeRequisitionExports:true});
  try{
    fs.cpSync(path.join(root,'backend/templates'),path.join(runtime.appRoot,'backend/templates'),{recursive:true});
    const cookie=await owner(runtime.base);
    const part=await request(runtime.base,'/api/inventory/native/parts',{method:'POST',cookie,body:{partNumber:'COMMENTS-QA',description:'Synthetic comment layout regression',location:'QA',vendor:'Synthetic Vendor',quantity:1,minQuantity:2,unitCost:kind==='under'?5:125}});
    expect(part.response.status).toBe(201);
    const created=await request(runtime.base,'/api/requisitions',{method:'POST',cookie,body:{poInitiator:'Local Security Owner',requisitionedByName:'Local Security Owner',departmentManager:'Synthetic Manager',authorizedBy:'Synthetic Approver',taxExempt:'No',notes:scenario.notes,items:[{inventoryPartId:Number(part.data.part.id),quantityRequested:1}]}});
    expect(created.response.status).toBe(201);
    const id=created.data.requisition.id;
    const inspect=async(label:string,preview=false)=>{
      const response=await fetch(`${runtime.base}/api/requisitions/${id}/pdf${preview?'?preview=true':''}`,{headers:{Cookie:cookie},signal:AbortSignal.timeout(90000)});
      expect(response.status).toBe(200);
      const file=info.outputPath(`${label}.pdf`);
      fs.writeFileSync(file,Buffer.from(await response.arrayBuffer()));
      await info.attach(label,{path:file,contentType:'application/pdf'});
      const {pages}:{pages:Page[]}=JSON.parse(execFileSync(process.env.PYTHON||'python',['-B','tests/helpers/inspect-requisition-pdf.py',file],{encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024}));
      expect(pages.length).toBeGreaterThan(1);
      const body:string[]=[];
      for(const [index,page]of pages.entries()){
        expect(page.width).toBeGreaterThan(page.height);
        expect(page.text).toContain(`Page ${index+1} of ${pages.length}`);
        if(index===0){
          expect(page.spans.find(s=>s.text.trim()==='COMMENTS:')?.color).toBe(0);
          expect(page.text).toContain('Comments continue on page 2.');
          expect(page.choices.map(c=>c.ink>0.03)).toEqual([false,true,false,true]);
          expect(page.text).toMatch(/DEPARTMENT\s+MANAGER/);
          expect(page.text).toContain('REQUISITIONED');
          if(kind==='under')expect(page.text).toContain('AUTHORIZED BY:');
          expect(page.text).toContain('Local Security Owner');
          expect(normalize(page.text)).toContain(kind==='under'?'$5.00':'$125.00');
        }else{
          const heading=page.spans.find(s=>s.text==='REQUISITION COMMENTS - CONTINUED');
          expect(heading?.color).toBe(0);
          expect(page.text).toContain('Requisition:');
          expect(page.text).not.toMatch(/AUTHORIZED BY|DEPARTMENT\s+MANAGER|Total Price|QTY/);
        }
        const red=page.spans.filter(s=>s.color===(kind==='under'?0xc00000:0xff0000));
        // Font fallback can shift a Unicode span's top by a few points.
        // Group actual printed lines, then read left-to-right within each one.
        const lines:Span[][]=[];
        for(const span of [...red].sort((a,b)=>a.bbox[1]-b.bbox[1])){
          const line=lines.find(group=>Math.abs(group[0].bbox[1]-span.bbox[1])<4);
          if(line)line.push(span);else lines.push([span]);
        }
        red.splice(0,red.length,...lines.flatMap(line=>line.sort((a,b)=>a.bbox[0]-b.bbox[0])));
        expect(red.length).toBeGreaterThan(0);
        for(const span of red){
          expect(span.bbox[0]).toBeGreaterThanOrEqual(18);
          expect(span.bbox[2]).toBeLessThanOrEqual(page.width-18);
          expect(span.bbox[1]).toBeGreaterThanOrEqual(18);
          expect(span.bbox[3]).toBeLessThan(page.height-35);
          // Check actual printed geometry, including signatures and footer;
          // growing the merged row must not paint over any unrelated text.
          for(const other of page.spans.filter(s=>s.color===0)){
            const width=Math.min(span.bbox[2],other.bbox[2])-Math.max(span.bbox[0],other.bbox[0]);
            const height=Math.min(span.bbox[3],other.bbox[3])-Math.max(span.bbox[1],other.bbox[1]);
            expect(width>0.5&&height>0.5,`${span.text} overlaps ${other.text}`).toBe(false);
          }
          if(!span.text.startsWith('Comments continue on page'))body.push(span.text);
        }
        await info.attach(`${label}-page-${index+1}`,{path:page.image,contentType:'image/png'});
      }
      expect(normalize(body.join(''))).toBe(normalize(scenario.notes));
      expect(pages.map(p=>p.text).join('')).not.toContain('...');
      if(scenario.name==='multiple continuation pages')expect(pages).toHaveLength(3);
      return fs.readFileSync(file);
    };
    const original=await inspect('saved');
    const saved=await request(runtime.base,`/api/requisitions/${id}`,{cookie});
    expect(saved.data.requisition.notes).toBe(scenario.notes);
    if(scenario.name==='multiple continuation pages'){
      const edited=await request(runtime.base,`/api/requisitions/${id}`,{method:'PATCH',cookie,body:{workOrderNumber:'QA-COMMENT-LAYOUT',notes:scenario.notes}});
      expect(edited.response.status).toBe(200);
      await inspect('reprint',true);
      expect(fs.readFileSync(info.outputPath('saved.pdf'))).toEqual(original);
    }
  }finally{
    await runtime.close();
    const exports=path.join(runtime.fixture,'requisition-exports');
    if(fs.existsSync(exports))for(const name of fs.readdirSync(exports)){
      const target=info.outputPath(name);fs.copyFileSync(path.join(exports,name),target);
      await info.attach(name,{path:target,contentType:name.endsWith('.xlsx')?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/plain'});
    }
  }
});
