import test from 'node:test';
import assert from 'node:assert/strict';
import {Atlas,FullNetwork,parseFullGraph} from '../dist/full-network.mjs';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export function tiny({nt=['acetylcholine','gaba','histamine','dopamine'],edges=[[0,1,3],[1,2,2],[3,2,1]],incoming=[0,3,3,0]}={}){
  const n=nt.length,e=edges.length,sorted=edges.toSorted((a,b)=>a[1]-b[1]||a[0]-b[0]),buffer=new ArrayBuffer(32+4*(2*n+1+2*e)),v=new DataView(buffer);
  new Uint8Array(buffer,0,8).set(new TextEncoder().encode('MCNSF001'));v.setUint32(8,n,true);v.setUint32(12,e,true);v.setUint32(16,1,true);
  let p=32,k=0;for(let row=0;row<=n;row++){while(k<e&&sorted[k][1]<row)k++;v.setUint32(p,k,true);p+=4;}
  for(const edge of sorted){v.setUint32(p,edge[0],true);p+=4;}for(const edge of sorted){v.setUint32(p,edge[2],true);p+=4;}for(const count of incoming){v.setUint32(p,count,true);p+=4;}
  const columns=['bodyId','superclass','class','type','somaSide','rootSide','nt_consensus_nt'],records=nt.map((t,i)=>[100+i,'cb_intrinsic',null,'n'+i,'L',null,t]);
  return {buffer,atlas:new Atlas({schema:1,columns,records}),edges:sorted};
}
test('Full graph parser rejects malformed CSR and unknown source indices',()=>{
  const {buffer}=tiny();assert.equal(parseFullGraph(buffer).e,3);assert.throws(()=>parseFullGraph(buffer,{neurons:5,edges:3}));assert.throws(()=>parseFullGraph(buffer.slice(0,-4)));
  const bad=buffer.slice(0);new DataView(bad).setUint32(32+5*4,999,true);assert.throws(()=>parseFullGraph(bad));
});
test('Signed dynamics agrees with independent dense recurrence; inhibitory sources are rectified',()=>{
  const {buffer,atlas,edges}=tiny(),network=new FullNetwork(parseFullGraph(buffer),atlas,'test',{substeps:1,tonic:.2,gain:.7,leak:.5}),stimulus=Float32Array.of(.8,0,0,.5);
  let expected=new Float32Array(4);const signs=[1,-1,-1,0],incoming=[0,3,3,0];
  for(let t=0;t<12;t++){
    const sums=Array(4).fill(0);for(const [from,to,count] of edges)sums[to]+=Math.fround(signs[from]*count/Math.max(1,incoming[to]))*expected[from];
    expected=Float32Array.from(expected,(v,i)=>.5*v+.5*Math.max(0,Math.tanh(.2+.7*sums[i]+.8*stimulus[i])));network.step(stimulus);
    assert.deepEqual(network.activity,expected);assert.ok([...network.activity].every(v=>v>=0&&v<=1));
  }
  assert.ok(network.slow[0][2]>0);assert.equal(network.dynamics.da,0);
});
test('Slow transmitter hypotheses affect only existing targets and leave anatomy untouched',()=>{
  const {buffer,atlas}=tiny({nt:['dopamine','acetylcholine'],edges:[[0,1,1],[1,1,1]],incoming:[0,2]}),hash=()=>createHash('sha256').update(new Uint8Array(buffer)).digest('hex'),before=hash();
  const monitor=new FullNetwork(parseFullGraph(buffer),atlas,'x',{substeps:1}),experiment=new FullNetwork(parseFullGraph(buffer),atlas,'x',{substeps:1,da:2});
  for(let k=0;k<30;k++){monitor.step(Float32Array.of(1,0));experiment.step(Float32Array.of(1,0));}
  assert.ok(experiment.activity[1]>monitor.activity[1]);assert.equal(experiment.activity[0],monitor.activity[0]);assert.equal(hash(),before);
});
test('Cut connections and zero tonic prevent downstream sensory response',()=>{
  const {buffer,atlas}=tiny(),a=new FullNetwork(parseFullGraph(buffer),atlas,'x',{substeps:8,tonic:0,connected:false});a.step(Float32Array.of(1,0,0,0));assert.ok(a.activity[0]>0);assert.equal(a.activity[1],0);assert.equal(a.activity[2],0);
});
test('Full network snapshot resumes exactly and invalid state is rejected before mutation',()=>{
  const {buffer,atlas}=tiny(),a=new FullNetwork(parseFullGraph(buffer),atlas,'x'),b=new FullNetwork(parseFullGraph(buffer),atlas,'x');a.step(Float32Array.of(.4,0,0,.6));b.restore(a.snapshot());a.step(Float32Array.of(.2,0,0,.5));b.step(Float32Array.of(.2,0,0,.5));assert.deepEqual(a.snapshot(),b.snapshot());
  const before=b.snapshot(),bad=structuredClone(before);bad.slow[2][0]=NaN;assert.throws(()=>b.restore(bad));assert.deepEqual(b.snapshot(),before);assert.throws(()=>b.configure({tonic:NaN}));assert.throws(()=>b.configure({learning:true}));
});
test('Tracked source inventory accounts for every excluded segment edge and sensory population',()=>{
  const m=JSON.parse(readFileSync(new URL('../data/full-cns-manifest.json',import.meta.url)));
  assert.equal(m.counts.neurons,166700);assert.equal(Object.values(m.superclasses).reduce((a,b)=>a+b,0),166700);
  assert.equal(m.counts.edges+m.counts.excludedSegmentEdges,m.counts.sourceSegmentEdges);assert.equal(m.counts.contacts+m.counts.excludedSegmentContacts,m.counts.sourceSegmentContacts);
  assert.equal(m.retina.mapped+m.retina.unmapped,m.retina.photoreceptors);assert.ok(m.superclasses.vnc_intrinsic>0&&m.superclasses.ol_intrinsic>0&&m.superclasses.ascending_neuron>0);assert.equal(m.learning,false);
});
