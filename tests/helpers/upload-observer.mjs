// Loaded only by the isolated security fixture. No application hooks or endpoints.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import { root } from './security-process.mjs';

const require = createRequire(path.join(root, 'backend/package.json'));
const multer = require('multer');
const eventsPath = process.env.MCC_TEST_UPLOAD_EVENTS;
const storageContext = new AsyncLocalStorage();
if (process.env.NODE_ENV !== 'test' || !eventsPath) throw new Error('Upload observation requires an isolated test fixture.');
function record(req, event, detail = {}) {
  const id = req.headers['x-security-upload-id'];
  if (typeof id === 'string' && /^[a-z0-9-]{1,80}$/.test(id)) fs.appendFileSync(eventsPath, JSON.stringify({ id, event, ...detail }) + '\n');
}
const emit = http.Server.prototype.emit;
const createWriteStream = fs.createWriteStream;
fs.createWriteStream = function (...args) {
  const stream = createWriteStream.apply(this, args);
  const context = storageContext.getStore();
  if (context?.kind === 'disk') {
    record(context.req, 'storage-path', { path: String(args[0]) });
    stream.once('close', () => record(context.req, 'disk-handle-close', { path: String(args[0]) }));
  }
  return stream;
};
http.Server.prototype.emit = function (event, ...args) {
  if (event === 'request') {
    const [req, res] = args;
    record(req, 'request');
    req.once('aborted', () => record(req, 'aborted'));
    res.once('close', () => record(req, 'response-close'));
  }
  return emit.call(this, event, ...args);
};
for (const [kind, storage] of [['memory', multer.memoryStorage()], ['disk', multer.diskStorage()]]) {
  const prototype = Object.getPrototypeOf(storage);
  const handle = prototype._handleFile;
  prototype._handleFile = function (req, file, callback) {
    record(req, 'storage-start', { kind });
    file.stream.once('data', () => record(req, 'storage-data', { kind }));
    file.stream.once('close', () => record(req, 'storage-close', { kind }));
    return storageContext.run({ req, kind }, () => handle.call(this, req, file, (error, info) => {
      record(req, 'storage-complete', { kind, error: Boolean(error) });
      callback(error, info);
    }));
  };
}
