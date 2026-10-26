import {clamp} from './full-network.mjs';
import {bodyPoint,legPoint,fieldAt,contactAt,soundAt,raySpectrum} from './sensory-world.mjs';
export const SENSES=Object.freeze({vision:'Зрение',smell:'Обоняние',taste:'Вкус / контактная химия',touch:'Осязание',hearing:'Звук',wind:'Механика антенн / ветер',proprioception:'Положение и нагрузка',temperature:'Температура',humidity:'Влажность'});
export const DEFAULT_SENSE_MASK=Object.freeze(Object.fromEntries(Object.keys(SENSES).map(k=>[k,true])));
export function validateMask(mask){if(!mask||Object.keys(mask).length!==Object.keys(SENSES).length||Object.keys(SENSES).some(k=>typeof mask[k]!=='boolean'))throw Error('Invalid sense mask');return {...mask};}
const legNerves={ProLN:0,ProAN:0,VProN:0,ProCN:0,MesoLN:1,MetaLN:2};
export class SensoryPorts {
  constructor(atlas,retina){
    this.atlas=atlas;this.retina=retina;this.ports=[];this.unmapped=[];this.retinal=[];this.columns=[];this.coverage={};
    this.motor=Array.from({length:6},()=>[]);this.odorTypes=new Set();
    const columnIndex=new Map();
    for(const side of ['L','R']){
      const raw=retina.columns[side].map(([q,r])=>({q,r,x:(q-r)*Math.sqrt(3)/2,y:(q+r)/2}));
      const xs=raw.map(v=>v.x),ys=raw.map(v=>v.y),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
      for(const c of raw){
        const u=(c.x-minX)/Math.max(1,maxX-minX),v=(c.y-minY)/Math.max(1,maxY-minY),mirror=side==='L'?-1:1;
        // Engineering optical projection. Column identity is anatomical; angles are not measured.
        const item={...c,side,u,v,azimuth:mirror*(85+(u-.5)*190)*Math.PI/180,elevation:(v-.5)*140*Math.PI/180};
        columnIndex.set(side+':'+c.q+':'+c.r,this.columns.length);this.columns.push(item);
      }
    }
    for(const r of retina.photoreceptors){
      if(!Number.isInteger(r.index)||r.index<0||r.index>=atlas.n||atlas.value(r.index,'bodyId')!==r.bodyId)throw Error('Retina/body identity mismatch');
      const weights=r.columns.map(([q,h,w])=>[columnIndex.get(r.side+':'+q+':'+h),w]);
      if(weights.some(([i,w])=>i===undefined||!Number.isFinite(w)||w<=0))throw Error('Invalid retina column');
      this.retinal.push({...r,weights,total:weights.reduce((s,x)=>s+x[1],0)});
    }
    const mappedRetina=new Set(this.retinal.map(r=>r.index));
    for(let i=0;i<atlas.n;i++){
      const superclass=atlas.value(i,'superclass'),type=atlas.value(i,'type')||'',cls=atlas.value(i,'class'),sub=atlas.value(i,'subclass'),side=atlas.side(i),nerve=atlas.value(i,'entryNerve');
      if(superclass==='vnc_motor'&&['fl','ml','hl'].includes(sub)&&['L','R'].includes(side))this.motor[['fl','ml','hl'].indexOf(sub)*2+(side==='R'?1:0)].push(i);
      if(!superclass.includes('sensory'))continue;
      if(mappedRetina.has(i)){this.count('vision');continue;}
      const leg=legNerves[nerve]!==undefined&&['L','R'].includes(side)?legNerves[nerve]*2+(side==='R'?1:0):null;
      let sense=null,probe='antenna';
      if(cls==='olfactory'&&type){sense='smell';this.odorTypes.add(type);}
      else if(cls==='gustatory'||cls==='chemosensory'){
        if(leg!==null){sense='taste';probe='leg';}
        else if(['labellar bristle','taste peg'].includes(sub)){sense='taste';probe='mouth';}
      }
      else if(cls==='mechanosensory_tactile'){
        if(leg!==null){sense='touch';probe='leg';}else if(sub==='notum'||sub==='mechanosensory bristle'){sense='touch';probe='body';}
      }
      else if(cls==='mechanosensory'&&sub==='auditory')sense='hearing';
      else if(cls==='mechanosensory'&&sub==='wind_gravity')sense='wind';
      else if(cls==='mechanosensory_proprioceptive'){
        if(leg!==null){sense='proprioception';probe='leg';}else if(sub==='haltere'){sense='proprioception';probe='rotation';}
      }
      else if(cls==='thermosensory')sense='temperature';
      else if(cls==='hygrosensory')sense='humidity';
      if(sense){this.ports.push({index:i,sense,probe,side,leg,type,sub});this.count(sense);}
      else this.unmapped.push({index:i,bodyId:atlas.value(i,'bodyId'),class:cls,subclass:sub,type,reason:cls==='visual'?'no_anatomical_column':'missing_body_or_tuning_contract'});
    }
    this.odorTypes=[...this.odorTypes].sort();this.stimulus=new Float32Array(atlas.n);
  }
  count(key){this.coverage[key]=(this.coverage[key]||0)+1;}
  sample(world,mask=DEFAULT_SENSE_MASK){
    const stimulus=this.stimulus;stimulus.fill(0);const pixels=this.columns.map(c=>raySpectrum(world,c.azimuth,c.elevation));
    const metrics=Object.fromEntries(Object.keys(SENSES).map(k=>[k,{mean:0,max:0,count:this.coverage[k]||0,enabled:mask[k]}]));
    const record=(sense,i,value)=>{const v=mask[sense]?clamp(value):0;stimulus[i]=v;metrics[sense].mean+=v;metrics[sense].max=Math.max(metrics[sense].max,v);};
    for(const r of this.retinal){
      const bands=[0,0,0];for(const [j,w] of r.weights)for(let k=0;k<3;k++)bands[k]+=pixels[j].spectrum[k]*w/r.total;
      const t=r.type;let v=t==='R1-R6'?.25*bands[0]+.4*bands[1]+.35*bands[2]:/^R7[ypd]$/.test(t)||t==='R8d'?bands[0]:t==='R8p'?bands[1]:t==='R8y'?bands[2]:(bands[0]+bands[1]+bands[2])/3;
      record('vision',r.index,v);
    }
    const b=world.body;
    for(const p of this.ports){
      const lateral=p.side==='L'?-.35:p.side==='R'?.35:0;
      const point=p.probe==='leg'?legPoint(b,p.leg):bodyPoint(b,p.probe==='mouth'?.55:p.probe==='body'?0:.45,lateral);
      const [x,y]=point;let v=0;
      if(p.sense==='smell')v=fieldAt(world,'odor:'+p.type,x,y);
      else if(p.sense==='temperature'||p.sense==='humidity')v=fieldAt(world,p.sense,x,y);
      else if(p.sense==='taste')v=contactAt(world,x,y).taste;
      else if(p.sense==='touch')v=contactAt(world,x,y).touch;
      else if(p.sense==='hearing')v=soundAt(world,x,y);
      else if(p.sense==='wind'){const angle=b.heading+(p.side==='L'?-.7:.7);v=Math.abs(world.wind[0]*Math.cos(angle)+world.wind[1]*Math.sin(angle))*.7+Math.abs(b.omega)*.05;}
      else if(p.sense==='proprioception'){
        if(p.probe==='rotation')v=Math.abs(b.omega)/3;
        else if(p.sub==='campaniform sensilla')v=b.loads[p.leg];
        else if(p.sub==='hair plate')v=Math.abs(b.joints[p.leg]);
        else v=.4*Math.abs(b.joints[p.leg])+.3*Math.abs(b.jointVelocity[p.leg])+.3*b.loads[p.leg];
      }
      record(p.sense,p.index,v);
    }
    for(const m of Object.values(metrics))m.mean/=Math.max(1,m.count);
    return {stimulus,pixels,metrics};
  }
  motors(activity){return this.motor.map(group=>group.length?clamp(group.reduce((s,i)=>s+activity[i],0)/group.length):0);}
  inventory(){return {coverage:{...this.coverage},unmapped:this.unmapped.length,unmappedClasses:this.unmapped.reduce((a,r)=>{const key=r.class||'unassigned';a[key]=(a[key]||0)+1;return a;},{}),motorCells:this.motor.map(g=>g.length),odorTypes:this.odorTypes,retinalColumns:this.columns.length,retinalMapped:this.retinal.length};}
}
