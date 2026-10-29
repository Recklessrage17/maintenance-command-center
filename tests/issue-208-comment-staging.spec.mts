import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {backendFixture,owner,request,root} from './helpers/security-process.mjs';

for(const kind of ['under','over'])test(`${kind} staging keeps full notes beyond the former 1000-character cutoff`,async({},info)=>{
  test.setTimeout(180000);
  const runtime=await backendFixture('p1-staging-comments');
  try{
    fs.cpSync(path.join(root,'backend/templates'),path.join(runtime.appRoot,'backend/templates'),{recursive:true});
    const cookie=await owner(runtime.base);
    const post=async(url:string,body:unknown)=>{
      const result=await request(runtime.base,url,{method:'POST',cookie,body});
      expect(result.response.ok,JSON.stringify(result.data)).toBe(true);return result.data;
    };
    const batch=(await post('/api/requisition-batches',{name:'Synthetic continuation QA'})).batch;
    const ids:number[]=[];
    for(let i=0;i<13;i++){
      const item=(await post('/api/requisition-staging',{batchId:batch.id,partNumber:`QA-COMMENT-${i+1}`,supplierPartNumber:`COMMENT-ITEM-${i+1}`,description:'Synthetic comment continuation staging',vendor:'Synthetic Vendor',quantityRequested:1,unitCost:kind==='under'?5:125,location:'QA',priority:'Normal',status:'Need to Order'})).item;
      ids.push(item.id);
    }
    const notes=Array.from({length:39},(_,i)=>`Synthetic staging line ${String(i+1).padStart(2,'0')}: preserve this full comment.`).join('\n');
    expect(notes.length).toBeGreaterThan(1000);
    const preview=await post('/api/requisition-staging/preview',{stagingItemIds:ids,poInitiator:'Local Security Owner',requisitionedByName:'Local Security Owner',taxExempt:'Yes',notes});
    const verify=async(url:string,label:string)=>{
      const response=await fetch(runtime.base+url,{headers:{Cookie:cookie},signal:AbortSignal.timeout(90000)});
      expect(response.status).toBe(200);
      const file=info.outputPath(`${label}.pdf`);fs.writeFileSync(file,Buffer.from(await response.arrayBuffer()));
      await info.attach(label,{path:file,contentType:'application/pdf'});
      const {pages}=JSON.parse(execFileSync(process.env.PYTHON||'python',['-B','tests/helpers/inspect-requisition-pdf.py',file],{encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024}));
      expect(pages).toHaveLength(4);
      let printed='';
      for(const [index,page]of pages.entries()){
        expect(page.text).toContain(`Page ${index+1} of 4`);
        if(index<2){
          expect(page.spans.find((s:any)=>s.text==='COMMENTS:').color).toBe(0);
          expect(page.text).toContain('Comments continue on page 3.');
          expect(page.choices.map((c:any)=>c.ink>0.03)).toEqual([true,false,false,true]);
        }
        const red=page.spans.filter((s:any)=>s.color===(kind==='under'?0xc00000:0xff0000)&&!s.text.startsWith('Comments continue on page')).sort((a:any,b:any)=>a.bbox[1]-b.bbox[1]||a.bbox[0]-b.bbox[0]);
        if(index!==1)printed+=red.map((s:any)=>s.text).join('');
        await info.attach(`${label}-page-${index+1}`,{path:page.image,contentType:'image/png'});
      }
      expect(printed.replace(/\s/g,'')).toBe(notes.replace(/\s/g,''));
    };
    await verify(preview.previews[0].pdfUrl,'preview');
    const created=await post('/api/requisition-staging/create-requisitions',{token:preview.token});
    const id=created.requisitions[0].id;
    const saved=await request(runtime.base,`/api/requisitions/${id}`,{cookie});
    expect(saved.data.requisition.notes).toBe(notes);
    expect(saved.data.requisition.lineCount).toBe(13);
    expect(saved.data.requisition.totalCost).toBe(13*(kind==='under'?5:125));
    await verify(`/api/requisitions/${id}/pdf`,'saved');
    const replay=await request(runtime.base,'/api/requisition-staging/create-requisitions',{method:'POST',cookie,body:{token:preview.token}});
    expect(replay.response.ok).toBe(false);
  }finally{await runtime.close();}
});
