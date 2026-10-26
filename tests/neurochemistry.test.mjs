import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CHEMISTRIES,NEUROTRANSMITTER_DATA,NEUROTRANSMITTER_SHA256,chemistryOf,transmitterInfo,transmitterPolarity,transmitterWeights,transmitterSummary,rectifiedRate} from '../dist/neurochemistry.mjs';
import {MOTOR_MODEL,MOTOR_SHA256,createMotorBrain,stepMotorBrain,motorReadout,motorCalibration} from '../dist/motor.mjs';
import {MOTOR_PACKED} from '../dist/data/malecns-motor.mjs';
import {CONNECTOME,createBrain,stepBrain,validateBrain} from '../dist/neural.mjs';
import {createSimulation,stepSimulation,repeatWithExperience,exportScene,importScene,decideUnit,VERSION} from '../dist/engine.mjs';
import {runTransmitterComparison,runMotorComparison,runAimComparison} from '../dist/experiments.mjs';
const bytes=Buffer.from(MOTOR_PACKED,'base64'),N=MOTOR_MODEL.neurons.length;
const offsets=Array.from({length:N+1},(_,i)=>bytes.readUInt32LE(i*4));
const edgeAt=e=>({from:bytes.readUInt16LE((N+1)*4+e*4),contacts:bytes.readUInt16LE((N+1)*4+e*4+2)});
const label=i=>transmitterInfo(MOTOR_MODEL.neurons[i].bodyId).consensus;
function converge(inputs,chemistry='nt',mode='neural'){
 const b=createMotorBrain(chemistry);stepMotorBrain(b,inputs,mode,32);return b;
}
function junction(other){
 for(let row=0;row<N;row++){
  let excitatory=null,changed=null;
  for(let e=offsets[row];e<offsets[row+1];e++){
   const edge=edgeAt(e);if(edge.from===row)continue;
   if(label(edge.from)==='acetylcholine')excitatory=edge.from;
   if(label(edge.from)===other)changed=edge.from;
  }
  if(excitatory!==null&&changed!==null)return {row,excitatory,changed};
 }
 throw Error('No source-identified junction found');
}
const project=s=>({tick:s.tick,rng:s.rng,scores:s.scores,finished:s.finished,winner:s.winner,units:s.units.map(u=>({x:u.x,y:u.y,hp:u.hp,heading:u.heading,brain:u.brain,experience:u.experience,decision:u.decision}))});

test('transmitter annotations are pinned, exact body-ID joins without changing either graph',()=>{
 assert.equal(createHash('sha256').update(JSON.stringify(NEUROTRANSMITTER_DATA)).digest('hex'),NEUROTRANSMITTER_SHA256);
 assert.equal(NEUROTRANSMITTER_DATA.source.sha256,'95c9289220663abeb3409f3ad9e5a7f8a53f8093f5139d15502cd08da8879621');
 assert.equal(NEUROTRANSMITTER_DATA.selection.motorModel,MOTOR_SHA256);
 assert.equal(MOTOR_SHA256,'2e00fbe4528b5ba23cbbcdb40aa94ee26772d1bf7c6b8ce7cfe14888029f3d89');
 const ids=new Set(NEUROTRANSMITTER_DATA.records.map(r=>r[0]));assert.equal(ids.size,11436);
 for(const n of [...MOTOR_MODEL.neurons,...CONNECTOME.neurons])assert.ok(ids.has(n.bodyId));
 const c=transmitterSummary(MOTOR_MODEL.neurons,'nt');
 assert.deepEqual(c.labels,{acetylcholine:8418,glutamate:1210,gaba:1568,octopamine:20,dopamine:30,unclear:184,serotonin:6});
 assert.deepEqual([c.excitatory,c.inhibitory,c.unresolved,c.groundTruth],[8418,2778,240,2036]);
 for(const r of NEUROTRANSMITTER_DATA.records)for(const i of [3,7])assert.ok(r[i]===null||Number.isFinite(r[i])&&r[i]>=0&&r[i]<=1);
});

test('source polarity uses consensus; unknown transmitters and modulators have no invented fast sign',()=>{
 assert.equal(transmitterPolarity('acetylcholine','nt'),1);assert.equal(transmitterPolarity('gaba','nt'),-1);
 assert.equal(transmitterPolarity('glutamate','nt'),-1);assert.equal(transmitterPolarity('glutamate','nt-glu-positive'),1);
 for(const nt of ['unclear','dopamine','serotonin','octopamine',null,'missing'])assert.equal(transmitterPolarity(nt,'nt'),0);
 assert.equal(transmitterPolarity('gaba','unsigned'),1);assert.throws(()=>transmitterPolarity('gaba','invented'));
 const row=NEUROTRANSMITTER_DATA.records.find(r=>r[1]!==r[2]);assert.ok(row);
 assert.equal(transmitterInfo(row[0]).consensus,row[1]);assert.equal(transmitterInfo(row[0]).confidence,row[3]);
});

test('actual GABA source suppresses a convergent excitatory signal, without negative rates',()=>{
 const j=junction('gaba'),exc=createMotorBrain('nt'),inhibited=createMotorBrain('nt');
 exc.activity[j.excitatory]=1;inhibited.activity[j.excitatory]=1;inhibited.activity[j.changed]=1;
 stepMotorBrain(exc,[0,0,0,0],'neural',1);stepMotorBrain(inhibited,[0,0,0,0],'neural',1);
 assert.ok(exc.activity[j.row]>0);assert.ok(inhibited.activity[j.row]<exc.activity[j.row]);
 assert.ok(inhibited.activity.every(v=>v>=0&&v<=1));
 const unsigned=createMotorBrain('unsigned');unsigned.activity[j.excitatory]=1;unsigned.activity[j.changed]=1;
 stepMotorBrain(unsigned,[0,0,0,0],'neural',1);assert.ok(unsigned.activity[j.row]>exc.activity[j.row]);
});

test('changing the glutamate assumption reverses its causal effect on a real postsynaptic cell',()=>{
 const j=junction('glutamate'),negative=createMotorBrain('nt'),positive=createMotorBrain('nt-glu-positive');
 for(const b of [negative,positive]){b.activity[j.excitatory]=1;b.activity[j.changed]=1;stepMotorBrain(b,[0,0,0,0],'neural',1);}
 assert.ok(positive.activity[j.row]>negative.activity[j.row]);
});

test('a full numerical step matches an independent signed-contact oracle using the source neuron label',()=>{
 const b=createMotorBrain('nt');for(let i=0;i<N;i++)b.activity[i]=Math.fround((i%23)/23);
 const old=Float32Array.from(b.activity),expected=new Float32Array(N),inputs=[.2,.6,.7,.1],stimulus=new Float32Array(N);
 for(const [k,v] of [['threatL',inputs[0]],['threatR',inputs[1]],['targetL',inputs[2]],['targetR',inputs[3]]])for(const i of MOTOR_MODEL.inputs[k])stimulus[i]+=.8*v;
 for(let row=0;row<N;row++){
  let sum=0;
  for(let e=offsets[row];e<offsets[row+1];e++){
   const {from,contacts}=edgeAt(e),nt=label(from),sign=nt==='acetylcholine'?1:nt==='gaba'||nt==='glutamate'?-1:0;
   const magnitude=Math.fround(.7*contacts/Math.max(1,MOTOR_MODEL.neurons[row].incomingTotal));
   sum=Math.fround(sum+Math.fround(magnitude*sign)*old[from]);
  }
  expected[row]=.5*old[row]+.5*Math.max(0,Math.tanh(sum+stimulus[row]));
 }
 stepMotorBrain(b,inputs,'neural',1);assert.deepEqual(b.activity,Array.from(expected));
});

test('sign compilation preserves contact magnitudes and does not mutate the anatomical weights',()=>{
 const nodes=['acetylcholine','gaba','glutamate','dopamine'].map(nt=>({bodyId:NEUROTRANSMITTER_DATA.records.find(r=>r[1]===nt)[0]}));
 const source=Uint16Array.from([0,1,2,3]),base=Float32Array.from([.1,.2,.3,.4]),saved=[...base];
 const signed=transmitterWeights(nodes,source,base,'nt');assert.deepEqual([...base],saved);
 assert.deepEqual([...signed],[base[0],-base[1],-base[2],0]);assert.equal(rectifiedRate(-10),0);
});

test('chemical models remain bounded and cannot create activity without a source stimulus',()=>{
 for(const chemistry of Object.keys(CHEMISTRIES)){
  const zero=converge([0,0,0,0],chemistry);assert.ok(zero.activity.every(v=>v===0));
  const cut=converge([1,1,1,1],chemistry,'neural-disconnected');assert.deepEqual(cut.outputs,[0,0]);
  assert.deepEqual(motorReadout(cut).scores,{fire:0,advance:0,left:0,right:0,reverse:0,wait:.06});
  const active=converge([1,1,1,1],chemistry);stepMotorBrain(active,[0,0,0,0],'neural',64);
  assert.ok(active.activity.every(v=>Number.isFinite(v)&&v>=0&&v<=1));
 }
});

test('readout keeps the same reference scale so inhibition is not cancelled by recalibration',()=>{
 const legacy=converge([.5,.5,.5,.5],'unsigned'),signed=converge([.5,.5,.5,.5]);
 assert.ok(motorReadout(signed).raw.aim[0]<motorReadout(legacy).raw.aim[0]);
 assert.ok(motorReadout(signed).scores.fire<motorReadout(legacy).scores.fire);
 assert.ok(Object.values(motorReadout(signed).scores).every(Number.isFinite));
 // The inhibited reference can be silent. No division by that zero occurs in the decoder.
 assert.equal(motorCalibration('nt').target.DNa01R,0);
});

test('compact reflex and large motor brains both carry and validate chemical provenance',()=>{
 for(const mode of ['malecns','neural'])for(const chemistry of Object.keys(CHEMISTRIES)){
  const b=createBrain(mode,chemistry);stepBrain(b,mode==='neural'?[.5,.3,.6,.4]:[.5,.3],mode);
  assert.ok(validateBrain(b,1));assert.equal(chemistryOf(b),chemistry);
  if(chemistry!=='unsigned')assert.equal(b.transmitters,NEUROTRANSMITTER_SHA256);
 }
});

test('v9 saves resume chemical activity and online learning exactly',()=>{
 for(const chemistry of ['nt','nt-glu-positive']){
  const a=createSimulation({scenario:'contact',controllerA:'adaptive',controllerB:'adaptive',neurochemistry:chemistry});
  for(let i=0;i<4;i++)stepSimulation(a);
  const serialized=exportScene(a);assert.equal(JSON.parse(serialized).version,9);assert.ok(Buffer.byteLength(serialized)<8_000_000);
  const b=importScene(serialized);
  for(let i=0;i<5;i++){stepSimulation(a);stepSimulation(b);assert.deepEqual(project(b),project(a));}
 }
});

test('v8 migration retains unsigned dynamics and learned weights instead of silently changing biology',()=>{
 const a=createSimulation({scenario:'contact',controllerA:'adaptive',controllerB:'adaptive'});
 for(let i=0;i<4;i++)stepSimulation(a);
 const old=JSON.parse(exportScene(a));old.version=8;old.state.version=8;delete old.state.config.neurochemistry;
 for(const u of old.state.units){delete u.brain.chemistry;delete u.brain.transmitters;}
 const b=importScene(JSON.stringify(old));assert.equal(b.config.neurochemistry,'unsigned');
 for(let i=0;i<4;i++){stepSimulation(a);stepSimulation(b);assert.deepEqual(project(b),project(a));}
 assert.match(b.importNote,/v8/);
});

test('saves reject unknown chemistry, different source identities, config mismatches and false old formats',()=>{
 const original=exportScene(createSimulation({neurochemistry:'nt'}));
 for(const mutate of [d=>{d.state.config.neurochemistry='fake'},d=>{d.state.units[0].brain.chemistry='unsigned';d.state.units[0].brain.transmitters=null},d=>{d.state.units[0].brain.transmitters='fake'},d=>{delete d.state.units[0].brain.chemistry},d=>{d.version=8}]){
  const data=JSON.parse(original);mutate(data);assert.throws(()=>importScene(JSON.stringify(data)));
 }
 assert.equal(VERSION,9);
});

test('experience transfers only between matching transmission models; profiles still carry',()=>{
 const a=createSimulation({controllerA:'adaptive',controllerB:'adaptive',neurochemistry:'nt'});a.units[0].experience.weights[0][0]=.75;a.units[0].overrides.objective=.9;
 const same=repeatWithExperience(a),different=repeatWithExperience(a,{...a.config,neurochemistry:'unsigned'});
 assert.equal(same.units[0].experience.weights[0][0],.75);assert.equal(same.units[0].experience.episodes,1);
 assert.ok(different.units[0].experience.weights.flat().every(v=>v===0));assert.equal(different.units[0].experience.episodes,0);
 assert.equal(different.units[0].overrides.objective,.9);
});

test('learned heads still require neural activity with transmitters and disconnected controls',()=>{
 for(const controllerA of ['adaptive','adaptive-disconnected']){
  const s=createSimulation({controllerA,neurochemistry:'nt'}),u=s.units[0];u.experience.weights=u.experience.weights.map(row=>row.map(()=>3));
  if(controllerA==='adaptive')u.overrides.reactivity=0;
  for(let i=0;i<4;i++){stepSimulation(s);assert.equal(u.decision.command,'wait');}
 }
});

test('comparison probes are deterministic, raw, chemically explicit and leave games untouched',()=>{
 const s=createSimulation({controllerA:'adaptive',neurochemistry:'nt'}),before=exportScene(s);
 const a=runTransmitterComparison('adaptive'),b=runTransmitterComparison('adaptive');assert.deepEqual(a,b);assert.equal(a.length,3);
 assert.ok(a[1].escape[0]<a[0].escape[0]);assert.ok(a[1].aim[0]<a[0].aim[0]);assert.equal(exportScene(s),before);
 assert.ok(runMotorComparison(.5,true,'nt').every(r=>r.chemistry==='nt'));
 assert.ok(runAimComparison(.5,'nt').every(r=>Number.isFinite(r.fire)));
});
