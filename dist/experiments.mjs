import {createSimulation,stepSimulation,decideUnit,distance} from './engine.mjs';
import {CONTROLLERS,stepBrain} from './neural.mjs';
export const CONTACT_SEED='reflex-01';
export const aimConfig=(mode='neural')=>({...contactConfig(mode),seed:'aim-01',scenario:'aim',controllerB:'neural-disconnected'});
export function contactConfig(mode='malecns'){
  return {seed:CONTACT_SEED,scenario:'contact',mapKind:'ruins',density:28,factionA:'marines',factionB:'marines',controllerA:mode,controllerB:'utility'};
}
// Isolated copies. Observe executed choices before damage can remove an actor.
function compareContact(modes,reactivity){
  if(!Number.isFinite(reactivity)||reactivity<0||reactivity>1)throw new Error('Invalid reactivity');
  return modes.map(mode=>{
    const s=createSimulation(contactConfig(mode)),u=s.units[0],timeline=[];
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
    return {mode,label:CONTROLLERS[mode],reactivity,firstAction:timeline[0]?.label??'—',firstType:timeline[0]?.action??'hold',
      neuralEscapes:u.neuralEscapes,motorCommands,episodes:u.reflex.episodes,damageDone:u.damageDone,hp:u.hp,ticks:s.tick,
      maxDrive:Math.max(0,...timeline.map(t=>t.rawDrive)),timeline};
  });
}
export const runContactComparison=(reactivity=.5)=>compareContact(['malecns','disconnected','utility'],reactivity);
export const runMotorComparison=(reactivity=.5,adaptive=false)=>compareContact(adaptive?['adaptive','adaptive-disconnected','utility']:['neural','neural-disconnected','utility'],reactivity);

// Isolated causal probes: same board and zero initial activity, only visual input
// or edge transmission changes. These are 32 neural steps, not combat turns.
export function runAimComparison(reactivity=.5){
  if(!Number.isFinite(reactivity)||reactivity<0||reactivity>1)throw new Error('Invalid reactivity');
  return [
    {mode:'neural',inputs:[0,0,.6,.4],label:'L 0.6 / R 0.4'},
    {mode:'neural',inputs:[0,0,.4,.6],label:'L 0.4 / R 0.6'},
    {mode:'neural-disconnected',inputs:[0,0,.6,.4],label:'L 0.6 / R 0.4 · без связей'},
    {mode:'neural',inputs:[0,0,0,0],label:'Без стимула'}
  ].map(probe=>{
    const s=createSimulation(aimConfig(probe.mode)),[u,left,right]=s.units;
    left.x=12;left.y=9;right.x=14;right.y=12;u.overrides.reactivity=reactivity;
    stepBrain(u.brain,probe.inputs,probe.mode,32);const d=decideUnit(s,u);
    return {...probe,reactivity,steps:u.brain.steps,command:d.command,action:d.type,target:d.target??null,
      preferredTarget:d.aim.target,angle:d.aim.angle,fire:d.motor.scores.fire,advance:d.motor.scores.advance,
      candidates:d.aim.candidates.map(c=>({...c,distance:distance(u,c)}))};
  });
}
