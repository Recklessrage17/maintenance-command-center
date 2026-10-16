import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
// Local release preparation must supply the immutable commit being validated.
export const candidateSha=process.env.MCC_ARM64_CANDIDATE_SHA;
export const legacySha='3929a957d4f633d8129997ed1eec818e2e3efbdb';
export const packageRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const candidate=path.resolve(process.env.MCC_ARM64_CANDIDATE||packageRoot);
export const legacy=path.resolve(process.env.MCC_ARM64_LEGACY||path.join(candidate,'../legacy-source'));
export const evidence=path.resolve(process.env.MCC_ARM64_EVIDENCE||path.join(packageRoot,'../evidence/local'));
export const local=process.argv.includes('--local');
export const native=process.platform==='linux'&&process.arch==='arm64';
export const moduleFrom=relative=>import(pathToFileURL(path.join(candidate,relative)).href);
export function write(name,value){fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,name),JSON.stringify(value,null,2)+'\n');}
export function isolatedEnvironment(root){
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^(MCC_|SMTP_|GITHUB_|ACTIONS_|RUNNER_|SSH_|AWS_|AZURE_|GOOGLE_|SESSION_SECRET$|NODE_OPTIONS$|NODE_PATH$|NODE_EXTRA_CA_CERTS$|.*_PROXY$|.*(?:TOKEN|PASSWORD|SECRET|PRIVATE_KEY)$)/i.test(key)));
 Object.assign(env,{NODE_ENV:'test',MCC_BIND_HOST:'127.0.0.1',MCC_UPDATE_MODE:'',MCC_HTTPS_MODE:'',SESSION_SECRET:'arm64-disposable-synthetic-only',SMTP_HOST:'',SMTP_PORT:'',SMTP_USER:'',SMTP_PASS:'',SMTP_FROM:'',TEMP:path.join(root,'t'),TMP:path.join(root,'t'),TMPDIR:path.join(root,'t')});
 for(const [key,dir]of Object.entries({MCC_DATA_DIR:'data',MCC_UPLOADS_DIR:'uploads',MCC_BACKUPS_DIR:'backups',MCC_RECOVERY_DIR:'recovery',MCC_PM_EXCEL_DIR:'pm-excel',MCC_PM_WORK_ORDER_DIR:'pm-work-orders'}))env[key]=path.join(root,dir);
 for(const [key,value]of Object.entries(env))if(key.startsWith('MCC_')&&key.endsWith('_DIR')||['TEMP','TMP','TMPDIR'].includes(key))fs.mkdirSync(value,{recursive:true});
 return env;
}
