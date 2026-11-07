import { parentPort, workerData } from 'node:worker_threads';
import { MasterRetention } from './masterRetention.js';

const engine = new MasterRetention(workerData);
// The service sends exactly one request at a time, including status scans.
parentPort!.on('message', async ({ method, args }) => {
  let result: unknown; let error: string | undefined;
  try { result = await (engine[method as 'verify'] as Function).apply(engine,args); }
  catch (caught) { error = caught instanceof Error ? caught.message : 'Master verification failed.'; }
  let status;
  try { status = engine.status(); } catch { /* Caller marks missing status as unknown. */ }
  parentPort!.postMessage({result,error,status});
});
