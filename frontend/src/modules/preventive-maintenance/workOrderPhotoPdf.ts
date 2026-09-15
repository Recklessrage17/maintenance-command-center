export const DEFAULT_PM_WORK_ORDER_MAX_BYTES = 12 * 1024 * 1024;
export const PM_WORK_ORDER_PHOTO_MAX_PAGES = 12;
export const PM_WORK_ORDER_PHOTO_MAX_SOURCE_BYTES = 30 * 1024 * 1024;

type PhotoMetadata={width:number;height:number;orientation:number};
type RenderProfile={maxLongEdge:number;maxPixels:number;quality:number};
type DecodedImage={source:CanvasImageSource;width:number;height:number;dispose:()=>void};

export type WorkOrderPhotoPdfProgress={attempt:number;page:number;pageCount:number};

const renderProfiles:RenderProfile[]=[
  {maxLongEdge:2400,maxPixels:5_500_000,quality:.9},
  {maxLongEdge:2100,maxPixels:4_200_000,quality:.82},
  {maxLongEdge:1800,maxPixels:3_100_000,quality:.74},
  {maxLongEdge:1500,maxPixels:2_100_000,quality:.66},
];
const jpegStartOfFrameMarkers=new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);

function aborted(signal?:AbortSignal){
  if(signal?.aborted)throw new DOMException('Work-order photo conversion was canceled.','AbortError');
}

function tiffOrientation(bytes:Uint8Array,start:number,end:number){
  if(end-start<14||String.fromCharCode(...bytes.subarray(start,start+6))!=='Exif\0\0')return 1;
  const tiff=start+6;const little=bytes[tiff]===0x49&&bytes[tiff+1]===0x49;const big=bytes[tiff]===0x4d&&bytes[tiff+1]===0x4d;
  if(!little&&!big)return 1;
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);const uint16=(offset:number)=>view.getUint16(offset,little);const uint32=(offset:number)=>view.getUint32(offset,little);
  if(uint16(tiff+2)!==42)return 1;
  const directory=tiff+uint32(tiff+4);if(directory+2>end)return 1;const entries=uint16(directory);
  for(let index=0;index<entries;index+=1){const entry=directory+2+index*12;if(entry+12>end)break;if(uint16(entry)===0x0112&&uint16(entry+2)===3&&uint32(entry+4)>=1){const value=uint16(entry+8);return value>=1&&value<=8?value:1;}}
  return 1;
}

async function jpegMetadata(file:File):Promise<PhotoMetadata|null>{
  const bytes=new Uint8Array(await file.slice(0,512*1024).arrayBuffer());if(bytes.length<4||bytes[0]!==0xff||bytes[1]!==0xd8)return null;
  let offset=2;let orientation=1;let dimensions:{width:number;height:number}|null=null;
  while(offset+4<=bytes.length){
    while(offset<bytes.length&&bytes[offset]===0xff)offset+=1;if(offset>=bytes.length)break;const marker=bytes[offset];offset+=1;
    if(marker===0xd9||marker===0xda)break;if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
    if(offset+2>bytes.length)break;const length=(bytes[offset]<<8)|bytes[offset+1];if(length<2||offset+length>bytes.length)break;const start=offset+2;const end=offset+length;
    if(marker===0xe1)orientation=tiffOrientation(bytes,start,end);
    if(jpegStartOfFrameMarkers.has(marker)&&end-start>=6){dimensions={height:(bytes[start+1]<<8)|bytes[start+2],width:(bytes[start+3]<<8)|bytes[start+4]};}
    offset=end;
  }
  if(!dimensions||dimensions.width<=0||dimensions.height<=0)return null;
  return {...dimensions,orientation};
}

function visualDimensions(metadata:PhotoMetadata){return metadata.orientation>=5&&metadata.orientation<=8?{width:metadata.height,height:metadata.width}:{width:metadata.width,height:metadata.height};}

function boundedDimensions(width:number,height:number,profile:RenderProfile){
  const edgeScale=Math.min(1,profile.maxLongEdge/Math.max(width,height));const pixelScale=Math.min(1,Math.sqrt(profile.maxPixels/(width*height)));const scale=Math.min(edgeScale,pixelScale);
  return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}

function loadHtmlImage(file:File):Promise<DecodedImage>{
  return new Promise((resolve,reject)=>{const url=URL.createObjectURL(file);const image=new Image();image.onload=()=>resolve({source:image,width:image.naturalWidth,height:image.naturalHeight,dispose:()=>URL.revokeObjectURL(url)});image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error(`Page image "${file.name}" could not be decoded by this browser.`));};image.src=url;});
}

async function decodeImage(file:File,profile:RenderProfile):Promise<DecodedImage>{
  const metadata=/^image\/jpe?g$/i.test(file.type)||/\.jpe?g$/i.test(file.name)?await jpegMetadata(file):null;
  if(typeof createImageBitmap==='function'){
    try{
      const visual=metadata?visualDimensions(metadata):null;const target=visual?boundedDimensions(visual.width,visual.height,profile):null;
      const bitmap=await createImageBitmap(file,{imageOrientation:'from-image',...(target&&{resizeWidth:target.width,resizeHeight:target.height,resizeQuality:'high'})});
      return {source:bitmap,width:bitmap.width,height:bitmap.height,dispose:()=>bitmap.close()};
    }catch{/* The HTMLImageElement path covers browsers with partial createImageBitmap support. */}
  }
  return loadHtmlImage(file);
}

function canvasJpeg(canvas:HTMLCanvasElement,quality:number){return new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('The browser could not compress a work-order photo.')),'image/jpeg',quality));}

async function renderPhoto(file:File,profile:RenderProfile,signal?:AbortSignal){
  aborted(signal);const decoded=await decodeImage(file,profile);
  try{
    aborted(signal);const target=boundedDimensions(decoded.width,decoded.height,profile);const canvas=document.createElement('canvas');canvas.width=target.width;canvas.height=target.height;const context=canvas.getContext('2d',{alpha:false});
    if(!context)throw new Error('Image processing is unavailable in this browser.');
    context.fillStyle='#fff';context.fillRect(0,0,target.width,target.height);context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(decoded.source,0,0,target.width,target.height);
    const blob=await canvasJpeg(canvas,profile.quality);aborted(signal);return {bytes:new Uint8Array(await blob.arrayBuffer()),width:target.width,height:target.height};
  }finally{decoded.dispose();}
}

async function yieldToBrowser(){await new Promise<void>(resolve=>window.setTimeout(resolve,0));}

async function pdfAttempt(files:File[],profile:RenderProfile,attempt:number,onProgress?:(progress:WorkOrderPhotoPdfProgress)=>void,signal?:AbortSignal){
  const {PDFDocument}=await import('pdf-lib');const pdf=await PDFDocument.create();pdf.setProducer('Maintenance Command Center');pdf.setCreator('Maintenance Command Center');pdf.setTitle('PM work-order photos');
  for(let index=0;index<files.length;index+=1){
    aborted(signal);onProgress?.({attempt,page:index+1,pageCount:files.length});const rendered=await renderPhoto(files[index],profile,signal);const embedded=await pdf.embedJpg(rendered.bytes);const portrait=rendered.height>=rendered.width;const page=pdf.addPage(portrait?[595.28,841.89]:[841.89,595.28]);const {width,height}=page.getSize();const margin=16;const scale=Math.min((width-margin*2)/embedded.width,(height-margin*2)/embedded.height);const drawWidth=embedded.width*scale;const drawHeight=embedded.height*scale;page.drawImage(embedded,{x:(width-drawWidth)/2,y:(height-drawHeight)/2,width:drawWidth,height:drawHeight});await yieldToBrowser();
  }
  return pdf.save({useObjectStreams:false});
}

export function validateWorkOrderPhoto(file:File){
  if(!file||file.size<=0)throw new Error('The captured photo is empty. Retake it or choose a PDF.');
  if(!file.type.toLowerCase().startsWith('image/'))throw new Error('The selected camera file is not an image. Retake it or choose a PDF.');
  if(file.size>PM_WORK_ORDER_PHOTO_MAX_SOURCE_BYTES)throw new Error('Each work-order photo must be 30 MB or smaller. Retake at a lower camera resolution.');
}

export async function createWorkOrderPhotoPdf({files,filename,maxBytes,onProgress,signal}:{files:File[];filename:string;maxBytes:number;onProgress?:(progress:WorkOrderPhotoPdfProgress)=>void;signal?:AbortSignal}){
  if(!Number.isFinite(maxBytes)||maxBytes<=0)throw new Error('The server work-order upload limit is unavailable. Retry before converting photos.');
  if(files.length===0)throw new Error('Capture at least one work-order page.');
  if(files.length>PM_WORK_ORDER_PHOTO_MAX_PAGES)throw new Error(`A work-order PDF can contain up to ${PM_WORK_ORDER_PHOTO_MAX_PAGES} photographed pages.`);
  files.forEach(validateWorkOrderPhoto);
  for(let attempt=0;attempt<renderProfiles.length;attempt+=1){
    const bytes=await pdfAttempt(files,renderProfiles[attempt],attempt+1,onProgress,signal);if(bytes.byteLength<=maxBytes){const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;return new File([buffer],filename,{type:'application/pdf',lastModified:Date.now()});}await yieldToBrowser();
  }
  throw new Error('The photographed work order could not be compressed within the server upload limit. Remove a page, retake photos closer to the document, or use Choose PDF.');
}

export function workOrderPhotoPdfFilename(workOrderNumber:string,assetNumber:string,taskTitle:string){
  const clean=(value:string)=>value.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g,'-').replace(/^[._-]+|[._-]+$/g,'').slice(0,72);
  const workOrder=/^n\s*\/\s*a$/i.test(workOrderNumber.trim())?'':clean(workOrderNumber);const identity=[workOrder,clean(assetNumber),clean(taskTitle)].filter(Boolean).join('_').slice(0,210)||'PM-work-order';return `${identity}_photos.pdf`;
}

export function formatWorkOrderFileSize(bytes:number){
  if(bytes<1024)return `${bytes} B`;if(bytes<1024*1024)return `${(bytes/1024).toFixed(bytes<10*1024?1:0)} KB`;const megabytes=bytes/1024/1024;return `${megabytes.toFixed(Number.isInteger(megabytes)?0:2)} MB`;
}
