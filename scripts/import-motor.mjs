import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {decodeLz4,sha256,ASSETS} from './import-malecns.mjs';
const root=new URL('../',import.meta.url),graph=await readFile(new URL('.cache/malecns-upstream/connectome.fcl',root));
if(sha256(graph)!==ASSETS['connectome.fcl'].sha256)throw Error('Graph identity');
const csv=await readFile(new URL('.cache/malecns-upstream/neurons.csv',root),'utf8');
if(sha256(csv)!==ASSETS['neurons.csv'].sha256)throw Error('Annotation identity');
function csvRow(line){const row=[];let field='',quoted=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quoted&&line[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field='';}else field+=c;}row.push(field);return row;}
const lines=csv.trim().split(/\r?\n/),headers=csvRow(lines.shift()),neurons=lines.map(l=>Object.fromEntries(csvRow(l).map((v,i)=>[headers[i],v])));
const N=graph.readUInt32LE(8),E=graph.readUInt32LE(12),sources=new Uint16Array(E),contacts=new Uint16Array(E),offsets=new Uint32Array(N+1),incoming=new Uint32Array(N);
if(N!==48311||E!==9462135||neurons.length!==N||neurons.some((n,i)=>Number(n.execution_index)!==i))throw Error('Unexpected graph or annotation shape');
let position=20+4*N,destination=0,edge=0;
while(destination<N){
  const count=graph.readUInt32LE(position),ec=graph.readUInt32LE(position+4),raw=graph.readUInt32LE(position+8),packed=graph.readUInt32LE(position+12);position+=16;
  const b=decodeLz4(graph.subarray(position,position+packed),raw);position+=packed;let cursor=0;
  const varint=()=>{let value=0;for(let i=0;i<5;i++){if(cursor>=b.length)throw Error('Truncated');const v=b[cursor++];value+=(v&127)*2**(i*7);if(!(v&128))return value;}throw Error('varint');};
  const degrees=Array.from({length:count},varint);if(destination+count>N||degrees.reduce((sum,d)=>sum+d,0)!==ec)throw Error('Block dimensions');let index=edge;
  for(const degree of degrees){let previous=0;for(let i=0;i<degree;i++){const delta=varint();if(i>0&&delta===0)throw Error('Unsorted sources');previous+=delta;if(previous>=N)throw Error('Source index');sources[index++]=previous;}}
  for(let row=0;row<count;row++){offsets[destination]=edge;for(let j=0;j<degrees[row];j++){const w=varint();if(w<1||w>32767)throw Error('Contact count');contacts[edge++]=w;incoming[destination]+=w;}destination++;}
  if(cursor!==raw||index!==edge)throw Error('Block');
}
offsets[N]=edge;if(edge!==E||position!==graph.length||incoming.reduce((a,b)=>a+b,0)!==49481754)throw Error('Totals');
for(let i=0;i<N;i++)if(graph.readUInt32LE(20+i*4)!==Number(neurons[i].canonical_index))throw Error('Annotation order mismatch');
const sensor=n=>['LC4','LPLC2'].includes(n.type)||/^LC10/.test(n.type);
const outputTypes=['DNa01','DNa02','DNp09','MDN','DNp01','DNp02','DNp04','DNp11'];
const isInput=neurons.map(sensor),isOutput=neurons.map(n=>outputTypes.includes(n.type));
function forward(active){const result=new Uint8Array(N);for(let to=0;to<N;to++)for(let k=offsets[to];k<offsets[to+1];k++)if(active[sources[k]]){result[to]=1;break;}return result;}
function backward(active){const result=new Uint8Array(N);for(let to=0;to<N;to++)if(active[to])for(let k=offsets[to];k<offsets[to+1];k++)result[sources[k]]=1;return result;}
const f1=forward(isInput),f2=forward(f1),b1=backward(isOutput),b2=backward(b1);
const chosen=neurons.map((n,i)=>isInput[i]||isOutput[i]||f1[i]&&b1[i]||f1[i]&&b2[i]||f2[i]&&b1[i]);
const ids=chosen.flatMap((x,i)=>x?[i]:[]),local=new Int32Array(N).fill(-1);ids.forEach((id,i)=>local[id]=i);
const modelNeurons=ids.map(i=>({...neurons[i],sourceIndex:i,incomingTotal:incoming[i]})),edges=[];
for(const to of ids)for(let k=offsets[to];k<offsets[to+1];k++)if(local[sources[k]]>=0)edges.push([local[sources[k]],local[to],contacts[k]]);
const inputs={};for(const [key,filter] of Object.entries({threat:n=>['LC4','LPLC2'].includes(n.type),target:n=>/^LC10/.test(n.type)}))for(const side of ['L','R'])inputs[key+side]=modelNeurons.flatMap((n,i)=>filter(n)&&n.side===side?[i]:[]);
const outputs={};for(const type of outputTypes)for(const side of ['L','R'])outputs[type+side]=modelNeurons.flatMap((n,i)=>n.type===type&&n.side===side?[i]:[]);
const from=Uint16Array.from(edges,e=>e[0]),to=Uint16Array.from(edges,e=>e[1]),weights=Float32Array.from(edges,e=>.7*e[2]/modelNeurons[e[1]].incomingTotal);
const calibration={};
for(const [channel,stimulus] of Object.entries({target:{targetL:.5,targetR:.5},threat:{threatL:.5,threatR:.5}})){
  const activity=new Float32Array(ids.length),sums=new Float32Array(ids.length),input=new Float32Array(ids.length);
  for(const [key,strength] of Object.entries(stimulus))for(const i of inputs[key])input[i]=strength*.8;
  for(let step=0;step<32;step++){
    sums.fill(0);for(let e=0;e<from.length;e++)sums[to[e]]+=weights[e]*activity[from[e]];
    for(let i=0;i<activity.length;i++)activity[i]=.5*activity[i]+.5*Math.tanh(sums[i]+input[i]);
  }
  calibration[channel]=Object.fromEntries(Object.entries(outputs).map(([key,group])=>[key,group.reduce((sum,i)=>sum+activity[i],0)/group.length]));
}
const packed=Buffer.alloc((ids.length+1)*4+edges.length*4);let cursor=0,localEdge=0;
for(let row=0;row<ids.length;row++){
  packed.writeUInt32LE(localEdge,row*4);
  while(localEdge<edges.length&&edges[localEdge][1]===row){
    const [source,,weight]=edges[localEdge];cursor=(ids.length+1)*4+localEdge*4;
    packed.writeUInt16LE(source,cursor);packed.writeUInt16LE(weight,cursor+2);localEdge++;
  }
}
packed.writeUInt32LE(localEdge,ids.length*4);
if(localEdge!==edges.length)throw Error('Packed row count');
const data={
  schema:1,id:'malecns-visual-motor-11436',dataset:'male-cns:v1.0',license:'CC-BY-4.0',
  source:{url:'https://huggingface.co/slvDev/esp32-ai-fly',revision:'d36ff5e192da832c4348ab509d150357cb70ddd8',assets:ASSETS,nodes:N,edges:E},
  selection:'LC4/LPLC2 and LC10 inputs, DNa01/DNa02/DNp09/MDN and DNp01/02/04/11 outputs, plus all intermediate neurons on input-to-output paths of at most three anatomical edges. Full induced graph; no contact threshold. All other neurons omitted.',
  normalization:'Original unsigned contact counts divided by the full 48311-neuron source incoming total; omitted cells contribute zero.',
  counts:{neurons:ids.length,edges:edges.length,contacts:edges.reduce((sum,e)=>sum+e[2],0)},
  neurons:modelNeurons.map(n=>({sourceIndex:n.sourceIndex,bodyId:Number(n.body_id),type:n.type,side:n.side,kind:sensor(n)?'input':outputTypes.includes(n.type)?'output':'hidden',incomingTotal:n.incomingTotal})),
  inputs,outputs,calibration,
  calibrationNote:'32 zero-start rate steps for symmetric target or looming inputs at 0.5. Used only to scale the engineered motor decoder, not trained against combat rewards.'
};
const base64=packed.toString('base64'),digest=sha256(JSON.stringify(data)+base64);
await mkdir(new URL('dist/data/',root),{recursive:true});
await writeFile(new URL('dist/data/malecns-motor.mjs',root),'// Generated by scripts/import-motor.mjs. Anatomical data: CC BY 4.0.\nexport const MOTOR_MODEL = '+JSON.stringify(data)+';\nexport const MOTOR_PACKED = '+JSON.stringify(base64)+';\nexport const MOTOR_SHA256 = '+JSON.stringify(digest)+';\n');
await writeFile(new URL('data/motor-manifest.json',root),JSON.stringify({...data,neurons:undefined,inputs:undefined,outputs:undefined,sha256:digest,packedBytes:packed.length},null,2)+'\n');
console.log(JSON.stringify({counts:data.counts,sha256:digest,packedBytes:packed.length}));
