// Loaded only by an isolated test child, never by application code.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { isMainThread } from 'node:worker_threads';
const read = fs.readFileSync;
const fault = () => { try { return JSON.parse(read(process.env.MCC_TEST_BACKUP_FAULTS,'utf8')).fault; } catch { return ''; } };
let heldVerification=false;
fs.readFileSync=function(filename,...args) {
  if (!isMainThread && !heldVerification && fault()==='slow_verification' && String(filename).endsWith('manifest.json')) {
    heldVerification=true;
    fs.writeFileSync(`${process.env.MCC_TEST_BACKUP_FAULTS}.started`,'worker-verification');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,3000);
  }
  return read.call(this,filename,...args);
};
// Advance the calendar only inside this disposable child when the test asks the
// actual monthly timer to run. No production scheduling hooks are introduced.
const NativeDate=Date;
let clockOffset=NativeDate.parse('2026-11-05T18:00:00.000Z')-NativeDate.now();
globalThis.Date=class extends NativeDate {
  constructor(...args){super(...(args.length?args:[NativeDate.now()+clockOffset]));}
  static now(){return NativeDate.now()+clockOffset;}
};
const timeout=globalThis.setTimeout;
globalThis.setTimeout=function(callback,delay,...args){
  const timer=timeout(callback,delay,...args);
  if(new Error().stack?.includes('armMasterBackupTimer')) {
    const poll=setInterval(()=>{
      if(fault()!=='monthly')return;
      clearInterval(poll);clearTimeout(timer);
      const current=new Date();
      clockOffset=new NativeDate(current.getFullYear(),current.getMonth()+1,1,13,0,1).getTime()-NativeDate.now();
      void callback(...args);
    },100);
    poll.unref();
  }
  return timer;
};
const exec = DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec = function(sql) {
  if (/^VACUUM INTO/.test(sql) && fault()==='snapshot') throw new Error('Injected snapshot failure');
  const result = exec.call(this,sql);
  if (/^VACUUM INTO/.test(sql) && fault()==='sqlite') {
    const filename=sql.match(/^VACUUM INTO '((?:[^']|'')+)'/)[1].replaceAll("''", "'");
    fs.writeFileSync(filename,'corrupt sqlite');
  }
  return result;
};
for (const [method,stage,predicate] of [
  ['openSync','status_io',p=>/\.zip(?:\.sha256)?$/.test(p)||p.includes('MCC Master back up')&&!p.endsWith('.json')],
  ['writeFileSync','manifest',p=>p.endsWith('manifest.json')&&p.includes('MCC_Master_Backup_')],
  ['createWriteStream','zip',p=>p.includes('.zip.partial-')],
  ['linkSync','publication',p=>p.includes('.zip.partial-')],
  ['createReadStream','zip_verify',p=>p.endsWith('.zip')],
  ['createWriteStream','external',p=>p.includes('.zip.')&&p.endsWith('.partial')],
]) {
  const original=fs[method];
  fs[method]=function(filename,...args) {
    if(fault()===stage&&predicate(String(filename)))throw new Error(`Injected ${stage} failure`);
    return original.call(this,filename,...args);
  };
}
