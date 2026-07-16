import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';

const maxPhotoDimension = 2560;
const compressionThreshold = 4 * 1024 * 1024;

function photoBaseName(name: string) {
  return name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'maintenance-photo';
}

async function imageSource(file: File) {
  if ('createImageBitmap' in window) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { width: bitmap.width, height: bitmap.height, draw: (context: CanvasRenderingContext2D, width: number, height: number) => context.drawImage(bitmap, 0, 0, width, height), close: () => bitmap.close() };
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const next = new Image();
      next.onload = () => resolve(next);
      next.onerror = () => reject(new Error('The selected photo could not be read.'));
      next.src = url;
    });
    return { width: image.naturalWidth, height: image.naturalHeight, draw: (context: CanvasRenderingContext2D, width: number, height: number) => context.drawImage(image, 0, 0, width, height), close: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function prepareMaintenancePhoto(file: File) {
  if (!file.type.toLowerCase().startsWith('image/')) throw new Error('Choose an image from the camera or photo library.');
  const source = await imageSource(file);
  try {
    const scale = Math.min(1, maxPhotoDimension / Math.max(source.width, source.height));
    const supportedType = ['image/jpeg','image/png','image/webp'].includes(file.type.toLowerCase());
    if (scale === 1 && file.size <= compressionThreshold && supportedType) return file;
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Photo processing is not supported by this browser.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    source.draw(context, width, height);
    const outputType = file.type.toLowerCase() === 'image/webp' ? 'image/webp' : 'image/jpeg';
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('The photo could not be prepared.')), outputType, 0.88));
    const extension = outputType === 'image/webp' ? '.webp' : '.jpg';
    return new File([blob], `${photoBaseName(file.name)}${extension}`, { type: outputType, lastModified: Date.now() });
  } finally {
    source.close();
  }
}

function formatPhotoSize(size: number) {
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function MaintenancePhotoReview({ file, title, detail, saving, onRetake, onCancel, onSave }: { file: File; title: string; detail?: string; saving?: boolean; onRetake: () => void; onCancel: () => void; onSave: () => void }) {
  const previewUrl = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl]);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saving) onCancel();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel, saving]);
  return createPortal(<div className="modal-backdrop maintenance-photo-review-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onCancel(); }}>
    <section className="mcc-card maintenance-photo-review mcc-full-view-dialog" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-heading"><div><p className="eyebrow">Photo Preview</p><h3>{title}</h3>{detail && <p>{detail}</p>}</div></div>
      <div className="maintenance-photo-preview-canvas"><img src={previewUrl} alt="Maintenance photo preview" /></div>
      <div className="maintenance-photo-preview-meta"><strong>{file.name}</strong><span>{formatPhotoSize(file.size)}</span></div>
      <div className="modal-actions maintenance-photo-review-actions">
        <button className="secondary-button" type="button" onClick={onRetake} disabled={saving}>Retake</button>
        <button className="link-button" type="button" onClick={onCancel} disabled={saving}>Cancel</button>
        <button className="primary-button" type="button" onClick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </section>
  </div>, document.body);
}
