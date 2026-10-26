// Engineered per-unit memory and a learned readout of frozen MaleCNS outputs.
// Bounded semi-gradient Sarsa(lambda), with an epsilon-greedy behaviour policy.
// No board coordinates, target IDs or tactical utilities are read by the policy head.
export const EXPERIENCE_VERSION=1, EXPERIENCE_FEATURES=13;
export const EXPERIENCE_COMMANDS=['fire','advance','left','right','reverse','wait'];
export const EXPERIENCE_RULE={alpha:.12,gamma:.9,lambda:.65,epsilon:.08,weightLimit:3,errorLimit:2};
export const EXPERIENCE_REWARDS=['capture','hold','damage','hurt','novelty','revisit','progress','cost','outcome'];
const experienceClamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const experienceMatrix=()=>EXPERIENCE_COMMANDS.map(()=>Array(EXPERIENCE_FEATURES).fill(0));
export function createExperience(cells){
  return {version:EXPERIENCE_VERSION,enabled:true,useMemory:true,visits:Array(cells).fill(0),lastCell:null,known:[],captured:[],
    weights:experienceMatrix(),eligibility:experienceMatrix(),pending:null,updates:0,episodes:0,totalReward:0,
    lastReward:0,lastError:0,lastParts:{},trace:[]};
}
export function experienceFeatures(motor){
  const v=[...motor.aim,...motor.steer,...motor.walk,...motor.reverse,...motor.fear].map(x=>Math.tanh(x));
  return [...v,v[0]*v[1],v[8]*v[9],Math.max(...v)];
}
function experienceDot(a,b){return a.reduce((sum,v,i)=>sum+v*b[i],0);}
export function experienceReadout(e,motor){
  const features=experienceFeatures(motor),corrections={},scores={};
  for(const [i,command] of EXPERIENCE_COMMANDS.entries()){
    corrections[command]=experienceDot(e.weights[i],features);
    scores[command]=motor.scores[command]+corrections[command];
  }
  return {features,corrections,scores,baseScores:{...motor.scores},active:features.some(v=>v>1e-9)};
}
function experienceNoise(text){
  let n=2166136261;for(const c of text){n^=c.charCodeAt(0);n=Math.imul(n,16777619);}
  n^=n>>>16;n=Math.imul(n,0x7feb352d);n^=n>>>15;n=Math.imul(n,0x846ca68b);n^=n>>>16;return (n>>>0)/4294967296;
}
export function experienceChoice(e,head,commands,token,canExplore=true){
  const legal=commands.filter(c=>c.available),greedy=legal[0];
  if(!head.active)return {chosen:legal.find(c=>c.command==='wait'),exploratory:false,greedy:'wait'};
  const exploratory=e.enabled&&canExplore&&experienceNoise(token+':explore')<EXPERIENCE_RULE.epsilon;
  return {chosen:exploratory?legal[Math.floor(experienceNoise(token+':action')*legal.length)]:greedy,
    exploratory,greedy:greedy.command};
}
export function visitExperience(e,cell){
  if(e.lastCell===cell)return false;
  const fresh=e.visits[cell]===0;e.visits[cell]++;e.lastCell=cell;return fresh;
}
export function experienceNovelty(e,cell){return e.useMemory?1/(1+4*e.visits[cell]):1;}
export function addExperienceReward(e,name,value){
  if(!e.pending||!Number.isFinite(value))return;
  if(!EXPERIENCE_REWARDS.includes(name))throw Error('Unknown reward component');
  e.pending.parts[name]=(e.pending.parts[name]??0)+value;
}
export function beginExperience(e,decision){
  e.pending={command:decision.command,features:[...decision.learning.features],
    base:decision.learning.baseScores[decision.command],parts:{}};
}
export function settleExperience(e,nextValue,tick,terminal=false){
  const p=e.pending;if(!p)return;
  const reward=Object.values(p.parts).reduce((a,b)=>a+b,0),row=EXPERIENCE_COMMANDS.indexOf(p.command);
  const current=p.base+experienceDot(e.weights[row],p.features);
  const error=reward+(terminal?0:EXPERIENCE_RULE.gamma*nextValue)-current;
  const active=p.features.some(v=>v>1e-9);
  if(e.enabled&&active){
    for(const z of e.eligibility)for(let i=0;i<z.length;i++)z[i]*=EXPERIENCE_RULE.gamma*EXPERIENCE_RULE.lambda;
    for(let i=0;i<p.features.length;i++)e.eligibility[row][i]+=p.features[i];
    const normalizer=Math.max(1,experienceDot(p.features,p.features));
    const rate=EXPERIENCE_RULE.alpha*experienceClamp(error,-EXPERIENCE_RULE.errorLimit,EXPERIENCE_RULE.errorLimit)/normalizer;
    for(let a=0;a<e.weights.length;a++)for(let i=0;i<EXPERIENCE_FEATURES;i++)
      e.weights[a][i]=experienceClamp(e.weights[a][i]+rate*e.eligibility[a][i],-EXPERIENCE_RULE.weightLimit,EXPERIENCE_RULE.weightLimit);
    e.updates++;
  }else e.eligibility=experienceMatrix();
  e.totalReward+=reward;e.lastReward=reward;e.lastError=error;e.lastParts={...p.parts};
  e.trace.push({tick,command:p.command,reward,error,learned:e.enabled&&active,parts:{...p.parts}});
  if(e.trace.length>40)e.trace.shift();
  e.pending=null;if(terminal)e.eligibility=experienceMatrix();
}
export function setExperienceLearning(e,enabled){
  e.enabled=enabled;e.pending=null;e.eligibility=experienceMatrix();
}
export function carryExperience(e,cells){
  const next=createExperience(cells);next.weights=e.weights.map(r=>[...r]);next.updates=e.updates;
  next.episodes=e.episodes+1;next.enabled=e.enabled;next.useMemory=e.useMemory;return next;
}
export function copyExperience(e){return structuredClone(e);}
export function validateExperience(e,cells,maxTicks){
  const finite=(v,lo,hi)=>Number.isFinite(v)&&v>=lo&&v<=hi;
  const integer=(v,lo,hi)=>Number.isInteger(v)&&finite(v,lo,hi);
  const features=a=>Array.isArray(a)&&a.length===EXPERIENCE_FEATURES&&a.every(v=>finite(v,0,1));
  const matrix=(a,limit)=>Array.isArray(a)&&a.length===EXPERIENCE_COMMANDS.length&&a.every(r=>Array.isArray(r)&&r.length===EXPERIENCE_FEATURES&&r.every(v=>finite(v,-limit,limit)));
  const parts=a=>a&&typeof a==='object'&&!Array.isArray(a)&&Object.entries(a).every(([k,v])=>EXPERIENCE_REWARDS.includes(k)&&finite(v,-1000,1000));
  if(!e||e.version!==EXPERIENCE_VERSION||typeof e.enabled!=='boolean'||typeof e.useMemory!=='boolean'||
    !Array.isArray(e.visits)||e.visits.length!==cells||!e.visits.every(v=>integer(v,0,maxTicks+1))||
    e.visits.reduce((a,b)=>a+b,0)>maxTicks+1||
    !(e.lastCell===null||integer(e.lastCell,0,cells-1)&&e.visits[e.lastCell]>0)||
    ![e.known,e.captured].every(a=>Array.isArray(a)&&a.length<=3&&new Set(a).size===a.length&&a.every(k=>['I','II','III'].includes(k)))||
    !matrix(e.weights,EXPERIENCE_RULE.weightLimit)||!matrix(e.eligibility,3)||
    !integer(e.updates,0,10000000)||!integer(e.episodes,0,100000)||!finite(e.totalReward,-1000000,1000000)||
    !finite(e.lastReward,-1000,1000)||!finite(e.lastError,-100000,100000)||!parts(e.lastParts)||
    !Array.isArray(e.trace)||e.trace.length>40)return false;
  if(e.pending&&(!EXPERIENCE_COMMANDS.includes(e.pending.command)||!features(e.pending.features)||!finite(e.pending.base,0,100000)||!parts(e.pending.parts)))return false;
  if(e.pending!==null&&!e.pending)return false;
  return e.trace.every((t,i)=>t&&integer(t.tick,1,maxTicks)&&EXPERIENCE_COMMANDS.includes(t.command)&&
    finite(t.reward,-1000,1000)&&finite(t.error,-100000,100000)&&typeof t.learned==='boolean'&&parts(t.parts)&&(i===0||t.tick>=e.trace[i-1].tick));
}

