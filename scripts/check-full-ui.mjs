import {readFileSync,writeFileSync} from 'node:fs';
import {Worker as NodeWorker} from 'node:worker_threads';
import assert from 'node:assert/strict';
import {createServer} from '../server.mjs';
const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const html=readFileSync(new URL('../dist/lab.html',import.meta.url),'utf8'),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
const elements=new Map();let draws=0,lastDownload=null;
const ctx=new Proxy({},{get:(o,k)=>o[k]??(()=>{draws++;}),set:(o,k,v)=>{o[k]=v;return true;}});
class Element{
  constructor(){this.value='';this.textContent='';this.hidden=false;this.disabled=false;this.checked=true;this.children=[];this.handlers={};this.dataset={};this.style={};this.classList={toggle(){}};this.width=960;this.height=720;}
  set id(id){this._id=id;elements.set(id,this);}get id(){return this._id;}
  append(...es){this.children.push(...es);}addEventListener(type,fn){this.handlers[type]=fn;}getContext(){return ctx;}getBoundingClientRect(){return {left:0,top:0,width:960,height:720};}
  click(){if(this.download)lastDownload=this.download;return this.handlers.click?.({target:this,currentTarget:this});}
}
for(const id of ids){const e=new Element();e.id=id;}
elements.get('error').hidden=true;
for(const [id,value] of Object.entries({seed:'40721',preset:'arena',edit:'body',overlay:'odor','eye-band':'mixed','neuron-query':'DNa01'}))elements.get(id).value=value;
const manual=['left','forward','right','backward'].map(value=>{const e=new Element();e.dataset.manual=value;return e;});
globalThis.document={getElementById:id=>elements.get(id),createElement:()=>new Element(),querySelectorAll:q=>q==='[data-manual]'?manual:[]};globalThis.location={protocol:'http:'};
const workers=[];
globalThis.Worker=class{
  constructor(){this.worker=new NodeWorker(new URL('./full-worker-harness.mjs',import.meta.url),{workerData:{origin}});workers.push(this.worker);this.worker.on('message',data=>this.onmessage?.({data}));this.worker.on('error',error=>this.onerror?.(error));}
  postMessage(data){this.worker.postMessage(data);}
};
const el=id=>elements.get(id),wait=async predicate=>{const deadline=Date.now()+30000;while(!predicate()){if(!el('error').hidden)throw Error(el('error').textContent);if(Date.now()>deadline)throw Error('UI timeout: '+el('status').textContent);await new Promise(r=>setTimeout(r,50));}};
try{
  await import('../dist/lab.mjs');await wait(()=>el('neurons').textContent.replace(/\D/g,'')==='166700'&&el('controls').disabled===false);
  assert.equal(el('ports').textContent.replace(/\D/g,''),'13679');assert.ok(el('unmapped').textContent.replace(/\D/g,'').includes('4258'));assert.ok(draws>1000);
  await el('step').click();await wait(()=>el('tick').textContent==='Такт 1');
  el('sense-vision').checked=false;await el('sense-vision').handlers.change();assert.equal(el('value-vision').textContent,'0.000');
  el('clamped').checked=false;await el('clamped').handlers.change();manual[1].click();await wait(()=>el('tick').textContent==='Такт 2');
  await el('inspect').click();assert.ok(el('neuron-detail').textContent.includes('bodyId'));assert.ok(el('neuron-detail').textContent.includes('stats_pre'));
  el('run').click();el('run').click();el('run').click();await wait(()=>el('tick').textContent==='Такт 3');el('run').click();await new Promise(r=>setTimeout(r,400));const paused=el('tick').textContent;await new Promise(r=>setTimeout(r,300));assert.equal(el('tick').textContent,paused);
  await el('save').click();assert.ok(/^malecns-full-lab-\d+\.json$/.test(lastDownload));
  el('seed').value='new-map';await el('reset').click();assert.equal(el('tick').textContent,'Такт 0');
  const report={graphLoadedViaHTTP:true,checksums:true,actualWorkerProtocol:true,uiControls:true,neuronInspector:true,snapshotDownload:true,canvasCalls:draws,note:'Node worker + DOM/Canvas stubs, not browser rendering.'};writeFileSync(new URL('../data/full-ui-check.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await Promise.all(workers.map(w=>w.terminate()));await new Promise(r=>{server.close(r);server.closeAllConnections();});}
