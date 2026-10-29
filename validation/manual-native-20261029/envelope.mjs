import fs from 'node:fs';
import {createCipheriv,createDecipheriv,randomBytes,createHash} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
const [mode,input,output]=process.argv.slice(2);
const key=Buffer.from(process.env.MCC_NATIVE_VALIDATION_KEY||'','base64');
if(key.length!==32)throw Error('Missing 256-bit validation transport key');
delete process.env.MCC_NATIVE_VALIDATION_KEY;
if(mode==='encrypt'){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 fs.writeFileSync(output,Buffer.concat([Buffer.from('MCC1'),iv,Buffer.alloc(16)]),{flag:'wx'});
 await pipeline(fs.createReadStream(input),cipher,fs.createWriteStream(output,{flags:'r+',start:32}));
 const fd=fs.openSync(output,'r+');fs.writeSync(fd,cipher.getAuthTag(),0,16,16);fs.closeSync(fd);
}else if(mode==='decrypt'){
 const fd=fs.openSync(input,'r');const header=Buffer.alloc(32);fs.readSync(fd,header,0,32,0);fs.closeSync(fd);
 if(header.subarray(0,4).toString()!=='MCC1')throw Error('Invalid envelope');
 const decipher=createDecipheriv('aes-256-gcm',key,header.subarray(4,16));decipher.setAuthTag(header.subarray(16,32));
 await pipeline(fs.createReadStream(input,{start:32}),decipher,fs.createWriteStream(output,{flags:'wx',mode:0o600}));
}else throw Error('Use encrypt or decrypt');
key.fill(0);
const hash=createHash('sha256');for await(const b of fs.createReadStream(output))hash.update(b);
console.log(hash.digest('hex'));
