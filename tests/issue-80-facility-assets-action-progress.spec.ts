import {expect,type Page,test} from '@playwright/test';
import {actionProgress,deferred,expectActionPending,fulfill,issue80Auth,issue80MachineAsset} from './issue-80-progress-helpers';

const area={id:21,name:'Production',description:'Main production floor.',building:'Building A',location:'North Wing',department:'Molding',status:'active',createdAt:'2026-08-20T12:00:00Z',updatedAt:'2026-08-20T12:00:00Z',summary:{folderCount:1,documentCount:1,pictureCount:0,videoCount:0}};
const folder={id:31,areaId:21,parentId:null,name:'Manuals',description:'Controlled manuals.',path:'Manuals',itemCount:1,childCount:0,createdAt:area.createdAt,updatedAt:area.updatedAt};
const facilityItem={id:41,areaId:21,folderId:31,facilityName:'Production',folderName:'Manuals',folderPath:'Manuals',mediaType:'document',originalFilename:'Panel Schedule.pdf',displayFilename:'Panel Schedule.pdf',extension:'.pdf',mimeType:'application/pdf',sizeBytes:120000,description:'Panel reference',caption:'Panel A',revision:'B',date:'2026-08-20',durationSeconds:null,uploadedAt:'2026-08-20T12:00:00Z',updatedAt:'2026-08-20T12:00:00Z',uploadedBy:'Issue 80 Owner',contentUrl:'/api/facility-info/items/41/content',downloadUrl:'/api/facility-info/items/41/download',canPrint:true};

test('Facility area create uses compact progress and blocks duplicate submissions',async({page})=>{
  const gate=deferred();let requests=0;let areas:typeof area[]=[];
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;const method=route.request().method();
    if(path==='/api/auth/status')return fulfill(route,issue80Auth);
    if(path==='/api/facility-info/permissions')return fulfill(route,{ok:true,canWrite:true,canRecoveryExport:true});
    if(path==='/api/facility-info'&&method==='GET')return fulfill(route,{ok:true,areas,limits:{documentsMb:50,picturesMb:50,videosMb:500}});
    if(path==='/api/facility-info/areas'&&method==='POST'){requests+=1;await gate.promise;areas=[area];return fulfill(route,{ok:true,area},201);}
    return fulfill(route,{ok:true});
  });
  await page.goto('/facility-info');await page.getByRole('button',{name:'Create Facility Area'}).click();
  const modal=page.getByRole('dialog',{name:'Create Facility Area'});await modal.getByLabel('Facility / Area Name *').fill('Production');const button=modal.locator('button[type="submit"]');
  await button.evaluate((element:HTMLButtonElement)=>{element.click();element.click();});await expect.poll(()=>requests).toBe(1);await expectActionPending(button);
  gate.release();await expect(actionProgress(button)).toHaveAttribute('data-action-progress','success');await expect(modal).toHaveCount(0);await expect(page.getByRole('button',{name:'Open Production'})).toBeVisible();
});

test('Facility folder and file metadata saves keep independent action lifecycles',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='mobile-chromium','Secondary Facility metadata coverage runs once on desktop.');
  const folderGate=deferred();const fileGate=deferred();let folderRequests=0;let fileRequests=0;let folders=[folder];let items=[facilityItem];
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;const method=route.request().method();
    if(path==='/api/auth/status')return fulfill(route,issue80Auth);
    if(path==='/api/facility-info/permissions')return fulfill(route,{ok:true,canWrite:true,canRecoveryExport:true});
    if(path==='/api/facility-info'&&method==='GET')return fulfill(route,{ok:true,areas:[area],limits:{documentsMb:50,picturesMb:50,videosMb:500}});
    if(path==='/api/facility-info/areas/21'&&method==='GET')return fulfill(route,{ok:true,area,folders,items});
    if(path==='/api/facility-info/areas/21/folders'&&method==='POST'){folderRequests+=1;await folderGate.promise;folders=[...folders,{...folder,id:32,name:'Safety',path:'Safety',itemCount:0}];return fulfill(route,{ok:true,folder:folders[1]},201);}
    if(path==='/api/facility-info/items/41'&&method==='PATCH'){fileRequests+=1;await fileGate.promise;items=[{...facilityItem,displayFilename:'Panel Schedule Rev C.pdf',revision:'C'}];return fulfill(route,{ok:true,item:items[0]});}
    return fulfill(route,{ok:true,items:[],areas:[],folders:[]});
  });
  await page.goto('/facility-info');await page.getByRole('button',{name:'Open Production'}).click();
  await page.locator('.facility-area-heading .mcc-overflow-menu__trigger').click();await page.getByRole('menuitem',{name:'Create Folder'}).click();
  let modal=page.getByRole('dialog',{name:'Create Folder'});await modal.getByLabel('Folder Name *').fill('Safety');let button=modal.locator('button[type="submit"]');
  await button.evaluate((element:HTMLButtonElement)=>{element.click();element.click();});await expect.poll(()=>folderRequests).toBe(1);await expectActionPending(button);folderGate.release();await expect(actionProgress(button)).toHaveAttribute('data-action-progress','success');await expect(modal).toHaveCount(0);

  const row=page.locator('.facility-item-row',{hasText:'Panel Schedule.pdf'});await row.getByRole('button',{name:'More actions for Panel Schedule.pdf'}).click();await page.getByRole('menuitem',{name:'Rename / Edit'}).click();
  modal=page.getByRole('dialog',{name:'Rename / Edit File'});await modal.getByLabel('Display Filename *').fill('Panel Schedule Rev C.pdf');await modal.getByLabel('Revision').fill('C');button=modal.locator('button[type="submit"]');
  await button.evaluate((element:HTMLButtonElement)=>{element.click();element.click();});await expect.poll(()=>fileRequests).toBe(1);await expectActionPending(button);fileGate.release();await expect(actionProgress(button)).toHaveAttribute('data-action-progress','success');await expect(page.getByText('Panel Schedule Rev C.pdf',{exact:true})).toBeVisible();
});

type DocumentFixture={id:number;assetId:number;folderId:number;folderName:string;originalFilename:string;displayFilename:string;extension:string;mimeType:string;sizeBytes:number;description:string;revision:string;uploadedAt:string;updatedAt:string;uploadedBy:string;openUrl:string;downloadUrl:string;canPrint:boolean};
function documentFixture():DocumentFixture{return{id:10,assetId:8080,folderId:1,folderName:'Manuals',originalFilename:'Manual.pdf',displayFilename:'Manual.pdf',extension:'.pdf',mimeType:'application/pdf',sizeBytes:2048,description:'Machine document',revision:'A',uploadedAt:'2026-08-20T12:00:00Z',updatedAt:'2026-08-20T12:00:00Z',uploadedBy:'Issue 80 Owner',openUrl:'/api/machine-library/assets/8080/documents/10/open',downloadUrl:'/api/machine-library/assets/8080/documents/10/download',canPrint:true};}

test('Asset document folder and document metadata saves share compact progress',async({page})=>{
  const folderGate=deferred();const documentGate=deferred();let folderRequests=0;let documentRequests=0;let folders=[{id:1,assetId:8080,name:'Manuals',description:'OEM manuals',documentCount:1,createdAt:'2026-08-20T12:00:00Z',updatedAt:'2026-08-20T12:00:00Z'}];let documents=[documentFixture()];
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;const method=route.request().method();
    if(path==='/api/auth/status')return fulfill(route,issue80Auth);
    if(path==='/api/machine-library/assets')return fulfill(route,{ok:true,assets:[issue80MachineAsset],brandSettings:[],permissions:{canEdit:true,canDelete:true,canManagePm:true}});
    if(path==='/api/machine-library/assets/8080/document-folders'&&method==='GET')return fulfill(route,{ok:true,folders,summary:{folderCount:folders.length,documentCount:documents.length}});
    if(path==='/api/machine-library/assets/8080/document-folders'&&method==='POST'){folderRequests+=1;await folderGate.promise;folders=[...folders,{...folders[0],id:2,name:'Safety',description:'Safety records',documentCount:0}];return fulfill(route,{ok:true,folder:folders[1]},201);}
    if(path==='/api/machine-library/assets/8080/documents'&&method==='GET')return fulfill(route,{ok:true,documents});
    if(path==='/api/machine-library/assets/8080/documents/10'&&method==='PATCH'){documentRequests+=1;await documentGate.promise;documents=[{...documents[0],displayFilename:'Service Manual.pdf',revision:'C'}];return fulfill(route,{ok:true,document:documents[0]});}
    if(path.endsWith('/preventive-maintenance'))return fulfill(route,{ok:true,tasks:[],summary:{total:0,dueSoon:0,overdue:0,nextDueDate:null,nextDueMeter:null}});
    if(path.endsWith('/notes'))return fulfill(route,{ok:true,notes:[],permissions:{canCreate:true}});
    if(path.endsWith('/history'))return fulfill(route,{ok:true,records:[]});
    if(path.endsWith('/inspection-records'))return fulfill(route,{ok:true,records:[]});
    if(path.endsWith('/component-images'))return fulfill(route,{ok:true,images:[]});
    return fulfill(route,{ok:true});
  });
  await page.goto('/machine-library');await page.locator('.machine-asset-card').click();const detail=page.locator('.machine-detail-modal');await detail.getByRole('button',{name:/Asset Document Library/}).click();
  await detail.getByRole('button',{name:'Create Folder'}).click();let modal=page.getByRole('dialog',{name:'Create Folder'});await modal.getByLabel('Folder Name *').fill('Safety');let button=modal.locator('button[type="submit"]');
  await button.evaluate((element:HTMLButtonElement)=>{element.click();element.click();});await expect.poll(()=>folderRequests).toBe(1);await expectActionPending(button);folderGate.release();await expect(actionProgress(button)).toHaveAttribute('data-action-progress','success');await expect(modal).toHaveCount(0);

  const manuals=detail.locator('.machine-document-folder-card',{hasText:'Manuals'});await manuals.getByRole('button',{name:/Manuals.*1 document/}).click();const row=detail.locator('.machine-document-row',{hasText:'Manual.pdf'});await row.getByRole('button',{name:'More actions for Manual.pdf'}).click();await page.getByRole('menuitem',{name:'Rename / Edit'}).click();
  modal=page.getByRole('dialog',{name:'Rename / Edit Document'});await modal.getByLabel('Display filename *').fill('Service Manual.pdf');button=modal.locator('button[type="submit"]');await button.evaluate((element:HTMLButtonElement)=>{element.click();element.click();});
  await expect.poll(()=>documentRequests).toBe(1);await expectActionPending(button);documentGate.release();await expect(actionProgress(button)).toHaveAttribute('data-action-progress','success');await expect(detail.getByText('Service Manual.pdf',{exact:true})).toBeVisible();
});

function warningNote(){return{id:801,assetId:8080,assetNumber:'PRESS-80',assetName:'Issue 80 Press',title:'Issue 80 warning',noteDate:'2026-08-20',body:'Original maintenance issue.',warning:true,workOrder:'WO-80',status:'active',createdBy:'Issue 80 Owner',createdAt:'2026-08-20T12:00:00Z',updatedAt:'2026-08-20T12:00:00Z',resolvedAt:null,resolvedBy:'',resolutionSummary:'',resolvedYear:'',pdfFilename:'issue-80.pdf',pdfUrl:'/api/machine-library/asset-notes/801/pdf',pdfDownloadUrl:'/api/machine-library/asset-notes/801/pdf?download=true',attachments:[],updates:[],lifecycle:[],permissions:{canEdit:true,canDelete:true,canResolve:true,canReopen:false,canAddUpdate:true,canDeleteAttachments:true}};}

test('Metadata-only Asset Note create and maintenance update use ordinary action progress',async({page})=>{
  const noteGate=deferred();const updateGate=deferred();let noteRequests=0;let updateRequests=0;let notes=[warningNote()];
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;const method=route.request().method();
    if(path==='/api/auth/status')return fulfill(route,issue80Auth);
    if(path==='/api/machine-library/assets')return fulfill(route,{ok:true,assets:[issue80MachineAsset],brandSettings:[],permissions:{canEdit:true,canDelete:true,canManagePm:true}});
    if(path==='/api/machine-library/assets/8080/notes'&&method==='GET')return fulfill(route,{ok:true,notes,permissions:{canCreate:true}});
    if(path==='/api/machine-library/assets/8080/notes'&&method==='POST'){noteRequests+=1;await noteGate.promise;const created={...warningNote(),id:802,title:'Metadata-only note',warning:false,status:'ordinary',body:'No attachment processing required.',workOrder:'',permissions:{...warningNote().permissions,canResolve:false,canAddUpdate:false}};notes=[...notes,created];return fulfill(route,{ok:true,note:created},201);}
    if(path==='/api/machine-library/asset-notes/801/updates'&&method==='POST'){updateRequests+=1;await updateGate.promise;const update={id:803,noteId:801,body:'Metadata-only maintenance update.',createdBy:'Issue 80 Owner',createdAt:'2026-08-21T12:00:00Z',attachments:[]};notes=[{...notes[0],updates:[update]},...notes.slice(1)];return fulfill(route,{ok:true,update,note:notes[0]},201);}
    if(path.endsWith('/preventive-maintenance'))return fulfill(route,{ok:true,tasks:[],summary:{total:0,dueSoon:0,overdue:0,nextDueDate:null,nextDueMeter:null}});
    if(path.endsWith('/document-folders'))return fulfill(route,{ok:true,folders:[],summary:{folderCount:0,documentCount:0}});
    if(path.endsWith('/documents'))return fulfill(route,{ok:true,documents:[]});
    if(path.endsWith('/history'))return fulfill(route,{ok:true,records:[]});
    if(path.endsWith('/inspection-records'))return fulfill(route,{ok:true,records:[]});
    if(path.endsWith('/component-images'))return fulfill(route,{ok:true,images:[]});
    return fulfill(route,{ok:true});
  });
  await page.goto('/machine-library');await page.locator('.machine-asset-card').click();const detail=page.locator('.machine-detail-modal');await detail.getByRole('button',{name:/Asset Notes & Attachments/}).click();
  await detail.getByRole('button',{name:'Add Note'}).click();let form=detail.locator('.asset-note-form');await form.getByLabel('Note Title *').fill('Metadata-only note');await form.getByLabel('Note Body *').fill('No attachment processing required.');let button=form.locator('button[type="submit"]');
  await button.evaluate((element:HTMLButtonElement)=>{element.click();element.click();});await expect.poll(()=>noteRequests).toBe(1);await expectActionPending(button);noteGate.release();await expect(actionProgress(button)).toHaveAttribute('data-action-progress','success');await expect(detail.getByText('Metadata-only note')).toBeVisible();

  const card=detail.locator('.asset-note-active-issue-card',{hasText:'Issue 80 warning'});await card.locator('.asset-note-issue-toggle').click();await card.getByRole('button',{name:'+ Add Update'}).click();form=card.locator('.asset-note-update-form');await form.getByLabel('Maintenance work / progress update *').fill('Metadata-only maintenance update.');button=form.locator('button[type="submit"]');
  await button.evaluate((element:HTMLButtonElement)=>{element.click();element.click();});await expect.poll(()=>updateRequests).toBe(1);await expectActionPending(button);updateGate.release();await expect(actionProgress(button)).toHaveAttribute('data-action-progress','success');await expect(card.getByText('Metadata-only maintenance update.')).toBeVisible();
});
