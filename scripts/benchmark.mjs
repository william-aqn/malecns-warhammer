import {writeFile,mkdir} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {createSimulation,stepSimulation,MAX_TICKS} from '../dist/engine.mjs';
import {CONNECTOME_SHA256,createBrain,stepBrain} from '../dist/neural.mjs';
import {REFLEX_CONTRACT,REFLEX_BURST,REFLEX_COOLDOWN,REFLEX_RELEASE} from '../dist/reflex.mjs';
import {runContactComparison} from '../dist/experiments.mjs';
// Frozen before evaluation. Historical seeds are reported separately from new seeds.
const suites={
  historical:['40721','104','orbit','ruins-7','control-5','tabletop'],
  additional:['probe-11','probe-29','probe-43','probe-61','probe-73','probe-97']
};
const modes=['malecns','disconnected','utility'],runs=[],started=performance.now();
for(const [suite,seeds] of Object.entries(suites))for(const seed of seeds)for(const testTeam of [0,1])for(const mode of modes){
  const s=createSimulation({seed,controllerA:testTeam===0?mode:'utility',controllerB:testTeam===1?mode:'utility',factionA:'marines',factionB:'marines'});
  const t=performance.now();let attacks=0,longestRun=0,streaks=new Map();
  while(!s.finished&&s.tick<MAX_TICKS){
    stepSimulation(s);
    for(const u of s.units.filter(u=>u.team===testTeam)){
      if(u.hp>0&&u.decision?.evaluatedAt===s.tick){
        if(u.decision.type==='attack')attacks++;
        const streak=u.decision.neuralOverride?(streaks.get(u.id)||0)+1:0;streaks.set(u.id,streak);longestRun=Math.max(longestRun,streak);
      }
    }
  }
  const own=s.units.filter(u=>u.team===testTeam);
  runs.push({suite,seed,testTeam,mode,tick:s.tick,scores:s.scores,winner:s.winner,win:s.winner===testTeam,
    survivors:own.filter(u=>u.hp>0).length,attacks,damageDone:own.reduce((sum,u)=>sum+u.damageDone,0),
    neuralEscapes:own.reduce((sum,u)=>sum+u.neuralEscapes,0),episodes:own.reduce((sum,u)=>sum+u.reflex.episodes,0),
    longestReflexRun:longestRun,milliseconds:Math.round(performance.now()-t)});
}
const summary=[];
for(const suite of Object.keys(suites))for(const mode of modes){
  const rows=runs.filter(r=>r.suite===suite&&r.mode===mode);
  summary.push({suite,mode,games:rows.length,wins:rows.filter(r=>r.win).length,draws:rows.filter(r=>r.winner===null).length,
    meanReflexMoves:Number((rows.reduce((a,r)=>a+r.neuralEscapes,0)/rows.length).toFixed(2)),
    maxConsecutiveReflexMoves:Math.max(...rows.map(r=>r.longestReflexRun))});
}
const probes=[];
for(const mode of ['malecns','disconnected'])for(const inputs of [[1,0],[0,1],[.5,.5],[0,0]]){
  const b=createBrain();stepBrain(b,inputs,mode,32);probes.push({mode,inputs,outputs:b.outputs});
}
const report={version:'0.3.0',model:CONNECTOME_SHA256,reflex:{contract:REFLEX_CONTRACT,burst:REFLEX_BURST,cooldown:REFLEX_COOLDOWN,release:REFLEX_RELEASE},
  scope:'12 fixed seeds × 2 test-team assignments × 3 modes. Same factions (marines), defaults, terrain and starting combat seed. Six seeds are historical and six additional. After action divergence the RNG consumption also diverges. No optimizer or training. Diagnostic sample, not a general-strength or biological-validity claim.',
  summary,contact:runContactComparison(),probes,runs,totalMilliseconds:Math.round(performance.now()-started)};
await mkdir(new URL('../data/',import.meta.url),{recursive:true});
await writeFile(new URL('../data/benchmark.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.table(summary);console.log(JSON.stringify({battles:runs.length,milliseconds:report.totalMilliseconds,report:'data/benchmark.json'}));
