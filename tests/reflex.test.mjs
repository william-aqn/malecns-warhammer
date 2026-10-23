import test from 'node:test';
import assert from 'node:assert/strict';
import {createReflex,stepReflex,validateReflex,REFLEX_COOLDOWN,REFLEX_BURST} from '../dist/reflex.mjs';
import {createSimulation,stepSimulation,exportScene,importScene,decideUnit,updateDecisions,VERSION} from '../dist/engine.mjs';
import {createBrain,stepBrain,neuralReadout} from '../dist/neural.mjs';
import {runContactComparison,contactConfig} from '../dist/experiments.mjs';
const signal=drive=>({drive,threshold:.1,triggered:drive>.1});
test('continuous threat produces one bounded burst, then restores tactical control',()=>{
  const r=createReflex(),active=[];
  for(let i=0;i<30;i++){stepReflex(r,signal(.2));active.push(r.active);assert.ok(validateReflex(r,i+1));}
  assert.deepEqual(active.slice(0,2),[true,true]);assert.ok(active.slice(2).every(v=>!v));
  assert.equal(r.episodes,1);assert.equal(r.phase,'waiting');
});
test('cooldown lasts five activations; rearming requires a quiet signal',()=>{
  const r=createReflex();for(let i=0;i<REFLEX_BURST;i++)stepReflex(r,signal(.2));
  for(let i=0;i<REFLEX_COOLDOWN;i++){stepReflex(r,signal(.2));assert.equal(r.active,false);}
  assert.equal(r.phase,'waiting');
  stepReflex(r,signal(.08));assert.equal(r.phase,'waiting'); // below onset, above release
  stepReflex(r,signal(.04));assert.equal(r.phase,'ready');assert.equal(r.active,false);
  stepReflex(r,signal(.2));assert.equal(r.active,true);assert.equal(r.episodes,2);
});
test('falling stimulus can end a burst early; disabled control releases the gate',()=>{
  const r=createReflex();stepReflex(r,signal(.2));stepReflex(r,signal(0));
  assert.equal(r.active,false);assert.equal(r.phase,'cooldown');
  stepReflex(r,signal(.2),false);assert.equal(r.active,false);assert.equal(r.phase,'ready');
});
test('sensitivity changes only the decoder; zero gain leaves neural dynamics active',()=>{
  const b=createBrain();stepBrain(b,[1,0],'malecns',16);const before=JSON.stringify(b);
  const off=neuralReadout(b,{caution:1,aggression:.4,reactivity:0},'malecns');
  const normal=neuralReadout(b,{caution:1,aggression:.4,reactivity:.5},'malecns');
  const strong=neuralReadout(b,{caution:1,aggression:.4,reactivity:1},'malecns');
  assert.equal(off.drive,0);assert.equal(off.triggered,false);assert.ok(off.rawDrive>.1);
  assert.equal(strong.drive,normal.drive*2);assert.equal(JSON.stringify(b),before);
});
test('contact experiment is deterministic and exposes a causal intervention',()=>{
  const a=runContactComparison(),b=runContactComparison();assert.deepEqual(a,b);
  assert.equal(a[0].firstType,'retreat');assert.equal(a[1].firstType,'attack');assert.equal(a[2].firstType,'attack');
  assert.ok(a[0].neuralEscapes>0);assert.equal(a[1].maxDrive,0);
  assert.deepEqual(a[1].timeline.map(t=>[t.action,t.x,t.y,t.hp]),a[2].timeline.map(t=>[t.action,t.x,t.y,t.hp]));
  const zero=runContactComparison(0);assert.equal(zero[0].firstType,'attack');assert.equal(zero[0].neuralEscapes,0);assert.ok(zero[0].maxDrive>0);
});
test('contact scene has two valid units; all controller combinations can save and resume',()=>{
  for(const mode of ['malecns','disconnected','utility']){
    const a=createSimulation(contactConfig(mode));assert.deepEqual(a.units.map(u=>u.id),['A-01','B-01']);
    for(let tick=0;tick<10&&!a.finished;tick++){
      const b=importScene(exportScene(a));stepSimulation(a);stepSimulation(b);
      assert.deepEqual(a.units,b.units);assert.deepEqual(a.scores,b.scores);assert.equal(a.rng,b.rng);
    }
  }
});
test('each gate phase survives import and read-only decisions without advancing',()=>{
  for(const calls of [0,1,2,3,7]){
    const s=createSimulation();s.tick=calls;for(let i=0;i<calls;i++)stepReflex(s.units[0].reflex,signal(.2));
    const b=importScene(exportScene(s));assert.deepEqual(b.units[0].reflex,s.units[0].reflex);
    const before=JSON.stringify(b.units[0].reflex);updateDecisions(b);decideUnit(b,b.units[0]);assert.equal(JSON.stringify(b.units[0].reflex),before);
  }
});
test('malformed reflex contracts, phases, remaining counts and episode counts are rejected',()=>{
  for(const change of [
    r=>r.contract='unknown',r=>r.phase='attack',r=>r.remaining=999,r=>r.episodes=-1,r=>r.active=true,
    r=>{r.phase='responding';r.active=true;r.remaining=0;}
  ]){const raw=JSON.parse(exportScene(createSimulation()));change(raw.state.units[0].reflex);assert.throws(()=>importScene(JSON.stringify(raw)));}
});
test('v2 migration retains brain activity and explicitly reports changed controller rules',()=>{
  const a=createSimulation();for(let i=0;i<10;i++)stepSimulation(a);
  const raw=JSON.parse(exportScene(a));raw.version=2;raw.state.version=2;delete raw.state.config.scenario;
  for(const u of raw.state.units)delete u.reflex;
  const b=importScene(JSON.stringify(raw));assert.equal(b.version,VERSION);assert.ok(b.importNote.includes('v2'));
  assert.deepEqual(b.units.map(u=>u.brain),a.units.map(u=>u.brain));assert.ok(b.units.every(u=>u.reflex.phase==='ready'));
});

test('eliminated units have no stale action before or after a save/load',()=>{
  const s=createSimulation({...contactConfig('utility'),seed:'kill-display'});
  for(const u of s.units)u.overrides={aggression:1,caution:0,objective:0};
  for(let i=0;i<20&&!s.finished;i++)stepSimulation(s);
  assert.ok(s.units.some(u=>u.hp===0));
  for(const u of s.units.filter(u=>u.hp===0))assert.equal(u.decision,null);
  const restored=importScene(exportScene(s));
  assert.deepEqual(restored.units.filter(u=>u.hp===0).map(u=>u.decision),s.units.filter(u=>u.hp===0).map(u=>u.decision));
});
