import {MOTOR_MODEL,MOTOR_PACKED,MOTOR_SHA256} from './data/malecns-motor.mjs';
export {MOTOR_MODEL,MOTOR_SHA256};
export const MOTOR_STEPS=8;
export const MOTOR_DECODER='visual-motor-v3';
export const isMotorMode=mode=>mode==='neural'||mode==='neural-disconnected';
export const isMotorBrain=brain=>brain?.model===MOTOR_SHA256;
const motorBytes=Uint8Array.from(atob(MOTOR_PACKED),c=>c.charCodeAt(0));
const motorView=new DataView(motorBytes.buffer),motorN=MOTOR_MODEL.counts.neurons,motorE=MOTOR_MODEL.counts.edges;
const motorOffsets=new Uint32Array(motorN+1),motorSources=new Uint16Array(motorE),motorWeights=new Float32Array(motorE);
for(let i=0;i<=motorN;i++)motorOffsets[i]=motorView.getUint32(i*4,true);
for(let row=0;row<motorN;row++)for(let e=motorOffsets[row];e<motorOffsets[row+1];e++){
  const offset=(motorN+1)*4+e*4;
  motorSources[e]=motorView.getUint16(offset,true);
  motorWeights[e]=.7*motorView.getUint16(offset+2,true)/Math.max(1,MOTOR_MODEL.neurons[row].incomingTotal);
}
function motorMean(activity,key){const indices=MOTOR_MODEL.outputs[key];return indices.reduce((sum,i)=>sum+activity[i],0)/indices.length;}
function escapePair(activity){return ['L','R'].map(side=>['DNp01','DNp02','DNp04','DNp11'].reduce((sum,type)=>sum+motorMean(activity,type+side),0)/4);}
export function createMotorBrain(){
  return {model:MOTOR_SHA256,activity:Array(motorN).fill(0),steps:0,inputs:[0,0],targets:[0,0],outputs:[0,0],trace:[]};
}
export function stepMotorBrain(brain,inputs,mode,steps=MOTOR_STEPS){
  if(!isMotorMode(mode)||!Array.isArray(inputs)||inputs.length!==4||inputs.some(v=>!Number.isFinite(v)||v<0||v>1)||
    !Number.isInteger(steps)||steps<1||steps>64)throw new Error('Invalid visual-motor input');
  const activity=Float32Array.from(brain.activity),sums=new Float32Array(motorN),stimulus=new Float32Array(motorN);
  for(const [channel,value] of [['threatL',inputs[0]],['threatR',inputs[1]],['targetL',inputs[2]],['targetR',inputs[3]]])
    for(const i of MOTOR_MODEL.inputs[channel])stimulus[i]+=.8*value;
  for(let step=0;step<steps;step++){
    sums.fill(0);
    if(mode==='neural')for(let row=0;row<motorN;row++)for(let e=motorOffsets[row];e<motorOffsets[row+1];e++)sums[row]+=motorWeights[e]*activity[motorSources[e]];
    for(let i=0;i<motorN;i++)activity[i]=.5*activity[i]+.5*Math.tanh(sums[i]+stimulus[i]);
  }
  brain.activity=Array.from(activity);brain.steps+=steps;brain.inputs=inputs.slice(0,2);brain.targets=inputs.slice(2);
  brain.outputs=escapePair(activity);
  brain.trace.push({step:brain.steps,inputs:[...brain.inputs],targets:[...brain.targets],outputs:[...brain.outputs]});
  if(brain.trace.length>40)brain.trace.shift();
  return brain;
}
// Engineering adapter: motor populations provide every command score.
// Symmetric reference stimuli equalize channel scales; no utility scores,
// pathfinding, assigned objective, combat optimizer or trained action labels.
export function motorReadout(brain,reactivity=.5){
  const gain=2*reactivity,cal=MOTOR_MODEL.calibration;
  const raw={
    aim:['L','R'].map(side=>motorMean(brain.activity,'DNa01'+side)),
    steer:['L','R'].map(side=>motorMean(brain.activity,'DNa02'+side)),
    walk:['L','R'].map(side=>motorMean(brain.activity,'DNp09'+side)),
    reverse:['L','R'].map(side=>motorMean(brain.activity,'MDN'+side)),
    escape:escapePair(brain.activity)
  };
  const steer=raw.steer.map((v,i)=>gain*v/cal.target['DNa02'+['L','R'][i]]);
  // DNa01 supplies an engineered aim/fire readout, not a biological attack label.
  const aim=raw.aim.map((v,i)=>gain*v/cal.target['DNa01'+['L','R'][i]]);
  const aimTotal=aim[0]+aim[1],aimAngle=aimTotal>1e-9?Math.atan2(aim[1]-aim[0],aimTotal):null;
  const fear=raw.escape.map((v,i)=>gain*v/(['DNp01','DNp02','DNp04','DNp11'].reduce((sum,type)=>sum+cal.threat[type+['L','R'][i]],0)/4));
  const walk=raw.walk.map((v,i)=>gain*v/cal.target['DNp09'+['L','R'][i]]),reverse=raw.reverse.map((v,i)=>gain*v/cal.threat['MDN'+['L','R'][i]]);
  // Opponent locomotor readout: forward activity damps repeated backing-up.
  // This is an engineered command mapping, not a change to the connectome.
  const advance=Math.min((steer[0]+steer[1])/2,(walk[0]+walk[1])/2);
  const retreat=Math.max(0,Math.min(...fear,(reverse[0]+reverse[1])/2)*1.1-.5*advance);
  return {decoder:MOTOR_DECODER,raw,aim,aimAngle,steer,fear,walk,reverse,gain,scores:{
    fire:aimTotal/2,
    advance,
    left:Math.max(0,steer[0]-steer[1])*2+fear[1],
    right:Math.max(0,steer[1]-steer[0])*2+fear[0],
    reverse:retreat,
    wait:.06
  }};
}
export function validateMotorBrain(b,maxTicks){
  const scalar=v=>Number.isFinite(v)&&v>=0&&v<=1,pair=x=>Array.isArray(x)&&x.length===2&&x.every(scalar);
  if(!b||b.model!==MOTOR_SHA256||!Array.isArray(b.activity)||b.activity.length!==motorN||!b.activity.every(scalar)||
    !Number.isInteger(b.steps)||b.steps<0||b.steps>maxTicks*MOTOR_STEPS||b.steps%MOTOR_STEPS!==0||
    !pair(b.inputs)||!pair(b.targets)||!pair(b.outputs)||!Array.isArray(b.trace)||b.trace.length>40||
    b.trace.some((t,i)=>!t||!Number.isInteger(t.step)||t.step<1||t.step>b.steps||t.step%MOTOR_STEPS!==0||!pair(t.inputs)||!pair(t.targets)||!pair(t.outputs)||(i>0&&t.step<=b.trace[i-1].step)))return false;
  return escapePair(b.activity).every((v,i)=>Math.abs(v-b.outputs[i])<1e-8);
}
export function copyMotorBrain(b){
  return {model:b.model,activity:[...b.activity],steps:b.steps,inputs:[...b.inputs],targets:[...b.targets],outputs:[...b.outputs],
    trace:b.trace.map(t=>({step:t.step,inputs:[...t.inputs],targets:[...t.targets],outputs:[...t.outputs]}))};
}
const motorDisplayIndices=Array.from({length:319},(_,i)=>Math.floor(i*(motorN-1)/318));
export const motorDisplay=brain=>motorDisplayIndices.map(i=>({...MOTOR_MODEL.neurons[i],activity:brain.activity[i]}));
