import {CHEMISTRIES,chemistryOf} from './neurochemistry.mjs';
import {createExperience,copyExperience,validateExperience,experienceReadout,experienceChoice,experienceNovelty,visitExperience,addExperienceReward,beginExperience,settleExperience,carryExperience} from './experience.mjs';
import {isMotorMode,isMotorBrain,isAdaptiveMode,motorReadout} from './motor.mjs';
import {REFLEX_BURST,createReflex,stepReflex,reflexAllows,validateReflex,copyReflex} from './reflex.mjs';
import {CONTROLLERS,createBrain,stepBrain,neuralReadout,validateBrain,copyBrain} from './neural.mjs';
// Pure deterministic simulation: no browser, clock or network dependencies.
export const VERSION=9, W=32, H=22, MAX_TICKS=180, WIN_SCORE=65;
export const TERRAIN={FLOOR:0,WALL:1,COVER:2};
export const FACTIONS={
  marines:{name:'Space Marines',short:'Astartes',description:'Согласованное продвижение и контроль позиций.',aggression:.62,caution:.67,objective:.85,hp:30,damage:6,range:6},
  orks:{name:'Orks',short:'Orks',description:'Напор, сближение и готовность рисковать.',aggression:.95,caution:.23,objective:.48,hp:33,damage:7,range:4},
  necrons:{name:'Necrons',short:'Necrons',description:'Удержание рубежей и методичный огонь.',aggression:.55,caution:.75,objective:.88,hp:36,damage:6,range:6},
  tyranids:{name:'Tyranids',short:'Tyranids',description:'Быстрое давление и атака ослабленных целей.',aggression:.90,caution:.28,objective:.65,hp:27,damage:7,range:3}
};
export const ROLES={
  assault:{name:'Штурмовик',symbol:'▲',aggression:.17,caution:-.12,objective:-.08,range:-2,damage:2,hp:4},
  support:{name:'Стрелок',symbol:'⊕',aggression:-.08,caution:.16,objective:0,range:3,damage:0,hp:-3},
  scout:{name:'Разведчик',symbol:'◇',aggression:-.12,caution:.04,objective:.18,range:0,damage:-1,hp:-5}
};
export const MAPS={ruins:'Разрушенный форпост',industrial:'Промышленная зона',badlands:'Каменистое плато'};
export const SCENARIOS={battle:'Контроль точек · 5 на 5',contact:'Тест рефлекса · 1 на 1',aim:'Выбор цели · 1 на 2'};
const scenarioSizes=scenario=>scenario==='contact'?[1,1]:scenario==='aim'?[1,2]:[5,5];
const DIRS=[[1,0],[0,1],[-1,0],[0,-1]];
export const clamp=(n,lo=0,hi=1)=>Math.min(hi,Math.max(lo,n));
export const distance=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const key=(x,y)=>y*W+x;
export const inside=(x,y)=>x>=0&&y>=0&&x<W&&y<H;
export const tileAt=(s,x,y)=>inside(x,y)?s.map[key(x,y)]:1;
export const aliveUnits=s=>s.units.filter(u=>u.hp>0);
function hash(text){let h=2166136261;for(const c of String(text)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
export function random(s){s.rng=(s.rng+0x6D2B79F5)>>>0;let t=s.rng;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;}
export function profile(u){const f=FACTIONS[u.faction],r=ROLES[u.role];return {...Object.fromEntries(['aggression','caution','objective'].map(k=>[k,u.overrides[k]??clamp(f[k]+r[k])])),reactivity:u.overrides.reactivity??.5};}
function reach(map,start){
  const seen=new Set([key(start.x,start.y)]),q=[start];
  for(let i=0;i<q.length;i++)for(const [dx,dy] of DIRS){const x=q[i].x+dx,y=q[i].y+dy,k=key(x,y);if(inside(x,y)&&map[k]!==1&&!seen.has(k)){seen.add(k);q.push({x,y});}}
  return seen;
}
export function makeMap(seed,kind='ruins',density=28){
  const rng={rng:hash(seed+':'+kind+':map')},map=Array(W*H).fill(0);
  const put=(x,y,t)=>{if(x>4&&x<W-5&&y>1&&y<H-2)map[key(x,y)]=t;};
  const count=Math.round(10+clamp(density,8,50)*.45);
  for(let i=0;i<count;i++){
    const x=5+Math.floor(random(rng)*(W-10)),y=2+Math.floor(random(rng)*(H-4)),l=2+Math.floor(random(rng)*3),horizontal=random(rng)>.5;
    if(kind==='badlands'){put(x,y,1);if(random(rng)>.3)put(x+1,y,1);put(x,y+1,2);put(x-1,y,2);}
    else{
      for(let j=0;j<l;j++)put(x+(horizontal?j:0),y+(horizontal?0:j),1);
      if(kind==='ruins')for(let j=1;j<3;j++)put(x+(horizontal?0:j),y+(horizontal?j:0),1);
      else for(let j=0;j<l;j++)put(x+(horizontal?j:1),y+(horizontal?1:j),1);
      put(x-1,y,2);put(x,y-1,2);put(x+2,y+2,2);
    }
  }
  const objectives=[{id:'I',x:9,y:6,owner:null},{id:'II',x:16,y:11,owner:null},{id:'III',x:23,y:16,owner:null}];
  for(const o of objectives)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)map[key(o.x+dx,o.y+dy)]=0;
  // Reserved corridors make every objective reachable from both deployment zones.
  for(let x=1;x<W-1;x++)map[key(x,11)]=0;
  for(const o of objectives)for(let y=Math.min(11,o.y);y<=Math.max(11,o.y);y++)map[key(o.x,y)]=0;
  const seen=reach(map,{x:3,y:11});for(let i=0;i<map.length;i++)if(map[i]!==1&&!seen.has(i))map[i]=1;
  return {map,objectives};
}
export function createSimulation(config={}){
  const c={scenario:Object.hasOwn(SCENARIOS,config.scenario)?config.scenario:'battle',seed:String(config.seed??'40721').slice(0,64),mapKind:Object.hasOwn(MAPS,config.mapKind)?config.mapKind:'ruins',density:clamp(Number(config.density)||28,8,50),factionA:Object.hasOwn(FACTIONS,config.factionA)?config.factionA:'marines',factionB:Object.hasOwn(FACTIONS,config.factionB)?config.factionB:'orks',controllerA:Object.hasOwn(CONTROLLERS,config.controllerA)?config.controllerA:'malecns',controllerB:Object.hasOwn(CONTROLLERS,config.controllerB)?config.controllerB:'malecns',neurochemistry:Object.hasOwn(CHEMISTRIES,config.neurochemistry)?config.neurochemistry:'unsigned'};
  const terrain=makeMap(c.seed,c.mapKind,c.density),s={version:VERSION,config:c,...terrain,units:[],tick:0,rng:hash(c.seed+':combat'),scores:[0,0],events:[],effects:[],finished:false,winner:null};
  const unitCounts=scenarioSizes(c.scenario);
  const roles=['scout','assault','support','assault','scout'],names=[['Vega','Castor','Atlas','Pollux','Lynx'],['Ruk','Gor','Zog','Mog','Krag']];
  for(let team=0;team<2;team++)for(let i=0;i<unitCounts[team];i++){
    const faction=team?c.factionB:c.factionA,role=roles[i],f=FACTIONS[faction],r=ROLES[role],id=(team?'B':'A')+'-'+String(i+1).padStart(2,'0');
    s.units.push({id,name:names[team][i],team,faction,role,x:team?W-4:3,y:6+i*2,px:team?W-4:3,py:6+i*2,hp:f.hp+r.hp,maxHp:f.hp+r.hp,damage:f.damage+r.damage,range:Math.max(1,f.range+r.range),overrides:{},kills:0,damageDone:0,decision:null,heading:team?6:2,brain:createBrain(team?c.controllerB:c.controllerA,c.neurochemistry),reflex:createReflex(),experience:createExperience(W*H),neuralEscapes:0,assignment:terrain.objectives[i%3].id});
  }
  if(c.scenario==='contact'){
    s.map.fill(0);
    for(const [i,u] of s.units.entries()){
      u.x=i?14:10;u.y=10;u.px=u.x;u.py=u.y;
      // Explicit contact-test temperament, displayed and editable in inspector.
      u.overrides={aggression:.4,caution:1,objective:0};
    }
    for(const p of [{x:9,y:11},{x:9,y:12},{x:15,y:9},{x:15,y:8}])s.map[key(p.x,p.y)]=2;
  }
  if(c.scenario==='aim'){
    s.map.fill(0);
    const positions=[[10,10],[11,9],[15,10]];
    for(const [i,u] of s.units.entries()){
      [u.x,u.y]=positions[i];u.px=u.x;u.py=u.y;
      u.overrides=i?{aggression:.4,caution:1,objective:0}:{aggression:1,caution:0,objective:0};
    }
  }
  updateDecisions(s);return s;
}
export function hasLineOfSight(s,a,b){
  // Supercover ray: diagonal corner gaps between walls do not allow shooting.
  let x=a.x,y=a.y;const dx=b.x-a.x,dy=b.y-a.y,nx=Math.abs(dx),ny=Math.abs(dy),sx=Math.sign(dx),sy=Math.sign(dy);let ix=0,iy=0;
  while(ix<nx||iy<ny){
    const cross=(1+2*ix)*ny-(1+2*iy)*nx;
    if(cross===0){if(tileAt(s,x+sx,y)===1||tileAt(s,x,y+sy)===1)return false;x+=sx;y+=sy;ix++;iy++;}
    else if(cross<0){x+=sx;ix++;}else{y+=sy;iy++;}
    if(tileAt(s,x,y)===1)return false;
  }
  return true;
}
export function covered(s,pos){return tileAt(s,pos.x,pos.y)===2;}
function pathsFrom(s,u){
  const occupied=new Set(aliveUnits(s).filter(v=>v.id!==u.id).map(v=>key(v.x,v.y))),nodes=new Map([[key(u.x,u.y),{x:u.x,y:u.y,d:0,parent:null}]]),q=[nodes.get(key(u.x,u.y))];
  for(let i=0;i<q.length;i++)for(const [dx,dy] of DIRS){
    const x=q[i].x+dx,y=q[i].y+dy,k=key(x,y);
    if(!inside(x,y)||tileAt(s,x,y)===1||occupied.has(k)||nodes.has(k))continue;
    const n={x,y,d:q[i].d+1,parent:key(q[i].x,q[i].y)};nodes.set(k,n);q.push(n);
  }
  return nodes;
}
function pathTo(nodes,pos){let n=nodes.get(key(pos.x,pos.y));if(!n)return [];const route=[];while(n.parent!==null){route.unshift({x:n.x,y:n.y});n=nodes.get(n.parent);}return route;}
function closestNode(nodes,p){let best=null,cost=Infinity;for(const n of nodes.values()){const c=distance(n,p)*5+n.d;if(c<cost){best=n;cost=c;}}return best;}
export function threatAt(s,pos,team){
  let danger=0;
  for(const e of aliveUnits(s))if(e.team!==team){
    const d=distance(pos,e);
    if(d<=e.range&&hasLineOfSight(s,e,pos))danger+=e.damage*(d>1&&covered(s,pos)?.60:1);
  }
  return danger;
}
// Enumerate every short path, including alternative routes to the same cell.
// Risk is a static estimate on the board at decision time, not future damage.
export function planReflexRetreat(s,u,side,budget=REFLEX_BURST){
  const steps=Math.min(REFLEX_BURST,Math.max(0,Math.floor(budget))),currentRisk=threatAt(s,u,u.team),epsilon=1e-9;
  if(u.hp<=0||!Number.isFinite(steps)||steps===0||currentRisk<=epsilon)return null;
  const occupied=new Set(aliveUnits(s).filter(v=>v.id!==u.id).map(v=>key(v.x,v.y)));
  const seen=new Set([key(u.x,u.y)]);let best=null,bestSide=-Infinity;
  const search=(pos,route,risks)=>{
    if(route.length>=steps)return;
    for(const [dx,dy] of DIRS){
      const next={x:pos.x+dx,y:pos.y+dy},k=key(next.x,next.y);
      if(!inside(next.x,next.y)||tileAt(s,next.x,next.y)===1||occupied.has(k)||seen.has(k))continue;
      const risk=threatAt(s,next,u.team),previousRisk=risks.at(-1)??currentRisk;
      if(risk>previousRisk+epsilon)continue;
      const path=[...route,next],pathRisks=[...risks,risk],lateral=(next.y-u.y)*(u.team?-1:1)*(side==='L'?1:-1);
      const equalRisk=best&&Math.abs(risk-best.safety.destinationRisk)<=epsilon;
      const better=!best||risk<best.safety.destinationRisk-epsilon||
        (equalRisk&&(path.length<best.route.length||(path.length===best.route.length&&lateral>bestSide)));
      if(risk<currentRisk-epsilon&&better){
        best={destination:{...next},route:path,safety:{currentRisk,firstRisk:pathRisks[0],destinationRisk:risk,maxRisk:Math.max(...pathRisks),steps:path.length,budget:steps}};
        bestSide=lateral;
      }
      seen.add(k);search(next,path,pathRisks);seen.delete(k);
    }
  };
  search(u,[],[]);return best;
}
function actionKey(d){return d.type==='attack'?'attack:'+d.target:d.route?.length?'move:'+key(d.route[0].x,d.route[0].y):'hold';}
export function controllerFor(s,u){return u.team?s.config.controllerB:s.config.controllerA;}
// Threat encoding is engineered: visible enemy proximity enters looming cells.
// Left/right are relative to deployment direction (A east, B west).
export function observeThreat(s,u){
  const inputs=[0,0],forward=u.team?-1:1;
  for(const e of aliveUnits(s))if(e.team!==u.team&&hasLineOfSight(s,u,e)){
    const d=distance(u,e),strength=clamp((e.range+5-d)/(e.range+5))*(.65+.35*(1-u.hp/u.maxHp));
    const side=(e.y-u.y)*forward;
    if(side<=0)inputs[0]=Math.max(inputs[0],strength);
    if(side>=0)inputs[1]=Math.max(inputs[1],strength);
  }
  return inputs;
}
export function motorBearing(u,p){
  let angle=Math.atan2(p.x-u.x,u.y-p.y)-u.heading*Math.PI/4;
  while(angle>Math.PI)angle-=Math.PI*2;while(angle< -Math.PI)angle+=Math.PI*2;
  return angle;
}
export const MOTOR_VISION='binocular-passages-v2';
export function observeMotor(s,u){
  const p=profile(u),fear=[0,0],targets=[.035,.035],others=aliveUnits(s).filter(e=>e.id!==u.id);
  const memory=isAdaptiveMode(controllerFor(s,u))?u.experience:null;
  // Engineered binocular scene projection, not reconstructed fly retinal geometry.
  const project=(pair,pos,strength,recall=false)=>{
    let angle=motorBearing(u,pos);
    if(recall)angle=clamp(angle,-Math.PI/2,Math.PI/2);
    else if(Math.abs(angle)>Math.PI*.75)return;
    const lateral=Math.sin(angle),visibility=Math.cos(angle/2);
    pair[0]=Math.max(pair[0],clamp(strength*visibility*(1-lateral)));
    pair[1]=Math.max(pair[1],clamp(strength*visibility*(1+lateral)));
  };
  for(const e of others)if(hasLineOfSight(s,u,e)){
    const d=distance(u,e);if(d>12)continue;
    if(e.team!==u.team){
      project(targets,e,p.aggression/(1+d/7));
      project(fear,e,clamp((e.range+5-d)/(e.range+5))*(.65+.35*(1-u.hp/u.maxHp))*p.caution);
    }else if(d===1)project(fear,e,.8*Math.max(0,Math.cos(motorBearing(u,e)))**2);
  }
  for(const o of s.objectives){
    const d=distance(u,o),visible=d<=12&&hasLineOfSight(s,u,o);
    if(memory&&d<=1){
      // Contact with a mission marker is a bilateral sensory cue, not a hold command.
      targets[0]=Math.max(targets[0],p.objective);targets[1]=Math.max(targets[1],p.objective);
    }else if((o.owner!==u.team||memory)&&visible)project(targets,o,p.objective/(1+d/7));
    else if(memory?.useMemory&&memory.known.includes(o.id)){
      // Recalled landmark bearing can persist behind a wall; enemies are never recalled.
      project(targets,o,.7*p.objective/(1+d/12),true);
    }
  }
  // Static obstacles only repel in the forward hemisphere; side/rear walls
  // are not an approaching threat. The squared cosine fades peripheral input.
  for(const [dx,dy] of DIRS){
    const pos={x:u.x+dx,y:u.y+dy},frontal=Math.max(0,Math.cos(motorBearing(u,pos)));
    if(tileAt(s,pos.x,pos.y)===1)project(fear,pos,.9*frontal*frontal);
  }
  // Local free-space vision supplies exploratory input, not a route or objective.
  const open=[0,0];
  for(const offset of [-2,-1,0,1,2]){
    const angle=offset*Math.PI/4,heading=(u.heading+offset+8)%8;
    const [dx,dy]=[[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]][heading];
    let clear=0;
    for(let d=1;d<=4;d++){
      const pos={x:u.x+dx*d,y:u.y+dy*d};
      if(!inside(pos.x,pos.y)||!hasLineOfSight(s,u,pos)||others.some(e=>e.x===pos.x&&e.y===pos.y))break;
      clear+=memory?experienceNovelty(memory,key(pos.x,pos.y)):1;
    }
    const strength=.08*clear/4,side=Math.sin(angle);
    open[0]+=strength*(1-side);open[1]+=strength*(1+side);
  }
  // A salient visible object attenuates exploration without losing its bearing.
  const exploration=1-Math.max(...targets);
  if(memory?.useMemory){
    // A familiar forward step is a weak aversive memory cue. This is engineered
    // sensory feedback, not a collision, action veto or anatomical plasticity.
    const [dx,dy]=[[0,-1],[1,0],[0,1],[-1,0]][Math.floor((u.heading+1)/2)%4];
    const ahead={x:u.x+dx,y:u.y+dy};
    if(inside(ahead.x,ahead.y)&&tileAt(s,ahead.x,ahead.y)!==1){
      const visits=memory.visits[key(ahead.x,ahead.y)];
      project(fear,ahead,.6*exploration*visits/(1+visits));
    }
  }
  for(let side=0;side<2;side++)targets[side]=clamp(targets[side]+exploration*open[side]);
  return [...fear,...targets];
}
// Decode a continuous aim direction from the network. Geometry only resolves
// that direction to a legal target: no distance, HP, cover or utility ranking.
export function selectMotorTarget(s,u,readout=motorReadout(u.brain,profile(u).reactivity)){
  const angle=readout.aimAngle;
  const candidates=aliveUnits(s).filter(e=>e.team!==u.team&&distance(u,e)<=u.range&&
    Math.abs(motorBearing(u,e))<=Math.PI/4+1e-9&&hasLineOfSight(s,u,e)).map(e=>{
      const bearing=motorBearing(u,e),error=angle===null?null:Math.abs(bearing-angle);
      return {id:e.id,x:e.x,y:e.y,bearing,error,alignment:error===null?0:1-error/(Math.PI/2)};
    });
  candidates.sort((a,b)=>(angle===null?0:a.error-b.error)||(a.id<b.id?-1:a.id>b.id?1:0));
  return {angle,heading:u.heading,target:angle===null?null:candidates[0]?.id??null,candidates};
}
export function decideMotorUnit(s,u){
  const mode=controllerFor(s,u),p=profile(u),rawReadout=motorReadout(u.brain,p.reactivity);
  const head=isAdaptiveMode(mode)?experienceReadout(u.experience,rawReadout):null;
  const readout=head?{...rawReadout,scores:head.scores}:rawReadout;
  const cardinal=[[0,-1],[1,0],[0,1],[-1,0]][Math.floor((u.heading+1)/2)%4];
  const forward={x:u.x+cardinal[0],y:u.y+cardinal[1]},back={x:u.x-cardinal[0],y:u.y-cardinal[1]};
  const legal=pos=>inside(pos.x,pos.y)&&tileAt(s,pos.x,pos.y)!==1&&!aliveUnits(s).some(v=>v.id!==u.id&&v.x===pos.x&&v.y===pos.y);
  const aim=selectMotorTarget(s,u,readout),target=s.units.find(e=>e.id===aim.target);
  // Exact score ties use this documented order; firing and advancing are distinct.
  const commands=[
    {command:'fire',type:'attack',label:target?'Нейронная команда · огонь по '+target.id:'Нейронная команда · огонь',target:target?.id,destination:target?{x:target.x,y:target.y}:undefined,route:[],available:!!target},
    {command:'advance',type:'move',label:'Нейронная команда · вперёд',destination:forward,route:[forward],available:legal(forward)},
    {command:'left',type:'turn',label:'Нейронная команда · поворот влево',turn:-1,route:[],available:true},
    {command:'right',type:'turn',label:'Нейронная команда · поворот вправо',turn:1,route:[],available:true},
    {command:'reverse',type:'retreat',label:'Нейронная команда · назад',destination:back,route:[back],available:legal(back)},
    {command:'wait',type:'hold',label:'Нет двигательной команды',route:[],available:true}
  ].map(c=>({...c,score:readout.scores[c.command],reason:c.command==='wait'?'Ни одна доступная команда не превысила порог ожидания.':
    'Команду выбрали выходные нейроны и открытый двигательный декодер. Тактическая оценка целей и поиск пути не выполняются.'}));
  commands.sort((a,b)=>b.score-a.score);
  const choice=head?experienceChoice(u.experience,head,commands,s.config.seed+':'+u.id+':'+s.tick,s.tick>0):null;
  const chosen=choice?.chosen??commands.find(c=>c.available);
  if(head)chosen.reason=choice.exploratory?'Проба доступной команды для обучения; генератор воспроизводится по seed.':
    'Команда выбрана по выходам MaleCNS и обучаемому слою. Готовый маршрут не назначается.';
  return {...chosen,source:'motor',alternatives:[chosen,...commands.filter(c=>c!==chosen)],counterfactual:null,origin:{x:u.x,y:u.y},
    evaluatedAt:s.tick,controller:mode,aim,learning:head?{...head,exploratory:choice.exploratory,greedy:choice.greedy}:undefined,neural:neuralReadout(u.brain,p,mode),motor:readout,
    adapterNote:target?'DNa01 задаёт сигнал атаки и смещение прицела. Адаптер выбирает видимого врага с наименьшим угловым отклонением в секторе ±45°; при равенстве — по ID.':
      aim.angle===null?'Нет сигнала прицеливания. Атака недоступна.':'В секторе ±45° нет доступной цели. Команда огня исключена.'};
}

export function decideUnit(s,u){
  if(u.hp<=0)return null;
  if(isMotorMode(controllerFor(s,u)))return decideMotorUnit(s,u);
  const mode=controllerFor(s,u),signal=neuralReadout(u.brain,profile(u),mode),neural={...signal,active:mode!=='utility'&&reflexAllows(u.reflex,signal),phase:u.reflex.phase};
  const p=profile(u),enemies=aliveUnits(s).filter(e=>e.team!==u.team),nodes=pathsFrom(s,u),candidates=[],hpRatio=u.hp/u.maxHp,currentDanger=threatAt(s,u,u.team);
  const add=(type,label,score,reason,extra={})=>candidates.push({type,label,score:Math.round(score*10)/10,reason,...extra});
  for(const e of enemies){
    const d=distance(u,e);
    if(d<=u.range&&hasLineOfSight(s,u,e)){
      const close=d===1,inCover=!close&&covered(s,e),lethal=e.hp<=u.damage*(inCover?.6:1);
      add('attack',(close?'Ближняя атака':'Огонь')+' · '+e.id,38+40*p.aggression+(lethal?24:0)+(1-e.hp/e.maxHp)*12-(inCover?8:0),e.id+' в зоне '+(close?'контакта. ':'огня. ')+(lethal?'Есть шанс уничтожить цель.':inCover?'Цель в укрытии: урон будет ниже.':'Открытая цель; учитывается агрессивность профиля.'),{target:e.id,destination:{x:e.x,y:e.y},route:[]});
    }
  }
  for(const o of s.objectives){
    const destination=closestNode(nodes,o),d=destination?.d??Infinity;if(!destination)continue;
    const near=distance(u,o)<=1,friendly=aliveUnits(s).filter(v=>v.team===u.team&&v.id!==u.id&&distance(v,o)<=1).length,contested=enemies.some(v=>distance(v,o)<=1),assigned=o.id===u.assignment;
    const score=25+45*p.objective+(o.owner!==u.team?16:0)+(assigned?9:0)-Math.min(d,40)*1.45-friendly*15-(o.owner===u.team&&!near?12:0);
    if(near)add('hold','Удерживать '+o.id,score+(contested?8:0),contested?'Точка оспаривается. Удерживать позицию до подхода поддержки.':'Контроль точки '+o.id+' приносит очки. '+(assigned?'Это назначенный сектор отряда.':'Поддержка общего плана армии.'),{objective:o.id,route:[]});
    else add('move','Захватить '+o.id,score,'Движение к точке '+o.id+'. '+(assigned?'Командующий назначил этот сектор.':'Можно усилить контроль карты.')+' До позиции '+d+' кл.',{objective:o.id,destination:{x:destination.x,y:destination.y},route:pathTo(nodes,destination)});
  }
  if(enemies.length){
    const target=[...enemies].sort((a,b)=>distance(u,a)-distance(u,b)||(a.hp/a.maxHp-b.hp/b.maxHp))[0];let attackNode=null,best=Infinity;
    for(const n of nodes.values()){
      const d=distance(n,target);if(d>u.range||!hasLineOfSight(s,n,target))continue;
      const cost=n.d+(u.role==='assault'?d*.7:Math.abs(d-Math.max(2,u.range-1))*.45)+threatAt(s,n,u.team)*p.caution*.12;
      if(cost<best){best=cost;attackNode=n;}
    }
    if(attackNode&&attackNode.d>0)add('move',u.role==='assault'?'Сблизиться с целью':'Занять огневую позицию',21+48*p.aggression-Math.min(attackNode.d,30)*1.2+(u.role==='assault'?9:0),'Выбор позиции для атаки '+target.id+'. Маршрут учитывает стены и занятые клетки.',{target:target.id,destination:{x:attackNode.x,y:attackNode.y},route:pathTo(nodes,attackNode)});
  }
  // The ordinary tactical choice is independent of neural state.
  if(currentDanger>0||hpRatio<.65){
    let safe=null,best=-Infinity;
    for(const n of nodes.values())if(n.d<=7){
      const risk=threatAt(s,n,u.team),value=(currentDanger-risk)*2+(covered(s,n)?7:0)-n.d*1.1;
      if(value>best){best=value;safe=n;}
    }
    if(safe&&best>0)add(safe.d===0?'hold':'retreat',safe.d===0?'Остаться в укрытии':'Снизить угрозу',10+70*p.caution*(1-hpRatio)+Math.min(30,currentDanger*1.7)*p.caution+(covered(s,safe)?8:0),
      'Здоровье '+Math.round(hpRatio*100)+'%. Угроза сейчас '+Math.round(currentDanger)+'; в выбранной позиции '+Math.round(threatAt(s,safe,u.team))+'.',
      {destination:{x:safe.x,y:safe.y},route:pathTo(nodes,safe)});
  }
  add('hold','Наблюдать',1,'Ожидание доступного действия.',{route:[]});
  candidates.sort((a,b)=>b.score-a.score);
  const baseline=candidates[0];
  if(neural.active){
    const budget=Math.min(REFLEX_BURST,u.reflex.remaining+1),plan=planReflexRetreat(s,u,neural.side,budget);
    if(plan)add('retreat','Рефлекс MaleCNS · отход',baseline.score+10+neural.drive*100,
      'LC4/LPLC2 → DN: сигнал '+neural.drive.toFixed(3)+' (порог '+neural.threshold.toFixed(3)+'). Угроза по маршруту не растёт; снижение достижимо за '+plan.safety.steps+' кл. при оставшемся лимите '+budget+'.',
      {destination:plan.destination,route:plan.route,routeSafety:plan.safety,neuralOverride:true});
    else neural.blockedReason=currentDanger<=0?'Рефлекс активен, но прямой угрозы огня сейчас нет. Тактический план сохранён.':
      'Рефлекс активен, но за оставшиеся '+budget+' кл. нет пути со снижением угрозы без её роста на промежуточных шагах. Тактический план сохранён.';
  }
  candidates.sort((a,b)=>b.score-a.score);
  const chosen=candidates[0],counterfactual={type:baseline.type,label:baseline.label,score:baseline.score,target:baseline.target??null,
    firstStep:baseline.route?.[0]?{...baseline.route[0]}:null,changed:actionKey(chosen)!==actionKey(baseline)};
  return {...chosen,alternatives:candidates.slice(0,4),counterfactual,origin:{x:u.x,y:u.y},evaluatedAt:s.tick,controller:mode,neural};
}
export function updateDecisions(s){for(const u of s.units)u.decision=decideUnit(s,u);}
function event(s,type,text,team=null){s.events.push({tick:s.tick,type,text,team});if(s.events.length>160)s.events.shift();}
export function updateObjectives(s,award=true){
  for(const o of s.objectives){
    const counts=[0,0];for(const u of aliveUnits(s))if(distance(u,o)<=1)counts[u.team]++;
    const owner=counts[0]>0&&counts[1]===0?0:counts[1]>0&&counts[0]===0?1:null;
    if(owner!==o.owner&&owner!==null)event(s,'capture',(owner?'B':'A')+' контролирует точку '+o.id,owner);
    o.owner=owner;o.contested=counts[0]>0&&counts[1]>0;if(award&&owner!==null)s.scores[owner]++;
  }
}
function prepareExperience(s,u){
  visitExperience(u.experience,key(u.x,u.y));
  for(const o of s.objectives)if(!u.experience.known.includes(o.id)&&distance(u,o)<=12&&hasLineOfSight(s,u,o)&&
    (distance(u,o)<=1||Math.abs(motorBearing(u,o))<=Math.PI*.75))u.experience.known.push(o.id);
}
function knownGoalDistance(s,u,pos=u){
  const goals=s.objectives.filter(o=>u.experience.known.includes(o.id));
  return goals.length?Math.min(...goals.map(o=>distance(pos,o))):null;
}
// The observer receives the actual pre-execution decision. Learning settles the
// previous transition against this chosen next action (on-policy Sarsa).
export function stepSimulation(s,observeDecision){
  if(s.finished)return s;s.tick++;s.effects=[];
  const previousOwners=s.objectives.map(o=>o.owner);
  for(const u of s.units){u.px=u.x;u.py=u.y;if(u.hp<=0)u.decision=null;}
  const order=aliveUnits(s).map(u=>u.id);for(let i=order.length-1;i>0;i--){const j=Math.floor(random(s)*(i+1));[order[i],order[j]]=[order[j],order[i]];}
  for(const id of order){
    const u=s.units.find(v=>v.id===id);if(u.hp<=0)continue;
    const mode=controllerFor(s,u),adaptive=isAdaptiveMode(mode);
    if(adaptive)prepareExperience(s,u);
    stepBrain(u.brain,isMotorMode(mode)?observeMotor(s,u):observeThreat(s,u),mode);
    stepReflex(u.reflex,neuralReadout(u.brain,profile(u),mode),!isMotorMode(mode)&&mode!=='utility');
    const d=decideUnit(s,u);u.decision=d;
    const before={x:u.x,y:u.y},goalBefore=adaptive?knownGoalDistance(s,u):null;
    if(adaptive){
      settleExperience(u.experience,d.score,s.tick);beginExperience(u.experience,d);
      addExperienceReward(u.experience,'cost',-.01);
    }
    observeDecision?.(d,u,s);
    if(d.neuralOverride){u.neuralEscapes++;event(s,'reflex',u.id+' · MaleCNS: короткий отход, сигнал '+d.neural.drive.toFixed(3),u.team);}
    if(d.type==='turn'){u.heading=(u.heading+d.turn+8)%8;}
    else if(d.type==='attack'){
      const target=s.units.find(v=>v.id===d.target);if(!target||target.hp<=0||distance(u,target)>u.range||!hasLineOfSight(s,u,target))continue;
      const melee=distance(u,target)===1,hit=random(s)<(melee?.94:.83),damage=hit?Math.max(1,Math.round(u.damage*(covered(s,target)&&!melee?.60:1)*(.85+random(s)*.30))):0;
      const actual=Math.min(target.hp,damage);target.hp=Math.max(0,target.hp-damage);u.damageDone+=actual;
      if(adaptive)addExperienceReward(u.experience,'damage',.05*actual*(.25+profile(u).aggression));
      if(isAdaptiveMode(controllerFor(s,target)))addExperienceReward(target.experience,'hurt',-.05*actual*(.25+profile(target).caution));
      s.effects.push({from:{x:u.x,y:u.y},to:{x:target.x,y:target.y},team:u.team,hit,damage:actual});
      event(s,hit?'hit':'miss',u.id+' → '+target.id+(hit?' · −'+actual+' HP':' · промах'),u.team);
      if(target.hp===0){
        target.decision=null;u.kills++;event(s,'kill',target.id+' выведен из боя',target.team);
        if(isAdaptiveMode(controllerFor(s,target))){addExperienceReward(target.experience,'outcome',-1);settleExperience(target.experience,0,s.tick,true);}
      }
    }else if(d.route.length){
      const next=d.route[0];if(tileAt(s,next.x,next.y)!==1&&!aliveUnits(s).some(v=>v.id!==u.id&&v.x===next.x&&v.y===next.y)){u.x=next.x;u.y=next.y;}
    }
    if(adaptive&&(u.x!==before.x||u.y!==before.y)){
      const fresh=visitExperience(u.experience,key(u.x,u.y));
      addExperienceReward(u.experience,fresh?'novelty':'revisit',fresh?.03:-.02);
      const goalAfter=knownGoalDistance(s,u);
      if(goalBefore!==null&&goalAfter!==null)addExperienceReward(u.experience,'progress',.04*profile(u).objective*(goalBefore-goalAfter));
    }
  }
  updateObjectives(s);
  for(const [i,o] of s.objectives.entries())if(o.owner!==null){
    const occupants=aliveUnits(s).filter(u=>u.team===o.owner&&distance(u,o)<=1);
    for(const u of occupants)if(isAdaptiveMode(controllerFor(s,u))){
      const priority=profile(u).objective/occupants.length;
      addExperienceReward(u.experience,'hold',.25*priority);
      if(previousOwners[i]!==o.owner&&!u.experience.captured.includes(o.id)){
        addExperienceReward(u.experience,'capture',.8*priority);u.experience.captured.push(o.id);
      }
    }
  }
  const counts=[0,0];for(const u of aliveUnits(s))counts[u.team]++;
  if(counts[0]===0||counts[1]===0||s.scores.some(v=>v>=WIN_SCORE)||s.tick>=MAX_TICKS){
    s.finished=true;
    if(!counts[0]||!counts[1])s.winner=counts[0]?0:counts[1]?1:null;else s.winner=s.scores[0]===s.scores[1]?null:s.scores[0]>s.scores[1]?0:1;
    event(s,'finish',s.winner===null?'Симуляция завершена: ничья':'Победа группы '+(s.winner?'B':'A'),s.winner);
    for(const u of s.units)if(isAdaptiveMode(controllerFor(s,u))){
      addExperienceReward(u.experience,'outcome',s.winner===null?0:s.winner===u.team?1:-1);
      settleExperience(u.experience,0,s.tick,true);
    }
  }return s;
}
export function setTerrain(s,x,y,type){
  if(s.tick!==0||![0,1,2].includes(type)||!inside(x,y))return false;
  if(s.units.some(u=>u.x===x&&u.y===y)||s.objectives.some(o=>distance(o,{x,y})<=1))return false;
  const old=tileAt(s,x,y);s.map[key(x,y)]=type;const reachable=reach(s.map,s.units[0]);
  if(!s.units.every(u=>reachable.has(key(u.x,u.y)))||!s.objectives.every(o=>reachable.has(key(o.x,o.y)))){s.map[key(x,y)]=old;return false;}
  updateDecisions(s);return true;
}
export function repeatWithExperience(previous,config=previous.config){
  const next=createSimulation(config);
  for(const u of next.units){
    const old=previous.units.find(v=>v.id===u.id&&v.faction===u.faction&&v.role===u.role);
    if(old&&isAdaptiveMode(controllerFor(next,u))&&isAdaptiveMode(controllerFor(previous,old))){
      u.overrides={...old.overrides};
      if(chemistryOf(old.brain)===chemistryOf(u.brain))u.experience=carryExperience(old.experience,W*H);
    }
  }
  updateDecisions(next);return next;
}
export function exportScene(s){return JSON.stringify({format:'malecns-scene',version:VERSION,state:s},null,2);}
export function importScene(text){
  if(typeof text!=='string'||text.length>8_000_000)throw new Error('Слишком большой файл сцены.');
  let data;try{data=JSON.parse(text);}catch{throw new Error('Файл не содержит корректный JSON.');}
  const v=data?.state,invalid=()=>{throw new Error('Неподдерживаемая или повреждённая сцена.');};
  if(data?.format!=='malecns-scene'||![1,2,3,4,5,6,7,8,VERSION].includes(data.version)||!v||!v.config)invalid();
  if(!Array.isArray(v.map)||v.map.length!==W*H||v.map.some(t=>![0,1,2].includes(t)))invalid();
  if(!Number.isInteger(v.tick)||v.tick<0||v.tick>MAX_TICKS||!Number.isInteger(v.rng)||v.rng<0||v.rng>4294967295)invalid();
  if(!Array.isArray(v.scores)||v.scores.length!==2||v.scores.some(n=>!Number.isInteger(n)||n<0||n>MAX_TICKS*3))invalid();
  if(!Object.hasOwn(MAPS,v.config.mapKind)||!Object.hasOwn(FACTIONS,v.config.factionA)||!Object.hasOwn(FACTIONS,v.config.factionB)||typeof v.config.seed!=='string'||v.config.seed.length>64||!Number.isFinite(v.config.density)||v.config.density<8||v.config.density>50)invalid();
  if(data.version>=2&&(!Object.hasOwn(CONTROLLERS,v.config.controllerA)||!Object.hasOwn(CONTROLLERS,v.config.controllerB)))invalid();
  if(data.version>=9&&!Object.hasOwn(CHEMISTRIES,v.config.neurochemistry))invalid();
  if(data.version<9&&v.config.neurochemistry!==undefined&&v.config.neurochemistry!=='unsigned')invalid();
  if(data.version<8&&(isAdaptiveMode(v.config.controllerA)||isAdaptiveMode(v.config.controllerB)))invalid();
  if(data.version<5&&(isMotorMode(v.config.controllerA)||isMotorMode(v.config.controllerB)))invalid();
  if(data.version>=3&&!Object.hasOwn(SCENARIOS,v.config.scenario))invalid();
  const scenario=data.version>=3?v.config.scenario:'battle',sizes=scenarioSizes(scenario);
  if(data.version<6&&scenario==='aim')invalid();
  if(!Array.isArray(v.units)||v.units.length!==sizes[0]+sizes[1]||!Array.isArray(v.objectives)||v.objectives.length!==3)invalid();
  if(typeof v.finished!=='boolean'||![null,0,1].includes(v.winner))invalid();
  const pos=p=>Number.isInteger(p.x)&&Number.isInteger(p.y)&&inside(p.x,p.y)&&v.map[key(p.x,p.y)]!==1;
  const ids=new Set(),occupied=new Set();
  for(const [i,u] of v.units.entries()){
    const team=i<sizes[0]?0:1,id=(team?'B':'A')+'-'+String(i-(team?sizes[0]:0)+1).padStart(2,'0');
    if(!u||u.id!==id||ids.has(u.id)||u.team!==team||!Object.hasOwn(FACTIONS,u.faction)||!Object.hasOwn(ROLES,u.role)||!pos(u))invalid();
    if(u.faction!==(team?v.config.factionB:v.config.factionA)||typeof u.name!=='string'||u.name.length>40||!u.overrides||typeof u.overrides!=='object'||Array.isArray(u.overrides))invalid();
    const f=FACTIONS[u.faction],r=ROLES[u.role];
    if(u.maxHp!==f.hp+r.hp||u.damage!==f.damage+r.damage||u.range!==Math.max(1,f.range+r.range)||!Number.isFinite(u.hp)||u.hp<0||u.hp>u.maxHp)invalid();
    for(const k of Object.keys(u.overrides))if(!['aggression','caution','objective','reactivity'].includes(k)||!Number.isFinite(u.overrides[k])||u.overrides[k]<0||u.overrides[k]>1)invalid();
    if(!Number.isInteger(u.kills)||u.kills<0||u.kills>sizes[1-team]||!Number.isFinite(u.damageDone)||u.damageDone<0||u.damageDone>1000||!['I','II','III'].includes(u.assignment))invalid();
    if(data.version>=2&&(!validateBrain(u.brain,v.tick)||!Number.isInteger(u.neuralEscapes)||u.neuralEscapes<0||u.neuralEscapes>v.tick))invalid();
    if(data.version>=9&&(!Object.hasOwn(u.brain,'chemistry')||chemistryOf(u.brain)!==v.config.neurochemistry))invalid();
    if(data.version>=2&&data.version<9&&chemistryOf(u.brain)!=='unsigned')invalid();
    if(data.version>=3&&!validateReflex(u.reflex,v.tick))invalid();
    if(data.version>=5&&(!Number.isInteger(u.heading)||u.heading<0||u.heading>7))invalid();
    if(data.version>=2&&isMotorMode(team?v.config.controllerB:v.config.controllerA)!==isMotorBrain(u.brain))invalid();
    if(data.version>=8&&!validateExperience(u.experience,W*H,v.tick))invalid();
    if(u.hp>0){const k=key(u.x,u.y);if(occupied.has(k))invalid();occupied.add(k);}ids.add(u.id);
  }
  for(const [i,o] of v.objectives.entries())if(!o||o.id!==['I','II','III'][i]||!pos(o)||![null,0,1].includes(o.owner))invalid();
  const config={...v.config,scenario,neurochemistry:data.version>=9?v.config.neurochemistry:'unsigned'};
  if(data.version===1){config.controllerA='utility';config.controllerB='utility';}
  const s=createSimulation(config);s.map=[...v.map];s.tick=v.tick;s.rng=v.rng;s.scores=[...v.scores];s.finished=v.finished;s.winner=v.winner;
  s.units=v.units.map(u=>({id:u.id,name:u.name,team:u.team,faction:u.faction,role:u.role,x:u.x,y:u.y,px:u.x,py:u.y,hp:u.hp,maxHp:u.maxHp,damage:u.damage,range:u.range,overrides:{...u.overrides},kills:u.kills,damageDone:u.damageDone,heading:data.version>=5?u.heading:u.team?6:2,decision:null,brain:data.version===1?createBrain():copyBrain(u.brain),reflex:data.version>=3?copyReflex(u.reflex):createReflex(),experience:data.version>=8?copyExperience(u.experience):createExperience(W*H),neuralEscapes:data.version===1?0:u.neuralEscapes,assignment:u.assignment}));
  s.objectives=v.objectives.map(o=>({id:o.id,x:o.x,y:o.y,owner:o.owner,contested:false}));s.events=[];s.effects=[];
  if(data.version<VERSION)s.importNote='Сцена v'+data.version+' обновлена: состояние сохранено, дальнейшее поведение рассчитывается по правилам v'+VERSION+'.';
  updateDecisions(s);return s;
}
