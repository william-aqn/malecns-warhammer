import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation,stepSimulation,decideUnit,planReflexRetreat,threatAt,exportScene,importScene,VERSION,W,distance,tileAt} from '../dist/engine.mjs';
import {stepBrain,neuralReadout} from '../dist/neural.mjs';
import {stepReflex} from '../dist/reflex.mjs';
import {contactConfig} from '../dist/experiments.mjs';

function prime(u){
  stepBrain(u.brain,[1,1],'malecns',32);
  stepReflex(u.reflex,neuralReadout(u.brain,{caution:1,aggression:.4,reactivity:.5},'malecns'));
}
function crossingThreats(blockDown=false){
  const s=createSimulation({factionA:'marines',factionB:'marines'});s.map.fill(0);
  for(const u of s.units)u.hp=0;
  const place=(index,x,y)=>{const u=s.units[index];u.hp=u.maxHp;u.x=x;u.y=y;return u;};
  const u=place(0,10,10),a=place(5,10,13),b=place(6,14,10);
  a.range=4;a.damage=10;b.range=3;b.damage=7;
  place(1,9,10);place(2,10,9);if(blockDown)place(3,10,11);
  return {s,u};
}
function ordinaryChoice(s,u){
  const copy=structuredClone(s);copy.config[u.team?'controllerB':'controllerA']='utility';
  return decideUnit(copy,copy.units.find(v=>v.id===u.id));
}
function assertComparison(d,baseline){
  assert.equal(d.counterfactual.label,baseline.label);
  assert.equal(d.counterfactual.type,baseline.type);
  assert.equal(d.counterfactual.score,baseline.score);
  assert.equal(d.counterfactual.target,baseline.target??null);
  assert.deepEqual(d.counterfactual.firstStep,baseline.route?.[0]??null);
}

test('threat estimate applies cover to ranged fire but not adjacent attacks',()=>{
  const s=createSimulation(contactConfig()),[u,e]=s.units;s.map.fill(0);
  e.x=u.x+1;e.y=u.y;s.map[u.y*W+u.x]=2;
  assert.equal(threatAt(s,u,u.team),e.damage);
  e.x=u.x+2;assert.equal(threatAt(s,u,u.team),e.damage*.6);
  s.map[u.y*W+u.x+1]=1;assert.equal(threatAt(s,u,u.team),0);
});

test('a safer endpoint cannot justify a dangerous first step',()=>{
  const {s,u}=crossingThreats(true);
  assert.equal(threatAt(s,u,0),10);
  assert.equal(threatAt(s,{x:11,y:10},0),17);
  assert.equal(threatAt(s,{x:12,y:10},0),7);
  const before=JSON.stringify(s);
  assert.equal(planReflexRetreat(s,u,'L',2),null);
  assert.equal(JSON.stringify(s),before);
});

test('short search finds the safe alternative route to the same endpoint',()=>{
  const {s,u}=crossingThreats();s.map[11*W+11]=2;
  const plan=planReflexRetreat(s,u,'L',2);
  assert.deepEqual(plan.route,[{x:10,y:11},{x:11,y:11}]);
  assert.deepEqual(plan.safety,{currentRisk:10,firstRisk:10,destinationRisk:6,maxRisk:10,steps:2,budget:2});
  assert.equal(planReflexRetreat(s,u,'L',1),null);
  assert.equal(planReflexRetreat(s,u,'L',0),null);
  s.units[3].hp=s.units[3].maxHp;s.units[3].x=11;s.units[3].y=11;
  assert.equal(planReflexRetreat(s,u,'L',2),null);
  s.units[3].hp=0;s.map[11*W+11]=1;
  // A new wall also blocks fire, so a different escape can become available.
  const aroundWall=planReflexRetreat(s,u,'L',2);assert.ok(aroundWall);
  assert.ok(aroundWall.route.every(p=>tileAt(s,p.x,p.y)!==1));
});

test('uniform danger leaves tactical control intact despite an active neural signal',()=>{
  const s=createSimulation(contactConfig()),[u,e]=s.units;s.map.fill(0);e.range=100;prime(u);
  const before=JSON.stringify(s),d=decideUnit(s,u);
  assert.equal(d.neural.active,true);assert.equal(d.neuralOverride,undefined);
  assert.equal(d.type,'attack');assert.equal(d.counterfactual.changed,false);
  assert.ok(d.neural.blockedReason);assertComparison(d,ordinaryChoice(s,u));
  assert.equal(JSON.stringify(s),before);
});

test('counterfactual matches utility on the same board and inspection is read-only',()=>{
  const s=createSimulation(contactConfig()),u=s.units[0];prime(u);
  const before=JSON.stringify(s),d=decideUnit(s,u);
  assert.equal(d.neuralOverride,true);assert.equal(d.counterfactual.type,'attack');
  assert.equal(d.counterfactual.changed,true);assertComparison(d,ordinaryChoice(s,u));
  assert.deepEqual(d.origin,{x:u.x,y:u.y});assert.equal(JSON.stringify(s),before);
});

test('an override with the same physical first step is not counted as a changed action',()=>{
  const s=createSimulation(contactConfig()),u=s.units[0];u.hp=1;prime(u);
  const d=decideUnit(s,u),baseline=ordinaryChoice(s,u);
  assert.equal(d.neuralOverride,true);assert.equal(baseline.type,'retreat');
  assert.deepEqual(d.route[0],baseline.route[0]);assert.equal(d.counterfactual.changed,false);
  assertComparison(d,baseline);
});

test('the last activation cannot plan a two-step escape',()=>{
  const s=createSimulation(contactConfig()),u=s.units[0];prime(u);
  const first=decideUnit(s,u);assert.equal(first.routeSafety.steps,2);assert.equal(first.routeSafety.budget,2);
  stepReflex(u.reflex,neuralReadout(u.brain,{caution:1,aggression:.4,reactivity:.5},'malecns'));
  const last=decideUnit(s,u);assert.equal(last.neural.active,true);assert.equal(u.reflex.remaining,0);
  assert.equal(last.neuralOverride,undefined);assert.equal(last.counterfactual.changed,false);
});

test('every observed neural route is legal, non-increasing in risk and within its remaining burst',()=>{
  let escapes=0,changes=0;
  for(const seed of ['40721','104','route-qa']){
    const s=createSimulation({seed});let observedEscapes=0;
    while(!s.finished)stepSimulation(s,(d,u,board)=>{
      assert.ok(d.counterfactual);
      if(!d.neuralOverride){assert.equal(d.counterfactual.changed,false);return;}
      observedEscapes++;escapes++;if(d.counterfactual.changed)changes++;
      assertComparison(d,ordinaryChoice(board,u));
      assert.ok(d.route.length>0&&d.route.length<=u.reflex.remaining+1&&d.route.length<=2);
      assert.equal(d.routeSafety.currentRisk,threatAt(board,u,u.team));
      let previous=u,previousRisk=d.routeSafety.currentRisk;
      for(const p of d.route){
        assert.equal(distance(previous,p),1);assert.notEqual(tileAt(board,p.x,p.y),1);
        assert.ok(!board.units.some(v=>v.hp>0&&v.id!==u.id&&v.x===p.x&&v.y===p.y));
        const risk=threatAt(board,p,u.team);assert.ok(risk<=previousRisk+1e-9);
        previous=p;previousRisk=risk;
      }
      assert.ok(previousRisk<d.routeSafety.currentRisk-1e-9);
      assert.equal(d.routeSafety.firstRisk,threatAt(board,d.route[0],u.team));
      assert.equal(d.routeSafety.destinationRisk,previousRisk);
    });
    assert.equal(observedEscapes,s.units.reduce((sum,u)=>sum+u.neuralEscapes,0));
  }
  assert.ok(escapes>0);assert.ok(changes>0);
});

test('read-only decision observation leaves each full simulated state unchanged',()=>{
  const a=createSimulation(contactConfig()),b=createSimulation(contactConfig());const observed=new Set();
  while(!a.finished){
    stepSimulation(a,(d,u)=>observed.add(u.id));stepSimulation(b);
    assert.deepEqual(a,b);
  }
  assert.deepEqual([...observed].sort(),['A-01','B-01']);
});

test('v3 contact saves preserve the brain and reflex while explicitly migrating decision rules',()=>{
  for(const count of [1,2,3,7]){
    const a=createSimulation(contactConfig());for(let i=0;i<count&&!a.finished;i++)stepSimulation(a);
    const raw=JSON.parse(exportScene(a));raw.version=3;raw.state.version=3;
    const b=importScene(JSON.stringify(raw));
    assert.equal(b.version,VERSION);assert.equal(b.config.scenario,'contact');assert.equal(b.units.length,2);
    assert.ok(b.importNote.includes('v3'));assert.ok(b.importNote.includes('v'+VERSION));
    assert.deepEqual(b.units.map(u=>u.brain),a.units.map(u=>u.brain));
    assert.deepEqual(b.units.map(u=>u.reflex),a.units.map(u=>u.reflex));
    assert.deepEqual(b.units.map(u=>[u.x,u.y,u.hp]),a.units.map(u=>[u.x,u.y,u.hp]));
    raw.state.units[0].reflex.contract='invalid';
    assert.throws(()=>importScene(JSON.stringify(raw)));
  }
});
