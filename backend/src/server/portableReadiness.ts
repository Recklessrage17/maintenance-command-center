import fs from 'node:fs';
import {inspectPortableArchive, sha256File} from './portableBackup.js';

// ZIPs are immutable after publication. Revalidate when either file identity
// changes, share concurrent checks, and stream only one cold archive at a time.
const checks = new Map<string, {identity: string; result: Promise<void>}>();
let queue: Promise<void> = Promise.resolve();
async function identity(filename: string) {
  const stats = await Promise.all([filename, `${filename}.sha256`].map(file=>fs.promises.lstat(file, {bigint:true})));
  if (stats.some(stat=>!stat.isFile()) || stats[1].size > 256n) throw new Error('Invalid portable archive or checksum file');
  return stats.map(stat=>[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join(':')).join('|');
}
export async function verifyPortableReadiness(filename: string, maxArchiveBytes: number) {
  const key = `${maxArchiveBytes}:${filename}`, before = await identity(filename);
  const cached = checks.get(key);
  if (cached?.identity === before) return cached.result;
  const result = queue.then(async()=>{
    if (await identity(filename) !== before) throw new Error('Portable archive changed before verification');
    inspectPortableArchive(filename, {maxArchiveBytes});
    const expected = (await fs.promises.readFile(`${filename}.sha256`, 'utf8')).trim().split(/\s+/)[0];
    if (!/^[a-f0-9]{64}$/i.test(expected) || await sha256File(filename) !== expected.toLowerCase()) throw new Error('Portable archive checksum mismatch');
    if (await identity(filename) !== before) throw new Error('Portable archive changed during verification');
  });
  queue = result.catch(()=>{});
  checks.set(key, {identity:before,result});
  if (checks.size > 256) checks.delete(checks.keys().next().value!);
  return result;
}
