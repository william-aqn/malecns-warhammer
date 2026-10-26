import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {FullLab} from '../dist/full-lab.mjs';
import {DEFAULT_SENSE_MASK} from '../dist/sensory-ports.mjs';
import {worldSnapshot} from '../dist/sensory-world.mjs';
const root=new URL('../',import.meta.url),file=name=>new URL('.cache/full-cns/'+name,root),read=async name=>JSON.parse(await readFile(file(name),'utf8')),hash=b=>createHash('sha256').update(b).digest('hex');
const manifest=await read('manifest.json'),tracked=JSON.parse(await readFile(new URL('data/full-cns-manifest.json',root),'utf8'));assert.deepEqual(manifest,tracked);
const buffer=await readFile(file('graph.bin')),annotations=await readFile(file('neurons.json')),retina=await readFile(file('retina.json'));
for(const [name,bytes] of [['graph.bin',buffer],['neurons.json',annotations],['retina.json',retina]]){assert.equal(hash(bytes),manifest.files[name].sha256);assert.equal(bytes.length,manifest.files[name].bytes);}
const start=performance.now(),lab=new FullLab(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength),JSON.parse(annotations),JSON.parse(retina),manifest),initMs=performance.now()-start;
const silence=Object.fromEntries(Object.keys(DEFAULT_SENSE_MASK).map(k=>[k,false])),results={},states={};
for(const [name,mask,connected] of [['baseline',silence,true],['vision',{...silence,vision:true},true],['all',DEFAULT_SENSE_MASK,true],['cut',DEFAULT_SENSE_MASK,false]]){
  lab.reset('40721','arena');lab.configure({mask,clamped:true,dynamics:{connected}});const timings=[];
  for(let i=0;i<24;i++)timings.push(lab.step().lastMs);
  const a=lab.network.activity;assert.ok(a.every(v=>Number.isFinite(v)&&v>=0&&v<=1));states[name]=a.slice();
  results[name]={ticks:lab.ticks,meanMs:timings.reduce((s,v)=>s+v,0)/timings.length,motors:lab.ports.motors(a),metrics:lab.sample.metrics};
  console.log(name,Math.round(results[name].meanMs)+' ms/tick');
}
const delta=(a,b,indices)=>{let sum=0,max=0;for(const i of indices){const d=Math.abs(a[i]-b[i]);sum+=d;max=Math.max(max,d);}return {mean:sum/indices.length,max};};
const visualEffect=Object.fromEntries(Object.entries(lab.atlas.groups).map(([k,group])=>[k,delta(states.vision,states.baseline,group)]));
assert.ok(visualEffect.ol_intrinsic.max>1e-5);assert.ok(visualEffect.visual_projection.max>1e-6);
lab.reset('snapshot','open');lab.configure({mask:DEFAULT_SENSE_MASK,clamped:false,dynamics:{connected:true}});for(let i=0;i<12;i++)lab.step();
const snapshot=lab.snapshot(),snapshotBytes=Buffer.byteLength(JSON.stringify(snapshot));assert.ok(snapshotBytes<40000000);lab.step();const expected=lab.snapshot();lab.restore(snapshot);lab.step();assert.deepEqual(lab.snapshot(),expected);
const beforeInvalid=lab.snapshot(),bad=structuredClone(beforeInvalid);bad.world.body.x=NaN;assert.throws(()=>lab.restore(bad));assert.deepEqual(lab.snapshot(),beforeInvalid);
lab.reset('long','random');for(let i=0;i<180;i++){
  lab.step();assert.ok(lab.network.activity.every(v=>Number.isFinite(v)&&v>=0&&v<=1));assert.ok(lab.world.body.x>=1&&lab.world.body.x<23&&lab.world.body.y>=1&&lab.world.body.y<17);
  if(i%60===59)console.log('long rollout',i+1);
}
assert.equal(hash(buffer),manifest.files['graph.bin'].sha256);assert.equal(hash(new Uint8Array(lab.network.graph.offsets.buffer)),manifest.files['graph.bin'].sha256);
const report={schema:1,graph:manifest.files['graph.bin'].sha256,annotations:manifest.files['neurons.json'].sha256,learning:false,initMs,processMiB:process.memoryUsage().rss/1048576,inventory:lab.ports.inventory(),conditions:results,visualEffect,snapshotBytes,exactReplay:true,invalidImportAtomic:true,longRun:{ticks:lab.ticks,body:worldSnapshot(lab.world).body,allFinite:true},anatomyUnchanged:true,note:'Numerical and causal integration checks, not evidence of biological fidelity or useful behavior.'};
await writeFile(new URL('data/full-cns-benchmark.json',root),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({initMs,snapshotBytes,processMiB:report.processMiB,visionToVNC:visualEffect.vnc_intrinsic,passed:true}));
