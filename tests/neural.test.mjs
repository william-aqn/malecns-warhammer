import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {CONNECTOME,CONNECTOME_SHA256,createBrain,stepBrain,NEURAL_STEPS} from '../dist/neural.mjs';
import {createSimulation,stepSimulation,decideUnit,updateDecisions,exportScene,importScene,observeThreat,W} from '../dist/engine.mjs';
import {decodeLz4} from '../scripts/import-malecns.mjs';
const near=(a,b,eps=1e-6)=>assert.ok(Math.abs(a-b)<eps,a+' differs from '+b);
test('bundled anatomical graph matches pinned identity, source provenance and counts',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../data/malecns-manifest.json',import.meta.url)));
  const digest=createHash('sha256').update(JSON.stringify(CONNECTOME)).digest('hex');
  assert.equal(digest,'6a1452434783f8e3e9ebdb82fc36e3c56071b85e1575c755af55a1f84b89a477');
  assert.equal(digest,CONNECTOME_SHA256);assert.equal(digest,manifest.sha256);
  assert.deepEqual(CONNECTOME.counts,{neurons:319,edges:21288,contacts:102445});
  assert.equal(CONNECTOME.source.assets['connectome.fcl'].sha256,'1e35e6ba658986de5e3163ea49b600378a2e3daa64700b8b619c4f21cc0a6e1f');
  assert.equal(new Set(CONNECTOME.neurons.map(n=>n.bodyId)).size,319);
  assert.deepEqual(CONNECTOME.neurons.filter(n=>n.kind==='output'&&n.type==='DNp01').map(n=>n.bodyId).sort((a,b)=>a-b),[10001,10010]);
  const incoming=Array(319).fill(0);
  for(const [a,b,w] of CONNECTOME.edges){assert.ok(a>=0&&a<319&&b>=0&&b<319&&Number.isInteger(w)&&w>0);incoming[b]+=w;}
  assert.ok(incoming.every((v,i)=>v<=CONNECTOME.neurons[i].incomingTotal));
  assert.equal(incoming.reduce((a,b)=>a+b,0),102445);
});
test('LZ4 extraction handles overlap copies and rejects malformed blocks',()=>{
  assert.equal(Buffer.from(decodeLz4(Buffer.from([0x32,97,98,99,3,0]),9)).toString(),'abcabcabc');
  assert.throws(()=>decodeLz4(Buffer.from([0,0,0]),4));
  assert.throws(()=>decodeLz4(Buffer.from([0x30,97]),3));
});
test('no stimulus produces silence; either eye drives its corresponding outputs',()=>{
  const quiet=createBrain();for(let i=0;i<20;i++)stepBrain(quiet,[0,0]);
  assert.ok(quiet.activity.every(v=>v===0));
  const left=createBrain(),right=createBrain();stepBrain(left,[1,0],'malecns',32);stepBrain(right,[0,1],'malecns',32);
  assert.ok(left.outputs[0]>.15&&left.outputs[0]>left.outputs[1]*100);
  assert.ok(right.outputs[1]>.15&&right.outputs[1]>right.outputs[0]*100);
  assert.ok([...left.activity,...right.activity].every(v=>Number.isFinite(v)&&v>=0&&v<=1));
});
test('removing edges leaves stimulated input cells active but silences outputs',()=>{
  const real=createBrain(),control=createBrain();stepBrain(real,[1,.5],'malecns',32);stepBrain(control,[1,.5],'disconnected',32);
  assert.ok(real.outputs.every(v=>v>.05));assert.deepEqual(control.outputs,[0,0]);
  assert.ok(control.activity.some(v=>v>.5));
});
test('signals propagate through anatomical edges with one-step delay',()=>{
  const b=createBrain();stepBrain(b,[1,0],'malecns',1);assert.deepEqual(b.outputs,[0,0]);
  // Independent two-step reference for one giant-fiber neuron. No upstream
  // activity exists except directly stimulated left input neurons after step 1.
  const target=CONNECTOME.neurons.findIndex(n=>n.bodyId===10010),stimulated=new Set(CONNECTOME.neurons.map((n,i)=>n.kind==='input'&&n.side==='L'?i:-1));
  const contacts=CONNECTOME.edges.filter(([s,t])=>t===target&&stimulated.has(s)).reduce((sum,e)=>sum+e[2],0);
  const expected=.5*Math.tanh(.7*contacts/CONNECTOME.neurons[target].incomingTotal*.5*Math.tanh(.8));
  stepBrain(b,[1,0],'malecns',1);near(b.activity[target],expected);
});
function contact(mode){
  const s=createSimulation({controllerA:mode,controllerB:'utility'});s.map.fill(0);s.units.forEach(u=>u.hp=0);
  const a=s.units[0],b=s.units[5];a.hp=a.maxHp;b.hp=b.maxHp;a.x=10;a.y=10;b.x=14;b.y=10;a.overrides={aggression:.4,caution:1,objective:0};
  return s;
}
test('end-to-end: same threat causes neural retreat, disconnected/utility choose attack',()=>{
  const a=contact('malecns'),b=contact('disconnected'),c=contact('utility');
  for(const s of [a,b,c])stepSimulation(s);
  assert.deepEqual(a.units[0].brain.inputs,b.units[0].brain.inputs);
  assert.equal(a.units[0].decision.type,'retreat');assert.equal(a.units[0].decision.neuralOverride,true);
  assert.equal(a.units[0].neuralEscapes,1);
  assert.equal(b.units[0].decision.type,'attack');assert.equal(c.units[0].decision.type,'attack');
});
test('walls hide neural stimuli, and the two teams use opposite left/right axes',()=>{
  const s=contact('malecns');s.units[5].y=9;
  const a=observeThreat(s,s.units[0]),b=observeThreat(s,s.units[5]);
  assert.ok(a[0]>0&&a[1]===0);assert.ok(b[0]>0&&b[1]===0);
  for(let y=0;y<22;y++)s.map[y*W+12]=1;
  assert.deepEqual(observeThreat(s,s.units[0]),[0,0]);
});
test('agents have independent memory; inspecting decisions does not advance neural time',()=>{
  const s=contact('malecns'),before=JSON.stringify(s.units.map(u=>u.brain));
  for(let i=0;i<5;i++){decideUnit(s,s.units[0]);updateDecisions(s);}
  assert.equal(JSON.stringify(s.units.map(u=>u.brain)),before);
  stepSimulation(s);assert.equal(s.units[0].brain.steps,NEURAL_STEPS);
  assert.equal(s.units[1].brain.steps,0);
  assert.notEqual(s.units[0].brain.activity,s.units[1].brain.activity);
  const snapshot=JSON.stringify(s.units[0].brain);updateDecisions(s);assert.equal(JSON.stringify(s.units[0].brain),snapshot);
});
test('save/load preserves every neural state and exact subsequent actions',()=>{
  const a=createSimulation({seed:'neural-memory'});for(let i=0;i<20;i++)stepSimulation(a);
  const b=importScene(exportScene(a));assert.deepEqual(a.units.map(u=>u.brain),b.units.map(u=>u.brain));
  for(let i=0;i<10;i++){
    stepSimulation(a);stepSimulation(b);
    assert.deepEqual(a.units.map(u=>[u.x,u.y,u.hp,u.brain,u.decision]),b.units.map(u=>[u.x,u.y,u.hp,u.brain,u.decision]));
  }
});
test('corrupt model IDs, activity, output readouts and controller names are rejected',()=>{
  for(const corrupt of [
    x=>x.state.units[0].brain.model='unknown',
    x=>x.state.units[0].brain.activity[0]=2,
    x=>x.state.units[0].brain.activity.pop(),
    x=>x.state.units[0].brain.outputs[0]=.3,
    x=>x.state.units[0].brain.steps=100,
    x=>x.state.config.controllerA='toString',
    x=>x.state.config.factionA='toString'
  ]){const x=JSON.parse(exportScene(createSimulation()));corrupt(x);assert.throws(()=>importScene(JSON.stringify(x)));}
});
test('legacy v1 scenes remain utility-controlled and acquire empty neural memory',()=>{
  const x=JSON.parse(exportScene(createSimulation({controllerA:'utility',controllerB:'utility'})));
  x.version=1;x.state.version=1;delete x.state.config.controllerA;delete x.state.config.controllerB;
  for(const u of x.state.units){delete u.brain;delete u.neuralEscapes;}
  const s=importScene(JSON.stringify(x));assert.equal(s.config.controllerA,'utility');assert.equal(s.config.controllerB,'utility');assert.ok(s.units.every(u=>u.brain.steps===0));
});
