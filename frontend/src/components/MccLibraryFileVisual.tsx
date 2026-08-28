import { useEffect, useState } from 'react';
import { fileTypeIconVariant, MccFileTypeIcon } from './MccFileTypeIcon';

type LibraryMediaType='document'|'picture'|'video'|'file';

type MccLibraryFileVisualProps={
  filename:string;
  src?:string;
  mimeType?:string;
  mediaType?:LibraryMediaType;
  className?:string;
  thumbnailClassName?:string;
};

export function isLibraryImageFile({mimeType='',mediaType}:{mimeType?:string;mediaType?:LibraryMediaType}){
  return mediaType==='picture'||mimeType.toLowerCase().startsWith('image/');
}

export function MccLibraryFileVisual({filename,src,mimeType,mediaType,className='',thumbnailClassName=''}:MccLibraryFileVisualProps){
  const image=isLibraryImageFile({mimeType,mediaType});
  const [failed,setFailed]=useState(false);

  useEffect(()=>setFailed(false),[src]);

  if(image&&src&&!failed)return <img className={`mcc-library-file-thumbnail${thumbnailClassName?` ${thumbnailClassName}`:''}${className?` ${className}`:''}`} src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={()=>setFailed(true)} />;

  return <MccFileTypeIcon type={fileTypeIconVariant(filename)} className={className} />;
}
