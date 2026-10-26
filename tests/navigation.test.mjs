import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation,stepSimulation,observeMotor,decideUnit,exportScene,importScene,VERSION,W} from '../dist/engine.mjs';
import {createBrain,stepBrain} from '../dist/neural.mjs';
function fixture(mode='neural'){
  const s=createSimulation({scenario:'contact',controllerA:mode,controllerB:'neural-disconnected'});
  s.map.fill(0);s.objectives=[];
  s.units[0].overrides={aggression:0,caution:0,objective:0};
  s.units[1].x=28;s.units[1].y=20;return s;
}
test('side and rear static walls do not act as frontal threats; an approaching wall does',()=>{
  const s=fixture(),u=s.units[0];s.map[u.y*W+u.x+1]=1;
  assert.ok(observeMotor(s,u)[0]>.8);
  for(const heading of [0,4,6]){
    u.heading=heading;assert.ok(observeMotor(s,u).slice(0,2).every(v=>v<1e-12));
  }
});
test('free-space sensing is local, occluded, bounded and does not mutate state or read assignments',()=>{
  const s=fixture(),u=s.units[0];u.heading=0;
  const original=JSON.stringify(s),open=observeMotor(s,u);
  assert.equal(JSON.stringify(s),original);
  s.map[(u.y-1)*W+u.x]=1;const blocked=observeMotor(s,u);
  s.map[(u.y-4)*W+u.x]=1;assert.deepEqual(observeMotor(s,u),blocked);
  assert.ok(blocked[2]+blocked[3]<open[2]+open[3]);
  Object.defineProperty(u,'assignment',{get(){throw Error('Assignment read');}});
  assert.ok(observeMotor(s,u).every(v=>Number.isFinite(v)&&v>=0&&v<=1));
});
test('real network leaves a wall, corner and board edge without a route planner',()=>{
  for(const kind of ['wall','corner','boundary']){
    const s=fixture(),u=s.units[0];
    if(kind==='boundary'){u.x=1;u.heading=6;}
    else for(let y=7;y<=13;y++)s.map[y*W+12]=1;
    if(kind==='corner')for(let x=8;x<=12;x++)s.map[7*W+x]=1;
    const cells=new Set([u.x+','+u.y]),tail=[];let still=0,maxStill=0,last=[u.x,u.y];
    for(let t=0;t<32;t++){
      stepSimulation(s,(d,actor)=>{if(actor===u){assert.equal(d.source,'motor');assert.ok(d.route.length<=1);}});
      const pos=u.x+','+u.y;cells.add(pos);tail.push(pos);
      still=u.x===last[0]&&u.y===last[1]?still+1:0;maxStill=Math.max(maxStill,still);last=[u.x,u.y];
      assert.notEqual(s.map[u.y*W+u.x],1);
    }
    assert.ok(cells.size>=12,kind+' must explore beyond the starting cells');
    assert.ok(new Set(tail.slice(-12)).size>=6,kind+' must not end in a two-cell loop');
    assert.ok(maxStill<=5,kind+' must not rotate indefinitely');
  }
});
test('passage cues cannot move disconnected or zero-sensitivity actors',()=>{
  for(const mode of ['neural-disconnected','neural']){
    const s=fixture(mode),u=s.units[0];if(mode==='neural')u.overrides.reactivity=0;
    s.map[u.y*W+u.x+1]=1;const before=[u.x,u.y,u.heading];
    for(let t=0;t<12;t++){stepSimulation(s);assert.equal(u.decision.command,'wait');}
    assert.deepEqual([u.x,u.y,u.heading],before);assert.ok(u.brain.activity.some(v=>v>0));
  }
});
test('opponent motor mapping retains retreat under bilateral threat but permits a turn with free-space input',()=>{
  const s=fixture(),u=s.units[0];s.map[u.y*W+u.x+1]=1;
  u.brain=createBrain('neural');stepBrain(u.brain,[.5,.5,0,0],'neural',32);
  assert.equal(decideUnit(s,u).command,'reverse');
  u.brain=createBrain('neural');stepBrain(u.brain,[.5,.5,.4,.4],'neural',32);
  assert.equal(decideUnit(s,u).type,'turn');
});
test('reported seed 40721 no longer strands the entire blue deployment at its first wall',()=>{
  const s=createSimulation({seed:'40721',controllerA:'neural',controllerB:'neural'});
  const cells=new Map(s.units.map(u=>[u.id,new Set([u.x+','+u.y])]));
  for(let t=0;t<32;t++)stepSimulation(s,(d,u)=>{
    assert.equal(d.source,'motor');cells.get(u.id).add(u.x+','+u.y);
    if(d.route[0])cells.get(u.id).add(d.route[0].x+','+d.route[0].y);
  });
  for(const u of s.units.filter(u=>u.team===0))assert.ok(cells.get(u.id).size>=8,u.id+' remains stuck');
});
test('v6 snapshots migrate explicitly; current saves resume the same navigation',()=>{
  const a=createSimulation({scenario:'contact',controllerA:'neural',controllerB:'neural-disconnected'});stepSimulation(a);const raw=JSON.parse(exportScene(a));
  raw.version=6;raw.state.version=6;const b=importScene(JSON.stringify(raw));
  assert.equal(b.version,VERSION);assert.ok(b.importNote.includes('v6'));assert.ok(b.importNote.includes('v'+VERSION));
  assert.deepEqual(a.units.map(u=>u.brain),b.units.map(u=>u.brain));
  for(let i=0;i<3;i++){stepSimulation(a);stepSimulation(b);assert.deepEqual(a.units,b.units);assert.equal(a.rng,b.rng);}
});
