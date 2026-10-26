import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createSimulation,stepSimulation,exportScene,importScene,W,H} from '../dist/engine.mjs';
import {MOTOR_SHA256,MOTOR_DECODER,motorCalibration} from '../dist/motor.mjs';
import {CHEMISTRIES,NEUROTRANSMITTER_SHA256} from '../dist/neurochemistry.mjs';
import {runTransmitterComparison} from '../dist/experiments.mjs';
const probes=runTransmitterComparison('adaptive'),runs=[];
for(const chemistry of Object.keys(CHEMISTRIES)){
 const s=createSimulation({seed:'40721',controllerA:'adaptive',controllerB:'adaptive',neurochemistry:chemistry});
 const actions={},late={activations:0,edge:0,attacks:0};let maxActivity=0,minActivity=1;
 while(!s.finished){
  stepSimulation(s,(decision,u)=>{
   assert.ok(decision.alternatives.find(c=>c.command===decision.command).available);
   actions[decision.command]=(actions[decision.command]??0)+1;
   if(s.tick>=120){late.activations++;if(u.x<=1||u.x>=30||u.y<=1||u.y>=20)late.edge++;if(decision.command==='fire')late.attacks++;}
  });
  const live=s.units.filter(u=>u.hp>0);assert.equal(new Set(live.map(u=>u.x+','+u.y)).size,live.length);
  for(const u of s.units){
   assert.ok(u.x>=0&&u.x<W&&u.y>=0&&u.y<H&&s.map[u.y*W+u.x]!==1);
   for(const value of u.brain.activity){assert.ok(Number.isFinite(value)&&value>=0&&value<=1);maxActivity=Math.max(maxActivity,value);minActivity=Math.min(minActivity,value);}
   assert.ok(u.experience.weights.flat().every(v=>Number.isFinite(v)&&Math.abs(v)<=3));
  }
  if(s.tick%60===0)console.log(JSON.stringify({chemistry,tick:s.tick,scores:s.scores,alive:live.length}));
 }
 for(const u of s.units)assert.equal(u.experience.pending,null);
 const snapshot=exportScene(s);assert.ok(Buffer.byteLength(snapshot)<8_000_000);
 const restored=importScene(snapshot);assert.deepEqual(restored.units.map(u=>[u.brain,u.experience]),s.units.map(u=>[u.brain,u.experience]));
 const result={chemistry,tick:s.tick,scores:s.scores,winner:s.winner,alive:s.units.filter(u=>u.hp>0).length,
  actions,late,activityBounds:[minActivity,maxActivity],snapshotBytes:Buffer.byteLength(snapshot),
  units:s.units.map(u=>({id:u.id,hp:u.hp,cells:u.experience.visits.filter(n=>n>0).length,updates:u.experience.updates,reward:u.experience.totalReward}))};
 runs.push(result);console.log(JSON.stringify({chemistry,tick:s.tick,scores:s.scores,late}));
}
const report={version:'0.9.0',anatomy:MOTOR_SHA256,transmitters:NEUROTRANSMITTER_SHA256,decoder:MOTOR_DECODER,
 scope:'Three complete games with the same seed, initial profiles and zero learned experience, varying only the transmission model. The online-learning trajectories diverge; different decisions also consume different combat random draws. This is a finite-state and integration diagnostic, not evidence of tactical superiority or biological fidelity.',
 dynamics:'Fixed unsigned anatomical contact counts and full-source normalization. ACh +1; GABA -1; glutamate -1 or +1 by explicit assumption. Unclear, DA, 5-HT and OA have zero assumed fast effect. Nonnegative rectified leaky rates. The game readout retains the same original unsigned calibration in every condition.',
 probes,referenceResponses:Object.fromEntries(Object.keys(CHEMISTRIES).map(c=>[c,motorCalibration(c)])),runs};
await writeFile(new URL('../data/neurotransmitter-benchmark.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
