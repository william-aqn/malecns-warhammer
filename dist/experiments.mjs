import {CHEMISTRIES,chemistryOf,transmitterSummary} from './neurochemistry.mjs';
import {MOTOR_MODEL,isMotorMode,motorReadout} from './motor.mjs';
import {CONNECTOME,createBrain} from './neural.mjs';
import {createSimulation,stepSimulation,decideUnit,distance} from './engine.mjs';
import {CONTROLLERS,stepBrain} from './neural.mjs';
export const CONTACT_SEED='reflex-01';
export const aimConfig=(mode='neural',chemistry='unsigned')=>({...contactConfig(mode,chemistry),seed:'aim-01',scenario:'aim',controllerB:'neural-disconnected'});
export function contactConfig(mode='malecns',chemistry='unsigned'){
  return {neurochemistry:chemistry,seed:CONTACT_SEED,scenario:'contact',mapKind:'ruins',density:28,factionA:'marines',factionB:'marines',controllerA:mode,controllerB:'utility'};
}
// Isolated copies. Observe executed choices before damage can remove an actor.
function compareContact(modes,reactivity,chemistry){
  if(!Number.isFinite(reactivity)||reactivity<0||reactivity>1)throw new Error('Invalid reactivity');
  return modes.map(mode=>{
    const s=createSimulation(contactConfig(mode,chemistry)),u=s.units[0],timeline=[];
    u.overrides.reactivity=reactivity;let motorCommands=0;
    for(let i=0;i<12&&!s.finished;i++){
      let executed=null;
      stepSimulation(s,(d,actor)=>{
        if(actor.id!==u.id)return;
        executed=d;if(d.source==='motor'&&d.command!=='wait')motorCommands++;
      });
      timeline.push({tick:s.tick,action:executed?.type??'dead',label:executed?.label??'Выведен из боя',command:executed?.command??null,
        reflex:u.reflex.active,override:!!executed?.neuralOverride,rawDrive:Math.max(...u.brain.outputs),phase:u.reflex.phase,
        heading:u.heading,x:u.x,y:u.y,hp:u.hp});
    }
    return {mode,chemistry:chemistryOf(u.brain),label:CONTROLLERS[mode],reactivity,firstAction:timeline[0]?.label??'—',firstType:timeline[0]?.action??'hold',
      neuralEscapes:u.neuralEscapes,motorCommands,episodes:u.reflex.episodes,damageDone:u.damageDone,hp:u.hp,ticks:s.tick,
      maxDrive:Math.max(0,...timeline.map(t=>t.rawDrive)),timeline};
  });
}
export const runContactComparison=(reactivity=.5,chemistry='unsigned')=>compareContact(['malecns','disconnected','utility'],reactivity,chemistry);
export const runMotorComparison=(reactivity=.5,adaptive=false,chemistry='unsigned')=>compareContact(adaptive?['adaptive','adaptive-disconnected','utility']:['neural','neural-disconnected','utility'],reactivity,chemistry);

// Isolated causal probes: same board and zero initial activity, only visual input
// or edge transmission changes. These are 32 neural steps, not combat turns.
export function runAimComparison(reactivity=.5,chemistry='unsigned'){
  if(!Number.isFinite(reactivity)||reactivity<0||reactivity>1)throw new Error('Invalid reactivity');
  return [
    {mode:'neural',inputs:[0,0,.6,.4],label:'L 0.6 / R 0.4'},
    {mode:'neural',inputs:[0,0,.4,.6],label:'L 0.4 / R 0.6'},
    {mode:'neural-disconnected',inputs:[0,0,.6,.4],label:'L 0.6 / R 0.4 · без связей'},
    {mode:'neural',inputs:[0,0,0,0],label:'Без стимула'}
  ].map(probe=>{
    const s=createSimulation(aimConfig(probe.mode,chemistry)),[u,left,right]=s.units;
    left.x=12;left.y=9;right.x=14;right.y=12;u.overrides.reactivity=reactivity;
    stepBrain(u.brain,probe.inputs,probe.mode,32);const d=decideUnit(s,u);
    return {...probe,reactivity,steps:u.brain.steps,command:d.command,action:d.type,target:d.target??null,
      preferredTarget:d.aim.target,angle:d.aim.angle,fire:d.motor.scores.fire,advance:d.motor.scores.advance,
      candidates:d.aim.candidates.map(c=>({...c,distance:distance(u,c)}))};
  });
}

// Same zero state, inputs and 32 updates. Raw rates, before calibration, game
// choices and learning. This is a model sensitivity probe, not a biology validation.
export function runTransmitterComparison(mode='neural'){
  const full=isMotorMode(mode),controller=full?'neural':'malecns';
  const inputs=full?[.5,.5,.5,.5]:[.5,.5],neurons=full?MOTOR_MODEL.neurons:CONNECTOME.neurons;
  return Object.entries(CHEMISTRIES).map(([chemistry,label])=>{
    const brain=createBrain(controller,chemistry);stepBrain(brain,inputs,controller,32);
    return {chemistry,label,inputs:[...inputs],steps:32,summary:transmitterSummary(neurons,chemistry),
      meanRate:brain.activity.reduce((sum,v)=>sum+v,0)/brain.activity.length,
      escape:[...brain.outputs],aim:full?motorReadout(brain).raw.aim:null};
  });
}
