import { Worker } from 'node:worker_threads';
import type { MasterRetention, MasterRetentionOptions, MasterRetentionStatus } from './masterRetention.js';

// One persistent worker owns all deep Master checks and destructive operations.
// A competing request is rejected, never queued into an unbounded I/O backlog.
export class MasterRetentionService {
  private worker?: Worker;
  private pending?: { resolve: (value: any)=>void; reject: (error: Error)=>void };
  private statusRequest?: Promise<MasterRetentionStatus>;
  private cached: MasterRetentionStatus;
  constructor(private readonly options: MasterRetentionOptions) {
    this.cached = this.empty();
  }
  private empty(): MasterRetentionStatus {
    return {limit:3,verifiedCount:0,excludedCount:0,pendingCount:0,unknownCount:0,latestVerified:null,checkedAt:null,verificationInProgress:false,secretConfigured:Boolean(this.options.secret),sets:[]};
  }
  get busy() { return Boolean(this.pending); }
  private call<T>(method: string, args: unknown[] = []): Promise<T> {
    if (this.pending) return Promise.reject(new Error('Another Master verification is already running.'));
    if (!this.worker) {
      const {masterRoot,portableRoot,appVersion,secret}=this.options;
      const worker = this.worker = new Worker(new URL('./masterRetentionWorker.js',import.meta.url),{workerData:{masterRoot,portableRoot,appVersion,secret}});
      worker.on('message',({result,error,status})=>{
        if (this.worker!==worker) return;
        const pending=this.pending; this.pending=undefined;
        this.cached=status??this.empty(); worker.unref();
        if (error) pending?.reject(new Error(error)); else pending?.resolve(result);
      });
      const failed=(error:Error)=>{
        this.cached=this.empty();this.worker=undefined;
        const pending=this.pending;this.pending=undefined;pending?.reject(error);
      };
      worker.on('error',failed);
      worker.on('exit',code=>{ if(this.worker===worker) failed(new Error(`Master verification worker exited (${code}); inspect backups before cleanup.`)); });
    }
    this.worker.ref();
    return new Promise<T>((resolve,reject)=>{this.pending={resolve,reject};this.worker!.postMessage({method,args});});
  }
  async status(): Promise<MasterRetentionStatus> {
    if (this.statusRequest) return this.statusRequest;
    // Keep API polling responsive during a deep scan; explicitly stale/in progress.
    if (this.busy) return {...this.cached,verificationInProgress:true};
    this.statusRequest=this.call<MasterRetentionStatus>('status');
    try { return await this.statusRequest; } finally { this.statusRequest=undefined; }
  }
  verify(...args: Parameters<MasterRetention['verify']>) { return this.call<Awaited<ReturnType<MasterRetention['verify']>>>('verify',args); }
  publish(...args: Parameters<MasterRetention['publish']>) { return this.call<Awaited<ReturnType<MasterRetention['publish']>>>('publish',args); }
  preview() { return this.call<Awaited<ReturnType<MasterRetention['preview']>>>('preview'); }
  cleanup(...args: Parameters<MasterRetention['cleanup']>) { return this.call<Awaited<ReturnType<MasterRetention['cleanup']>>>('cleanup',args); }
  async close() { const worker=this.worker; if(worker) await worker.terminate(); }
}
