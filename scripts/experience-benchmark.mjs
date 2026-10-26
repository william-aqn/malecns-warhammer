import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createSimulation,stepSimulation,repeatWithExperience,exportScene,importScene,W,H} from '../dist/engine.mjs';
import {MOTOR_SHA256,MOTOR_DECODER} from '../dist/motor.mjs';
import {EXPERIENCE_RULE,EXPERIENCE_FEATURES} from '../dist/experience.mjs';
const summarize=function summarize(s,history){
 const alive=s.units.filter(u=>u.hp>0).length,late=history.filter(r=>r.t>=120);
 return {seed:s.config.seed,tick:s.tick,scores:s.scores,winner:s.winner,alive,
  attacks:history.filter(r=>r.command==='fire').length,waits:history.filter(r=>r.command==='wait').length,
  late:{activations:late.length,edge:late.filter(r=>r.x<=1||r.x>=30||r.y<=1||r.y>=20).length,attacks:late.filter(r=>r.command==='fire').length},
  units:s.units.map(u=>({id:u.id,hp:u.hp,position:[u.x,u.y],cells:new Set(history.filter(r=>r.id===u.id).map(r=>r.x+','+r.y)).size,
   updates:u.experience?.updates??0,reward:u.experience?.totalReward??null,known:u.experience?.known??[],
   captured:u.experience?.captured??[],coefficientNorm:u.experience?Math.sqrt(u.experience.weights.flat().reduce((sum,v)=>sum+v*v,0)):0}))};
};
const runs=[];let first=null;
function run(s,label){
 const history=[];
 while(!s.finished){
  stepSimulation(s,(d,u,board)=>{
   assert.equal(d.source,'motor');assert.ok(d.alternatives.find(c=>c.command===d.command).available);
   history.push({t:s.tick,id:u.id,x:u.x,y:u.y,h:u.heading,command:d.command,exploratory:d.learning.exploratory});
  });
  const live=s.units.filter(u=>u.hp>0);
  assert.equal(new Set(live.map(u=>u.x+','+u.y)).size,live.length);
  for(const u of live)assert.ok(u.x>=0&&u.x<W&&u.y>=0&&u.y<H&&s.map[u.y*W+u.x]!==1);
  if(s.tick%60===0)console.log(JSON.stringify({label,tick:s.tick,scores:s.scores,alive:live.length}));
 }
 for(const u of s.units){assert.equal(u.experience.pending,null);assert.ok(u.experience.weights.flat().every(Number.isFinite));}
 const snapshot=exportScene(s);assert.ok(Buffer.byteLength(snapshot)<8_000_000);
 const restored=importScene(snapshot);assert.deepEqual(restored.units.map(u=>u.experience),s.units.map(u=>u.experience));
 const result={label,...summarize(s,history),exploratory:history.filter(r=>r.exploratory).length};runs.push(result);
 console.log(JSON.stringify({label,tick:s.tick,scores:s.scores,late:result.late}));
 return s;
}
for(const seed of ['40721','experience-check-29','experience-check-61']){
 const s=run(createSimulation({seed,controllerA:'adaptive',controllerB:'adaptive'}),'learning-'+seed);
 if(!first)first=s;
}
const frozen=createSimulation({seed:'40721',controllerA:'adaptive',controllerB:'adaptive'});
for(const u of frozen.units)u.experience.enabled=false;
run(frozen,'memory-without-learning-40721');
run(repeatWithExperience(first),'second-battle-with-experience-40721');
const baseline=JSON.parse(await readFile(new URL('../data/experience-baseline-v0.7.json',import.meta.url),'utf8'));
const report={version:'0.8.0',model:MOTOR_SHA256,baseDecoder:MOTOR_DECODER,features:EXPERIENCE_FEATURES,learning:EXPERIENCE_RULE,
 scope:'Complete games, up to 180 ticks. Three cold-start seeds with online learning, one memory-only frozen-head ablation, and one same-seed replay carrying the first game coefficients. Parameters were not optimized for wins. This small diagnostic set cannot establish general tactical strength; scores across games also depend on differing casualties and random-number consumption.',
 observation:'Decisions captured before execution. Late means tick >=120; edge means x<=1, x>=30, y<=1 or y>=20. An earlier terminal result is not evidence that all surviving agents would avoid orbiting if the game continued.',
 baseline,runs};
await writeFile(new URL('../data/experience-benchmark.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
