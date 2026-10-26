import test from 'node:test';
import assert from 'node:assert/strict';
import {MOTOR_MODEL,motorReadout,MOTOR_DECODER} from '../dist/motor.mjs';
import {stepBrain} from '../dist/neural.mjs';
import {createSimulation,stepSimulation,decideUnit,selectMotorTarget,exportScene,importScene,VERSION,W} from '../dist/engine.mjs';
import {aimConfig,runAimComparison} from '../dist/experiments.mjs';

const probeScene=()=>{
  const s=createSimulation(aimConfig());s.units[1].x=12;s.units[1].y=9;s.units[2].x=14;s.units[2].y=12;return s;
};
test('real visual inputs change the attacked enemy on an identical board, including a farther target',()=>{
  const [left,right,cut,quiet]=runAimComparison();
  assert.equal(left.action,'attack');assert.equal(right.action,'attack');
  assert.equal(left.target,'B-01');assert.equal(right.target,'B-02');
  assert.ok(left.angle<0&&right.angle>0);
  assert.ok(right.candidates.find(c=>c.id===right.target).distance>right.candidates.find(c=>c.id==='B-01').distance);
  assert.equal(cut.command,'wait');assert.equal(cut.target,null);assert.equal(cut.angle,null);
  assert.equal(quiet.command,'wait');assert.equal(quiet.target,null);
  assert.equal(cut.steps,left.steps);
});

test('forward remains movement when aim outputs are silenced despite a legal enemy in front',()=>{
  const s=createSimulation(aimConfig()),u=s.units[0];stepBrain(u.brain,[0,0,.5,.5],'neural',32);
  const before=decideUnit(s,u);assert.equal(before.command,'fire');assert.equal(before.target,'B-02');
  for(const side of ['L','R'])for(const i of MOTOR_MODEL.outputs['DNa01'+side])u.brain.activity[i]=0;
  const after=decideUnit(s,u);
  assert.equal(after.command,'advance');assert.equal(after.type,'move');
  assert.deepEqual(after.route,[{x:11,y:10}]);assert.equal(after.target,undefined);
  assert.equal(after.aim.angle,null);assert.equal(after.alternatives.find(c=>c.command==='fire').available,false);
  assert.equal(after.motor.scores.advance,before.motor.scores.advance);
});

test('aim selection does not score target health, cover, damage or distance within weapon range',()=>{
  const s=probeScene(),u=s.units[0];stepBrain(u.brain,[0,0,.4,.6],'neural',32);
  const first=selectMotorTarget(s,u);assert.equal(first.target,'B-02');
  s.units[1].hp=1;s.units[1].damage=999;
  s.map[s.units[2].y*W+s.units[2].x]=2;
  assert.equal(selectMotorTarget(s,u).target,'B-02');
  s.units[2].x=12;s.units[2].y=11;
  assert.equal(selectMotorTarget(s,u).target,'B-02');
});

test('target masks exclude walls, rear sectors, range and dead units; no target disables fire only',()=>{
  const s=probeScene(),u=s.units[0];stepBrain(u.brain,[0,0,.4,.6],'neural',32);
  assert.equal(decideUnit(s,u).target,'B-02');
  s.map[11*W+12]=1;
  assert.equal(selectMotorTarget(s,u).target,'B-01');
  s.map[11*W+12]=0;s.units[2].hp=0;assert.equal(selectMotorTarget(s,u).target,'B-01');
  s.units[1].x=8;s.units[1].y=10;
  let d=decideUnit(s,u);assert.equal(d.aim.target,null);assert.notEqual(d.command,'fire');
  assert.equal(d.alternatives.find(c=>c.command==='advance').available,true);
  s.units[1].x=17;assert.equal(selectMotorTarget(s,u).target,null);
});

test('collinear ties use stable IDs and do not restore a nearest-enemy fallback',()=>{
  const s=probeScene(),u=s.units[0];stepBrain(u.brain,[0,0,.5,.5],'neural',32);
  s.units[1].x=15;s.units[1].y=10;s.units[2].x=12;s.units[2].y=10;
  assert.equal(selectMotorTarget(s,u).target,'B-01');
  s.units.reverse();assert.equal(selectMotorTarget(s,u).target,'B-01');
});

test('aim inspection is read-only and neuron sensitivity zero disables attack',()=>{
  const s=probeScene(),u=s.units[0];stepBrain(u.brain,[0,0,.4,.6],'neural',32);
  const before=JSON.stringify(s);for(let i=0;i<5;i++){selectMotorTarget(s,u);decideUnit(s,u);}
  assert.equal(JSON.stringify(s),before);
  u.overrides.reactivity=0;const d=decideUnit(s,u);
  assert.equal(d.command,'wait');assert.equal(d.aim.angle,null);assert.ok(u.brain.activity.some(v=>v>0));
  assert.equal(motorReadout(u.brain).decoder,MOTOR_DECODER);
});

test('1v2 aim scenario keeps isolated target brains and resumes exactly from v6 snapshots',()=>{
  const a=createSimulation(aimConfig());
  assert.deepEqual(a.units.map(u=>u.id),['A-01','B-01','B-02']);
  assert.notEqual(a.units[1].brain.activity,a.units[2].brain.activity);
  const positions=a.units.slice(1).map(u=>[u.x,u.y,u.heading]);
  let attacks=0;
  for(let i=0;i<12&&!a.finished;i++){
    const b=importScene(exportScene(a));
    stepSimulation(a,(d,u)=>{if(u.team===0&&d.command==='fire')attacks++;});stepSimulation(b);
    assert.deepEqual(a.units,b.units);assert.equal(a.rng,b.rng);assert.deepEqual(a.scores,b.scores);
    assert.deepEqual(a.units.slice(1).map(u=>[u.x,u.y,u.heading]),positions);
  }
  assert.ok(attacks>0);
});

test('asymmetric team imports validate roster sizes, IDs and opposing-team kill limits',()=>{
  const base=JSON.parse(exportScene(createSimulation(aimConfig())));
  for(const corrupt of [
    x=>x.state.units.pop(),
    x=>x.state.units[1].id='B-02',
    x=>x.state.units[0].kills=3,
    x=>x.state.units[1].kills=2,
    x=>{x.version=5;x.state.version=5;}
  ]){const raw=structuredClone(base);corrupt(raw);assert.throws(()=>importScene(JSON.stringify(raw)));}
  base.state.units[0].kills=2;assert.equal(importScene(JSON.stringify(base)).units[0].kills,2);
});

test('v5 neural scenes retain activity and heading with an explicit v6 decision-rule migration',()=>{
  const a=createSimulation({...aimConfig(),scenario:'contact'});stepSimulation(a);
  const raw=JSON.parse(exportScene(a));raw.version=5;raw.state.version=5;
  const b=importScene(JSON.stringify(raw));
  assert.equal(b.version,VERSION);assert.ok(b.importNote.includes('v5'));assert.ok(b.importNote.includes('v6'));
  assert.deepEqual(b.units.map(u=>[u.x,u.y,u.hp,u.heading,u.brain]),a.units.map(u=>[u.x,u.y,u.hp,u.heading,u.brain]));
  stepSimulation(a);stepSimulation(b);assert.deepEqual(a.units,b.units);assert.equal(a.rng,b.rng);
});

test('causal aim probes are reproducible and zero gain never falls back to tactical fire',()=>{
  assert.deepEqual(runAimComparison(),runAimComparison());
  const zero=runAimComparison(0);assert.ok(zero.every(p=>p.command==='wait'&&p.target===null));
  assert.throws(()=>runAimComparison(-1));assert.throws(()=>runAimComparison(NaN));
});
