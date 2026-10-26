import {CHEMISTRIES,TRANSMITTER_NAMES,TRANSMITTER_COLORS,chemistryOf,transmitterInfo,transmitterPolarity,transmitterSummary} from './neurochemistry.mjs';
import {createExperience,setExperienceLearning} from './experience.mjs';
import {MOTOR_MODEL,isMotorMode,isMotorBrain,isAdaptiveMode,motorReadout,motorDisplay} from './motor.mjs';
import {SCENARIOS,W,H,FACTIONS,ROLES,MAPS,MAX_TICKS,WIN_SCORE,createSimulation,repeatWithExperience,stepSimulation,controllerFor,profile,decideUnit,updateDecisions,aliveUnits,threatAt,distance,hasLineOfSight,setTerrain,exportScene,importScene,clamp} from './engine.mjs';
import {CONNECTOME,CONTROLLERS,neuralReadout} from './neural.mjs';
import {contactConfig,aimConfig,runContactComparison,runMotorComparison,runAimComparison,runTransmitterComparison} from './experiments.mjs';
const $=id=>document.getElementById(id),colors=['#86c4d1','#e0a07b'];
const canvas=$('battlefield'),ctx=canvas.getContext('2d'),reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
let state=createSimulation({controllerA:'adaptive',controllerB:'adaptive',neurochemistry:'nt'}),initial=exportScene(state),selected='A-01',running=false,timer=null,lastStep=-10000,speed=1,brush='select',hover=null,toastTimer=null,revision=0,threatCache=null,tab='units',dimensions={width:0,height:0,cell:0,ox:0,oy:0};
let neuralHover=null,comparisonReactivity=.5,comparisonNeural=false,comparisonAdaptive=false,comparisonChemistry='nt';
const brainCells=brain=>isMotorBrain(brain)?motorDisplay(brain):CONNECTOME.neurons.map((n,i)=>({...n,activity:brain.activity[i]}));
const t=()=>performance.now();
const degrees=angle=>(angle>0?'+':'')+(angle*180/Math.PI).toFixed(1)+'°';
const icon=name=>'<svg aria-hidden="true"><use href="#i-'+name+'"/></svg>';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3200);}
function populate(){
  for(const id of ['faction-a','faction-b'])for(const [key,f]of Object.entries(FACTIONS)){const o=document.createElement('option');o.value=key;o.textContent=f.name;$(id).append(o);}
  for(const id of ['controller-a','controller-b'])for(const [key,label] of Object.entries(CONTROLLERS)){const o=document.createElement('option');o.value=key;o.textContent=label;$(id).append(o);}
  for(const [value,label] of Object.entries(SCENARIOS)){const o=document.createElement('option');o.value=value;o.textContent=label;$('scenario').append(o);}
  for(const [value,label] of Object.entries(CHEMISTRIES)){const o=document.createElement('option');o.value=value;o.textContent=label;$('neurochemistry').append(o);}
  syncConfig();
}
function syncConfig(){
  $('neurochemistry').value=state.config.neurochemistry;
  $('scenario').value=state.config.scenario;syncScenarioControls();
  $('map-kind').value=state.config.mapKind;$('seed').value=state.config.seed;$('density').value=state.config.density;$('density-value').value=state.config.density;
  $('controller-a').value=state.config.controllerA;$('controller-b').value=state.config.controllerB;
  $('faction-a').value=state.config.factionA;$('faction-b').value=state.config.factionB;updateFactionNotes();
}
function syncScenarioControls(){const fixed=$('scenario').value!=='battle';$('map-kind').disabled=fixed;$('density').disabled=fixed;}
function updateFactionNotes(){for(const id of ['a','b'])$('faction-'+id+'-note').textContent=FACTIONS[$('faction-'+id).value].description;}
function setRunning(value){
  running=value&&!state.finished;if(timer)clearTimeout(timer);timer=null;
  if(running){setBrush('select');schedule();}
  updateTransport();
}
function schedule(){timer=setTimeout(()=>{if(!running)return;advance();if(running)schedule();},750/speed);}
function advance(){
  if(state.finished)return;
  if(state.tick===0)initial=exportScene(state);
  stepSimulation(state);lastStep=t();revision++;threatCache=null;
  if(state.finished)setRunning(false);renderUI();
}
function reset(){
  setRunning(false);state=importScene(initial);lastStep=-10000;revision++;threatCache=null;syncConfig();renderUI();toast('Возврат к исходной сцене. Seed и настройки сохранены.');
}
function setupConfig(){return {scenario:$('scenario').value,seed:$('seed').value.trim()||'40721',mapKind:$('map-kind').value,density:Number($('density').value),factionA:$('faction-a').value,factionB:$('faction-b').value,controllerA:$('controller-a').value,controllerB:$('controller-b').value,neurochemistry:$('neurochemistry').value};}
function generate(){
  setRunning(false);
  state=createSimulation(setupConfig());
  initial=exportScene(state);selected='A-01';lastStep=-10000;revision++;threatCache=null;setBrush('select');syncConfig();renderUI();toast('Новое поле создано. Нажми «Запустить» или «Шаг».');
}
function repeatExperienced(){
  setRunning(false);state=repeatWithExperience(state,setupConfig());initial=exportScene(state);
  selected='A-01';lastStep=-10000;revision++;threatCache=null;setBrush('select');syncConfig();renderUI();
  toast('Новый бой. Совместимый опыт перенесён; при смене модели передачи обучение начинается заново.');
}
function openExperiment(config,reactivity=.5){
  for(const [id,key] of [['scenario','scenario'],['seed','seed'],['map-kind','mapKind'],['faction-a','factionA'],['faction-b','factionB'],['controller-a','controllerA'],['controller-b','controllerB'],['neurochemistry','neurochemistry']])$(id).value=config[key];
  $('density').value=config.density;generate();state.units[0].overrides.reactivity=reactivity;updateDecisions(state);initial=exportScene(state);renderUI();
}
function openContactScene(reactivity=.5,controller='malecns',chemistry=state.config.neurochemistry){
  openExperiment(contactConfig(controller,chemistry),reactivity);
  toast(isMotorMode(controller)?'Нейронное управление у A. Нажми «Шаг» и смотри команды сети.':'Тест рефлекса: нажми «Шаг». Затем сравни режимы.');
}
function openAimScene(){
  openExperiment(aimConfig('neural',state.config.neurochemistry));
  toast('Две мишени с отключёнными связями. У A — отдельные команды движения и огня.');
}
function compareControllers(){
  const unit=state.units.find(u=>u.id===selected)||state.units[0],reactivity=profile(unit).reactivity,neural=isMotorMode(controllerFor(state,unit)),adaptive=isAdaptiveMode(controllerFor(state,unit)),chemistry=chemistryOf(unit.brain),results=neural?runMotorComparison(reactivity,adaptive,chemistry):runContactComparison(reactivity,chemistry);comparisonReactivity=reactivity;comparisonNeural=neural;comparisonAdaptive=adaptive;comparisonChemistry=chemistry;
  $('compare-neural-column').textContent=neural?'Двигательных команд':'Нейронных отходов';
  $('compare-description').textContent=(adaptive?'С чистым опытом · ':'')+CHEMISTRIES[chemistry]+' · 12 тактов · один seed · два разведчика Astartes · одинаковые входные условия. Чувствительность A: '+(reactivity*2).toFixed(2)+'×. Текущий бой сохранён.';
  $('compare-results').innerHTML=results.map(r=>'<tr><th scope="row">'+escape(r.label)+'</th><td>'+escape(r.firstAction)+'</td><td>'+(neural?r.motorCommands:r.neuralEscapes)+'</td><td>'+r.damageDone+'</td><td>'+r.hp+'</td></tr>').join('');
  $('compare-timeline').innerHTML=results.map(r=>'<div class="comparison-run"><strong>'+escape(r.label)+'</strong><div class="comparison-ticks">'+r.timeline.map(t=>'<span class="action-'+(t.override?'reflex':t.action)+'" title="Такт '+t.tick+': '+escape(t.label)+'; выход цепи угрозы '+t.rawDrive.toFixed(3)+'">'+(t.override?'↙':t.action==='attack'?'×':t.action==='dead'?'—':t.action==='move'?'→':t.action==='retreat'?'↙':t.action==='turn'?'↶':'·')+'</span>').join('')+'</div></div>').join('');
  $('compare-aim-section').hidden=!neural;
  if(neural){
    const probes=runAimComparison(reactivity,chemistry);
    $('compare-aim-results').innerHTML=probes.map(p=>'<tr><th scope="row">'+escape(p.label)+'</th><td>'+(p.angle===null?'—':degrees(p.angle))+'</td><td>'+escape(p.target||'—')+'</td><td>'+escape(p.command==='fire'?'Огонь':p.command==='wait'?'Ожидание':p.command)+'</td></tr>').join('');
  }
  $('compare-transmitter-results').innerHTML=runTransmitterComparison(controllerFor(state,unit)).map(p=>'<tr><th scope="row">'+escape(p.label)+'</th><td>'+p.meanRate.toFixed(5)+'</td><td>'+p.escape.map(v=>v.toFixed(5)).join(' / ')+'</td><td>'+(p.aim?p.aim.map(v=>v.toFixed(5)).join(' / '):'—')+'</td></tr>').join('');
  $('compare-dialog').showModal();
}
function selectUnit(id){selected=id;threatCache=null;renderInspector();renderRoster();}
function updateTransport(){
  $('repeat-experience').disabled=!state.units.some(u=>isAdaptiveMode(controllerFor(state,u)));
  $('play').innerHTML=icon(running?'pause':'play')+'<span>'+(running?'Пауза':'Запустить')+'</span>';
  $('play').disabled=state.finished;$('step').disabled=running||state.finished;
  $('status-text').textContent=state.finished?'ЭКСПЕРИМЕНТ ЗАВЕРШЁН':running?'СИМУЛЯЦИЯ ИДЁТ':state.tick?'НА ПАУЗЕ':'ГОТОВ К ЗАПУСКУ';
  $('status-dot').classList.toggle('running',running);
  for(const b of document.querySelectorAll('[data-brush]'))if(b.dataset.brush!=='select')b.disabled=state.tick>0||running;
}
function renderUI(){
  $('migration-note').hidden=!state.importNote;$('migration-note').textContent=state.importNote||'';
  const contact=state.config.scenario==='contact',aim=state.config.scenario==='aim';
  for(const [team,id] of [[0,'team-size-a'],[1,'team-size-b']])$(id).textContent=String(state.units.filter(u=>u.team===team).length).padStart(2,'0')+' ед.';$('roster-count').textContent=state.units.length;
  $('mission-title').textContent=aim?'Две цели. Один прицел.':contact?'Реакция на близкую угрозу.':'Три точки. Один победитель.';
  $('mission-description').textContent=aim?'A выбирает движение или огонь; две мишени B не передают сигналы по связям. Сравни направление прицела с расположением целей.':contact?'Два разведчика в зоне огня. Сравни команды и поведение сети со связями и без них.':'Занимай сектора I, II и III. Каждый удерживаемый сектор приносит 1 очко за такт.';
  $('score-a').textContent=String(state.scores[0]).padStart(2,'0');$('score-b').textContent=String(state.scores[1]).padStart(2,'0');$('tick-value').textContent=String(state.tick).padStart(3,'0');
  $('name-a').textContent=FACTIONS[state.config.factionA].short;$('name-b').textContent=FACTIONS[state.config.factionB].short;
  $('map-name').textContent=aim?'AIM TEST':contact?'CONTACT TEST':{ruins:'FORPOST',industrial:'INDUSTRIAL',badlands:'BADLANDS'}[state.config.mapKind];
  $('seed-display').textContent='SEED '+state.config.seed.slice(0,14);
  $('objective-indicators').innerHTML=state.objectives.map(o=>'<span title="Точка '+o.id+(o.contested?' оспаривается':o.owner===null?' свободна':': группа '+(o.owner?'B':'A'))+'" style="'+(o.owner!==null?'color:'+colors[o.owner]+';border-color:'+colors[o.owner]+';background:'+colors[o.owner]+'18':'')+'"><i>'+o.id+'</i></span>').join('');
  $('result-overlay').hidden=!state.finished;
  if(state.finished){$('result-title').textContent=state.winner===null?'Ничья':'Победа '+FACTIONS[state.winner?state.config.factionB:state.config.factionA].short+' · '+(state.winner?'B':'A');$('result-summary').textContent='Счёт '+state.scores[0]+' : '+state.scores[1]+' · '+state.tick+' тактов · '+aliveUnits(state).length+' юнитов осталось';}
  $('event-count').textContent=state.events.length;updateTransport();renderInspector();renderRoster();renderLog();
}
function renderInspector(){
  const u=state.units.find(u=>u.id===selected)||state.units[0],p=profile(u),d=u.hp>0?u.decision:null;
  $('unit-emblem').textContent=ROLES[u.role].symbol;$('unit-emblem').style.color=colors[u.team];$('unit-emblem').style.borderColor=colors[u.team]+'70';
  $('unit-name').textContent=u.name;$('unit-code').textContent=u.id+' / '+FACTIONS[u.faction].short.toUpperCase();$('unit-role').textContent=ROLES[u.role].name;
  $('unit-team').textContent=u.team?'B':'A';$('unit-team').style.color=colors[u.team];$('unit-team').style.borderColor=colors[u.team]+'70';
  $('unit-health').textContent=u.hp+' / '+u.maxHp+' HP';$('health-fill').style.width=u.hp/u.maxHp*100+'%';$('health-fill').style.background=u.hp/u.maxHp<.3?'#db9a78':'var(--accent)';
  $('stat-range').innerHTML=u.range+' <small>кл.</small>';$('stat-damage').textContent=u.damage;$('stat-position').textContent=String(u.x).padStart(2,'0')+' : '+String(u.y).padStart(2,'0');
  $('decision-state').textContent=!u.hp?'ВЫВЕДЕН ИЗ БОЯ':({move:'ДВИЖЕНИЕ',turn:'ПОВОРОТ',attack:'АТАКА',hold:'КОНТРОЛЬ',retreat:'ОТСТУПЛЕНИЕ'}[d?.type]||'ОЖИДАНИЕ');
  $('decision-title').textContent=d?.label||'Юнит потерян';$('decision-reason').textContent=d?.reason||'Урон за бой: '+u.damageDone+'. Уничтожено противников: '+u.kills+'.';
  const cf=d?.counterfactual;
  $('decision-comparison').hidden=!cf;
  if(cf){
    const formatChoice=(label,step)=>label+(step?' → '+step.x+' : '+step.y:'');
    $('baseline-action').textContent=formatChoice(cf.label,cf.firstStep);
    $('actual-action').textContent=formatChoice(d.label,d.route?.[0]);
    $('decision-impact').textContent=cf.changed?'Рефлекс изменил первое действие':d.neuralOverride?'Рефлекс выбрал тот же первый шаг':'Тактическое действие сохранено';
    $('decision-impact').classList.toggle('changed',cf.changed);
    const safety=d.routeSafety;
    $('route-safety').hidden=!safety;
    if(safety){
      for(const [id,value] of [['risk-now',safety.currentRisk],['risk-first',safety.firstRisk],['risk-end',safety.destinationRisk]])$(id).textContent=Number(value.toFixed(1));
      $('route-budget').textContent='Маршрут: '+safety.steps+' кл. · доступно '+safety.budget+'. На каждом шаге оценка угрозы не растёт.';
    }
  }
  $('candidate-kind').textContent=d?.learning?'сеть + опыт':d?.source==='motor'?'выход сети':'utility';
  $('candidate-kind').title=d?.source==='motor'?'Сигнал двигательного декодера, не вероятность':'Условная полезность действия, не вероятность';
  $('profile-explainer').textContent=d?.source==='motor'?'Агрессия, осторожность и миссия меняют входные сигналы со следующего такта. Чувствительность усиливает выходные команды.':'Меняй приоритеты выбранного юнита.';
  const options=d?.alternatives||[],max=Math.max(1,...options.map(a=>a.score));
  $('candidates').innerHTML=options.map(a=>'<div class="candidate"><i style="width:'+clamp(a.score/max)*100+'%"></i><span>'+escape(a.label)+(a.available===false?' · недоступно':'')+'</span><strong>'+a.score.toFixed(d?.source==='motor'?3:1)+'</strong></div>').join('');
  $('decision-caption').textContent=d?(d.evaluatedAt===0?'Расчёт перед первым тактом':'Последний расчёт: такт '+d.evaluatedAt):'Действия больше не выполняются';
  for(const k of ['aggression','caution','objective','reactivity']){if(document.activeElement!==$(k))$(k).value=Math.round(p[k]*100);$(k+'-value').value=k==='reactivity'?(p[k]*2).toFixed(2)+'×':Math.round(p[k]*100);$(k).disabled=u.hp<=0;}
  $('reset-profile').disabled=u.hp<=0;
  renderBrain(u);
}

function renderExperience(u,adaptive){
  $('experience-panel').hidden=!adaptive;if(!adaptive)return;
  const e=u.experience,decision=u.decision;
  $('experience-status').textContent=e.enabled?'Опыт обновляется после действий.':'Обучение заморожено; используются сохранённые коэффициенты.';
  $('experience-cells').textContent=e.visits.filter(v=>v>0).length;
  $('experience-goals').textContent=e.known.join(', ')||'Пока не замечены';
  $('experience-updates').textContent=e.updates;$('experience-episode').textContent=e.episodes+1;
  $('experience-reward').textContent=(e.lastReward>0?'+':'')+e.lastReward.toFixed(3);
  $('experience-total').textContent=e.totalReward.toFixed(3);
  const names={capture:'захват',hold:'контроль',damage:'урон врагу',hurt:'полученный урон',novelty:'новая клетка',revisit:'повтор пути',progress:'приближение к точке',cost:'затрата такта',outcome:'исход'};
  $('experience-parts').textContent=Object.entries(e.lastParts).map(([k,v])=>names[k]+': '+(v>0?'+':'')+v.toFixed(3)).join(' · ')||'Обратная связь появится после первого действия.';
  const learning=decision?.learning;
  $('experience-choice').textContent=learning?'Последнее решение: '+(learning.exploratory?'исследовательская проба':'выбор по оценкам')+
    '. Поправка опыта: '+learning.corrections[decision.command].toFixed(3)+'.':'Нет действующего решения.';
  $('learning-enabled').checked=e.enabled;$('memory-enabled').checked=e.useMemory;
  $('learning-enabled').disabled=u.hp<=0;$('memory-enabled').disabled=u.hp<=0;
}
function neuronDescription(node,brain){
  const info=transmitterInfo(node.bodyId),sign=transmitterPolarity(info.consensus,chemistryOf(brain));
  const label=TRANSMITTER_NAMES[info.consensus]||info.consensus;
  const effect=sign>0?'возбуждение':sign<0?'торможение':'быстрый эффект не задан';
  return (node.type||'Без типа')+' '+node.side+' · body '+node.bodyId+' · активность '+node.activity.toFixed(4)+
    ' · медиатор: '+label+' · '+effect+(info.prediction&&info.confidence!==null?
    ' · предсказание нейрона: '+(TRANSMITTER_NAMES[info.prediction]||info.prediction)+' ('+(info.confidence*100).toFixed(1)+'%)':'')+
    (info.groundTruth?' · ground_truth: '+(TRANSMITTER_NAMES[info.groundTruth]||info.groundTruth):'');
}
function renderBrain(u){
  const mode=controllerFor(state,u),full=isMotorMode(mode),adaptive=isAdaptiveMode(mode),b=u.brain,n=neuralReadout(b,profile(u),mode),cells=brainCells(b),motor=full?(u.decision?.motor??motorReadout(b,profile(u).reactivity)):null;
  renderExperience(u,adaptive);
  const chemistry=chemistryOf(b),nt=transmitterSummary(full?MOTOR_MODEL.neurons:CONNECTOME.neurons,chemistry);
  $('chemistry-status').textContent=mode==='utility'?'Только тактика: нейронная передача не участвует.':CHEMISTRIES[chemistry];
  $('chemistry-counts').textContent='Возбуждающих: '+nt.excitatory+' · тормозящих: '+nt.inhibitory+' · без заданного быстрого эффекта: '+nt.unresolved;
  $('chemistry-note').textContent=chemistry==='unsigned'?'Контрольный режим: все контакты положительные. Метки медиаторов доступны для просмотра.':
    'Метки consensus_nt из MaleCNS. Знак глутамата — допущение; для неопределённых меток и дофамина, серотонина, октопамина быстрый эффект не задан. Рецепторы и концентрации не моделируются.';
  $('brain-mode').textContent=adaptive?'ADAPTIVE':full?'NEURAL':mode==='malecns'?'REFLEX':mode==='utility'?'UTILITY':'CONTROL';
  $('brain-summary').textContent=full?((mode==='neural-disconnected'||mode==='adaptive-disconnected')?'11 436 нейронов; все связи отключены. Входы стимулируются, выходы не получают сигнал.':adaptive?'11 436 нейронов · фиксированные связи. Выходы читает обучаемый слой команд; память хранится отдельно.':'11 436 нейронов · 1 687 031 связь. Команды выбираются по выходам сети; тактический планировщик отключён.'):mode==='utility'?'Сеть не участвует. Действия выбирает тактический алгоритм.':mode==='disconnected'?'Входы работают, все связи отключены. Контроль вклада графа.':'319 нейронов · 21 288 связей. Короткий рефлекс поверх тактики.';
  $('brain-input').textContent=b.inputs.map(v=>v.toFixed(3)).join(' / ');
  $('brain-output').textContent=b.outputs.map(v=>v.toFixed(3)).join(' / ');
  const strongest=full?Math.max(motor.scores.fire,motor.scores.advance,motor.scores.left,motor.scores.right,motor.scores.reverse):n.drive;
  $('brain-drive').style.width=clamp(strongest/(full?2:.5))*100+'%';
  $('brain-threshold-marker').style.left=(full?.06/2:clamp(n.threshold/.5))*100+'%';
  $('brain-threshold-marker').hidden=adaptive;
  $('brain-threshold').textContent=adaptive?'Оценка выбранной команды '+(u.decision?.score??0).toFixed(3):full?'Порог команды 0.060 · сигнал '+strongest.toFixed(3):'Порог '+n.threshold.toFixed(3)+' · сигнал '+n.drive.toFixed(3);
  $('brain-steps').textContent=b.steps+' шагов';
  $('motor-panel').hidden=!full;$('reflex-phases').hidden=full;$('reflex-meta').hidden=full;
  if(full){
    $('motor-targets').textContent=b.targets.map(v=>v.toFixed(3)).join(' / ');
    $('motor-aim-signal').textContent=motor.raw.aim.map(v=>v.toFixed(4)).join(' / ');
    const aim=u.decision?.aim;
    $('motor-aim-angle').textContent=aim?.angle==null?'Нет сигнала':degrees(aim.angle);
    $('aim-caption').textContent=aim?'Расчёт решения, такт '+u.decision.evaluatedAt+'. Приоритет прицела: '+(aim.target||'нет')+'. Огонь выполняется, только если выигрывает команда атаки.':'Нет действующего решения.';
    $('aim-candidates').innerHTML=aim?.candidates.length?
      '<table class="aim-table"><thead><tr><th>Цель</th><th>Угол</th><th>Отклонение</th></tr></thead><tbody>'+
      aim.candidates.map(c=>'<tr'+(c.id===aim.target?' class="aim-selected"':'')+'><td>'+escape(c.id)+'</td><td>'+degrees(c.bearing)+'</td><td>'+(c.error===null?'—':degrees(c.error))+'</td></tr>').join('')+'</tbody></table>':
      '<p>Нет видимых врагов в секторе ±45° и радиусе оружия.</p>';
    $('motor-steer').textContent=motor.raw.steer.map(v=>v.toFixed(4)).join(' / ');
    $('motor-walk').textContent=motor.raw.walk.map(v=>v.toFixed(4)).join(' / ');
    $('motor-reverse').textContent=motor.raw.reverse.map(v=>v.toFixed(4)).join(' / ');
    $('motor-heading').textContent=['С','СВ','В','ЮВ','Ю','ЮЗ','З','СЗ'][u.heading];
    $('motor-adapter').textContent=u.decision?.adapterNote||'Выходы сети переводятся в игровые команды.';
    $('brain-status').textContent=u.hp<=0?'Юнит выведен из боя; сеть остановлена.':(mode==='neural-disconnected'||mode==='adaptive-disconnected')?'Связи отключены. Без сигнала выходных нейронов юнит остаётся на месте.':adaptive?'MaleCNS и обучаемый слой команд. Награды меняют добавленные коэффициенты; исходный граф фиксирован.':'Самостоятельный выбор команды через двигательный декодер. Ограничитель короткого рефлекса не используется.';
  }else{
    const gate=u.reflex;
    for(const el of document.querySelectorAll('[data-reflex-phase]'))el.classList.toggle('active',mode!=='utility'&&el.dataset.reflexPhase===gate.phase);
    $('reflex-meta').textContent='Эпизодов: '+gate.episodes+' · нейронных отходов: '+u.neuralEscapes+(gate.phase==='cooldown'?' · восстановление: '+gate.remaining:'');
    $('brain-status').textContent=u.hp<=0?'Юнит выведен из боя; сеть остановлена.':mode==='utility'?'Активен обычный тактический выбор.':u.decision?.neuralOverride?'Короткий нейронный отход: до 2 действий за эпизод.':gate.phase==='cooldown'?'Рефлекс восстанавливается. Тактические решения доступны.':gate.phase==='waiting'?'Ожидание ослабления сигнала. Тактические решения доступны.':n.triggered&&!gate.active?'Порог превышен; реакция проверится на следующем такте.':u.decision?.neural?.blockedReason||'Сигнал ниже порога; действует тактический план.';
  }
  $('neural-sampling').textContent=full?'Показана равномерная выборка 319 из 11 436 нейронов. Расположение условное.':'Все 319 нейронов цепи рефлекса. Расположение условное.';
  if(neuralHover!==null){const node=cells[neuralHover];if(node)$('neuron-detail').textContent=neuronDescription(node,b);}
  const c=$('neural-canvas'),g=c.getContext('2d');g.clearRect(0,0,c.width,c.height);
  c.setAttribute('aria-label',full?'Активность выборки 319 из 11436 нейронов':'Активность всех 319 нейронов');
  for(let i=0;i<cells.length;i++){
    const node=cells[i],x=i%29*20,y=Math.floor(i/29)*20;
    if($('show-transmitters').checked){g.fillStyle=TRANSMITTER_COLORS[transmitterInfo(node.bodyId).consensus]||TRANSMITTER_COLORS.unclear;g.globalAlpha=.22+.78*node.activity;}
    else g.fillStyle='hsl('+(node.side==='L'?190:26)+' 48% '+(10+node.activity*66)+'%)';
    g.fillRect(x+2,y+2,16,16);g.globalAlpha=1;
    if(node.kind==='output'){g.strokeStyle='#c8df9b';g.lineWidth=1;g.strokeRect(x+2,y+2,16,16);}
  }
  const trace=$('neural-trace'),tc=trace.getContext('2d');tc.clearRect(0,0,trace.width,trace.height);
  if(!full&&n.gain>0){const y=96-clamp(n.threshold/n.gain/.3)*90;tc.strokeStyle='#e0a07b66';tc.setLineDash([5,5]);tc.beginPath();tc.moveTo(0,y);tc.lineTo(580,y);tc.stroke();tc.setLineDash([]);}
  for(let side=0;side<2;side++){
    tc.strokeStyle=colors[side];tc.lineWidth=2;tc.beginPath();
    b.trace.forEach((sample,i)=>{const x=8+i/39*564,y=96-clamp(sample.outputs[side]/.3)*90;i?tc.lineTo(x,y):tc.moveTo(x,y);});tc.stroke();
  }
}

function renderRoster(){
  $('unit-roster').innerHTML=state.units.map(u=>'<button class="roster-unit '+(u.team?'team-b ':'')+(u.id===selected?'selected ':'')+(u.hp<=0?'dead':'')+'" data-unit="'+u.id+'" aria-label="'+u.id+', '+ROLES[u.role].name+', '+u.hp+' HP" aria-pressed="'+(u.id===selected)+'"><span class="roster-top"><span class="roster-symbol">'+ROLES[u.role].symbol+'</span><span class="roster-id">'+u.id+'</span></span><div class="roster-hp"><i style="width:'+u.hp/u.maxHp*100+'%"></i></div><div class="roster-role">'+(u.hp<=0?'Выведен из боя':ROLES[u.role].name)+'</div></button>').join('');
}
function renderLog(){
  if(tab!=='log')return;
  $('event-log').innerHTML=state.events.length?[...state.events].reverse().map(e=>'<div class="log-item" data-team="'+e.team+'"><span class="log-tick">'+String(e.tick).padStart(3,'0')+'</span><span>'+escape(e.text)+'</span></div>').join(''):'<p class="empty-log"><b>Поле ждёт первого решения.</b>Здесь появятся захваты точек, выстрелы и потери. Используй «Шаг», чтобы исследовать бой по тактам.</p>';
}
function setTab(name){
  tab=name;for(const n of ['units','log']){$('tab-'+n).classList.toggle('active',n===name);$('tab-'+n).setAttribute('aria-selected',n===name);$(n+'-view').hidden=n!==name;}renderLog();
}
function setBrush(value){brush=value;for(const b of document.querySelectorAll('[data-brush]')){const active=b.dataset.brush===value;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);}canvas.style.cursor=value==='select'?'crosshair':'cell';}
function edit(x,y){if(setTerrain(state,x,y,Number(brush))){revision++;threatCache=null;initial=exportScene(state);renderInspector();}else toast('Нельзя перекрыть юнит, цель или единственный проход. Редактор работает до старта.');}
function coordinate(e){const r=canvas.getBoundingClientRect();return {x:Math.floor((e.clientX-r.left-dimensions.ox)/dimensions.cell),y:Math.floor((e.clientY-r.top-dimensions.oy)/dimensions.cell)};}
function resize(){
  const box=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(box.width*dpr);canvas.height=Math.round(box.height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
  const cell=Math.min((box.width-36)/W,(box.height-52)/H);dimensions={width:box.width,height:box.height,cell,ox:(box.width-cell*W)/2,oy:(box.height-cell*H)/2};threatCache=null;
}
function poly(points,fill,stroke){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}}
function roundRect(x,y,w,h,r,fill,stroke){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}}
function center(pos){return {x:dimensions.ox+(pos.x+.5)*dimensions.cell,y:dimensions.oy+(pos.y+.5)*dimensions.cell};}
function draw(now){
  const {width,height,cell:c,ox,oy}=dimensions;if(!c)return;
  ctx.clearRect(0,0,width,height);ctx.fillStyle='#242e23';ctx.fillRect(0,0,width,height);
  const industrial=state.config.mapKind==='industrial',badlands=state.config.mapKind==='badlands';
  const floor=industrial?['#30362e','#32382f','#31372e']:badlands?['#34382b','#363a2d','#32362a']:['#303b2d','#333d2f','#313a2d'];
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const px=ox+x*c,py=oy+y*c,noise=((x*73+y*127+x*y*31)%17);
    ctx.fillStyle=floor[noise%3];ctx.fillRect(px,py,c+.4,c+.4);
    if(noise%4===0){ctx.fillStyle='#a1ab7611';ctx.fillRect(px+c*.24,py+c*.43,Math.max(1,c*.09),1);ctx.fillRect(px+c*.7,py+c*.13,1,Math.max(1,c*.07));}
    if(y===11){ctx.fillStyle='#9caa6c06';ctx.fillRect(px,py,c,c);if(x%2===0){ctx.fillStyle='#b7b77a25';ctx.fillRect(px+c*.15,py+c*.5,c*.48,1);}}
  }
  // Deployment bands and coordinate ticks.
  ctx.fillStyle=colors[0]+'08';ctx.fillRect(ox,oy,4.5*c,H*c);ctx.fillStyle=colors[1]+'08';ctx.fillRect(ox+(W-4.5)*c,oy,4.5*c,H*c);
  ctx.setLineDash([3,5]);ctx.lineWidth=1;
  for(const [x,color]of [[ox+4.5*c,colors[0]],[ox+(W-4.5)*c,colors[1]]]){ctx.strokeStyle=color+'35';ctx.beginPath();ctx.moveTo(x,oy);ctx.lineTo(x,oy+H*c);ctx.stroke();}
  ctx.setLineDash([]);
  if($('show-grid').checked){
    ctx.strokeStyle='#b7c4940e';ctx.lineWidth=.6;ctx.beginPath();
    for(let x=0;x<=W;x++){ctx.moveTo(ox+x*c,oy);ctx.lineTo(ox+x*c,oy+H*c);}
    for(let y=0;y<=H;y++){ctx.moveTo(ox,oy+y*c);ctx.lineTo(ox+W*c,oy+y*c);}ctx.stroke();
  }
  ctx.strokeStyle='#80906a35';ctx.strokeRect(ox,oy,W*c,H*c);ctx.font='7px Consolas,monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#9eae8980';
  for(let x=0;x<W;x+=4)ctx.fillText(String(x).padStart(2,'0'),ox+(x+.5)*c,oy-9);
  for(let y=0;y<H;y+=4)ctx.fillText(String(y).padStart(2,'0'),ox-10,oy+(y+.5)*c);
  // Soft obstacles cast small offset shadows, making a miniature tabletop.
  for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(state.map[y*W+x]===1){
    ctx.fillStyle='#10191070';ctx.fillRect(ox+x*c+c*.2,oy+y*c+c*.23,c*1.12,c*1.14);
  }
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const type=state.map[y*W+x],px=ox+x*c,py=oy+y*c;
    if(type===1){
      const top=badlands?'#686e50':industrial?'#59634f':'#657354',light=badlands?'#8c9269':'#8a9a70';
      if(badlands){poly([[px+2,py+c*.2],[px+c*.25,py+1],[px+c*.8,py+2],[px+c-1,py+c*.5],[px+c*.78,py+c-2],[px+c*.1,py+c*.83]],top,'#8b95704a');}
      else{
        ctx.fillStyle='#414c36';ctx.fillRect(px+1,py+3,c-1,c-1);
        ctx.fillStyle=top;ctx.fillRect(px+1,py-1,c-1,c-3);
        ctx.fillStyle=light;ctx.globalAlpha=.65;ctx.fillRect(px+1,py-1,c-1,1);ctx.fillRect(px+1,py-1,1,c-3);ctx.globalAlpha=1;
        ctx.strokeStyle='#2c382741';ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(px+c*.2,py+c*.2);ctx.lineTo(px+c*.6,py+c*.2);ctx.lineTo(px+c*.72,py+c*.5);ctx.stroke();
        if((x+y)%5===0){ctx.fillStyle='#a3b27b30';ctx.fillRect(px+c*.7,py+c*.65,2,2);}
      }
    }else if(type===2){
      roundRect(px+2,py+2,c-4,c-4,2,'#46603a','#82996775');ctx.strokeStyle='#9bb57a80';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(px+c*.25,py+c*.3);ctx.lineTo(px+c*.75,py+c*.3);ctx.moveTo(px+c*.25,py+c*.65);ctx.lineTo(px+c*.75,py+c*.65);ctx.stroke();
    }
  }
  const unit=state.units.find(u=>u.id===selected);
  if($('show-memory').checked&&unit&&isAdaptiveMode(controllerFor(state,unit))){
    for(let k=0;k<unit.experience.visits.length;k++){
      const visits=unit.experience.visits[k];if(!visits)continue;
      ctx.fillStyle='rgba(200,223,155,'+Math.min(.55,.12+visits*.09)+')';
      ctx.fillRect(ox+(k%W)*c+1,oy+Math.floor(k/W)*c+1,c-2,c-2);
    }
  }
  if($('show-threat').checked&&unit){
    if(!threatCache||threatCache.key!==revision+':'+selected){const tiles=[];for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(state.map[y*W+x]!==1){const danger=threatAt(state,{x,y},unit.team);if(danger)tiles.push({x,y,danger});}threatCache={key:revision+':'+selected,tiles};}
    for(const p of threatCache.tiles){ctx.fillStyle='rgba(231,119,80,'+Math.min(.46,p.danger/65)+')';ctx.fillRect(ox+p.x*c+1,oy+p.y*c+1,c-2,c-2);}
  }
  for(const o of state.objectives){
    const p=center(o),color=o.contested?'#e9be86':o.owner===null?'#ced4a0':colors[o.owner];
    ctx.strokeStyle=color+'55';ctx.fillStyle=color+'09';ctx.lineWidth=1;ctx.setLineDash([3,4]);ctx.beginPath();ctx.arc(p.x,p.y,c*1.4,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.setLineDash([]);
    ctx.lineWidth=1.5;poly([[p.x,p.y-c*.53],[p.x+c*.53,p.y],[p.x,p.y+c*.53],[p.x-c*.53,p.y]],'#263223',color+'b0');
    ctx.font='bold '+Math.max(8,c*.42)+'px Consolas,monospace';ctx.fillStyle=color;ctx.textAlign='center';ctx.fillText(o.id,p.x,p.y+.5);
  }
  const moveFraction=reducedMotion?1:clamp((now-lastStep)/(250/speed)),ease=1-Math.pow(1-moveFraction,3);
  const point=u=>center({x:u.px+(u.x-u.px)*ease,y:u.py+(u.y-u.py)*ease});
  if($('show-paths').checked)for(const u of aliveUnits(state)){
    if(!u.decision?.route?.length)continue;const p=point(u);ctx.strokeStyle=colors[u.team]+(u.id===selected?'c0':'35');ctx.lineWidth=u.id===selected?1.8:1;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(p.x,p.y);
    for(const n of u.decision.route){const v=center(n);ctx.lineTo(v.x,v.y);}ctx.stroke();ctx.setLineDash([]);
    if(u.id===selected){const end=center(u.decision.route.at(-1));ctx.strokeStyle=colors[u.team]+'a0';ctx.strokeRect(end.x-3,end.y-3,6,6);}
  }
  if(unit?.hp>0&&unit.decision?.aim?.angle!=null&&$('show-paths').checked){
    const aim=unit.decision.aim,p=center(unit.decision.origin),angle=aim.heading*Math.PI/4+aim.angle;
    ctx.strokeStyle='#e6d69b';ctx.lineWidth=1.4;ctx.setLineDash([6,4]);ctx.beginPath();ctx.moveTo(p.x,p.y);
    ctx.lineTo(p.x+Math.sin(angle)*c*2.5,p.y-Math.cos(angle)*c*2.5);ctx.stroke();ctx.setLineDash([]);
    const target=aim.candidates.find(e=>e.id===aim.target);
    if(target){const q=center(target);ctx.strokeRect(q.x-c*.47,q.y-c*.47,c*.94,c*.94);}
  }
  if(unit?.hp>0&&brush==='select'){
    const p=point(unit);ctx.strokeStyle=colors[unit.team]+'17';ctx.lineWidth=1;ctx.setLineDash([2,5]);poly([[p.x,p.y-unit.range*c],[p.x+unit.range*c,p.y],[p.x,p.y+unit.range*c],[p.x-unit.range*c,p.y]],null,colors[unit.team]+'19');ctx.setLineDash([]);
  }
  for(const u of state.units){
    const p=point(u),r=c*.38,sel=u.id===selected;
    if(u.hp<=0){ctx.strokeStyle=colors[u.team]+'50';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(p.x-3,p.y-3);ctx.lineTo(p.x+3,p.y+3);ctx.moveTo(p.x+3,p.y-3);ctx.lineTo(p.x-3,p.y+3);ctx.stroke();continue;}
    if(sel){ctx.strokeStyle=colors[u.team]+'bb';ctx.lineWidth=1;ctx.beginPath();ctx.arc(p.x,p.y,r+5,0,Math.PI*2);ctx.stroke();ctx.fillStyle=colors[u.team]+'08';ctx.beginPath();ctx.arc(p.x,p.y,r+8,0,Math.PI*2);ctx.fill();}
    ctx.fillStyle='#0c160e90';ctx.beginPath();ctx.ellipse(p.x+2,p.y+4,r+2,r*.65,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=u.team?'#3e3025':'#253b38';ctx.strokeStyle=colors[u.team];ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();ctx.stroke();
    if(isMotorMode(controllerFor(state,u))){const angle=u.heading*Math.PI/4;ctx.strokeStyle=colors[u.team];ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(p.x+Math.sin(angle)*(r+2),p.y-Math.cos(angle)*(r+2));ctx.lineTo(p.x+Math.sin(angle)*(r+9),p.y-Math.cos(angle)*(r+9));ctx.stroke();}
    ctx.strokeStyle=colors[u.team];ctx.lineWidth=1.6;
    if(u.role==='assault'){poly([[p.x,p.y-r*.5],[p.x+r*.5,p.y+r*.4],[p.x-r*.5,p.y+r*.4]],colors[u.team]);}
    else if(u.role==='scout'){poly([[p.x,p.y-r*.55],[p.x+r*.5,p.y],[p.x,p.y+r*.55],[p.x-r*.5,p.y]],null,colors[u.team]);}
    else{ctx.beginPath();ctx.moveTo(p.x-r*.45,p.y);ctx.lineTo(p.x+r*.45,p.y);ctx.moveTo(p.x,p.y-r*.45);ctx.lineTo(p.x,p.y+r*.45);ctx.stroke();}
    ctx.strokeStyle='#152115';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(p.x-r,p.y+r+4);ctx.lineTo(p.x+r,p.y+r+4);ctx.stroke();ctx.strokeStyle=colors[u.team];ctx.beginPath();ctx.moveTo(p.x-r,p.y+r+4);ctx.lineTo(p.x-r+r*2*u.hp/u.maxHp,p.y+r+4);ctx.stroke();
    const labelWidth=Math.max(23,c*1.4);roundRect(p.x-labelWidth/2,p.y-r-12,labelWidth,10,2,'#142015b8');
    ctx.font=Math.max(7,c*.33)+'px Consolas,monospace';ctx.textAlign='center';ctx.fillStyle=colors[u.team];ctx.fillText(u.id,p.x,p.y-r-6.5);
  }
  const effectAge=(now-lastStep)/(550/speed);
  if(effectAge<1&&effectAge>=0)for(const e of state.effects){
    const a=center(e.from),b=center(e.to);ctx.globalAlpha=1-effectAge;ctx.strokeStyle=e.hit?'#f4d49b':colors[e.team];ctx.lineWidth=e.hit?1.7:1;ctx.setLineDash(e.hit?[]:[2,3]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
    if(e.hit){ctx.fillStyle='#fff2c1';ctx.beginPath();ctx.arc(b.x,b.y,3+effectAge*8,0,Math.PI*2);ctx.stroke();ctx.font='bold 10px Consolas,monospace';ctx.fillStyle='#ffe2bb';ctx.fillText('−'+e.damage,b.x,b.y-15-effectAge*12);}ctx.globalAlpha=1;
  }
  if(hover&&hover.x>=0&&hover.y>=0&&hover.x<W&&hover.y<H){
    ctx.strokeStyle=brush==='select'?'#cedda14a':'#dfefb6';ctx.lineWidth=1;ctx.strokeRect(ox+hover.x*c+1,oy+hover.y*c+1,c-2,c-2);
  }
  // A subtle vignette gives the field the depth of a physical table.
  const vignette=ctx.createRadialGradient(width/2,height/2,width*.2,width/2,height/2,width*.7);vignette.addColorStop(0,'#07140900');vignette.addColorStop(1,'#07140930');ctx.fillStyle=vignette;ctx.fillRect(0,0,width,height);
}
let framePending=false;
function frame(now){draw(now);requestAnimationFrame(frame);}
populate();
$('neural-canvas').addEventListener('pointermove',e=>{
  const c=e.currentTarget,r=c.getBoundingClientRect(),col=Math.floor((e.clientX-r.left)/r.width*29),row=Math.floor((e.clientY-r.top)/r.height*11),i=row*29+col;
  const u=state.units.find(v=>v.id===selected);if(!u)return;
  const n=brainCells(u.brain)[i];if(!n)return;neuralHover=i;
  $('neuron-detail').textContent=neuronDescription(n,u.brain);
});
$('neural-canvas').addEventListener('pointerleave',()=>{neuralHover=null;$('neuron-detail').textContent='Наведи на ячейку: медиатор, предсказание, знак передачи и активность.';});
$('generate').addEventListener('click',generate);
$('show-transmitters').addEventListener('change',()=>renderInspector());
$('repeat-experience').addEventListener('click',repeatExperienced);
$('learning-enabled').addEventListener('change',()=>{const u=state.units.find(v=>v.id===selected);setExperienceLearning(u.experience,$('learning-enabled').checked);u.decision=decideUnit(state,u);if(state.tick===0)initial=exportScene(state);renderInspector();});
$('memory-enabled').addEventListener('change',()=>{const u=state.units.find(v=>v.id===selected);u.experience.useMemory=$('memory-enabled').checked;if(state.tick===0)initial=exportScene(state);renderInspector();});
$('forget-experience').addEventListener('click',()=>{const u=state.units.find(v=>v.id===selected);u.experience=createExperience(W*H);u.decision=decideUnit(state,u);if(state.tick===0)initial=exportScene(state);renderInspector();toast('Память и опыт '+u.id+' сброшены.');});
$('scenario').addEventListener('change',syncScenarioControls);
$('contact-demo').addEventListener('click',()=>openContactScene());
$('neural-demo').addEventListener('click',()=>openContactScene(.5,'neural'));
$('aim-demo').addEventListener('click',openAimScene);
$('compare-btn').addEventListener('click',()=>{setRunning(false);compareControllers();});
$('close-compare').addEventListener('click',()=>$('compare-dialog').close());
$('compare-open-scene').addEventListener('click',()=>{$('compare-dialog').close();openContactScene(comparisonReactivity,comparisonAdaptive?'adaptive':comparisonNeural?'neural':'malecns',comparisonChemistry);});
$('random-seed').addEventListener('click',()=>{$('seed').value=String(crypto.getRandomValues(new Uint32Array(1))[0]%999999);$('setup-hint').textContent='Новый seed выбран. Нажми «Создать поле».';});
$('density').addEventListener('input',()=>{$('density-value').value=$('density').value;});
for(const id of ['faction-a','faction-b'])$(id).addEventListener('change',updateFactionNotes);
$('play').addEventListener('click',()=>setRunning(!running));
$('step').addEventListener('click',()=>{setBrush('select');advance();});
$('reset').addEventListener('click',reset);$('replay').addEventListener('click',reset);
$('speed').addEventListener('change',()=>{speed=Number($('speed').value);if(running){clearTimeout(timer);schedule();}});
$('unit-roster').addEventListener('click',e=>{const b=e.target.closest('[data-unit]');if(b)selectUnit(b.dataset.unit);});
for(const k of ['aggression','caution','objective','reactivity'])$(k).addEventListener('input',()=>{const u=state.units.find(v=>v.id===selected);u.overrides[k]=Number($(k).value)/100;u.decision=decideUnit(state,u);if(state.tick===0)initial=exportScene(state);renderInspector();});
$('reset-profile').addEventListener('click',()=>{const u=state.units.find(v=>v.id===selected);u.overrides={};u.decision=decideUnit(state,u);if(state.tick===0)initial=exportScene(state);renderInspector();toast('Возвращён профиль фракции и роли.');});
$('tab-units').addEventListener('click',()=>setTab('units'));$('tab-log').addEventListener('click',()=>setTab('log'));
for(const b of document.querySelectorAll('[data-brush]'))b.addEventListener('click',()=>setBrush(b.dataset.brush));
canvas.addEventListener('pointermove',e=>{hover=coordinate(e);$('map-coordinate').textContent='X '+String(hover.x).padStart(2,'0')+' / Y '+String(hover.y).padStart(2,'0')+(brush!=='select'?' · РЕДАКТОР':'');});
canvas.addEventListener('pointerleave',()=>{hover=null;$('map-coordinate').textContent='SECTOR / '+state.config.seed.slice(0,14);});
canvas.addEventListener('click',e=>{const pos=coordinate(e);if(brush==='select'){const u=state.units.find(u=>u.x===pos.x&&u.y===pos.y);if(u)selectUnit(u.id);}else edit(pos.x,pos.y);});
$('export-btn').addEventListener('click',()=>{const blob=new Blob([exportScene(state)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='malecns-scene-'+state.config.seed.replace(/[^a-z0-9_-]/gi,'_')+'-t'+state.tick+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Сцена сохранена: карта, профили и состояние боя.');});
$('import-btn').addEventListener('click',()=>$('import-file').click());
$('import-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>8_000_000)throw new Error('Максимальный размер сцены — 8 МБ.');const next=importScene(await file.text());setRunning(false);state=next;initial=exportScene(state);selected=state.units[0].id;revision++;threatCache=null;lastStep=-10000;syncConfig();setBrush('select');renderUI();toast(state.importNote||'Сцена загружена. Сброс вернёт к этому состоянию.');}catch(err){toast(err.message);}finally{e.target.value='';}});
$('about-btn').addEventListener('click',()=>$('about-dialog').showModal());$('close-about').addEventListener('click',()=>$('about-dialog').close());
$('about-dialog').addEventListener('click',e=>{if(e.target===$('about-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
document.addEventListener('keydown',e=>{if(/INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName)||$('about-dialog').open||$('compare-dialog').open)return;if(e.code==='Space'){e.preventDefault();setRunning(!running);}else if(e.code==='ArrowRight'&&!running){e.preventDefault();advance();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&running){setRunning(false);toast('Симуляция на паузе: вкладка была скрыта.');}});
new ResizeObserver(resize).observe($('map-shell'));renderUI();resize();requestAnimationFrame(frame);
