import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createServer,startServer} from '../server.mjs';
async function withServer(fn){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;try{await fn(base,server.address().port);}finally{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}}
test('Local server serves both labs, module workers and HEAD without loading the graph into memory',async()=>withServer(async base=>{
  for(const path of ['/','/lab.html','/full-worker.mjs']){const r=await fetch(base+path);assert.equal(r.status,200);assert.ok((await r.text()).length>100);}
  const head=await fetch(base+'/lab.html',{method:'HEAD'});assert.equal(head.status,200);assert.ok(Number(head.headers.get('content-length'))>100);assert.equal(await head.text(),'');
}));
test('Static server restricts full dataset files, methods and encoded traversal',async()=>withServer(async(base,port)=>{
  assert.equal((await fetch(base+'/full-cns/anything.json')).status,404);assert.equal((await fetch(base+'/lab.html',{method:'POST'})).status,405);
  const result=await new Promise((resolve,reject)=>{http.get({host:'127.0.0.1',port,path:'/%5c..%5cpackage.json'},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));}).on('error',reject);});assert.equal(result,403);
}));

const closeServer=server=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
test('Launcher handles a busy port, opens the actual page after listening, and preserves its owner',async()=>{
  const owner=http.createServer((req,res)=>res.end('existing service'));
  await new Promise(resolve=>owner.listen(0,'127.0.0.1',resolve));
  const occupied=owner.address().port,lines=[],opened=[];let app;
  try{
    app=await startServer({port:occupied,announce:line=>lines.push(line),openPage:async url=>{
      const response=await fetch(url);
      assert.equal(response.status,200);
      assert.ok((await response.text()).includes('Сенсорная лаборатория'));
      opened.push(url);
    }});
    assert.notEqual(app.port,occupied);
    assert.equal(app.url,'http://127.0.0.1:'+app.port+'/lab.html');
    assert.deepEqual(opened,[app.url]);
    assert.ok(lines.some(line=>line.includes('EADDRINUSE')));
    assert.ok(lines.some(line=>line.includes(app.url)));
    assert.equal(await (await fetch('http://127.0.0.1:'+occupied)).text(),'existing service');
  }finally{if(app)await closeServer(app.server);await closeServer(owner);}
});
test('Browser launch failure retains a working server and reports its actual URL',async()=>{
  const lines=[];const app=await startServer({port:0,announce:line=>lines.push(line),openPage:async()=>{throw Error('browser unavailable');}});
  try{
    assert.equal((await fetch(app.url)).status,200);
    assert.ok(lines.some(line=>line.includes('browser unavailable')&&line.includes(app.url)));
    assert.ok(!lines.some(line=>line.includes('selecting a free')));
  }finally{await closeServer(app.server);}
});
test('Invalid PORT values fail before binding instead of silently using an unrelated port',async()=>{
  for(const port of [-1,65536,NaN,null,'4177.5','not-a-port']){
    await assert.rejects(()=>startServer({port,announce(){}}),/PORT must be an integer/);
  }
});
