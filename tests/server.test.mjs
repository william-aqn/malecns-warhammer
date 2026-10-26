import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createServer} from '../server.mjs';
async function withServer(fn){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;try{await fn(base,server.address().port);}finally{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}}
test('Local server serves both labs, module workers and HEAD without loading the graph into memory',async()=>withServer(async base=>{
  for(const path of ['/','/lab.html','/full-worker.mjs']){const r=await fetch(base+path);assert.equal(r.status,200);assert.ok((await r.text()).length>100);}
  const head=await fetch(base+'/lab.html',{method:'HEAD'});assert.equal(head.status,200);assert.ok(Number(head.headers.get('content-length'))>100);assert.equal(await head.text(),'');
}));
test('Static server restricts full dataset files, methods and encoded traversal',async()=>withServer(async(base,port)=>{
  assert.equal((await fetch(base+'/full-cns/anything.json')).status,404);assert.equal((await fetch(base+'/lab.html',{method:'POST'})).status,405);
  const result=await new Promise((resolve,reject)=>{http.get({host:'127.0.0.1',port,path:'/%5c..%5cpackage.json'},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));}).on('error',reject);});assert.equal(result,403);
}));
