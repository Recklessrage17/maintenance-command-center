import fs from 'node:fs';
import path from 'node:path';

// Keep legacy public references while resolving against the configured root.
export function storedUploadPath(root: string, reference: string, prefix: string) {
  const portable = reference.replaceAll('\\', '/');
  if (!portable.startsWith(prefix)) throw new Error('Stored file reference is invalid.');
  const parts = portable.slice(prefix.length).split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[:\x00-\x1f\x7f]/.test(part))) throw new Error('Stored file reference is invalid.');
  const base = path.resolve(root);
  if (fs.lstatSync(base).isSymbolicLink()) throw new Error('Stored file reference is invalid.');
  const realBase = fs.realpathSync(base);
  let candidate = base;
  for (const part of parts) {
    candidate = path.join(candidate, part);
    if (!fs.existsSync(candidate)) {
      // Missing files retain existing callers' 404 behavior, but reject dangling links.
      try { if (fs.lstatSync(candidate).isSymbolicLink()) throw new Error('Stored file reference is invalid.'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      continue;
    }
    if (fs.lstatSync(candidate).isSymbolicLink()) throw new Error('Stored file reference is invalid.');
    const relative = path.relative(realBase, fs.realpathSync(candidate));
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Stored file reference is invalid.');
  }
  if (fs.existsSync(candidate) && !fs.statSync(candidate).isFile()) throw new Error('Stored file reference is invalid.');
  return candidate;
}
