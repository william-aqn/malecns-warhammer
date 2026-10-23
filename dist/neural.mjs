import {isMotorMode,isMotorBrain,createMotorBrain,stepMotorBrain,validateMotorBrain,copyMotorBrain} from './motor.mjs';
import {CONNECTOME,CONNECTOME_SHA256} from './data/malecns-escape.mjs';
export {CONNECTOME,CONNECTOME_SHA256};
export const CONTROLLERS={
  neural:'MaleCNS · нейронное управление',
  'neural-disconnected':'Нейронное управление · без связей',
  malecns:'MaleCNS + тактика',
  disconnected:'Контроль: связи отключены',
  utility:'Только тактика'
};
export const NEURAL_STEPS=4,NEURAL_GAIN=.7,NEURAL_LEAK=.5,NEURAL_AMPLITUDE=.8;
const inputIndices={L:[],R:[]},outputIndices={L:[],R:[]};
CONNECTOME.neurons.forEach((n,i)=>(n.kind==='input'?inputIndices:outputIndices)[n.side].push(i));
const edgeFrom=Uint16Array.from(CONNECTOME.edges,e=>e[0]);
const edgeTo=Uint16Array.from(CONNECTOME.edges,e=>e[1]);
const edgeWeight=Float32Array.from(CONNECTOME.edges,e=>NEURAL_GAIN*e[2]/Math.max(1,CONNECTOME.neurons[e[1]].incomingTotal));
export function createBrain(mode='malecns'){
  if(isMotorMode(mode))return createMotorBrain();
  return {model:CONNECTOME_SHA256,activity:Array(CONNECTOME.neurons.length).fill(0),steps:0,inputs:[0,0],outputs:[0,0],trace:[]};
}
// Discrete leaky rate model, NOT measured electrophysiology. All edges are
// unsigned because the source bundle contains no transmitter signs.
// The full-source denominator is retained; missing neurons contribute zero.
export function stepBrain(brain,inputs,mode='malecns',steps=NEURAL_STEPS){
  if(isMotorMode(mode))return stepMotorBrain(brain,inputs,mode,arguments.length>=4?steps:undefined);
  if(!Object.hasOwn(CONTROLLERS,mode)||!Array.isArray(inputs)||inputs.length!==2||inputs.some(v=>!Number.isFinite(v)||v<0||v>1))throw new Error('Invalid neural input');
  if(!Number.isInteger(steps)||steps<1||steps>64)throw new Error('Invalid neural step count');
  if(mode==='utility')return brain;
  const drive=[...inputs];let activity=Float32Array.from(brain.activity);
  const incoming=new Float32Array(activity.length),next=new Float32Array(activity.length);
  for(let substep=0;substep<steps;substep++){
    incoming.fill(0);
    if(mode==='malecns')for(let e=0;e<edgeFrom.length;e++)incoming[edgeTo[e]]+=edgeWeight[e]*activity[edgeFrom[e]];
    for(let i=0;i<activity.length;i++)next[i]=incoming[i];
    for(const [side,indices] of Object.entries(inputIndices))for(const i of indices)next[i]+=NEURAL_AMPLITUDE*drive[side==='L'?0:1];
    for(let i=0;i<activity.length;i++)next[i]=(1-NEURAL_LEAK)*activity[i]+NEURAL_LEAK*Math.tanh(next[i]);
    activity.set(next);
  }
  brain.activity=Array.from(activity);brain.steps+=steps;brain.inputs=drive;
  brain.outputs=['L','R'].map(side=>outputIndices[side].reduce((sum,i)=>sum+activity[i],0)/outputIndices[side].length);
  brain.trace.push({step:brain.steps,inputs:[...drive],outputs:[...brain.outputs]});
  if(brain.trace.length>40)brain.trace.shift();
  return brain;
}
export function neuralReadout(brain,traits,mode){
  const outputs=mode==='utility'?[0,0]:brain.outputs;
  const rawDrive=Math.max(...outputs),gain=2*(traits.reactivity??.5),drive=rawDrive*gain;
  // Engineered temperament decoder; there are no Warhammer races in the data.
  const threshold=.025+.075*(1-traits.caution)+.035*traits.aggression;
  return {outputs:[...outputs],rawDrive,gain,drive,threshold,triggered:mode!=='utility'&&drive>threshold,side:outputs[0]>outputs[1]?'L':'R'};
}
export function validateBrain(b,maxTicks){
  if(isMotorBrain(b))return validateMotorBrain(b,maxTicks);
  const finite=(x,lo=0,hi=1)=>Number.isFinite(x)&&x>=lo&&x<=hi;
  const pair=x=>Array.isArray(x)&&x.length===2&&x.every(v=>finite(v));
  if(!b||b.model!==CONNECTOME_SHA256||!Array.isArray(b.activity)||b.activity.length!==CONNECTOME.neurons.length||!b.activity.every(v=>finite(v))||
    !Number.isInteger(b.steps)||b.steps<0||b.steps>maxTicks*NEURAL_STEPS||b.steps%NEURAL_STEPS!==0||!pair(b.inputs)||!pair(b.outputs)||
    !Array.isArray(b.trace)||b.trace.length>40||b.trace.some((t,i)=>!t||!Number.isInteger(t.step)||t.step<1||t.step>b.steps||t.step%NEURAL_STEPS!==0||!pair(t.inputs)||!pair(t.outputs)||(i>0&&t.step<=b.trace[i-1].step)))return false;
  const actual=['L','R'].map(side=>outputIndices[side].reduce((sum,i)=>sum+b.activity[i],0)/outputIndices[side].length);
  return actual.every((x,i)=>Math.abs(x-b.outputs[i])<1e-8);
}
export function copyBrain(b){if(isMotorBrain(b))return copyMotorBrain(b);return {model:b.model,activity:[...b.activity],steps:b.steps,inputs:[...b.inputs],outputs:[...b.outputs],trace:b.trace.map(t=>({step:t.step,inputs:[...t.inputs],outputs:[...t.outputs]}))};}
