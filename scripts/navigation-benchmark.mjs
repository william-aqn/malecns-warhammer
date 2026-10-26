import {writeFile,readFile} from 'node:fs/promises';
import {createSimulation,stepSimulation,MOTOR_VISION} from '../dist/engine.mjs';
import {MOTOR_SHA256,MOTOR_DECODER} from '../dist/motor.mjs';
const metrics=function metrics(records){
 const units={};
 for(const r of records){
  const tr=units[r.id]??={id:r.id,cells:new Set(),moves:0,turns:0,attacks:0,maxStationary:0,stationary:0,smallAreaWindows:0,recent:[]};
  tr.cells.add(r.x+','+r.y);const delta=[[0,-1],[1,0],[0,1],[-1,0]][Math.floor((r.h+1)/2)%4],sign=r.command==='advance'?1:r.command==='reverse'?-1:0;
  const pos=sign?[r.x+delta[0]*sign,r.y+delta[1]*sign]:[r.x,r.y];tr.cells.add(pos.join(','));
  tr.moves+=!!sign;tr.turns+=['left','right'].includes(r.command);tr.attacks+=r.command==='fire';
  tr.stationary=sign||r.command==='fire'?0:tr.stationary+1;tr.maxStationary=Math.max(tr.maxStationary,tr.stationary);
  if(r.command==='fire')tr.recent=[];else {tr.recent.push(pos.join(','));if(tr.recent.length>12)tr.recent.shift();if(tr.recent.length===12&&new Set(tr.recent).size<=2)tr.smallAreaWindows++;}
 }
 return Object.values(units).map(({cells,recent,stationary,...tr})=>({...tr,cells:cells.size}));
};
const runs=[];
for(const seed of ['40721','navigation-17','navigation-83']){
  const s=createSimulation({seed,controllerA:'neural',controllerB:'neural'}),records=[];
  while(s.tick<40&&!s.finished)stepSimulation(s,(d,u)=>records.push({t:s.tick,id:u.id,x:u.x,y:u.y,h:u.heading,command:d.command}));
  const run={seed,ticks:s.tick,scores:s.scores,units:metrics(records)};runs.push(run);
  console.log(JSON.stringify(run));
}
const baseline=JSON.parse(await readFile(new URL('../data/navigation-v0.6.json',import.meta.url),'utf8'));
const report={version:'0.7.0',model:MOTOR_SHA256,decoder:MOTOR_DECODER,vision:MOTOR_VISION,
  scope:'Three fixed 40-tick neural-vs-neural diagnostics with default factions and terrain. Baseline: v0.6 at reported seed 40721. No optimization or training. These maps were inspected during development; this is a regression sample, not a held-out evaluation or evidence of tactical strength.',
  metrics:'Distinct visited cells include the spawn and executed destinations. maxStationary counts consecutive turn/wait activations; moves and attacks reset it. smallAreaWindows counts 12 consecutive non-firing activations confined to at most two cells. Dead units receive no later activations. Holding a point is not distinguished from other waiting.',
  baseline,runs};
await writeFile(new URL('../data/navigation-benchmark.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
