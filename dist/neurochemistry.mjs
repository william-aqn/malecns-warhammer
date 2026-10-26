// Predicted transmitter identity is data; receptor-independent signs are model assumptions.
import {NEUROTRANSMITTER_DATA,NEUROTRANSMITTER_SHA256} from './data/malecns-neurotransmitters.mjs';
export {NEUROTRANSMITTER_DATA,NEUROTRANSMITTER_SHA256};
export const CHEMISTRIES={unsigned:'Без медиаторов · все связи +',nt:'Медиаторы · глутамат −','nt-glu-positive':'Медиаторы · глутамат +'};
export const TRANSMITTER_NAMES={acetylcholine:'Ацетилхолин',gaba:'ГАМК',glutamate:'Глутамат',dopamine:'Дофамин',serotonin:'Серотонин',octopamine:'Октопамин',unclear:'Не определён'};
export const TRANSMITTER_COLORS={acetylcholine:'#d5bd77',gaba:'#86b8e0',glutamate:'#c59abf',dopamine:'#e39c74',serotonin:'#8ccea0',octopamine:'#caacdf',unclear:'#899087'};
const transmitterRows=new Map(NEUROTRANSMITTER_DATA.records.map(r=>[r[0],r]));
export const chemistryOf=brain=>brain.chemistry??'unsigned';
export function chemistryState(chemistry='unsigned'){
  if(!Object.hasOwn(CHEMISTRIES,chemistry))throw Error('Unknown neurotransmitter model');
  return {chemistry,transmitters:chemistry==='unsigned'?null:NEUROTRANSMITTER_SHA256};
}
export function validateChemistry(brain){
  if(brain.chemistry===undefined)return brain.transmitters===undefined;
  return Object.hasOwn(CHEMISTRIES,brain.chemistry)&&brain.transmitters===(brain.chemistry==='unsigned'?null:NEUROTRANSMITTER_SHA256);
}
export function transmitterInfo(bodyId){
  const r=transmitterRows.get(bodyId);
  if(!r)return {bodyId,consensus:'unclear',prediction:null,confidence:null,samples:0,groundTruth:null,typePrediction:null,typeConfidence:null,typeSamples:0};
  return {bodyId,consensus:r[1]??'unclear',prediction:r[2],confidence:r[3],samples:r[4],groundTruth:r[5],typePrediction:r[6],typeConfidence:r[7],typeSamples:r[8]};
}
export function transmitterPolarity(label,chemistry='nt'){
  if(!Object.hasOwn(CHEMISTRIES,chemistry))throw Error('Unknown neurotransmitter model');
  if(chemistry==='unsigned')return 1;
  if(label==='acetylcholine')return 1;
  if(label==='gaba')return -1;
  if(label==='glutamate')return chemistry==='nt-glu-positive'?1:-1;
  // Unknown labels and slow modulators have no assumed fast effect. They are
  // retained as annotations; receptors, cotransmission and modulation are not reconstructed.
  return 0;
}
export function transmitterWeights(neurons,sources,base,chemistry){
  if(chemistry==='unsigned')return base;
  const signs=Float32Array.from(neurons,n=>transmitterPolarity(transmitterInfo(n.bodyId).consensus,chemistry));
  return Float32Array.from(base,(weight,e)=>weight*signs[sources[e]]);
}
export const rectifiedRate=value=>Math.max(0,Math.tanh(value));
const transmitterSummaries=new WeakMap();
export function transmitterSummary(neurons,chemistry){
  let cache=transmitterSummaries.get(neurons);if(!cache){cache=new Map();transmitterSummaries.set(neurons,cache);}
  if(cache.has(chemistry))return cache.get(chemistry);
  const summary={neurons:neurons.length,excitatory:0,inhibitory:0,unresolved:0,labels:{},groundTruth:0};
  for(const neuron of neurons){
    const info=transmitterInfo(neuron.bodyId),label=info.consensus,sign=transmitterPolarity(label,chemistry);
    summary.labels[label]=(summary.labels[label]??0)+1;summary[sign>0?'excitatory':sign<0?'inhibitory':'unresolved']++;
    if(info.groundTruth)summary.groundTruth++;
  }
  cache.set(chemistry,summary);return summary;
}
