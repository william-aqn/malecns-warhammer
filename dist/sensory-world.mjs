// Synthetic arena and body. Units are laboratory units, not measured fly physiology.
import {clamp} from './full-network.mjs';
export const WORLD_VERSION='sensory-arena-v1';
export const DT=.1;
export function seeded(seed){let x=2166136261;for(const c of String(seed))x=Math.imul(x^c.charCodeAt(0),16777619);return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296;};}
export function createWorld(seed='40721',preset='arena'){
  const width=24,height=18,walls=Array(width*height).fill(0),random=seeded(seed);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(!x||!y||x===width-1||y===height-1)walls[y*width+x]=1;
  if(preset==='arena')for(let y=3;y<15;y++)if(y!==8&&y!==9)walls[y*width+12]=1;
  if(preset==='random')for(let k=0;k<30;k++){const x=7+Math.floor(random()*14),y=2+Math.floor(random()*14);walls[y*width+x]=1;}
  const objects=[
    {id:'light',kind:'light',x:9,y:6,radius:.6,height:1.6,spectrum:[.15,.9,.25],power:1,motion:true},
    {id:'odor',kind:'odor',x:16,y:9,radius:.55,height:.8,spectrum:[.25,.35,.9],power:1,channel:'ORN_DM1'},
    {id:'sound',kind:'sound',x:7,y:14,radius:.4,height:1.2,spectrum:[.6,.3,.4],power:1,frequency:2},
    {id:'taste',kind:'taste',x:6,y:9,radius:.65,height:.05,spectrum:[.25,.5,.4],power:1},
    {id:'climate',kind:'climate',x:18,y:5,radius:.6,height:.6,spectrum:[.5,.3,.5],power:1}
  ];
  for(const o of objects)walls[Math.floor(o.y)*width+Math.floor(o.x)]=0;
  return {version:WORLD_VERSION,seed:String(seed),width,height,walls,objects,time:0,light:1,wind:[.2,0],fields:{},
    body:{x:5,y:9,heading:0,radius:.28,z:.65,velocity:[0,0],omega:0,collision:0,phase:Array(6).fill(0),joints:Array(6).fill(0),jointVelocity:Array(6).fill(0),loads:Array(6).fill(0)}};
}
export function wall(world,x,y){const ix=Math.floor(x),iy=Math.floor(y);return ix<0||iy<0||ix>=world.width||iy>=world.height||world.walls[iy*world.width+ix]!==0;}
function clearBody(world,x,y){const r=world.body.radius;for(const [dx,dy] of [[0,0],[r,0],[-r,0],[0,r],[0,-r],[r*.707,r*.707],[-r*.707,r*.707],[r*.707,-r*.707],[-r*.707,-r*.707]])if(wall(world,x+dx,y+dy))return false;return true;}
export function bodyPoint(body,forward,lateral){const c=Math.cos(body.heading),s=Math.sin(body.heading);return [body.x+forward*c-lateral*s,body.y+forward*s+lateral*c];}
export function legPoint(body,index){return bodyPoint(body,[.45,0,-.45][Math.floor(index/2)],index%2?.45:-.45);}
export function advanceBody(world,legs,{clamped=true,manual=null}={}){
  const b=world.body;if(!Array.isArray(legs)||legs.length!==6||legs.some(v=>!Number.isFinite(v)||v<0||v>1))throw Error('Invalid motor command');
  const left=(legs[0]+legs[2]+legs[4])/3,right=(legs[1]+legs[3]+legs[5])/3;
  let speed=2*(left+right)/2,turn=3*(left-right);
  if(manual){speed=manual==='forward'?1:manual==='backward'?-1:0;turn=manual==='left'?-1:manual==='right'?1:0;}
  if(clamped){speed=0;turn=0;}
  const oldX=b.x,oldY=b.y,oldHeading=b.heading;
  b.heading=Math.atan2(Math.sin(b.heading+turn*DT),Math.cos(b.heading+turn*DT));b.collision=0;
  const distance=speed*DT,steps=Math.max(1,Math.ceil(Math.abs(distance)/(b.radius/3)));
  for(let s=0;s<steps;s++){
    const x=b.x+Math.cos(b.heading)*distance/steps,y=b.y+Math.sin(b.heading)*distance/steps;
    if(clearBody(world,x,y)){b.x=x;b.y=y;}else{b.collision=1;break;}
  }
  b.velocity=[(b.x-oldX)/DT,(b.y-oldY)/DT];b.omega=Math.atan2(Math.sin(b.heading-oldHeading),Math.cos(b.heading-oldHeading))/DT;
  const moved=Math.hypot(...b.velocity);
  for(let i=0;i<6;i++){
    const prev=b.joints[i];b.phase[i]=(b.phase[i]+moved*DT*5)% (2*Math.PI);b.joints[i]=.6*Math.sin(b.phase[i]+(i%2?Math.PI:0));b.jointVelocity[i]=(b.joints[i]-prev)/DT;
    b.loads[i]=clamped?0:clamp((Math.sin(b.phase[i]+(i%2?Math.PI:0))<=0?.4:0)+b.collision*.6);
  }
}
export function stepFields(world){
  const {width:w,height:h,walls}=world,size=w*h;
  const channels=new Set(['temperature','humidity',...world.objects.filter(o=>o.kind==='odor').map(o=>'odor:'+o.channel)]);
  for(const channel of channels){
    const base=channel==='temperature'?.3:channel==='humidity'?.4:0;
    const old=world.fields[channel]??new Float32Array(size).fill(base),next=new Float32Array(size);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x;if(walls[i]){next[i]=base;continue;}
      const center=old[i],sample=(nx,ny)=>nx<0||ny<0||nx>=w||ny>=h||walls[ny*w+nx]?center:old[ny*w+nx];
      const lap=sample(x-1,y)+sample(x+1,y)+sample(x,y-1)+sample(x,y+1)-4*center;
      const wx=world.wind[0],wy=world.wind[1],advection=Math.abs(wx)*(sample(x-(wx>=0?1:-1),y)-center)+Math.abs(wy)*(sample(x,y-(wy>=0?1:-1))-center);
      next[i]=clamp(center+DT*(.9*lap+advection-.08*(center-base)));
    }
    for(const o of world.objects){
      if(o.kind==='odor'&&channel==='odor:'+o.channel||o.kind==='climate'&&['temperature','humidity'].includes(channel)){
        const i=Math.floor(o.y)*w+Math.floor(o.x);if(!walls[i])next[i]=clamp(next[i]+DT*o.power);
      }
    }
    world.fields[channel]=next;
  }
  // Retired odor channels decay as well; no lingering infinite source after editing.
  for(const channel of Object.keys(world.fields))if(!channels.has(channel)){world.fields[channel]=Float32Array.from(world.fields[channel],v=>v*.97);}
  world.time+=DT;
  for(const o of world.objects)if(o.motion){const x=9+Math.sin(world.time*.6)*1.5,y=6+Math.sin(world.time*.35);if(!wall(world,x,y)){o.x=x;o.y=y;}}
}
export function fieldAt(world,channel,x,y){
  const a=world.fields[channel],base=channel==='temperature'?.3:channel==='humidity'?.4:0;if(!a||wall(world,x,y))return base;
  const ix=clamp(Math.floor(x),0,world.width-1),iy=clamp(Math.floor(y),0,world.height-1);return a[iy*world.width+ix];
}
export function contactAt(world,x,y){
  let touch=0,taste=0;for(const [dx,dy] of [[0,0],[.12,0],[-.12,0],[0,.12],[0,-.12]])if(wall(world,x+dx,y+dy))touch=1;
  for(const o of world.objects)if(Math.hypot(x-o.x,y-o.y)<o.radius){if(o.height>.1)touch=1;if(o.kind==='taste')taste=Math.max(taste,o.power);}
  return {touch,taste};
}
export function soundAt(world,x,y){
  let sum=0;for(const o of world.objects)if(o.kind==='sound'){
    const d=Math.hypot(x-o.x,y-o.y);let attenuation=1;
    const steps=Math.max(1,Math.ceil(d*4));for(let i=1;i<steps;i++)if(wall(world,x+(o.x-x)*i/steps,y+(o.y-y)*i/steps)){attenuation=.25;break;}
    // Low-frequency laboratory envelope; not an acoustic propagation solver.
    sum+=o.power/(1+d*.5)*attenuation*(.5+.5*Math.sin(2*Math.PI*o.frequency*world.time-d*.2));
  }return clamp(sum);
}
export function raySpectrum(world,azimuth,elevation){
  const b=world.body,angle=b.heading+azimuth,dx=Math.cos(angle)*Math.cos(elevation),dy=Math.sin(angle)*Math.cos(elevation),dz=Math.sin(elevation);
  let spectrum=[.55,.4,.25],distance=24;
  for(let t=.08;t<26;t+=.12){
    const x=b.x+dx*t,y=b.y+dy*t,z=b.z+dz*t;
    if(z<=0){const checker=(Math.floor(x)+Math.floor(y))%2===0; spectrum=checker?[.12,.22,.16]:[.04,.1,.08];distance=t;break;}
    if(wall(world,x,y)&&z<2){const stripe=(Math.floor(x*3)+Math.floor(y*3)+Math.floor(z*4))%2===0;spectrum=stripe?[.18,.27,.23]:[.05,.09,.08];distance=t;break;}
    let hit=false;
    for(const o of world.objects)if(z>=0&&z<=o.height&&Math.hypot(x-o.x,y-o.y)<o.radius){spectrum=o.spectrum.map(v=>v*(o.kind==='light'?o.power:1));distance=t;hit=true;break;}
    if(hit)break;
  }
  // Only photons reach neural sensory ports: depth is diagnostic UI data.
  return {spectrum:spectrum.map(v=>clamp(v*world.light)),distance};
}
export function validateWorld(input){
  const s=structuredClone(input),finite=(v,a,b)=>Number.isFinite(v)&&v>=a&&v<=b,arr=(a,n,lo,hi)=>Array.isArray(a)&&a.length===n&&a.every(v=>finite(v,lo,hi));
  if(s?.version!==WORLD_VERSION||!Number.isInteger(s.width)||s.width<8||s.width>64||!Number.isInteger(s.height)||s.height<8||s.height>64||!arr(s.walls,s.width*s.height,0,1)||!s.walls.every(Number.isInteger)||!finite(s.time,0,1e8)||!finite(s.light,0,2)||!arr(s.wind,2,-1,1)||typeof s.seed!=='string'||s.seed.length>64||!Array.isArray(s.objects)||s.objects.length>32)throw Error('Invalid arena');
  const ids=new Set();for(const o of s.objects){if(typeof o.id!=='string'||ids.has(o.id)||!['light','odor','sound','taste','climate'].includes(o.kind)||!finite(o.x,0,s.width-1)||!finite(o.y,0,s.height-1)||wall(s,o.x,o.y)||!finite(o.radius,.05,2)||!finite(o.height,0,3)||!finite(o.power,0,1)||!arr(o.spectrum,3,0,1)||o.kind==='odor'&&(typeof o.channel!=='string'||o.channel.length>64)||o.kind==='sound'&&!finite(o.frequency,.1,5)||o.motion!==undefined&&typeof o.motion!=='boolean')throw Error('Invalid arena source');ids.add(o.id);}
  const b=s.body;if(!b||!finite(b.x,0,s.width)||!finite(b.y,0,s.height)||!finite(b.radius,.1,.5)||!finite(b.z,.1,1.5)||!finite(b.heading,-Math.PI,Math.PI)||!arr(b.velocity,2,-5,5)||!finite(b.omega,-5,5)||!finite(b.collision,0,1)||!arr(b.phase,6,0,2*Math.PI)||!arr(b.joints,6,-1,1)||!arr(b.jointVelocity,6,-20,20)||!arr(b.loads,6,0,1)||!clearBody(s,b.x,b.y))throw Error('Invalid body');
  if(!s.fields||typeof s.fields!=='object'||Array.isArray(s.fields)||Object.keys(s.fields).length>64)throw Error('Invalid fields');
  for(const [key,a] of Object.entries(s.fields)){if(!['temperature','humidity'].includes(key)&&!key.startsWith('odor:')||key.length>70||!arr(Array.from(a),s.width*s.height,0,1))throw Error('Invalid sensory field');s.fields[key]=Float32Array.from(a);}
  return s;
}
export function worldSnapshot(world){const s=structuredClone(world);for(const k of Object.keys(s.fields))s.fields[k]=Array.from(s.fields[k]);return s;}
