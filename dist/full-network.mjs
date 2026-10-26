// Full annotated MaleCNS rate model. Anatomy is immutable; physiology is explicit.
export const FULL_MODEL_VERSION='full-cns-rate-v1';
export const DEFAULT_DYNAMICS=Object.freeze({tonic:.12,gain:.7,leak:.5,substeps:4,gluSign:-1,connected:true,da:0,oa:0,serotonin:0});
export const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
export function validateDynamics(value={}){
  const p={...DEFAULT_DYNAMICS,...value};
  if(Object.keys(p).some(k=>!Object.hasOwn(DEFAULT_DYNAMICS,k))||!Number.isFinite(p.tonic)||p.tonic<0||p.tonic>.5||!Number.isFinite(p.gain)||p.gain<0||p.gain>2||!Number.isFinite(p.leak)||p.leak<=0||p.leak>1||!Number.isInteger(p.substeps)||p.substeps<1||p.substeps>32||![-1,1].includes(p.gluSign)||typeof p.connected!=='boolean'||['da','oa','serotonin'].some(k=>!Number.isFinite(p[k])||Math.abs(p[k])>2))throw Error('Invalid full-CNS dynamics');
  return p;
}
export class Atlas {
  constructor(data){
    if(data.schema!==1||!Array.isArray(data.columns)||!Array.isArray(data.records))throw Error('Invalid neuron annotations');
    this.columns=data.columns;this.rows=data.records;this.c=Object.fromEntries(data.columns.map((x,i)=>[x,i]));this.n=this.rows.length;
    for(const k of ['bodyId','superclass','class','type','somaSide','rootSide','nt_consensus_nt'])if(this.c[k]===undefined)throw Error('Missing annotation '+k);
    this.groups={};this.byId=new Map();this.nt=new Uint8Array(this.n);
    const codes={acetylcholine:1,gaba:2,glutamate:3,histamine:4,dopamine:5,octopamine:6,serotonin:7};
    for(let i=0;i<this.n;i++){
      const id=this.value(i,'bodyId');if(!Number.isSafeInteger(id)||this.byId.has(id))throw Error('Duplicate/invalid body ID');this.byId.set(id,i);
      this.nt[i]=codes[this.value(i,'nt_consensus_nt')]??0;
      const key=this.value(i,'superclass');(this.groups[key]??=[]).push(i);
    }
  }
  value(i,key){return this.rows[i]?.[this.c[key]]??null;}
  side(i){return this.value(i,'rootSide')||this.value(i,'somaSide');}
  neuron(i){return Object.fromEntries(this.columns.map((key,j)=>[key,this.rows[i][j]]));}
}
export function parseFullGraph(buffer,expected){
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<32)throw Error('Truncated full graph');
  const view=new DataView(buffer),magic=new TextDecoder().decode(new Uint8Array(buffer,0,8));
  const n=view.getUint32(8,true),e=view.getUint32(12,true);
  if(magic!=='MCNSF001'||view.getUint32(16,true)!==1||n<1||n>300000||e>100000000||buffer.byteLength!==32+4*(2*n+1+2*e)||expected&&(n!==expected.neurons||e!==expected.edges))throw Error('Full graph format/count mismatch');
  if(new Uint8Array(new Uint32Array([1]).buffer)[0]!==1)throw Error('Little-endian runtime required');
  let p=32;const offsets=new Uint32Array(buffer,p,n+1);p+=4*(n+1);
  const sources=new Uint32Array(buffer,p,e);p+=4*e;const contacts=new Uint32Array(buffer,p,e);p+=4*e;
  const incoming=new Uint32Array(buffer,p,n);
  if(offsets[0]!==0||offsets[n]!==e)throw Error('Invalid CSR offsets');
  for(let i=0;i<n;i++)if(offsets[i]>offsets[i+1])throw Error('Invalid CSR order');
  for(let k=0;k<e;k++)if(sources[k]>=n||contacts[k]===0)throw Error('Invalid graph edge');
  return {n,e,offsets,sources,contacts,incoming};
}
export class FullNetwork {
  constructor(graph,atlas,identity,dynamics={}){
    if(graph.n!==atlas.n)throw Error('Graph/annotation count mismatch');
    this.graph=graph;this.atlas=atlas;this.identity=identity;this.dynamics=validateDynamics(dynamics);
    this.activity=new Float32Array(graph.n);this.next=new Float32Array(graph.n);this.weights=new Float32Array(graph.e);
    this.slow=[new Float32Array(graph.n),new Float32Array(graph.n),new Float32Array(graph.n)];this.steps=0;
    const modFrom=[],modTo=[],modWeight=[],modKind=[];
    const {n,offsets,sources,contacts,incoming}=graph;
    for(let row=0;row<n;row++)for(let k=offsets[row];k<offsets[row+1];k++){
      const nt=atlas.nt[sources[k]];if(nt>=5){modFrom.push(sources[k]);modTo.push(row);modWeight.push(contacts[k]/Math.max(1,incoming[row]));modKind.push(nt-5);}
    }
    this.mod={from:Uint32Array.from(modFrom),to:Uint32Array.from(modTo),weight:Float32Array.from(modWeight),kind:Uint8Array.from(modKind)};
    this.modSums=[new Float32Array(n),new Float32Array(n),new Float32Array(n)];this.compileWeights();
  }
  configure(p){const next=validateDynamics({...this.dynamics,...p}),changed=next.gluSign!==this.dynamics.gluSign;this.dynamics=next;if(changed)this.compileWeights();}
  compileWeights(){
    const {n,offsets,sources,contacts,incoming}=this.graph,sign=[0,1,-1,this.dynamics.gluSign,-1,0,0,0];
    for(let row=0;row<n;row++)for(let k=offsets[row];k<offsets[row+1];k++)this.weights[k]=sign[this.atlas.nt[sources[k]]]*contacts[k]/Math.max(1,incoming[row]);
  }
  step(stimulus){
    const {n,offsets,sources}=this.graph,p=this.dynamics;
    if(!(stimulus instanceof Float32Array)||stimulus.length!==n)throw Error('Invalid sensory vector');
    for(const v of stimulus)if(!Number.isFinite(v)||v<0||v>1)throw Error('Invalid sensory value');
    for(let step=0;step<p.substeps;step++){
      const a=this.activity,next=this.next;
      for(const sum of this.modSums)sum.fill(0);
      if(p.connected){const m=this.mod;for(let k=0;k<m.from.length;k++)this.modSums[m.kind[k]][m.to[k]]+=m.weight[k]*a[m.from[k]];}
      for(let i=0;i<n;i++){
        let sum=0;if(p.connected)for(let k=offsets[i];k<offsets[i+1];k++)sum+=this.weights[k]*a[sources[k]];
        for(let j=0;j<3;j++)this.slow[j][i]=.95*this.slow[j][i]+.05*this.modSums[j][i];
        // Receptor gains are user hypotheses; default 0 means monitor only.
        const modulation=clamp(1+p.da*this.slow[0][i]+p.oa*this.slow[1][i]+p.serotonin*this.slow[2][i],.25,2);
        const target=Math.max(0,Math.tanh(p.tonic+modulation*p.gain*sum+.8*stimulus[i]));
        next[i]=(1-p.leak)*a[i]+p.leak*target;
      }
      this.activity=next;this.next=a;this.steps++;
    }
  }
  summary(){
    const classes={};for(const [key,indices] of Object.entries(this.atlas.groups)){
      let sum=0,max=0,active=0;for(const i of indices){const a=this.activity[i];sum+=a;max=Math.max(max,a);if(a>1e-6)active++;}
      classes[key]={count:indices.length,mean:sum/indices.length,max,active};
    }
    return {steps:this.steps,classes,modulators:this.slow.map(a=>{let sum=0,max=0;for(const v of a){sum+=v;max=Math.max(max,v);}return {mean:sum/a.length,max};})};
  }
  snapshot(){return {model:FULL_MODEL_VERSION,identity:this.identity,steps:this.steps,dynamics:{...this.dynamics},activity:Array.from(this.activity),slow:this.slow.map(a=>Array.from(a))};}
  restore(s){
    const valid=a=>Array.isArray(a)&&a.length===this.graph.n&&a.every(v=>Number.isFinite(v)&&v>=0&&v<=1);
    if(s?.model!==FULL_MODEL_VERSION||s.identity!==this.identity||!Number.isSafeInteger(s.steps)||s.steps<0||s.steps>1e9||!valid(s.activity)||!Array.isArray(s.slow)||s.slow.length!==3||!s.slow.every(valid))throw Error('Snapshot model/graph/state mismatch');
    const p=validateDynamics(s.dynamics);this.configure(p);this.activity=Float32Array.from(s.activity);this.next.fill(0);this.slow=s.slow.map(a=>Float32Array.from(a));this.steps=s.steps;
  }
}
