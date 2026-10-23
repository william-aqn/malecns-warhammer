import test from 'node:test';
import assert from 'node:assert/strict';
import {W,H,MAX_TICKS,FACTIONS,ROLES,createSimulation,makeMap,stepSimulation,aliveUnits,hasLineOfSight,decideUnit,updateObjectives,setTerrain,exportScene,importScene} from '../dist/engine.mjs';
const combat=s=>({tick:s.tick,rng:s.rng,units:s.units.map(({px,py,decision,...u})=>u),scores:s.scores,objectives:s.objectives,finished:s.finished,winner:s.winner});
test('same seed produces the same map and complete battle',()=>{
  const a=createSimulation({seed:'deterministic'}),b=createSimulation({seed:'deterministic'});
  for(let i=0;i<MAX_TICKS&&!a.finished;i++){stepSimulation(a);stepSimulation(b);}
  assert.deepEqual(a,b);assert.ok(a.finished);assert.notDeepEqual(makeMap('other').map,a.map);
});
test('all objectives and spawn zones remain connected across generated layouts',()=>{
  for(const kind of ['ruins','industrial','badlands'])for(let seed=0;seed<24;seed++){
    const s=createSimulation({seed,mapKind:kind,density:50}),queue=[s.units[0]],seen=new Set([s.units[0].y*W+s.units[0].x]);
    for(let i=0;i<queue.length;i++)for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){
      const x=queue[i].x+dx,y=queue[i].y+dy,k=y*W+x;if(x<0||y<0||x>=W||y>=H||s.map[k]===1||seen.has(k))continue;seen.add(k);queue.push({x,y});
    }
    assert.ok([...s.objectives,...s.units].every(p=>seen.has(p.y*W+p.x)));
  }
});
test('agents never overlap, enter walls, teleport or leave the map',()=>{
  for(const [a,b] of [['marines','orks'],['necrons','tyranids'],['orks','orks']]){
    const s=createSimulation({seed:'movement-'+a,factionA:a,factionB:b});
    for(let i=0;i<MAX_TICKS&&!s.finished;i++){
      const before=new Map(s.units.map(u=>[u.id,{x:u.x,y:u.y}]));stepSimulation(s);const occupied=new Set();
      for(const u of aliveUnits(s)){
        assert.ok(u.x>=0&&u.y>=0&&u.x<W&&u.y<H);assert.notEqual(s.map[u.y*W+u.x],1);
        const k=u.y*W+u.x;assert.ok(!occupied.has(k));occupied.add(k);
        assert.ok(Math.abs(u.x-before.get(u.id).x)+Math.abs(u.y-before.get(u.id).y)<=1);
        assert.ok(u.hp>0&&u.hp<=u.maxHp);
      }
      for(const e of s.effects){assert.ok(hasLineOfSight(s,e.from,e.to));}
    }
    assert.ok(s.finished);
  }
});
test('walls and diagonal corners block line of sight',()=>{
  const s=createSimulation();s.map.fill(0);s.map[5*W+5]=1;
  assert.equal(hasLineOfSight(s,{x:3,y:5},{x:8,y:5}),false);
  assert.equal(hasLineOfSight(s,{x:3,y:4},{x:8,y:4}),true);
  assert.equal(hasLineOfSight(s,{x:4,y:5},{x:5,y:6}),false);
});
test('contested and empty objectives do not score',()=>{
  const s=createSimulation();s.map.fill(0);s.objectives=[{id:'I',x:10,y:10,owner:null}];
  for(const u of s.units)u.hp=0;
  const a=s.units[0],b=s.units[5];a.hp=10;b.hp=10;a.x=10;a.y=10;b.x=11;b.y=10;
  updateObjectives(s);assert.deepEqual(s.scores,[0,0]);assert.equal(s.objectives[0].contested,true);
  b.x=15;updateObjectives(s);assert.deepEqual(s.scores,[1,0]);assert.equal(s.objectives[0].owner,0);
  a.x=5;updateObjectives(s);assert.deepEqual(s.scores,[1,0]);assert.equal(s.objectives[0].owner,null);
});
test('profile overrides materially change a decision in the same tactical situation',()=>{
  const s=createSimulation();s.map.fill(0);for(const u of s.units)u.hp=0;
  const a=s.units[0],b=s.units[5];a.hp=a.maxHp;b.hp=b.maxHp;a.x=10;a.y=10;b.x=14;b.y=10;
  s.objectives=[{id:'I',x:10,y:10,owner:0}];a.assignment='I';
  a.overrides={aggression:0,caution:0,objective:1};assert.equal(decideUnit(s,a).type,'hold');
  a.overrides={aggression:1,caution:0,objective:0};assert.equal(decideUnit(s,a).type,'attack');
});
test('save/load resumes exactly the same future combat',()=>{
  const a=createSimulation({seed:'resume'});for(let i=0;i<16;i++)stepSimulation(a);
  const b=importScene(exportScene(a));for(let i=0;i<30;i++){stepSimulation(a);stepSimulation(b);}
  assert.deepEqual(combat(a),combat(b));
});
test('scene import rejects malformed, excessive and invalid data',()=>{
  assert.throws(()=>importScene('broken'));assert.throws(()=>importScene('a'.repeat(2_000_001)));
  const raw=JSON.parse(exportScene(createSimulation()));raw.state.units[0].x=-1;assert.throws(()=>importScene(JSON.stringify(raw)));
  raw.state.units[0].x=3;raw.state.units[0].overrides.aggression=20;assert.throws(()=>importScene(JSON.stringify(raw)));
});
test('map editor protects occupied cells, objectives and active simulations',()=>{
  const s=createSimulation();assert.equal(setTerrain(s,s.units[0].x,s.units[0].y,1),false);assert.equal(setTerrain(s,s.objectives[0].x,s.objectives[0].y,1),false);
  assert.equal(setTerrain(s,1,1,2),true);stepSimulation(s);assert.equal(setTerrain(s,1,1,0),false);
});
