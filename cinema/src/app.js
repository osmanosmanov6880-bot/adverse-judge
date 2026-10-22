/* ADVERSE JUDGE CINEMA — UI runtime. No network, account, analytics or mandatory API. */
(function () {
  'use strict';
  const D = window.CINEMA_DATA;
  const E = window.CINEMA_ENGINE;
  const S = window.CINEMA_SOUND;
  const STATE_KEY = 'adverse.cinema.story.v1';
  const PREFS_KEY = 'adverse.cinema.preferences.v1';
  const $ = (id) => document.getElementById(id);
  const el = (tag, className, text) => { const e = document.createElement(tag); if(className) e.className=className; if(text !== undefined) e.textContent=text; return e; };
  const add = (parent,...kids) => {kids.forEach(k=>k&&parent.appendChild(k));return parent;};
  const cap = (text,n) => String(text||'').slice(0,n);
  function getStored(key){try{return JSON.parse(localStorage.getItem(key))}catch(_){return null}}
  function setStored(key,obj){try{localStorage.setItem(key,JSON.stringify(obj));return true}catch(_){return false}}
  const freshPrefs = () => ({mode:'auto',reduced:false,contrast:false,volume:35});
  let state = E.hydrate(getStored(STATE_KEY));
  let prefs = Object.assign(freshPrefs(),getStored(PREFS_KEY)||{});
  let sceneEpoch=0,dialogReturnFocus=null,timer=null;
  let activePlate=$('plate-active'),previousPlate=$('plate-prev');
  let currentToastTimeout;
  const missing=new Set();
  const prefersReduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  const smallScreen=window.matchMedia('(max-width: 650px)');
  const noHeavyMotion=()=>prefs.reduced||prefersReduced.matches;
  function save(){setStored(STATE_KEY,state);$('persist-status').textContent='ПРОГРЕСС ЛОКАЛЬНО';}
  function savePrefs(){setStored(PREFS_KEY,prefs)}
  function inferredMode(){
    if(prefs.mode!=='auto')return prefs.mode;
    if(noHeavyMotion())return 'lite';
    if(navigator.connection?.saveData || smallScreen.matches)return 'lite';
    return 'cinematic';
  }
  function applyPrefs(){
    const mode=inferredMode();
    $('cinema-app').dataset.mode=mode;
    document.body.classList.remove('mode-cinematic','mode-balanced','mode-lite');
    document.body.classList.add('mode-'+mode);
    document.body.classList.toggle('reduced-motion',noHeavyMotion());
    document.body.classList.toggle('high-contrast',!!prefs.contrast);
    $('mode-label').textContent=mode.toUpperCase();
    $('mode-toggle').title='Режим графики: '+mode.toUpperCase();
    S.setVolume(Number(prefs.volume||0)/100);
    $('sound-toggle').setAttribute('aria-pressed',S.isEnabled()?'true':'false');
    $('sound-toggle').setAttribute('aria-label',S.isEnabled()?'Выключить звук':'Включить звук');
    $('sound-icon').textContent=S.isEnabled()?'♫':'♪';
    $('sound-toggle').classList.toggle('active',S.isEnabled());
    paintParticles();
  }
  function paintParticles(){
    const root=$('particles');root.replaceChildren();
    if(inferredMode()==='lite'||noHeavyMotion())return;
    const n=inferredMode()==='cinematic'?25:10;
    for(let i=0;i<n;i++){
      const p=el('span','particle');
      p.style.left=((17+i*33.17)%100)+'%';p.style.top=((i*13.37)%96)+'%';
      p.style.animationDelay=((-i*1.11)%19)+'s';
      p.style.animationDuration=(14+i%9*2)+'s';
      root.appendChild(p);
    }
  }
  function srcFor(art){
    const suffix=smallScreen.matches?'-mobile':'';
    const key=art+suffix+'.webp';
    return (window.CINEMA_ASSETS&&window.CINEMA_ASSETS[key])||'assets/'+key;
  }
  function preloadAdjacent(scene){
    const next=scene.choices.filter(c=>c.next).slice(0,2);
    next.forEach(c=>{
      const s=D.scenes.find(x=>x.id===c.next);
      if(s){const im=new Image();im.decoding='async';im.src=srcFor(s.art);}
    });
  }
  function applyPlate(scene){
    const epoch=++sceneEpoch;
    const imagePath=srcFor(scene.art);
    if(missing.has(imagePath)){stylePlate(previousPlate,'none',scene);return}
    const im=new Image();im.decoding='async';im.src=imagePath;
    const onready=()=>{
      if(epoch!==sceneEpoch)return;
      const next=previousPlate;
      next.style.backgroundImage='url("'+imagePath+'")';
      next.className='plate-layer plate-active';
      next.style.opacity='0';
      // Force style calculation to make crossfade reliable after cached images.
      next.getBoundingClientRect();
      const old=activePlate;
      old.className='plate-layer plate-prev';old.style.opacity='0';
      next.className='plate-layer plate-active camera-'+scene.camera;
      next.style.opacity='.91';
      previousPlate=old;activePlate=next;
      preloadAdjacent(scene);
    };
    im.onload=onready;
    im.onerror=()=>{
      missing.add(imagePath);if(epoch!==sceneEpoch)return;
      toast('Кадр не найден. Сюжет продолжает работать без изображения.');
      const next=previousPlate;next.style.backgroundImage='linear-gradient(135deg,#142a34,#080d18 64%,#392e27)';
      next.className='plate-layer plate-active';next.style.opacity='1';activePlate.className='plate-layer plate-prev';activePlate.style.opacity='0';
      previousPlate=activePlate;activePlate=next;
    };
    if(im.complete && im.naturalWidth)onready();
  }
  function stylePlate(layer,image,scene){layer.style.backgroundImage=image==='none'?'linear-gradient(135deg,#182f37,#070a10)':image}
  function toast(message){
    const t=$('toast');t.textContent=message;t.hidden=false;
    clearTimeout(currentToastTimeout);
    currentToastTimeout=setTimeout(()=>{t.hidden=true},4600);
  }
  function transition(result){
    if(!result.ok){toast(result.error||'Действие недоступно.');return false}
    state=result.state;save();render();return true;
  }
  function warningBrief(text){
    if(!text)return null;
    const w=E.warnings(text);
    if(!w.length)return null;
    const box=el('div','inline-hint');
    add(box,el('span','inline-hint-icon','!'),el('span','',w[0]));
    return box;
  }
  function makeField(type){
    const val=type==='claim'?state.claim:type==='evidence'?state.evidence:state.rewrite;
    const cfg={
      claim:['ВАШЕ РЕКЛАМНОЕ ОБЕЩАНИЕ',240,'Введите утверждение для рассмотрения', 'Изменение исходного обещания обнуляет дальнейшие решения.'],
      evidence:['ЗАЯВЛЕННЫЕ ОСНОВАНИЯ',500,'Название исследования, документ, URL или описание.', 'Источник только записывается; он не проверяется автоматически.'],
      rewrite:['НОВОЕ ОБЕЩАНИЕ',320,'Для кого, какая польза, при каких условиях?', 'Уточните слова и не выдавайте неподтверждённые цифры за факты.']
    }[type];
    const field=el('div','field-shell');
    const label=el('label','field-label');const id='field-'+type;
    label.htmlFor=id;
    const count=el('span','count',String(val.length)+' / '+cfg[1]);
    add(label,el('span','',cfg[0]),count);
    const textarea=el('textarea','text-field');
    textarea.id=id;textarea.name=type;textarea.rows=type==='evidence'?3:2;textarea.maxLength=cfg[1];
    textarea.placeholder=cfg[2];textarea.value=val;textarea.setAttribute('aria-describedby','field-hint-'+type);
    const note=el('p','form-note',cfg[3]);note.id='field-hint-'+type;
    textarea.addEventListener('input',()=>{
      const change=E.setDraft(state,type,textarea.value);
      if(change.ok){state=change.state;save();count.textContent=textarea.value.length+' / '+cfg[1];const h=field.querySelector('.inline-hint');if(h)h.remove();const warn=warningBrief(textarea.value);if(warn&&type!=='evidence')field.appendChild(warn);}
    });
    add(field,label,textarea,note);
    if(type==='rewrite'&&state.strategy){
      const tip=el('p','strategy-hint','ВАШ ПУТЬ · '+D.strategies[state.strategy].label+' — '+D.strategies[state.strategy].desc);
      field.appendChild(tip);
      const suggest=el('button','mini-action','Вставить осторожный шаблон ↗');
      suggest.type='button';
      suggest.addEventListener('click',()=>{
        const template= state.strategy==='proof' ? 'Наш продукт предназначен для [аудитория] и помогает [проверяемая польза] при условиях [ограничения]. Данные: [источник для проверки].' : state.strategy==='empathy' ? 'Для [аудитория] мы предлагаем [конкретную услугу], чтобы [польза без гарантий]. Подробные условия: [ссылка или правила].' : 'Для [аудитория]: [конкретное действие или польза] при условии [существенные ограничения]. Результат зависит от [важные факторы].';
        textarea.value=template;textarea.dispatchEvent(new Event('input',{bubbles:true}));textarea.focus();
        toast('Это шаблон с заполнителями, а не готовый проверенный факт.');
      });
      field.appendChild(suggest);
    }
    if(type!=='evidence')field.appendChild(warningBrief(val)||document.createDocumentFragment());
    return field;
  }
  function contextFor(scene){
    if(scene.id==='scene_005'){
      const w=E.warnings(state.claim);
      return {title:'ЛЕКС ПРОВЕРИЛ ФОРМУЛИРОВКУ',text:w.length?w[0]:'Прямых шаблонных сигналов нет. Это не означает, что утверждение доказано.'};
    }
    if(scene.id==='scene_009'&&state.strategy){
      return {title:'ИЗМЕНЁННЫЙ ПУТЬ · '+D.strategies[state.strategy].label.toUpperCase(),text:D.strategies[state.strategy].desc};
    }
    if(scene.id==='scene_010'){
      const v=state.strategy==='proof'?'Доказательств пока недостаточно, если источник не прошёл независимую проверку.':state.strategy==='empathy'?'Сильная эмоциональная идея не заменяет честных условий.':'Даже ясную формулировку нужно подтвердить реальными фактами.';
      return {title:'СЛЕДСТВИЕ ВАШЕГО РЕШЕНИЯ',text:v};
    }
    if(scene.id==='scene_011'){
      return {title:'СЛОВА, КОТОРЫЕ УСЛЫШАЛ ЧЕЛОВЕК',text:'«'+cap(state.claim,160)+'»'};
    }
    if(scene.id==='scene_012'){
      return {title:'ВЫ УЖЕ ОСТАВИЛИ СЛЕД',text:'Выбран путь: '+(state.strategy?D.strategies[state.strategy].label:'не выбран')+'. Источник: '+(state.evidenceStatus==='claimed'?'заявлен, не проверен':state.evidenceStatus==='missing'?'не предоставлен':'не отмечен')+'.'};
    }
    return null;
  }
  function detailCard(title,text){const outer=el('div','context-card');add(outer,el('span','context-title',title),el('p','context-text',text));return outer}
  function renderVerdict(){
    const a=E.analyze(state);
    const box=el('section','verdict-panel');box.setAttribute('aria-label','Итоговая редакторская проверка');
    add(box,el('div','verdict-status',a.rating));
    const meta=el('div','verdict-metrics','РЕДАКТОРСКИЙ ИНДИКАТОР '+a.score+' / 100 · ЭВРИСТИКА, НЕ ОДОБРЕНИЕ');
    box.appendChild(meta);
    const meter=el('div','verdict-bar');meter.setAttribute('role','meter');meter.setAttribute('aria-valuenow',String(a.score));meter.setAttribute('aria-valuemin','0');meter.setAttribute('aria-valuemax','100');meter.setAttribute('aria-label','Эвристический показатель текста');
    const fill=el('span','verdict-bar-fill');fill.style.width=a.score+'%';meter.appendChild(fill);box.appendChild(meter);
    const lines=el('p','verdict-text',a.statement);box.appendChild(lines);
    const revised=el('p','brief-peek');
    add(revised,el('strong','','ВАШ ТЕКСТ: '),el('span','','«'+state.rewrite+'»'));
    box.appendChild(revised);
    const flags=el('p','verdict-text',a.revised.length?'Замечания: '+a.revised.join(' · '):'Автоматических словарных замечаний нет. Независимая проверка по-прежнему нужна.');
    box.appendChild(flags);
    const post=state.witness==='guarantee'?'Свидетель предположил завышенную гарантию.':'Свидетель попросил уточнить условия.';
    box.appendChild(detailCard('ПОСЛЕДСТВИЕ ВЫБОРА',post));
    const btn=el('button','mini-action','Открыть полный бриф ↗');btn.type='button';btn.addEventListener('click',openDossier);box.appendChild(btn);
    return box;
  }
  function render(){
    const scene=E.sceneOf(state);
    $('cinema-app').classList.toggle('tone-red',scene.tone==='red');
    $('cinema-app').classList.toggle('tone-cyan',scene.tone==='cyan');
    document.body.classList.toggle('tone-red',scene.tone==='red');
    document.body.classList.toggle('tone-cyan',scene.tone==='cyan');
    document.body.classList.toggle('tone-gold',scene.tone==='gold');
    $('scene-eyebrow').textContent=scene.eyebrow;
    const copy=$('story-copy');copy.replaceChildren();
    add(copy,el('div','copy-chapter',scene.chapter),el('h1','scene-headline',scene.headline),el('p','scene-body',scene.body),el('p','scene-sub',scene.sub));
    const zone=$('interaction-zone');zone.replaceChildren();
    if(scene.form==='claim')zone.appendChild(makeField('claim'));
    if(scene.form==='evidence')zone.appendChild(makeField('evidence'));
    if(scene.form==='rewrite')zone.appendChild(makeField('rewrite'));
    if(scene.form==='verdict')zone.appendChild(renderVerdict());
    const ctx=contextFor(scene);if(ctx)zone.appendChild(detailCard(ctx.title,ctx.text));
    const choices=el('div','choices');
    scene.choices.forEach((c,i)=>{
      const button=el('button','choice'+(c.kind==='primary'?' choice-primary':''));button.type='button';button.dataset.index=String(i);
      const idx=el('span','choice-index',String(i+1).padStart(2,'0'));
      const text=el('span','choice-content');add(text,el('strong','choice-text',c.label),el('small','choice-detail',c.detail||''));
      add(button,idx,text,el('span','choice-arrow','↗'));
      button.addEventListener('click',()=>handleChoice(i));choices.appendChild(button);
    });
    zone.appendChild(choices);
    $('transport-status').textContent=scene.chapter;
    $('scene-count').textContent=scene.number+' / '+String(D.scenes.length).padStart(2,'0');
    $('subtitle-status').textContent=scene.sub;
    const pct=Math.round((new Set(state.visited)).size/D.scenes.length*100);
    $('progress-label').textContent=pct+'% ПРОЙДЕНО';$('timeline-fill').style.width=pct+'%';
    $('back-btn').disabled=!state.history.length;
    $('secret-tag').hidden=!scene.secret;
    if(scene.secret){
      $('secret-tag').textContent=state.collectibles.includes(scene.secret)?'✦ Фрагмент найден — открыть':'✦ '+scene.secretLabel;
      $('secret-tag').setAttribute('aria-label',scene.secretLabel);
    }
    $('scene-artifact').classList.toggle('artifact-subtle', ['skyline','human','aftermath','city'].includes(scene.art));
    const artSymbol=scene.tone==='cyan'?'◇':scene.tone==='red'?'⚖':'J';
    document.querySelector('.artifact-core').textContent=artSymbol;
    applyPlate(scene);
    if(S.isEnabled()){S.ambience(scene.ambience);S.cue(scene.cue)}
    document.title='ADVERSE JUDGE / '+scene.title;
    const main=$('story-main');main.scrollTop=0;
    try{history.replaceState(null,'','#'+scene.id)}catch(_){/* file URLs remain valid */}
  }
  function handleChoice(index){
    const scene=E.sceneOf(state),choice=scene.choices[index];if(!choice)return;
    if(!choice.next){
      const action=choice.action;
      if(action==='about')return openAbout();
      if(action==='download')return downloadBrief();
      if(action==='handoff')return openTransfer();
      if(action==='copy')return copyBrief();
      if(action==='restart')return confirmReset();
      return;
    }
    const result=E.choose(state,index);
    transition(result);
  }
  function secretClicked(){
    const key=E.sceneOf(state).secret;if(!key)return;
    const result=E.collect(state,key);
    if(!result.ok){toast(result.error);return}
    state=result.state;save();
    $('secret-tag').textContent='✦ Фрагмент найден — открыть';
    modal('НАЙДЕННАЯ ЗАПИСЬ',result.secret.title,(root)=>{
      root.appendChild(el('p','',result.secret.text));
      const n=el('p','','Собрано фрагментов: '+state.collectibles.length+' / '+Object.keys(D.secrets).length);root.appendChild(n);
      if(state.collectibles.length===3)root.appendChild(detailCard('СЕКРЕТНЫЙ ПРОТОКОЛ ОТКРЫТ','Ясность, доказательство, взгляд человека. Это три правила, без которых нельзя доверять рекламному обещанию.'));
    });
  }
  function modal(kicker,title,renderBody){
    dialogReturnFocus=document.activeElement;
    const layer=$('dialog-layer');$('dialog-kicker').textContent=kicker;$('dialog-title').textContent=title;
    const body=$('dialog-content');body.replaceChildren();renderBody(body);
    layer.hidden=false;$('dialog-close').focus();
    document.body.classList.add('modal-open');
  }
  function closeDialog(){
    const layer=$('dialog-layer');if(layer.hidden)return;layer.hidden=true;document.body.classList.remove('modal-open');
    if(dialogReturnFocus && dialogReturnFocus.isConnected)dialogReturnFocus.focus();
  }
  function btn(title,func,klass='dialog-action'){
    const b=el('button',klass,title);b.type='button';b.addEventListener('click',func);return b;
  }
  function openMap(){
    modal('15 СЦЕН / НЕЛИНЕЙНЫЙ МАРШРУТ','Карта Трибунала',(content)=>{
      content.appendChild(el('p','', 'Открытые сцены можно посетить снова. Закрытые станут доступны после прохождения сюжета.'));
      const list=el('ol','map-list');
      D.scenes.forEach(s=>{
        const li=el('li');const link=btn(s.number+' · '+s.title,()=>{if(transition(E.revisit(state,s.id)))closeDialog()},'map-choice');
        link.disabled=!state.visited.includes(s.id);if(s.id===state.scene)link.setAttribute('aria-current','step');
        li.appendChild(link);list.appendChild(li);
      });
      content.appendChild(list);
    });
  }
  function openAbout(){
    modal('О ПРОЕКТЕ','Суд над обещанием',(content)=>{
      content.appendChild(el('p','','ADVERSE JUDGE CINEMA — самостоятельная интерактивная история о качестве рекламного обещания, созданная как вход в экосистему ADVERSE.'));
      content.appendChild(el('p','','Лекс, Аврора и Свидетель 404 — вымышленные программные редакторские роли. Здесь нет работающего большого языкового ИИ и нет юридической экспертизы.'));
      content.appendChild(detailCard('КАК ЭТО РАБОТАЕТ','Сюжет хранит только ваш локальный прогресс. Вы принимаете решения, переписываете обещание и вручную скачиваете бриф. Никакой автоматической отправки на сайты A–G нет.'));
      content.appendChild(btn('Вернуться к истории',closeDialog));
    });
  }
  function openDossier(){
    modal('ВОСПОМИНАНИЯ · ПРОТОКОЛ','Ваше досье',(content)=>{
      const p=el('p','');p.textContent='Открыто сцен: '+state.visited.length+' / 15 · найдено фрагментов: '+state.collectibles.length+' / 3.';content.appendChild(p);
      content.appendChild(detailCard('ИСХОДНОЕ ОБЕЩАНИЕ',state.claim));
      content.appendChild(detailCard('СТРАТЕГИЯ',state.strategy?D.strategies[state.strategy].label:'Ещё не выбрана'));
      content.appendChild(detailCard('СТАТУС ИСТОЧНИКА',state.evidenceStatus==='claimed'?'Предоставлен пользователем, без проверки':state.evidenceStatus==='missing'?'Источник отсутствует':'Не указан'));
      if(state.rewrite)content.appendChild(detailCard('НОВОЕ ОБЕЩАНИЕ',state.rewrite));
      if(state.verdictIssued){
        const a=E.analyze(state);content.appendChild(detailCard('РЕДАКТОРСКОЕ ЗАКЛЮЧЕНИЕ',a.rating+' · '+a.statement));
        content.appendChild(btn('Скачать JSON-бриф',downloadBrief));
        content.appendChild(btn('Продолжить как дело JUDGE',()=>{closeDialog();openTransfer()}));
        content.appendChild(btn('Скопировать формулировку',copyBrief));
      }
      const items=el('ul','dossier-list');
      Object.entries(D.secrets).forEach(([key,value])=>{
        const li=el('li','',state.collectibles.includes(key)?'✦ '+value.title+': '+value.text:'◇ Неизвестная запись');items.appendChild(li);
      });
      content.appendChild(el('h3','subhead','Фрагменты истории'));content.appendChild(items);
      content.appendChild(btn('Карта открытых сцен',()=>{closeDialog();openMap()}));
    });
  }
  function openSettings(){
    modal('ВАШ СПОСОБ ПРОСМОТРА','Настройки',(content)=>{
      content.appendChild(el('p','','Изменения применяются сразу и сохраняются только в этом браузере.'));
      function row(title,control){const r=el('div','settings-row');add(r,el('span','',title),control);content.appendChild(r)}
      const select=el('select');select.id='quality-select';
      [['auto','Автоматически'],['cinematic','CINEMATIC'],['balanced','BALANCED'],['lite','LITE']].forEach(([v,l])=>{const o=el('option','',l);o.value=v;select.appendChild(o)});
      select.value=['auto','cinematic','balanced','lite'].includes(prefs.mode)?prefs.mode:'auto';
      select.addEventListener('change',()=>{prefs.mode=select.value;savePrefs();applyPrefs();applyPlate(E.sceneOf(state))});row('Качество изображения',select);
      const soundCheck=el('input');soundCheck.type='checkbox';soundCheck.checked=S.isEnabled();soundCheck.setAttribute('aria-label','Звук');
      soundCheck.addEventListener('change',()=>{const ok=S.setEnabled(soundCheck.checked);soundCheck.checked=ok;applyPrefs();if(ok){S.ambience(E.sceneOf(state).ambience);S.cue('arrival')}});row('Синтезированный звук',soundCheck);
      const vol=el('input');vol.type='range';vol.min=0;vol.max=100;vol.step=5;vol.value=prefs.volume;
      vol.setAttribute('aria-label','Громкость');vol.addEventListener('input',()=>{prefs.volume=Number(vol.value);savePrefs();applyPrefs()});row('Громкость',vol);
      const reduce=el('input');reduce.type='checkbox';reduce.checked=!!prefs.reduced;
      reduce.setAttribute('aria-label','Уменьшить движение');reduce.addEventListener('change',()=>{prefs.reduced=reduce.checked;savePrefs();applyPrefs();applyPlate(E.sceneOf(state))});row('Меньше движения',reduce);
      const contrast=el('input');contrast.type='checkbox';contrast.checked=!!prefs.contrast;
      contrast.setAttribute('aria-label','Высокая контрастность');contrast.addEventListener('change',()=>{prefs.contrast=contrast.checked;savePrefs();applyPrefs()});row('Высокий контраст',contrast);
      content.appendChild(el('p','privacy-note','Прогресс сохраняется в localStorage. Аналитика и сбор персональных данных отсутствуют.'));
      content.appendChild(btn('Сбросить историю',confirmReset));
      content.appendChild(btn('Описание проекта',()=>{closeDialog();openAbout()}));
    });
  }
  function confirmReset(){
    modal('ОЧИСТКА ЛОКАЛЬНЫХ ДАННЫХ','Начать новую историю?',(content)=>{
      content.appendChild(el('p','','Текущие ответы, найденные записи и редакторский бриф будут удалены из браузера. Этот шаг необратим.'));
      content.appendChild(btn('Да, очистить и начать заново',()=>{
        state=E.fresh();save();closeDialog();render();toast('Новое дело открыто.');
      }));
      content.appendChild(btn('Отмена',closeDialog));
    });
  }
  function openTransfer(){
    if(!state.verdictIssued){toast('Сначала завершите рассмотрение.');return;}
    modal('ИЗ КИНО — В РАБОЧИЙ КАБИНЕТ','Продолжить дело в JUDGE',(content)=>{
      content.appendChild(detailCard('ЧТО МЫ ПЕРЕДАДИМ','Исходную фразу, ваш новый черновик, выбранную стратегию и описание источника (если указано). Другие сцены и личные настройки не передаются.'));
      content.appendChild(detailCard('ЧТО ПРОИЗОЙДЁТ','В JUDGE создастся настоящее дело со статусом «Рассмотрение». Киношный вердикт не считается проверкой фактов, юридическим разрешением или одобрением рекламы.'));
      content.appendChild(el('p','form-note','Автономная HTML-версия не отправляет ничего на сервер: скачайте JSON или откройте JUDGE CINEMA внутри своего работающего JUDGE.'));
      const permission=el('label','transfer-consent');
      const check=el('input');check.type='checkbox';check.id='transfer-consent';
      add(permission,check,el('span','','Я разрешаю передать перечисленные данные моему серверному JUDGE.'));
      content.appendChild(permission);
      const send=btn('Создать черновое дело →',async()=>{
        if(!check.checked)return;
        send.disabled=true;send.textContent='Переносим в JUDGE…';
        try{
          // No remote calls and no automatic transfer for file:// or other apps.
          if(!/^https?:$/.test(location.protocol)||!location.pathname.startsWith('/cinema'))
            throw Error('Эта копия фильма автономна. Для прямого переноса откройте /cinema/ на сервере JUDGE. Здесь доступен экспорт JSON.');
          const bootstrap=await fetch('/api/bootstrap',{credentials:'same-origin',headers:{'Accept':'application/json'}});
          if(!bootstrap.ok)throw Error('Не удалось установить защищённую сессию JUDGE.');
          const setup=await bootstrap.json();
          if(typeof setup.csrf!=='string')throw Error('Нет подтверждения защищённой сессии.');
          const response=await fetch('/api/cinema/import',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':setup.csrf},body:JSON.stringify({consent:true,brief:E.brief(state)})});
          const result=await response.json().catch(()=>({}));
          if(!response.ok)throw Error(result?.error?.message||result?.message||'Передача не выполнена.');
          if(!/^[a-z0-9-]{36}$/i.test(result.caseId||''))throw Error('Сервер вернул неверный номер дела.');
          location.assign('/#/case/'+result.caseId);
        }catch(error){send.disabled=false;send.textContent='Создать черновое дело →';toast(error.message||'Нет соединения с JUDGE.');}
      });
      send.disabled=true;
      check.addEventListener('change',()=>{send.disabled=!check.checked;});
      content.appendChild(send);
      content.appendChild(btn('Вместо этого скачать JSON',downloadBrief));
    });
  }
  function jsonOfBrief(){return JSON.stringify(E.brief(state),null,2)}
  function downloadBrief(){
    if(!state.verdictIssued){toast('Сначала завершите дело и получите вердикт.');return}
    const blob=new Blob([jsonOfBrief()],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');link.download='ADVERSE-JUDGE-brief.json';link.href=url;
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1200);
    toast('JSON-бриф подготовлен. Перед публикацией нужна реальная проверка.');
  }
  async function copyBrief(){
    if(!state.rewrite){toast('Сначала введите новое обещание.');return}
    const text=state.rewrite;
    try{
      if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);toast('Формулировка скопирована.');
    }catch(_){
      modal('РУЧНОЙ ЭКСПОРТ','Скопируйте текст',(content)=>{
        content.appendChild(el('p','','Автоматическое копирование недоступно в этом браузере. Выделите текст ниже и скопируйте вручную.'));
        const field=el('textarea','text-field');field.readOnly=true;field.value=text;content.appendChild(field);
        field.focus();field.select();
      });
    }
  }
  function changeMode(){
    const modes=['cinematic','balanced','lite'];
    const pos=modes.indexOf(inferredMode());prefs.mode=modes[(pos+1)%modes.length];savePrefs();applyPrefs();
    toast('Режим: '+prefs.mode.toUpperCase());
  }
  function onKeydown(ev){
    if(!$('dialog-layer').hidden){
      if(ev.key==='Escape'){ev.preventDefault();closeDialog();return}
      if(ev.key==='Tab'){
        const buttons=Array.from($('dialog-layer').querySelectorAll('button:not([disabled]),select,input,textarea')).filter(x=>!x.hidden);
        if(buttons.length){const first=buttons[0],last=buttons.at(-1);
          if(ev.shiftKey&&document.activeElement===first){ev.preventDefault();last.focus()}
          else if(!ev.shiftKey&&document.activeElement===last){ev.preventDefault();first.focus()}
        }
      }
      return;
    }
    const tag=ev.target?.tagName;if(['INPUT','TEXTAREA','SELECT'].includes(tag))return;
    if(ev.key==='ArrowLeft'&&state.history.length){ev.preventDefault();transition(E.back(state))}
    if(ev.key.toLowerCase()==='m'&&!ev.ctrlKey&&!ev.altKey){ev.preventDefault();openMap()}
  }
  function bind(){
    $('brand-home').addEventListener('click',(e)=>{e.preventDefault();if(state.visited.includes('scene_001'))transition(E.revisit(state,'scene_001'))});
    $('back-btn').addEventListener('click',()=>transition(E.back(state)));
    $('map-toggle').addEventListener('click',openMap);
    $('settings-toggle').addEventListener('click',openSettings);
    $('dossier-btn').addEventListener('click',openDossier);
    $('mode-toggle').addEventListener('click',changeMode);
    $('sound-toggle').addEventListener('click',()=>{
      const ok=S.setEnabled(!S.isEnabled());applyPrefs();if(ok){S.ambience(E.sceneOf(state).ambience);S.cue('arrival')}
    });
    $('secret-tag').addEventListener('click',secretClicked);
    $('dialog-close').addEventListener('click',closeDialog);
    $('dialog-layer').addEventListener('click',event=>{if(event.target.dataset.closeDialog)closeDialog()});
    document.addEventListener('keydown',onKeydown);
    smallScreen.addEventListener?.('change',()=>applyPlate(E.sceneOf(state)));
    prefersReduced.addEventListener?.('change',applyPrefs);
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&S.isEnabled())S.stop();applyPrefs()});
    window.addEventListener('beforeunload',save);
    const notches=$('timeline-notches');D.scenes.forEach(()=>notches.appendChild(el('span','notch')));
  }
  bind();applyPrefs();render();save();
  // Explicit debug contract for tests, not a privileged server API.
  window.ADVERSE_CINEMA={state:()=>structuredClone(state),scene:()=>E.sceneOf(state).id,go:(id)=>transition(E.revisit(state,id)),graph:()=>E.graph(),mode:()=>inferredMode()};
})();
