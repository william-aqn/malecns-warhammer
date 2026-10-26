import {FullNetwork,Atlas,parseFullGraph,validateDynamics} from './full-network.mjs';
import {SensoryPorts,DEFAULT_SENSE_MASK,validateMask} from './sensory-ports.mjs';
import {createWorld,stepFields,advanceBody,worldSnapshot,validateWorld,wall} from './sensory-world.mjs';
export class FullLab {
  constructor(buffer,annotations,retina,manifest){
    this.manifest=manifest;this.atlas=new Atlas(annotations);this.network=new FullNetwork(parseFullGraph(buffer,manifest.counts),this.atlas,manifest.files['graph.bin'].sha256);
    this.ports=new SensoryPorts(this.atlas,retina);this.mask={...DEFAULT_SENSE_MASK};this.clamped=true;this.world=createWorld();this.ticks=0;this.lastMs=0;this.sample=this.ports.sample(this.world,this.mask);
  }
  reset(seed='40721',preset='arena'){
    if(typeof seed!=='string'||seed.length>64||!['arena','random','open'].includes(preset))throw Error('Invalid arena seed/preset');
    this.world=createWorld(seed,preset);this.network.activity.fill(0);this.network.next.fill(0);this.network.slow.forEach(a=>a.fill(0));this.network.steps=0;this.ticks=0;this.lastMs=0;this.sample=this.ports.sample(this.world,this.mask);
  }
  configure(p={}){
    if(Object.keys(p).some(k=>!['dynamics','mask','clamped','light','wind','odor','sound'].includes(k)))throw Error('Unknown laboratory option');
    const dynamics=validateDynamics({...this.network.dynamics,...p.dynamics}),mask=p.mask?validateMask(p.mask):this.mask;
    if(p.clamped!==undefined&&typeof p.clamped!=='boolean'||p.light!==undefined&&(!Number.isFinite(p.light)||p.light<0||p.light>2)||p.wind!==undefined&&(!Array.isArray(p.wind)||p.wind.length!==2||p.wind.some(v=>!Number.isFinite(v)||Math.abs(v)>1))||p.odor!==undefined&&!this.ports.odorTypes.includes(p.odor)||p.sound!==undefined&&(!Number.isFinite(p.sound)||p.sound<0||p.sound>1))throw Error('Invalid laboratory option');
    this.network.configure(dynamics);this.mask={...mask};if(p.clamped!==undefined)this.clamped=p.clamped;if(p.light!==undefined)this.world.light=p.light;if(p.wind!==undefined)this.world.wind=[...p.wind];
    if(p.odor!==undefined)this.world.objects.find(o=>o.kind==='odor').channel=p.odor;
    if(p.sound!==undefined)this.world.objects.find(o=>o.kind==='sound').power=p.sound;
    this.sample=this.ports.sample(this.world,this.mask);
  }
  edit(p){
    const candidate=worldSnapshot(this.world),x=Number(p.x),y=Number(p.y);
    if(!Number.isFinite(x)||!Number.isFinite(y)||x<1||y<1||x>=candidate.width-1||y>=candidate.height-1)throw Error('Position outside arena');
    if(p.kind==='wall'){
      const ix=Math.floor(x),iy=Math.floor(y),i=iy*candidate.width+ix;candidate.walls[i]=1-candidate.walls[i];
      if(candidate.walls[i])for(const values of Object.values(candidate.fields))values[i]=0;
    }else if(p.kind==='body'){candidate.body.x=x;candidate.body.y=y;candidate.body.velocity=[0,0];candidate.body.omega=0;candidate.body.collision=0;}
    else if(p.kind==='source'){const o=candidate.objects.find(v=>v.id===p.id);if(!o)throw Error('Unknown source');o.x=x;o.y=y;o.motion=false;}
    else throw Error('Unknown arena edit');
    this.world=validateWorld(candidate);this.sample=this.ports.sample(this.world,this.mask);
  }
  step(manual=null){
    if(manual!==null&&!['forward','backward','left','right'].includes(manual))throw Error('Invalid manual movement');
    const start=performance.now();stepFields(this.world);this.sample=this.ports.sample(this.world,this.mask);
    this.network.step(this.sample.stimulus);const motors=this.ports.motors(this.network.activity);
    advanceBody(this.world,motors,{clamped:manual?false:this.clamped,manual});this.ticks++;this.lastMs=performance.now()-start;
    return this.view();
  }
  view(){
    // A returned sensory frame is the actual frame that fed the most recent neural step.
    return {ticks:this.ticks,lastMs:this.lastMs,learning:false,world:worldSnapshot(this.world),mask:{...this.mask},clamped:this.clamped,dynamics:{...this.network.dynamics},summary:this.network.summary(),motors:this.ports.motors(this.network.activity),metrics:this.sample.metrics,pixels:this.sample.pixels.map(p=>p.spectrum)};
  }
  metadata(){return {manifest:this.manifest,inventory:this.ports.inventory(),columns:this.ports.columns};}
  inspect(query){
    const text=String(query).trim();let index=this.atlas.byId.get(Number(text));if(index===undefined)index=this.atlas.rows.findIndex((_,i)=>(this.atlas.value(i,'type')||'').toLowerCase()===text.toLowerCase());
    if(index===undefined||index<0)return null;
    const g=this.network.graph,edges=[];for(let k=g.offsets[index];k<g.offsets[index+1];k++)edges.push({bodyId:this.atlas.value(g.sources[k],'bodyId'),type:this.atlas.value(g.sources[k],'type'),nt:this.atlas.value(g.sources[k],'nt_consensus_nt'),contacts:g.contacts[k],activity:this.network.activity[g.sources[k]]});
    edges.sort((a,b)=>b.contacts-a.contacts);
    return {index,annotation:this.atlas.neuron(index),activity:this.network.activity[index],stimulus:this.sample.stimulus[index],slow:this.network.slow.map(a=>a[index]),incomingEdges:edges.length,topIncoming:edges.slice(0,12),retinal:this.ports.retinal.find(r=>r.index===index)||null};
  }
  snapshot(){return {format:'malecns-full-lab',version:1,annotations:this.manifest.files['neurons.json'].sha256,retina:this.manifest.files['retina.json'].sha256,learning:false,ticks:this.ticks,world:worldSnapshot(this.world),mask:{...this.mask},clamped:this.clamped,network:this.network.snapshot()};}
  restore(s){
    if(s?.format!=='malecns-full-lab'||s.version!==1||s.learning!==false||s.annotations!==this.manifest.files['neurons.json'].sha256||s.retina!==this.manifest.files['retina.json'].sha256||!Number.isSafeInteger(s.ticks)||s.ticks<0||s.ticks>1e8||typeof s.clamped!=='boolean')throw Error('Snapshot version/identity mismatch');
    const world=validateWorld(s.world),mask=validateMask(s.mask);
    if(world.objects.filter(o=>o.kind==='odor').some(o=>!this.ports.odorTypes.includes(o.channel)))throw Error('Unknown odor channel');
    this.network.restore(s.network);this.world=world;this.mask=mask;this.clamped=s.clamped;this.ticks=s.ticks;this.sample=this.ports.sample(this.world,this.mask);this.lastMs=0;
  }
}
