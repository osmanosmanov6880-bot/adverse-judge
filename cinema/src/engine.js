(function (root, factory) {
  const value = factory(typeof module === 'object' && module.exports ? require('./data.js') : root.CINEMA_DATA);
  if (typeof module === 'object' && module.exports) module.exports = value;
  root.CINEMA_ENGINE = value;
})(typeof window !== 'undefined' ? window : globalThis, function (D) {
  'use strict';
  const IDS=new Set(D.scenes.map(s=>s.id));
  const MAX={claim:240,evidence:500,rewrite:320};
  const has=(id)=>IDS.has(id);
  const cloned=(obj)=>JSON.parse(JSON.stringify(obj));
  const sceneOf=(state)=>D.scenes.find(s=>s.id===state.scene)||D.scenes[0];
  const safe=(value,max)=>String(value??'').slice(0,max);
  function fresh(){ return {
    schema:1,scene:'scene_001',history:[],visited:['scene_001'],collectibles:[],
    claim:D.defaultClaim,claimCommitted:false,evidence:'',evidenceStatus:'unknown',
    strategy:null,witness:null,rewrite:'',verdictIssued:false,journey:[],
    createdAt:new Date().toISOString(),lastUpdated:new Date().toISOString()
  };}
  function hydrate(value){
    const base=fresh();if(!value||typeof value!=='object'||value.schema!==1)return base;
    base.scene=has(value.scene)?value.scene:base.scene;
    base.history=Array.isArray(value.history)?value.history.filter(has).slice(-100):[];
    base.visited=Array.from(new Set(['scene_001',...(Array.isArray(value.visited)?value.visited.filter(has):[])])).slice(0,15);
    if(!base.visited.includes(base.scene))base.visited.push(base.scene);
    base.collectibles=Array.isArray(value.collectibles)?Array.from(new Set(value.collectibles.filter(x=>Object.hasOwn(D.secrets,x)))).slice(0,3):[];
    base.claim=safe(value.claim,MAX.claim)||base.claim;
    base.claimCommitted=Boolean(value.claimCommitted);
    base.evidence=safe(value.evidence,MAX.evidence);
    base.evidenceStatus=['unknown','claimed','missing'].includes(value.evidenceStatus)?value.evidenceStatus:'unknown';
    base.strategy=Object.hasOwn(D.strategies,value.strategy)?value.strategy:null;
    base.witness=['guarantee','conditions'].includes(value.witness)?value.witness:null;
    base.rewrite=safe(value.rewrite,MAX.rewrite);
    base.verdictIssued=Boolean(value.verdictIssued&&base.rewrite.trim().length>=16);
    if(!base.verdictIssued&&['scene_014','scene_015'].includes(base.scene))base.scene='scene_013';
    base.journey=Array.isArray(value.journey)?value.journey.filter(x=>x&&has(x.scene)&&typeof x.action==='string').slice(-75).map(x=>({scene:x.scene,action:safe(x.action,80)})):[];
    base.createdAt=safe(value.createdAt,30)||base.createdAt;
    base.lastUpdated=new Date().toISOString();
    return base;
  }
  function push(state,next,action){
    if(!has(next))return {ok:false,error:'Неизвестная сцена.'};
    const s=cloned(state);
    if(s.scene!==next)s.history.push(s.scene);
    s.history=s.history.slice(-100);
    s.scene=next;
    if(!s.visited.includes(next))s.visited.push(next);
    s.journey.push({scene:next,action:safe(action||'visit',80)});
    s.journey=s.journey.slice(-75);
    s.lastUpdated=new Date().toISOString();
    if(next==='scene_014')s.verdictIssued=true;
    return {ok:true,state:s};
  }
  function setDraft(state,name,value){
    if(!Object.hasOwn(MAX,name))return {ok:false,error:'Неизвестное поле.'};
    let s=cloned(state),v=safe(value,MAX[name]);
    if(s[name]!==v){
      s[name]=v;
      if(name==='claim'){
        s.claimCommitted=false;s.evidence='';s.evidenceStatus='unknown';s.strategy=null;s.witness=null;s.rewrite='';s.verdictIssued=false;
      }
      if(name==='evidence'){s.evidenceStatus='unknown';s.verdictIssued=false;}
      if(name==='rewrite')s.verdictIssued=false;
      s.lastUpdated=new Date().toISOString();
    }
    return {ok:true,state:s};
  }
  function choose(state,choiceIndex){
    if(!Number.isInteger(choiceIndex))return {ok:false,error:'Неверный выбор.'};
    const scene=sceneOf(state);const c=scene.choices[choiceIndex];
    if(!c)return {ok:false,error:'Такой вариант недоступен.'};
    let s=cloned(state);
    if(scene.id==='scene_004'){
      if(s.claim.trim().length<10)return {ok:false,error:'Укажите обещание минимум из 10 символов.'};
      s.claimCommitted=true;
    }
    if(scene.id==='scene_007'){
      if(c.action==='evidence_claimed'){
        if(s.evidence.trim().length<8)return {ok:false,error:'Опишите источник хотя бы в 8 символах или отметьте его отсутствие.'};
        s.evidenceStatus='claimed';
      }
      if(c.action==='evidence_missing'){
        s.evidenceStatus='missing';s.evidence='';
      }
    }
    if(c.action?.startsWith('strategy:')){
      const v=c.action.split(':')[1];if(!Object.hasOwn(D.strategies,v))return {ok:false,error:'Недопустимая стратегия.'};
      if(s.strategy!==v){s.strategy=v;s.verdictIssued=false;s.rewrite='';}
    }
    if(c.action?.startsWith('witness:')){
      s.witness=c.action.split(':')[1];s.verdictIssued=false;
    }
    if(c.action==='submit_rewrite'){
      if(s.rewrite.trim().length<16)return {ok:false,error:'Сформулируйте обещание минимум из 16 символов.'};
    }
    if(c.next)return push(s,c.next,c.action||'continue');
    return {ok:true,state:s,effect:c.action||'noop'};
  }
  function back(state){
    const s=cloned(state);if(!s.history.length)return {ok:false,error:'Вы в начале истории.'};
    let dest;while(s.history.length){const id=s.history.pop();if(!s.verdictIssued&&['scene_014','scene_015'].includes(id))continue;dest=id;break;}
    if(!dest)return {ok:false,error:'Нет доступной предыдущей сцены.'};
    s.scene=dest;s.lastUpdated=new Date().toISOString();return {ok:true,state:s};
  }
  function revisit(state,next){
    if(!has(next)||!state.visited.includes(next))return {ok:false,error:'Сцена ещё не открыта.'};
    if(['scene_014','scene_015'].includes(next)&&!state.verdictIssued)return {ok:false,error:'Финал пока не открыт.'};
    return push(state,next,'revisit');
  }
  function collect(state,key){
    if(!Object.hasOwn(D.secrets,key)||sceneOf(state).secret!==key)return {ok:false,error:'Запись недоступна в этой сцене.'};
    const s=cloned(state);
    if(!s.collectibles.includes(key))s.collectibles.push(key);
    s.lastUpdated=new Date().toISOString();
    return {ok:true,state:s,secret:D.secrets[key]};
  }
  function warnings(txt){
    const found=[];const t=String(txt||'').toLowerCase();
    if(/гарант|100\s*%|без\s*риска|guarantee|guaranteed/.test(t))found.push('Безусловная гарантия: укажите пределы и подтверждение.');
    if(/лучший|№\s*1|номер\s*один|самый|the best/.test(t))found.push('Превосходная степень: нужна проверяемая методика сравнения.');
    if(/вдвое|в\s*2\s*раза|\b\d+\s*(дн|час|минут|days)\b|\d+\s*%/.test(t))found.push('Числовой результат или срок: требуются условия и проверяемые данные.');
    if(t.length<30)found.push('Слишком кратко: уточните адресата и предмет обещания.');
    return found;
  }
  function analyze(state){
    const original=warnings(state.claim),revised=warnings(state.rewrite);
    let score=Math.max(5,92-revised.length*22);
    if(state.rewrite.trim().length<36)score-=10;
    if(/\b(может|возможн|зависит|при услов|для тех|помога|позволя|often|may|under)\b/i.test(state.rewrite))score+=5;
    if(state.evidenceStatus==='missing'&&revised.some(x=>x.startsWith('Числовой')))score-=12;
    if(state.evidenceStatus==='claimed')score+=0; // self-reported material is never verified
    score=Math.min(96,Math.max(10,score));
    const rating=score>=76?'Предварительно ясно':score>=51?'Нужно уточнение':'Высокий риск неверного ожидания';
    return {score,rating,original,revised,delta:original.length-revised.length,unverified:state.evidenceStatus==='claimed',statement:'Автоматическая эвристика формулировки. Не является юридическим одобрением, проверкой доказательств или прогнозом результата.'};
  }
  function brief(state){
    const a=analyze(state);
    return {schema:'adverse.cinematic-brief.v1',origin:'ADVERSE JUDGE · THE TRIAL OF PROMISES',reviewStatus:'draft_requires_human_and_legal_review',createdAt:new Date().toISOString(),claim:{original:state.claim,revised:state.rewrite,selectedStrategy:state.strategy?D.strategies[state.strategy].label:null},evidence:{status:state.evidenceStatus==='claimed'?'user_supplied_unverified':state.evidenceStatus,description:state.evidenceStatus==='claimed'?state.evidence:null},witness:state.witness,editorialHeuristics:a,narrative:{visitedScenes:state.visited.slice(),collectedFragments:state.collectibles.slice(),journey:state.journey.slice()},handoff:{method:'manual_export_only',externalPlatformConnected:false}};
  }
  function graph(){
    const problems=[];
    for(const s of D.scenes){
      if(!s.choices?.length)problems.push(s.id+': no choices');
      for(const c of s.choices||[])if(c.next&&!has(c.next))problems.push(s.id+': missing '+c.next);
      if(!s.art)problems.push(s.id+': missing art');
    }
    return {valid:problems.length===0,problems,count:D.scenes.length};
  }
  return {fresh,hydrate,choose,back,revisit,collect,setDraft,analyze,brief,graph,sceneOf,warnings};
});
