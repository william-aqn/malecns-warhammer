import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,stepFields,fieldAt,contactAt,soundAt,raySpectrum,advanceBody,worldSnapshot,validateWorld} from '../dist/sensory-world.mjs';
import {SensoryPorts,DEFAULT_SENSE_MASK} from '../dist/sensory-ports.mjs';
import {Atlas} from '../dist/full-network.mjs';
const darkMask=()=>Object.fromEntries(Object.keys(DEFAULT_SENSE_MASK).map(k=>[k,false]));
function ports(){
  const columns=['bodyId','superclass','class','type','somaSide','rootSide','nt_consensus_nt','subclass','entryNerve'];
  const records=[
    [1,'ol_sensory','visual','R8p',null,'R','histamine',null,null],
    [2,'cb_sensory','olfactory','ORN_DM1',null,'L','acetylcholine',null,'AN'],
    [3,'cb_sensory','olfactory','ORN_DA1',null,'L','acetylcholine',null,'AN'],
    [4,'vnc_sensory','gustatory','test','L',null,'acetylcholine','leg bristle','ProLN'],
    [5,'vnc_sensory','mechanosensory_proprioceptive','test','L',null,'acetylcholine','chordotonal organ','ProLN'],
    [6,'cb_sensory','mechanosensory','test','L',null,'acetylcholine','auditory','AN'],
    [7,'vnc_sensory','unknown_sensory',null,'L',null,'acetylcholine',null,null],
    [8,'cb_sensory','thermosensory','TRN','L',null,'acetylcholine',null,'AN'],
    [9,'cb_sensory','hygrosensory','HRN','L',null,'acetylcholine',null,'AN']
  ];
  const atlas=new Atlas({schema:1,columns,records}),retina={columns:{L:[[1,1]],R:[[1,1],[2,2]]},photoreceptors:[{index:0,bodyId:1,side:'R',type:'R8p',columns:[[1,1,3],[2,2,1]]}]};
  return new SensoryPorts(atlas,retina);
}
test('Seeded arena, fields and body replay deterministically',()=>{
  const a=createWorld('42','random'),b=createWorld('42','random');assert.deepEqual(a,b);
  for(let i=0;i<10;i++){stepFields(a);stepFields(b);advanceBody(a,Array(6).fill(.4),{clamped:false});advanceBody(b,Array(6).fill(.4),{clamped:false});}
  assert.deepEqual(worldSnapshot(a),worldSnapshot(b));assert.deepEqual(worldSnapshot(validateWorld(worldSnapshot(a))),worldSnapshot(a));
});
test('Retinal ray sees occluder, not hidden object identity; darkness zeros photons',()=>{
  const w=createWorld('1','open');w.objects=[{id:'target',kind:'light',x:8,y:9,radius:.8,height:1.5,spectrum:[0,0,1],power:1}];const open=raySpectrum(w,0,0);assert.deepEqual(open.spectrum,[0,0,1]);
  w.walls[9*w.width+6]=1;const hidden=raySpectrum(w,0,0);assert.notDeepEqual(hidden.spectrum,open.spectrum);w.objects[0].spectrum=[1,0,0];assert.deepEqual(raySpectrum(w,0,0),hidden);w.light=0;assert.deepEqual(raySpectrum(w,0,0).spectrum,[0,0,0]);
});
test('Odor diffuses around openings but cannot cross a sealed wall',()=>{
  const w=createWorld('1','open');w.wind=[0,0];w.objects=w.objects.filter(o=>o.kind==='odor');Object.assign(w.objects[0],{x:10,y:9});
  for(let y=1;y<w.height-1;y++)w.walls[y*w.width+12]=1;
  for(let t=0;t<80;t++)stepFields(w);
  assert.ok(fieldAt(w,'odor:ORN_DM1',11,9)>0);assert.equal(fieldAt(w,'odor:ORN_DM1',13,9),0);
  w.walls[9*w.width+12]=0;for(let t=0;t<50;t++)stepFields(w);assert.ok(fieldAt(w,'odor:ORN_DM1',13,9)>0);
});
test('Taste requires physical contact; sound is attenuated by a wall',()=>{
  const w=createWorld('1','open');assert.equal(contactAt(w,20,12).taste,0);assert.ok(contactAt(w,6,9).taste>0);
  w.time=.13;w.objects=w.objects.filter(o=>o.kind==='sound');Object.assign(w.objects[0],{x:10,y:9});const open=soundAt(w,5,9);w.walls[9*w.width+7]=1;assert.ok(soundAt(w,5,9)<open);
});
test('Body collision blocks travel and movement creates real joint feedback',()=>{
  const w=createWorld('1','open');w.walls[9*w.width+6]=1;
  for(let k=0;k<20;k++)advanceBody(w,Array(6).fill(1),{clamped:false});assert.ok(w.body.x<6);assert.equal(w.body.collision,1);assert.ok(w.body.loads.some(v=>v>0));
  const open=createWorld('1','open');advanceBody(open,Array(6).fill(.8),{clamped:false});assert.ok(open.body.x>5);assert.ok(open.body.jointVelocity.some(v=>Math.abs(v)>0));
  const fixed=createWorld();advanceBody(fixed,Array(6).fill(1),{clamped:true});assert.equal(fixed.body.x,5);assert.equal(fixed.body.jointVelocity[0],0);
});
test('Annotated receptor channels are selective, unmapped cells stay undriven and modality cuts are causal',()=>{
  const p=ports(),w=createWorld('1','open');w.fields['odor:ORN_DM1']=new Float32Array(w.width*w.height).fill(.7);w.body.joints[0]=.5;
  let s=p.sample(w);assert.ok(s.stimulus[1]>.6);assert.equal(s.stimulus[2],0);assert.equal(s.stimulus[6],0);assert.ok(s.stimulus[4]>0);
  const mask={...DEFAULT_SENSE_MASK,smell:false};s=p.sample(w,mask);assert.equal(s.stimulus[1],0);assert.ok(s.stimulus[4]>0);
  assert.ok(p.sample(w,darkMask()).stimulus.every(v=>v===0));assert.equal(p.inventory().unmapped,1);
});
test('World import rejects NaN, invalid geometry and malformed sensory fields',()=>{
  const s=worldSnapshot(createWorld());s.body.x=NaN;assert.throws(()=>validateWorld(s));const t=worldSnapshot(createWorld());t.fields.temperature=[1];assert.throws(()=>validateWorld(t));const u=worldSnapshot(createWorld());u.walls[9*u.width+5]=1;assert.throws(()=>validateWorld(u));
});
