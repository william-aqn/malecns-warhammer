import {createSimulation,stepSimulation} from './engine.mjs';
import {CONTROLLERS} from './neural.mjs';
export const CONTACT_SEED='reflex-01';
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
export const runMotorComparison=(reactivity=.5)=>compareContact(['neural','neural-disconnected','utility'],reactivity);
