// Synthetic-test-only export observations; never imported by the application.
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const original = childProcess.spawnSync;
const output = process.env.MCC_TEST_REQUISITION_EXPORTS;
let sequence = 0;
childProcess.spawnSync = function(command, args, options) {
  const excel = command === 'powershell.exe' && args.includes('-XlsxPath');
  const libre = /(?:soffice|libreoffice)(?:\.exe)?$/i.test(command);
  if (!excel && !libre) return original(command, args, options);
  fs.mkdirSync(output, {recursive:true});
  if (excel) {
    const source = args[args.indexOf('-XlsxPath')+1];
    fs.copyFileSync(source, path.join(output, `workbook-${++sequence}.xlsx`));
  }
  if (libre) {
    const source = args.at(-1);
    args = [`-env:UserInstallation=${pathToFileURL(path.join(path.dirname(source), 'lo-profile')).href}`, ...args];
  }
  const result = original(command, args, options);
  fs.appendFileSync(path.join(output, 'converters.log'), JSON.stringify({command,status:result.status,error:result.error?.message,stdout:String(result.stdout||''),stderr:String(result.stderr||'')})+'\n');
  return result;
};
syncBuiltinESMExports();
