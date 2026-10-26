import test from 'node:test';
import assert from 'node:assert/strict';
import {createExperience,experienceReadout,experienceChoice,visitExperience,addExperienceReward,beginExperience,settleExperience,setExperienceLearning,EXPERIENCE_COMMANDS} from '../dist/experience.mjs';
import {motorReadout} from '../dist/motor.mjs';
import {createBrain,stepBrain} from '../dist/neural.mjs';
import {createSimulation,stepSimulation,observeMotor,decideUnit,updateDecisions,exportScene,importScene,repeatWithExperience,W,H,VERSION} from '../dist/engine.mjs';
function field(mode='adaptive'){
  const s=createSimulation({scenario:'contact',seed:'experience-test',controllerA:mode,controllerB:'adaptive-disconnected'});
  s.map.fill(0);s.units[1].x=28;s.units[1].y=20;return s;
}
function visual(){
  const b=createBrain('adaptive');stepBrain(b,[0,0,.5,.5],'adaptive',32);return motorReadout(b);
}
function record(e,motor,command){
  const head=experienceReadout(e,motor);beginExperience(e,{command,learning:head});return head;
}
test('visit memory counts entries, remains personal, and is not updated by inspection',()=>{
  const s=field(),[a,b]=s.units;
  assert.equal(visitExperience(a.experience,1),true);assert.equal(visitExperience(a.experience,1),false);
  visitExperience(a.experience,2);assert.equal(visitExperience(a.experience,1),false);
  assert.equal(a.experience.visits[1],2);assert.ok(b.experience.visits.every(v=>v===0));
  const before=JSON.stringify(s),rng=s.rng;
  for(let i=0;i<4;i++){observeMotor(s,a);decideUnit(s,a);}
  assert.equal(JSON.stringify(s),before);assert.equal(s.rng,rng);
});
test('remembered landmarks survive occlusion, while unknown landmarks and hidden enemies do not',()=>{
  const s=field(),u=s.units[0];u.overrides={aggression:1,caution:1,objective:1};
  s.objectives=[{id:'I',x:14,y:10,owner:null}];s.map[10*W+11]=1;
  const unknown=observeMotor(s,u);u.experience.known=['I'];const recalled=observeMotor(s,u);
  assert.ok(recalled[2]+recalled[3]>unknown[2]+unknown[3]);
  u.experience.useMemory=false;assert.deepEqual(observeMotor(s,u),unknown);
  s.units[1].x=14;s.units[1].y=10;assert.deepEqual(observeMotor(s,u),unknown);
});
test('experience changes scores in opposite directions under positive and negative feedback',()=>{
  const motor=visual(),positive=createExperience(W*H),negative=createExperience(W*H);
  for(let t=1;t<=60;t++)for(const [e,reward] of [[positive,.5],[negative,-.5]]){
    const head=record(e,motor,'wait');addExperienceReward(e,'hold',reward);
    settleExperience(e,head.scores.wait,t);
  }
  const pos=experienceReadout(positive,motor),neg=experienceReadout(negative,motor);
  assert.ok(pos.scores.wait>Math.max(...EXPERIENCE_COMMANDS.filter(c=>c!=='wait').map(c=>pos.scores[c])));
  assert.ok(neg.scores.wait<motor.scores.wait);assert.equal(positive.updates,60);
  assert.deepEqual(motor,visual(),'training must not modify MaleCNS dynamics or calibration');
});
test('later reward credits an earlier action through eligibility without hard-coded action labels',()=>{
  const e=createExperience(W*H),motor=visual();record(e,motor,'left');
  settleExperience(e,0,1);const before=[...e.weights[2]];
  record(e,motor,'wait');addExperienceReward(e,'capture',1);settleExperience(e,0,2,true);
  assert.ok(e.weights[2].some((v,i)=>v>before[i]));assert.ok(e.eligibility.flat().every(v=>v===0));
});
test('freezing stops coefficient updates and exploratory choices, preserving learned values',()=>{
  const e=createExperience(W*H),motor=visual();record(e,motor,'wait');addExperienceReward(e,'hold',1);settleExperience(e,0,1,true);
  setExperienceLearning(e,false);const weights=structuredClone(e.weights),updates=e.updates;
  const head=record(e,motor,'wait');addExperienceReward(e,'hurt',-1);settleExperience(e,0,2,true);
  assert.deepEqual(e.weights,weights);assert.equal(e.updates,updates);assert.equal(e.lastReward,-1);
  const commands=EXPERIENCE_COMMANDS.map(command=>({command,available:true,score:head.scores[command]})).sort((a,b)=>b.score-a.score);
  for(let i=0;i<100;i++)assert.equal(experienceChoice(e,head,commands,'seed:'+i).exploratory,false);
});
test('trained readout cannot move silent, disconnected or zero-sensitivity agents',()=>{
  for(const mode of ['adaptive','adaptive-disconnected']){
    const s=field(mode),u=s.units[0];u.experience.weights.forEach(r=>r.fill(3));
    if(mode==='adaptive')u.overrides.reactivity=0;
    const pos=[u.x,u.y,u.heading],weights=structuredClone(u.experience.weights);
    for(let i=0;i<8;i++){stepSimulation(s);assert.equal(u.decision.command,'wait');}
    assert.deepEqual([u.x,u.y,u.heading],pos);assert.deepEqual(u.experience.weights,weights);assert.equal(u.experience.updates,0);
  }
});
test('exploratory policy is reproducible and never chooses an illegal command',()=>{
  const e=createExperience(W*H),head=experienceReadout(e,visual());
  const commands=EXPERIENCE_COMMANDS.map(command=>({command,available:command==='left'||command==='wait',score:head.scores[command]})).sort((a,b)=>b.score-a.score);
  let explorations=0;
  for(let i=0;i<300;i++){
    const a=experienceChoice(e,head,commands,'probe:'+i),b=experienceChoice(e,head,commands,'probe:'+i);
    assert.deepEqual(a,b);assert.ok(['left','wait'].includes(a.chosen.command));explorations+=a.exploratory;
  }
  assert.ok(explorations>0&&explorations<60);
});
test('capture bonus cannot be farmed by repeatedly abandoning and reentering the same point',()=>{
  const s=field(),u=s.units[0];u.x=9;u.y=6;u.overrides={reactivity:0,objective:1,aggression:0,caution:0};
  for(let i=0;i<3;i++)stepSimulation(s);
  u.y=8;stepSimulation(s);u.y=6;stepSimulation(s);stepSimulation(s);
  const captures=u.experience.trace.filter(t=>t.parts.capture>0);
  assert.equal(captures.length,1);assert.ok(u.experience.trace.some(t=>t.parts.hold>0));
  assert.deepEqual(u.experience.captured,['I']);assert.equal(u.experience.updates,0);
});
test('actual combat credits inflicted damage and received damage and flushes death transitions',()=>{
  const s=field(),[u,e]=s.units;e.x=12;e.y=10;u.overrides={aggression:1,caution:0,objective:0};
  u.experience.weights[0].fill(2);u.experience.enabled=false;
  while(!s.finished&&s.tick<12)stepSimulation(s);
  assert.ok(u.damageDone>0);
  assert.ok(u.experience.trace.some(t=>t.parts.damage>0));
  assert.ok(e.experience.trace.some(t=>t.parts.hurt<0));
  if(e.hp===0){assert.equal(e.experience.pending,null);assert.ok(e.experience.trace.some(t=>t.parts.outcome<0));}
});
test('adaptive snapshots preserve weights, visits, traces, pending credit and exact future actions',()=>{
  const a=field();for(let i=0;i<8;i++)stepSimulation(a);
  assert.ok(a.units[0].experience.weights.flat().some(v=>v!==0));
  const text=exportScene(a);assert.ok(Buffer.byteLength(text)<8_000_000);const b=importScene(text);
  assert.deepEqual(a.units.map(u=>u.experience),b.units.map(u=>u.experience));
  for(let i=0;i<8&&!a.finished;i++){
    stepSimulation(a);stepSimulation(b);assert.deepEqual(a.units,b.units);assert.deepEqual(a.scores,b.scores);assert.equal(a.rng,b.rng);
  }
});
test('new battles carry coefficients but clear spatial and transition memory with no shared arrays',()=>{
  const a=field();a.units[0].overrides.objective=.8;for(let i=0;i<4;i++)stepSimulation(a);
  const b=repeatWithExperience(a);
  assert.deepEqual(b.units[0].overrides,a.units[0].overrides);
  for(let i=0;i<a.units.length;i++){
    assert.deepEqual(b.units[i].experience.weights,a.units[i].experience.weights);
    assert.notEqual(b.units[i].experience.weights[0],a.units[i].experience.weights[0]);
    assert.ok(b.units[i].experience.visits.every(v=>v===0));assert.deepEqual(b.units[i].experience.known,[]);
    assert.equal(b.units[i].experience.pending,null);assert.equal(b.units[i].experience.episodes,1);
    assert.ok(b.units[i].brain.activity.every(v=>v===0));
  }
  const changed=repeatWithExperience(a,{...a.config,factionA:'orks'});
  assert.ok(changed.units[0].experience.weights.flat().every(v=>v===0));
  assert.equal(importScene(exportScene(b)).version,VERSION);
});
test('malformed experience cannot enter a scene',()=>{
  const a=field();stepSimulation(a);const base=JSON.parse(exportScene(a));
  for(const change of [
    e=>e.weights[0][0]=4,e=>e.weights.pop(),e=>e.eligibility[0][0]=4,
    e=>e.visits[0]=-1,e=>e.visits.fill(1),e=>e.lastCell=W*H,e=>e.known=['IV'],
    e=>e.captured=['I','I'],e=>e.pending.features[0]=2,e=>e.pending.command='teleport',
    e=>e.pending.parts.secret=1,e=>e.enabled='yes',e=>e.trace[0]={tick:999},
  ]){
    const raw=structuredClone(base);change(raw.state.units[0].experience);assert.throws(()=>importScene(JSON.stringify(raw)));
  }
  const missing=structuredClone(base);delete missing.state.units[0].experience;assert.throws(()=>importScene(JSON.stringify(missing)));
});
test('v7 migration retains the original graph and starts explicit empty experience',()=>{
  const a=createSimulation({controllerA:'neural',controllerB:'neural'});stepSimulation(a);
  const raw=JSON.parse(exportScene(a));raw.version=7;raw.state.version=7;for(const u of raw.state.units)delete u.experience;
  const b=importScene(JSON.stringify(raw));assert.ok(b.importNote.includes('v7'));
  assert.deepEqual(b.units.map(u=>u.brain),a.units.map(u=>u.brain));assert.ok(b.units.every(u=>u.experience.visits.every(v=>v===0)));
  raw.state.config.controllerA='adaptive';assert.throws(()=>importScene(JSON.stringify(raw)));
});
test('personal spatial memory breaks a late perimeter orbit with learning and exploration frozen',()=>{
  const results=[];
  for(const useMemory of [false,true]){
    const s=field(),[u,e]=s.units;s.objectives=[];u.x=0;u.y=10;u.heading=0;u.range=0;
    u.overrides={aggression:0,caution:0,objective:0};e.x=16;e.y=11;
    u.experience.enabled=false;u.experience.useMemory=useMemory;
    let inside=0,lateEdge=0;
    while(!s.finished){stepSimulation(s);inside+=u.x>3&&u.x<28&&u.y>3&&u.y<18;
      if(s.tick>100)lateEdge+=u.x<=1||u.x>=30||u.y<=1||u.y>=20;}
    results.push({inside,lateEdge});assert.equal(u.experience.updates,0);
  }
  assert.equal(results[0].inside,0);assert.equal(results[0].lateEdge,80);
  assert.ok(results[1].inside>=10);assert.ok(results[1].lateEdge<70);
});

