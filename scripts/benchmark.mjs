import {writeFile,mkdir} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {createSimulation,stepSimulation,threatAt,MAX_TICKS} from '../dist/engine.mjs';
import {CONNECTOME_SHA256,createBrain,stepBrain} from '../dist/neural.mjs';
import {REFLEX_CONTRACT,REFLEX_BURST,REFLEX_COOLDOWN,REFLEX_RELEASE} from '../dist/reflex.mjs';
import {MOTOR_MODEL,MOTOR_SHA256,MOTOR_STEPS,MOTOR_DECODER,motorReadout} from '../dist/motor.mjs';
import {runContactComparison,runMotorComparison,runAimComparison} from '../dist/experiments.mjs';
// Frozen before evaluation. Historical seeds are reported separately from new seeds.
const suites={
  historical:['40721','104','orbit','ruins-7','control-5','tabletop'],
  additional:['probe-11','probe-29','probe-43','probe-61','probe-73','probe-97']
};
const modes=['malecns','disconnected','utility'],runs=[],started=performance.now();
for(const [suite,seeds] of Object.entries(suites))for(const seed of seeds)for(const testTeam of [0,1])for(const mode of modes){
  const s=createSimulation({seed,controllerA:testTeam===0?mode:'utility',controllerB:testTeam===1?mode:'utility',factionA:'marines',factionB:'marines'});
  const t=performance.now();
  let attacks=0,longestRun=0,changedActions=0,blockedReflexDecisions=0,reflexDecisions=0;
  let riskIncreaseSteps=0,nonImprovingRoutes=0,overBudgetRoutes=0;
  const streaks=new Map();
  while(!s.finished&&s.tick<MAX_TICKS)stepSimulation(s,(d,u,board)=>{
    if(u.team!==testTeam)return;
    if(d.type==='attack')attacks++;
    if(d.counterfactual.changed)changedActions++;
    if(d.neural.active&&!d.neuralOverride)blockedReflexDecisions++;
    const streak=d.neuralOverride?(streaks.get(u.id)||0)+1:0;
    streaks.set(u.id,streak);longestRun=Math.max(longestRun,streak);
    if(d.neuralOverride){
      reflexDecisions++;
      let risk=threatAt(board,u,u.team);const startRisk=risk;
      for(const p of d.route){const next=threatAt(board,p,u.team);if(next>risk+1e-9)riskIncreaseSteps++;risk=next;}
      if(risk>=startRisk-1e-9)nonImprovingRoutes++;
      if(d.route.length>u.reflex.remaining+1||d.route.length>REFLEX_BURST)overBudgetRoutes++;
    }
  });
  const own=s.units.filter(u=>u.team===testTeam);
  runs.push({suite,seed,testTeam,mode,tick:s.tick,scores:s.scores,winner:s.winner,win:s.winner===testTeam,
    survivors:own.filter(u=>u.hp>0).length,attacks,damageDone:own.reduce((sum,u)=>sum+u.damageDone,0),
    neuralEscapes:own.reduce((sum,u)=>sum+u.neuralEscapes,0),episodes:own.reduce((sum,u)=>sum+u.reflex.episodes,0),
    changedActions,blockedReflexDecisions,reflexDecisions,riskIncreaseSteps,nonImprovingRoutes,overBudgetRoutes,
    longestReflexRun:longestRun,milliseconds:Math.round(performance.now()-t)});
}
const summary=[];
for(const suite of Object.keys(suites))for(const mode of modes){
  const rows=runs.filter(r=>r.suite===suite&&r.mode===mode);
  summary.push({suite,mode,games:rows.length,wins:rows.filter(r=>r.win).length,draws:rows.filter(r=>r.winner===null).length,
    meanReflexMoves:Number((rows.reduce((a,r)=>a+r.neuralEscapes,0)/rows.length).toFixed(2)),
    meanChangedActions:Number((rows.reduce((a,r)=>a+r.changedActions,0)/rows.length).toFixed(2)),
    maxConsecutiveReflexMoves:Math.max(...rows.map(r=>r.longestReflexRun))});
}
const probes=[];
for(const mode of ['malecns','disconnected'])for(const inputs of [[1,0],[0,1],[.5,.5],[0,0]]){
  const b=createBrain();stepBrain(b,inputs,mode,32);probes.push({mode,inputs,outputs:b.outputs});
}
const motorProbes=[];
for(const mode of ['neural','neural-disconnected'])for(const inputs of [[0,0,1,0],[0,0,0,1],[1,0,0,0],[0,1,0,0],[0,0,0,0]]){
  const b=createBrain(mode),start=performance.now();stepBrain(b,inputs,mode,32);
  motorProbes.push({mode,inputs,outputs:motorReadout(b).raw,scores:motorReadout(b).scores,milliseconds:Math.round(performance.now()-start)});
}
const motorContact=runMotorComparison();
if(motorContact[0].motorCommands===0||motorContact[1].motorCommands!==0||motorContact[1].maxDrive!==0)throw Error('Motor lesion control failed');
const aimProbes=runAimComparison();
if(aimProbes[0].target!=='B-01'||aimProbes[1].target!=='B-02'||aimProbes.slice(2).some(p=>p.command!=='wait'))throw Error('Causal aim probe failed');
const motor={model:MOTOR_SHA256,decoder:MOTOR_DECODER,counts:MOTOR_MODEL.counts,stepsPerActivation:MOTOR_STEPS,
  scope:'One fixed 1v1 contact scene, 12 ticks at most, with neural/disconnected/utility A against utility B; same factions, seed and initial state. Lateral stimuli are separate zero-start probes. Command decoding, sensory projection and target binding are engineered. No claim of tactical superiority or biological behavior.',
  aimProbeScope:'Four isolated zero-start probes on an identical board. LC10 0.6/0.4 versus 0.4/0.6, disconnected edges and zero input; 32 neural steps each. B-01 at 3 cells, B-02 at 6, symmetric bearings. Fire and advance are independent outputs; legal targets are resolved by angular error, with ID ties.',
  contact:motorContact,aimProbes,probes:motorProbes};
const report={version:'0.7.0',model:CONNECTOME_SHA256,reflex:{contract:REFLEX_CONTRACT,burst:REFLEX_BURST,cooldown:REFLEX_COOLDOWN,release:REFLEX_RELEASE},
  scope:'12 fixed seeds × 2 test-team assignments × 3 modes. Same factions (marines), defaults, terrain and starting combat seed. Six seeds are historical and six additional. After action divergence the RNG consumption also diverges. No optimizer or training. Diagnostic sample, not a general-strength or biological-validity claim.',
  checks:{riskIncreaseSteps:runs.reduce((sum,r)=>sum+r.riskIncreaseSteps,0),nonImprovingRoutes:runs.reduce((sum,r)=>sum+r.nonImprovingRoutes,0),overBudgetRoutes:runs.reduce((sum,r)=>sum+r.overBudgetRoutes,0)},
  observation:'All decisions are recorded immediately before execution, including later casualties. changedActions compares only the next physical action to utility on that same board. Risk is a static sum of visible enemy base damage, with ranged cover reduction; it does not predict enemy turns, hit rolls or survival.',
  summary,motor,contact:runContactComparison(),probes,runs,totalMilliseconds:Math.round(performance.now()-started)};
if(Object.values(report.checks).some(value=>value!==0)||runs.some(r=>r.reflexDecisions!==r.neuralEscapes))throw new Error('Reflex route or observation invariant failed');
await mkdir(new URL('../data/',import.meta.url),{recursive:true});
await writeFile(new URL('../data/benchmark.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.table(summary);console.table(aimProbes.map(p=>({input:p.label,command:p.command,target:p.target,aimDegrees:p.angle===null?null:Number((p.angle*180/Math.PI).toFixed(3))})));console.log(JSON.stringify({battles:runs.length,milliseconds:report.totalMilliseconds,report:'data/benchmark.json'}));
