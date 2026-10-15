import fs from 'node:fs';
import path from 'node:path';
const root=process.env.MCC_ARM64_PROFILE_ROOT,file=process.env.MCC_ARM64_PROFILE_FILE;
if(!root||!file||!path.resolve(file).startsWith(path.resolve(root)+path.sep))throw Error('Metrics must remain inside the synthetic profile root.');
function sample(){fs.appendFileSync(file,JSON.stringify({at:Date.now(),pid:process.pid,memory:process.memoryUsage(),cpu:process.cpuUsage(),usage:process.resourceUsage()})+'\n');}
sample();setInterval(sample,200).unref();process.once('exit',sample);
