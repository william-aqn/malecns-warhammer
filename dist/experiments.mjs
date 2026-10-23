import {createSimulation,stepSimulation} from './engine.mjs';
import {CONTROLLERS} from './neural.mjs';
export const CONTACT_SEED='reflex-01';
export function contactConfig(mode='malecns'){
  return {seed:CONTACT_SEED,scenario:'contact',mapKind:'ruins',density:28,factionA:'marines',factionB:'marines',controllerA:mode,controllerB:'utility'};
}
// Isolated copies. Running a comparison never modifies the user's battle.
export function runContactComparison(reactivity=.5){
  if(!Number.isFinite(reactivity)||reactivity<0||reactivity>1)throw new Error('Invalid reactivity');
  return ['malecns','disconnected','utility'].map(mode=>{
    const s=createSimulation(contactConfig(mode)),u=s.units[0],timeline=[];
    u.overrides.reactivity=reactivity;
    for(let i=0;i<12&&!s.finished;i++){
      stepSimulation(s);
      timeline.push({tick:s.tick,action:u.hp>0?u.decision?.type:'dead',label:u.decision?.label??'Выведен из боя',reflex:u.reflex.active,override:!!u.decision?.neuralOverride,
        rawDrive:Math.max(...u.brain.outputs),phase:u.reflex.phase,x:u.x,y:u.y,hp:u.hp});
    }
    return {mode,label:CONTROLLERS[mode],reactivity,firstAction:timeline[0]?.label??'—',firstType:timeline[0]?.action??'hold',neuralEscapes:u.neuralEscapes,
      episodes:u.reflex.episodes,damageDone:u.damageDone,hp:u.hp,ticks:s.tick,maxDrive:Math.max(0,...timeline.map(t=>t.rawDrive)),timeline};
  });
}
