import {parentPort,workerData} from 'node:worker_threads';
const nativeFetch=globalThis.fetch;globalThis.fetch=(url,options)=>nativeFetch(new URL(url,workerData.origin),options);
globalThis.onmessage=null;globalThis.postMessage=data=>parentPort.postMessage(data);
await import('../dist/full-worker.mjs');
parentPort.on('message',data=>globalThis.onmessage({data}));
