import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {MOTOR_MODEL,MOTOR_PACKED,MOTOR_SHA256} from '../dist/data/malecns-motor.mjs';
import {motorReadout,MOTOR_STEPS} from '../dist/motor.mjs';
import {createBrain,stepBrain} from '../dist/neural.mjs';
import {createSimulation,stepSimulation,decideUnit,updateDecisions,observeMotor,motorBearing,exportScene,importScene,VERSION,W} from '../dist/engine.mjs';
import {contactConfig,runMotorComparison} from '../dist/experiments.mjs';
const contact=(mode='neural')=>createSimulation(contactConfig(mode));
function stimulated(inputs,mode='neural'){
  const brain=createBrain(mode);stepBrain(brain,inputs,mode,32);return brain;
}

test('visual-motor graph has pinned anatomy, valid CSR and original contact totals',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../data/motor-manifest.json',import.meta.url)));
  const digest=createHash('sha256').update(JSON.stringify(MOTOR_MODEL)+MOTOR_PACKED).digest('hex');
  assert.equal(digest,'2e00fbe4528b5ba23cbbcdb40aa94ee26772d1bf7c6b8ce7cfe14888029f3d89');
  assert.equal(digest,MOTOR_SHA256);assert.equal(digest,manifest.sha256);
  assert.deepEqual(MOTOR_MODEL.counts,{neurons:11436,edges:1687031,contacts:10931415});
  assert.equal(MOTOR_MODEL.source.assets['connectome.fcl'].sha256,'1e35e6ba658986de5e3163ea49b600378a2e3daa64700b8b619c4f21cc0a6e1f');
  const bytes=Buffer.from(MOTOR_PACKED,'base64'),n=MOTOR_MODEL.counts.neurons,e=MOTOR_MODEL.counts.edges;
  assert.equal(bytes.length,6793872);assert.equal(bytes.length,(n+1)*4+e*4);
  assert.equal(new Set(MOTOR_MODEL.neurons.map(v=>v.bodyId)).size,n);
  assert.equal(bytes.readUInt32LE(0),0);assert.equal(bytes.readUInt32LE(n*4),e);
  let total=0;
  for(let row=0;row<n;row++){
    const start=bytes.readUInt32LE(row*4),end=bytes.readUInt32LE((row+1)*4);
    assert.ok(end>=start&&end<=e);let incoming=0,previous=-1;
    for(let i=start;i<end;i++){
      const offset=(n+1)*4+i*4,source=bytes.readUInt16LE(offset),contacts=bytes.readUInt16LE(offset+2);
      assert.ok(source>previous&&source<n);assert.ok(contacts>0&&contacts<=32767);previous=source;incoming+=contacts;
    }
    assert.ok(incoming<=MOTOR_MODEL.neurons[row].incomingTotal);total+=incoming;
  }
  assert.equal(total,10931415);
  for(const group of Object.values({...MOTOR_MODEL.inputs,...MOTOR_MODEL.outputs})){
    assert.ok(group.length>0);assert.equal(new Set(group).size,group.length);
    assert.ok(group.every(i=>Number.isInteger(i)&&i>=0&&i<n));
  }
  assert.ok(Object.values(MOTOR_MODEL.outputs).flat().every(i=>MOTOR_MODEL.neurons[i].kind==='output'));
});

test('zero stimulus is silent; lateral visual input changes steering through the graph',()=>{
  const silent=stimulated([0,0,0,0]);assert.ok(silent.activity.every(v=>v===0));
  const left=motorReadout(stimulated([0,0,1,0])),right=motorReadout(stimulated([0,0,0,1]));
  assert.ok(left.raw.steer[0]>left.raw.steer[1]);assert.ok(right.raw.steer[1]>right.raw.steer[0]);
  assert.ok(left.scores.left>left.scores.right);assert.ok(right.scores.right>right.scores.left);
  assert.ok(left.scores.left>.06&&right.scores.right>.06);
  const threatL=stimulated([1,0,0,0]),threatR=stimulated([0,1,0,0]);
  assert.ok(threatL.outputs[0]>threatL.outputs[1]);assert.ok(threatR.outputs[1]>threatR.outputs[0]);
  assert.ok([...threatL.activity,...threatR.activity].every(v=>Number.isFinite(v)&&v>=0&&v<=1));
});

test('symmetric calibration is reproducible by the actual runtime',()=>{
  for(const [channel,inputs] of [['target',[0,0,.5,.5]],['threat',[.5,.5,0,0]]]){
    const b=stimulated(inputs);
    for(const [name,group] of Object.entries(MOTOR_MODEL.outputs)){
      const actual=group.reduce((sum,i)=>sum+b.activity[i],0)/group.length;
      assert.ok(Math.abs(actual-MOTOR_MODEL.calibration[channel][name])<1e-8,name);
    }
  }
});

test('edge removal leaves input activity but no motor outputs or non-wait command',()=>{
  const b=stimulated([1,.5,.9,.7],'neural-disconnected');
  assert.ok(b.activity.some(v=>v>.5));
  for(const group of Object.values(MOTOR_MODEL.outputs))assert.ok(group.every(i=>b.activity[i]===0));
  const s=contact('neural-disconnected');s.units[0].brain=b;
  assert.equal(decideUnit(s,s.units[0]).command,'wait');
  assert.deepEqual(b.outputs,[0,0]);
});

test('motor choice responds to stimulus direction without consulting tactical objectives or assignments',()=>{
  const s=contact(),u=s.units[0];s.units[1].x=28;s.units[1].y=20;
  Object.defineProperty(s,'objectives',{get(){throw Error('Tactical objective access');}});
  Object.defineProperty(u,'assignment',{get(){throw Error('Tactical assignment access');}});
  u.brain=stimulated([0,0,1,0]);const left=decideUnit(s,u);
  u.brain=stimulated([0,0,0,1]);const right=decideUnit(s,u);
  assert.equal(left.command,'left');assert.equal(right.command,'right');
  assert.equal(left.source,'motor');assert.equal(left.counterfactual,null);assert.equal(left.neuralOverride,undefined);
});

test('facing and legal-action mask govern firing, walls and occupied cells',()=>{
  const s=contact(),[u,e]=s.units;u.brain=stimulated([0,0,.5,.5]);
  assert.equal(decideUnit(s,u).type,'attack');
  e.x=u.x-3;assert.equal(decideUnit(s,u).type,'move');
  e.x=u.x+3;s.map[u.y*W+u.x+1]=1;
  let d=decideUnit(s,u);assert.notEqual(d.type,'attack');assert.notEqual(d.command,'advance');
  assert.equal(d.alternatives.find(c=>c.command==='advance').available,false);
  s.map[u.y*W+u.x+1]=0;e.x=28;e.y=20;
  s.units.push({...u,id:'A-02',x:u.x+1});
  d=decideUnit(s,u);assert.notEqual(d.command,'advance');
  assert.equal(d.alternatives.find(c=>c.command==='advance').available,false);
});

test('scene inputs rotate with facing and walls hide objects',()=>{
  const s=contact(),[u,e]=s.units;u.overrides={aggression:1,caution:1,objective:0};e.x=u.x;e.y=u.y-4;
  const left=observeMotor(s,u);assert.ok(left[2]>left[3]);
  u.heading=6;const right=observeMotor(s,u);assert.ok(right[3]>right[2]);
  u.heading=2;s.map[(u.y-2)*W+u.x]=1;
  assert.deepEqual(observeMotor(s,u),[0,0,.035,.035]);
  assert.ok(Math.abs(motorBearing(u,{x:u.x+1,y:u.y}))<1e-9);
  u.heading=0;assert.ok(Math.abs(motorBearing(u,{x:u.x,y:u.y-1}))<1e-9);
});

test('network-selected turns execute and each activation advances eight neural steps',()=>{
  const s=contact(),[u,e]=s.units;e.x=28;e.y=20;u.overrides={aggression:0,caution:0,objective:1};
  s.objectives=[{id:'I',x:u.x,y:u.y-3,owner:null}];const before=u.heading;let choice;
  stepSimulation(s,(d,actor)=>{if(actor.id===u.id)choice=d;});
  assert.equal(choice.type,'turn');assert.equal(choice.command,'left');
  assert.equal(u.heading,(before+choice.turn+8)%8);assert.equal(u.brain.steps,MOTOR_STEPS);
  assert.equal(u.reflex.active,false);assert.equal(u.neuralEscapes,0);
});

test('zero decoder sensitivity stops motor commands while neural dynamics continue',()=>{
  const s=contact(),u=s.units[0];u.overrides.reactivity=0;const position=[u.x,u.y,u.heading];
  stepSimulation(s);assert.equal(u.decision.command,'wait');
  assert.deepEqual([u.x,u.y,u.heading],position);assert.ok(u.brain.activity.some(v=>v>0));assert.equal(u.brain.steps,MOTOR_STEPS);
});

test('unit neural memory is independent and inspection consumes neither steps nor RNG',()=>{
  const s=createSimulation({controllerA:'neural',controllerB:'neural'});
  assert.notEqual(s.units[0].brain.activity,s.units[1].brain.activity);
  stepBrain(s.units[0].brain,[0,0,1,0],'neural');
  assert.ok(s.units[1].brain.activity.every(v=>v===0));
  const before=s.units.map(u=>JSON.stringify(u.brain)),rng=s.rng;
  for(let i=0;i<3;i++){decideUnit(s,s.units[0]);updateDecisions(s);}
  assert.deepEqual(s.units.map(u=>JSON.stringify(u.brain)),before);assert.equal(s.rng,rng);
});

test('v5 saves preserve motor activity, headings and exact subsequent actions',()=>{
  for(const mode of ['neural','neural-disconnected']){
    const a=contact(mode);stepSimulation(a);stepSimulation(a);const b=importScene(exportScene(a));
    assert.equal(b.version,VERSION);assert.deepEqual(b.units.map(u=>[u.heading,u.brain]),a.units.map(u=>[u.heading,u.brain]));
    for(let i=0;i<3;i++){
      stepSimulation(a);stepSimulation(b);
      assert.deepEqual(b.units,a.units);assert.deepEqual(b.scores,a.scores);assert.equal(b.rng,a.rng);
    }
  }
});

test('invalid heading, incompatible model/controller and malformed motor state are rejected',()=>{
  const valid=JSON.parse(exportScene(contact()));
  for(const change of [
    x=>x.state.units[0].heading=8,
    x=>delete x.state.units[0].heading,
    x=>x.state.config.controllerA='utility',
    x=>x.state.units[0].brain=createBrain(),
    x=>x.state.units[0].brain.targets=[0],
    x=>x.state.units[0].brain.activity[0]=1.5,
    x=>x.state.units[0].brain.activity.pop(),
    x=>x.state.units[0].brain.outputs[0]=.1,
    x=>x.state.units[0].brain.steps=8,
    x=>{x.version=4;x.state.config.controllerA='utility';}
  ]){const raw=structuredClone(valid);change(raw);assert.throws(()=>importScene(JSON.stringify(raw)));}
});

test('v4 scenes retain legacy model and state with default facing and an explicit migration note',()=>{
  const a=contact('malecns');stepSimulation(a);const raw=JSON.parse(exportScene(a));raw.version=4;raw.state.version=4;
  for(const u of raw.state.units)delete u.heading;
  const b=importScene(JSON.stringify(raw));
  assert.equal(b.version,5);assert.ok(b.importNote.includes('v4'));assert.ok(b.importNote.includes('v5'));
  assert.deepEqual(b.units.map(u=>[u.x,u.y,u.hp,u.brain,u.reflex]),a.units.map(u=>[u.x,u.y,u.hp,u.brain,u.reflex]));
  assert.deepEqual(b.units.map(u=>u.heading),[2,6]);
});

test('causal motor comparison is deterministic and disconnected actors do not borrow utility actions',()=>{
  const a=runMotorComparison(),b=runMotorComparison();assert.deepEqual(a,b);
  assert.ok(a[0].motorCommands>0);assert.equal(a[1].motorCommands,0);
  assert.ok(a[1].timeline.every(t=>t.action==='hold'||t.action==='dead'));
  assert.ok(a[2].timeline.some(t=>t.action==='attack'));
  assert.equal(a[1].maxDrive,0);
});

test('ordinary retreat keeps equally safe current cover but can move into better cover',()=>{
  const s=contact('utility'),[u,e]=s.units;e.hp=0;s.objectives=[];s.map.fill(0);u.hp=1;u.x=9;u.y=11;
  s.map[11*W+9]=2;s.map[12*W+9]=2;
  const stay=decideUnit(s,u);assert.equal(stay.type,'hold');assert.equal(stay.route.length,0);
  u.x=10;const move=decideUnit(s,u);assert.equal(move.type,'retreat');assert.deepEqual(move.route[0],{x:9,y:11});
});

test('reported contact-scene cover loop no longer oscillates after the neural reflex ends',()=>{
  const s=contact('malecns'),positions=[];
  while(s.tick<30&&!s.finished){
    stepSimulation(s);if(s.tick>=5)positions.push(s.units[0].x+','+s.units[0].y);
  }
  assert.ok(positions.length>=6);assert.equal(new Set(positions).size,1);
});

test('ten neural agents stay legal through movement, turning and contact; full scenes fit the import limit',()=>{
  const s=createSimulation({seed:'neural-battle-01',controllerA:'neural',controllerB:'neural'});
  for(let tick=0;tick<20&&!s.finished;tick++){
    stepSimulation(s,(d,u,board)=>{
      assert.equal(d.source,'motor');
      if(d.type==='attack'){
        const enemy=board.units.find(v=>v.id===d.target);
        assert.ok(enemy&&enemy.hp>0&&enemy.team!==u.team);
        assert.ok(Math.abs(motorBearing(u,enemy))<=Math.PI/4+1e-9);
      }
    });
    const live=s.units.filter(u=>u.hp>0);
    assert.equal(new Set(live.map(u=>u.x+','+u.y)).size,live.length);
    for(const u of live){
      assert.ok(u.x>=0&&u.x<32&&u.y>=0&&u.y<22);assert.notEqual(s.map[u.y*W+u.x],1);
      assert.ok(Number.isInteger(u.heading)&&u.heading>=0&&u.heading<8);
      assert.ok(u.brain.activity.every(v=>Number.isFinite(v)&&v>=0&&v<=1));
    }
  }
  const snapshot=exportScene(s);assert.ok(Buffer.byteLength(snapshot)<8_000_000);
  const restored=importScene(snapshot);
  assert.deepEqual(restored.units.map(u=>[u.heading,u.brain]),s.units.map(u=>[u.heading,u.brain]));
});
