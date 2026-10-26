import {SENSES} from './sensory-ports.mjs';
const $=id=>document.getElementById(id),format=n=>new Intl.NumberFormat('ru-RU').format(n),number=v=>Number(v).toFixed(3);
let worker,sequence=0,pending=new Map(),state=null,metadata=null,running=false,stepping=false,runGeneration=0,loopTimer=null;
function message(text){$('status').textContent=text;}
function fail(error){running=false;$('run').textContent='▶ Запустить';$('error').textContent=error.message||String(error);$('error').hidden=false;message('Эксперимент приостановлен');}
function request(action,payload){return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});worker.postMessage({id,action,payload});});}
function pause(){running=false;runGeneration++;if(loopTimer!==null)clearTimeout(loopTimer);loopTimer=null;$('run').textContent='▶ Запустить';}
async function act(action,payload){pause();$('error').hidden=true;try{state=await request(action,payload);syncControls();render();}catch(error){fail(error);}}
function element(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
function build(){
  const m=metadata.manifest,inv=metadata.inventory;
  for(const k of ['neurons','edges','contacts'])$(k).textContent=format(m.counts[k]);
  $('ports').textContent=format(Object.values(inv.coverage).reduce((s,n)=>s+n,0));$('unmapped').textContent=format(inv.unmapped)+' клеток без внешнего входа';
  for(const type of inv.odorTypes){const option=element('option',type);option.value=type;$('odor').append(option);}
  for(const [key,label] of Object.entries(SENSES)){
    const row=element('label',undefined,'sense-row'),input=element('input');input.type='checkbox';input.checked=true;input.id='sense-'+key;input.addEventListener('change',()=>act('configure',{mask:Object.fromEntries(Object.keys(SENSES).map(k=>[k,$('sense-'+k).checked]))}));row.append(input,element('span',label),element('small',format(inv.coverage[key]||0)));$('senses').append(row);
    const reading=element('div',undefined,'reading');reading.id='reading-'+key;reading.append(element('span',label));const value=element('strong','0.000');value.id='value-'+key;reading.append(value);const track=element('div',undefined,'track'),bar=element('i');bar.id='bar-'+key;track.append(bar);reading.append(track);$('readings').append(reading);
  }
  for(const [key,count] of Object.entries(m.superclasses)){
    const row=element('div',undefined,'class-row');row.title=format(count)+' нейронов';row.append(element('span',key));const value=element('b','0.000');value.id='class-value-'+key;row.append(value);const track=element('div',undefined,'track'),bar=element('i');bar.id='class-bar-'+key;track.append(bar);row.append(track);$('classes').append(row);
  }
  for(const [i,name] of ['FL','FR','ML','MR','HL','HR'].entries()){const e=element('div',name+' · '+inv.motorCells[i]);const value=element('strong','0.000');value.id='motor-'+i;e.append(value);$('motors').append(e);}
  const table=element('table'),head=element('tr');head.append(element('th','Подключение'),element('th','Охват'));table.append(head);
  for(const [label,value] of [['Нейронные классы',Object.keys(m.superclasses).length],['Клетки с сенсорными портами',Object.values(inv.coverage).reduce((s,v)=>s+v,0)],['Колонки двух глаз',inv.retinalColumns],['Привязанные фоторецепторы',inv.retinalMapped],['Клетки моторных групп ног',inv.motorCells.reduce((s,v)=>s+v,0)],['Без внешнего входа',inv.unmapped]]){const tr=element('tr');tr.append(element('td',label),element('td',format(value)));table.append(tr);}
  $('coverage').append(table);
  for(const [name,count] of Object.entries(inv.unmappedClasses))$('coverage').append(element('p',name+': '+format(count)));
  $('controls').disabled=false;$('dynamics').disabled=false;for(const id of ['step','run','save','load','inspect'])$(id).disabled=false;
}
function syncControls(){
  if(!state)return;$('clamped').checked=state.clamped;$('connected').checked=state.dynamics.connected;$('glu').value=String(state.dynamics.gluSign);$('seed').value=state.world.seed;
  const values={light:state.world.light,wind:state.world.wind[0],tonic:state.dynamics.tonic,da:state.dynamics.da,oa:state.dynamics.oa,serotonin:state.dynamics.serotonin};
  for(const [key,v] of Object.entries(values)){$(key).value=String(v);$(key+'-value').textContent=v.toFixed(key==='tonic'||key==='light'||key==='wind'?2:1);}
  $('odor').value=state.world.objects.find(o=>o.kind==='odor').channel;
  for(const k of Object.keys(SENSES))$('sense-'+k).checked=state.mask[k];
}
function render(){
  if(!state)return;$('tick').textContent='Такт '+state.ticks;$('timing').textContent=Math.round(state.lastMs)+' мс · '+state.summary.steps+' шагов сети';
  message(running?'Симуляция · обучение выключено':'Пауза · обучение выключено');
  for(const [key,m] of Object.entries(state.metrics)){$('value-'+key).textContent=number(m.mean);$('bar-'+key).style.width=(m.mean*100)+'%';$('reading-'+key).classList.toggle('off',!m.enabled);$('reading-'+key).title='Максимум '+number(m.max)+' · '+m.count+' клеток';}
  for(const [key,v] of Object.entries(state.summary.classes)){$('class-value-'+key).textContent=number(v.mean);$('class-bar-'+key).style.width=(v.mean*100)+'%';}
  state.motors.forEach((v,i)=>$('motor-'+i).textContent=number(v));
  $('modulators').textContent=state.summary.modulators.map((v,i)=>['DA','OA','5-HT'][i]+': среднее '+v.mean.toExponential(2)+', макс. '+v.max.toExponential(2)).join('\n');
  drawArena();drawEyes();
}
function drawArena(){
  const c=$('arena'),ctx=c.getContext('2d'),w=state.world,scale=c.width/w.width;
  const height=Math.round(c.width*w.height/w.width);if(c.height!==height)c.height=height;
  ctx.clearRect(0,0,c.width,c.height);ctx.fillStyle='#273324';ctx.fillRect(0,0,c.width,c.height);
  const overlay=$('overlay').value,channel=overlay==='odor'?'odor:'+w.objects.find(o=>o.kind==='odor').channel:overlay,field=w.fields[channel];
  for(let y=0;y<w.height;y++)for(let x=0;x<w.width;x++){
    const i=y*w.width+x;
    if(w.walls[i]){ctx.fillStyle='#131d15';ctx.fillRect(x*scale+5,y*scale+7,scale,scale);ctx.fillStyle='#576548';ctx.fillRect(x*scale,y*scale,scale-2,scale-2);ctx.strokeStyle='#7a8561';ctx.strokeRect(x*scale+3,y*scale+3,scale-8,scale-8);}
    else if(field&&overlay!=='none'){
      const baseline=overlay==='temperature'?.3:overlay==='humidity'?.4:0,v=Math.max(0,field[i]-baseline);ctx.fillStyle=overlay==='temperature'?'rgba(228,154,120,'+Math.min(.75,v*1.5)+')':overlay==='humidity'?'rgba(142,211,218,'+Math.min(.75,v*1.5)+')':'rgba(167,204,125,'+Math.min(.75,v*2)+')';ctx.fillRect(x*scale,y*scale,scale,scale);
    }
  }
  ctx.lineWidth=1;ctx.strokeStyle='rgba(171,190,145,.05)';for(let x=0;x<=w.width;x++){ctx.beginPath();ctx.moveTo(x*scale,0);ctx.lineTo(x*scale,c.height);ctx.stroke();}for(let y=0;y<=w.height;y++){ctx.beginPath();ctx.moveTo(0,y*scale);ctx.lineTo(c.width,y*scale);ctx.stroke();}
  const colors={light:'#d9e7ba',odor:'#a7cc7d',sound:'#ddba75',taste:'#bd9ddd',climate:'#e49a78'},labels={light:'СВЕТ',odor:'ЗАПАХ',sound:'ЗВУК',taste:'КОНТАКТ',climate:'ТЕПЛО'};
  for(const o of w.objects){
    const x=o.x*scale,y=o.y*scale;ctx.strokeStyle=colors[o.kind];ctx.fillStyle=colors[o.kind]+'2b';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,o.radius*scale,0,Math.PI*2);ctx.fill();ctx.stroke();
    if(o.kind==='sound'){ctx.strokeStyle=colors[o.kind]+'55';ctx.beginPath();ctx.arc(x,y,(o.radius+.4+(w.time%1)*.5)*scale,0,Math.PI*2);ctx.stroke();}
    ctx.font='10px ui-monospace,monospace';ctx.fillStyle=colors[o.kind];ctx.textAlign='center';ctx.fillText(labels[o.kind],x,y-o.radius*scale-10);
  }
  const b=w.body,x=b.x*scale,y=b.y*scale;ctx.save();ctx.translate(x,y);ctx.rotate(b.heading);ctx.strokeStyle='#8ed3da';ctx.lineWidth=2;
  for(let i=0;i<6;i++){const localX=[.35,0,-.35][Math.floor(i/2)]*scale,side=i%2?1:-1;ctx.beginPath();ctx.moveTo(localX,side*.15*scale);ctx.lineTo(localX+Math.sin(b.joints[i])*scale*.2,side*.5*scale);ctx.stroke();}
  ctx.fillStyle='#192b2b';ctx.beginPath();ctx.ellipse(0,0,.4*scale,.2*scale,0,0,2*Math.PI);ctx.fill();ctx.stroke();ctx.beginPath();ctx.arc(.28*scale,0,.16*scale,0,2*Math.PI);ctx.stroke();ctx.beginPath();ctx.moveTo(.4*scale,-.1*scale);ctx.lineTo(.65*scale,-.3*scale);ctx.moveTo(.4*scale,.1*scale);ctx.lineTo(.65*scale,.3*scale);ctx.stroke();ctx.strokeStyle='#8ed3da66';ctx.setLineDash([4,5]);ctx.beginPath();ctx.moveTo(.5*scale,0);ctx.lineTo(2*scale,0);ctx.stroke();ctx.restore();
  if(state.clamped){ctx.strokeStyle='#c6dc9977';ctx.setLineDash([4,4]);ctx.beginPath();ctx.arc(x,y,scale*.9,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);}
}
function drawEyes(){
  const selected=$('eye-band').value;
  for(const [side,id] of [['L','eye-left'],['R','eye-right']]){
    const canvas=$(id),ctx=canvas.getContext('2d');ctx.fillStyle='#101813';ctx.fillRect(0,0,canvas.width,canvas.height);
    for(let i=0;i<metadata.columns.length;i++){
      const c=metadata.columns[i];if(c.side!==side)continue;const bands=state.pixels[i],scale=state.mask.vision?1:.2;
      const rgb=selected==='mixed'?[bands[0]*210,bands[2]*255,bands[1]*255]:Array(3).fill(bands[Number(selected)]*255);
      ctx.fillStyle='rgb('+rgb.map(v=>Math.round(v*scale)).join(',')+')';const x=18+c.u*(canvas.width-36),y=canvas.height-18-c.v*(canvas.height-36);ctx.beginPath();ctx.arc(x,y,4.1,0,2*Math.PI);ctx.fill();
    }
  }
}
async function advance(manual=null){
  if(stepping)return;stepping=true;try{state=await request('step',{manual});render();}catch(error){fail(error);}finally{stepping=false;}
}
async function loop(generation){if(!running||generation!==runGeneration)return;await advance();if(running&&generation===runGeneration)loopTimer=setTimeout(()=>loop(generation),30);}
$('run').addEventListener('click',()=>{if(running)pause();else{running=true;$('run').textContent='Ⅱ Пауза';loop(++runGeneration);}});
$('step').addEventListener('click',()=>{pause();advance();});
$('reset').addEventListener('click',()=>act('reset',{seed:$('seed').value,preset:$('preset').value}));
$('clamped').addEventListener('change',()=>act('configure',{clamped:$('clamped').checked}));
$('connected').addEventListener('change',()=>act('configure',{dynamics:{connected:$('connected').checked}}));
$('glu').addEventListener('change',()=>act('configure',{dynamics:{gluSign:Number($('glu').value)}}));
for(const key of ['tonic','da','oa','serotonin'])$(key).addEventListener('change',()=>act('configure',{dynamics:{[key]:Number($(key).value)}}));
$('light').addEventListener('change',()=>act('configure',{light:Number($('light').value)}));
$('wind').addEventListener('change',()=>act('configure',{wind:[Number($('wind').value),0]}));
$('odor').addEventListener('change',()=>act('configure',{odor:$('odor').value}));
$('overlay').addEventListener('change',()=>{if(state)drawArena();});$('eye-band').addEventListener('change',()=>{if(state)drawEyes();});
for(const b of document.querySelectorAll('[data-manual]'))b.addEventListener('click',()=>{pause();advance(b.dataset.manual);});
$('arena').addEventListener('click',event=>{
  if(!state)return;const rect=$('arena').getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width*state.world.width,y=(event.clientY-rect.top)/rect.height*state.world.height,mode=$('edit').value;
  act('edit',{kind:mode==='body'||mode==='wall'?mode:'source',id:mode,x,y});
});
$('save').addEventListener('click',async()=>{pause();try{const snapshot=await request('snapshot'),url=URL.createObjectURL(new Blob([JSON.stringify(snapshot)],{type:'application/json'})),a=element('a');a.href=url;a.download='malecns-full-lab-'+snapshot.ticks+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){fail(error);}});
$('load').addEventListener('click',()=>{pause();$('file').click();});$('file').addEventListener('change',async()=>{const file=$('file').files[0];if(!file)return;try{if(file.size>40000000)throw Error('Снимок слишком большой (лимит 40 МБ)');await act('restore',JSON.parse(await file.text()));}catch(error){fail(error);}finally{$('file').value='';}});
$('inspect').addEventListener('click',async()=>{try{const info=await request('inspect',$('neuron-query').value);$('neuron-detail').textContent=info?JSON.stringify(info,null,2):'Нейрон или тип не найден';}catch(error){fail(error);}});
async function init(){
  try{
    if(location.protocol==='file:')throw Error('Полная сеть запускается через локальный сервер: npm start, затем http://127.0.0.1:4177/lab.html. Двойной щелчок по HTML не может загрузить большой граф и фоновый поток.');
    worker=new Worker(new URL('./full-worker.mjs',import.meta.url),{type:'module'});
    worker.onmessage=({data})=>{if(data.event==='progress'){message(data.message);return;}const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.error?p.reject(Error(data.error)):p.resolve(data.result);};
    worker.onerror=event=>{const error=Error(event.message||'Фоновый расчёт завершился с ошибкой');for(const p of pending.values())p.reject(error);pending.clear();fail(error);};
    const result=await request('init');metadata=result.metadata;state=result.state;build();syncControls();render();
  }catch(error){fail(error);}
}
init();
