// Engineered action gate. This is game/controller logic, not fly physiology.
export const REFLEX_CONTRACT='bounded-escape-v1';
export const REFLEX_BURST=2,REFLEX_COOLDOWN=5,REFLEX_RELEASE=.65;
export function createReflex(){return {contract:REFLEX_CONTRACT,phase:'ready',remaining:0,active:false,episodes:0};}
export function stepReflex(r,signal,enabled=true){
  r.active=false;
  if(!enabled){r.phase='ready';r.remaining=0;return r;}
  const quiet=signal.drive<=signal.threshold*REFLEX_RELEASE;
  if(r.phase==='cooldown'){
    r.remaining--;
    if(r.remaining===0)r.phase=quiet?'ready':'waiting';
    return r;
  }
  if(r.phase==='waiting'){
    if(quiet)r.phase='ready';
    return r;
  }
  if(r.phase==='responding'){
    if(r.remaining>0&&!quiet){r.remaining--;r.active=true;return r;}
    r.phase='cooldown';r.remaining=REFLEX_COOLDOWN-1;return r;
  }
  if(signal.triggered){
    r.phase='responding';r.remaining=REFLEX_BURST-1;r.active=true;r.episodes++;
  }
  return r;
}
export function reflexAllows(r,signal){
  return r.active&&signal.drive>signal.threshold*REFLEX_RELEASE;
}
export function validateReflex(r,tick){
  if(!r||r.contract!==REFLEX_CONTRACT||!['ready','responding','cooldown','waiting'].includes(r.phase)||
    typeof r.active!=='boolean'||!Number.isInteger(r.remaining)||r.remaining<0||
    !Number.isInteger(r.episodes)||r.episodes<0||r.episodes>tick)return false;
  if(r.phase==='responding')return r.active&&r.remaining<REFLEX_BURST&&r.episodes>0;
  if(r.active)return false;
  if(r.phase==='cooldown')return r.remaining>0&&r.remaining<REFLEX_COOLDOWN&&r.episodes>0;
  return r.remaining===0&&(r.phase!=='waiting'||r.episodes>0);
}
export function copyReflex(r){return {contract:r.contract,phase:r.phase,remaining:r.remaining,active:r.active,episodes:r.episodes};}
