import {clientUUID,VERSION,DEMOS,initialState,reduceEvent,analyze,dialogue,makeBrief,briefText,DomainError,funnelFromEvents,comparison,replay} from '../shared/domain.mjs';

// Preview-only adapter. It never pretends to provide accounts or shared state.
export class PreviewClient {
 constructor(){this.mode='preview';this.key='adverse-judge-preview-v1';this.saved={cases:{},events:{},commands:{}};this.storageAvailable=true;try{const data=JSON.parse(localStorage.getItem(this.key));if(data?.cases&&data?.events&&data?.commands)this.saved=data;}catch{this.storageAvailable=false;} }
 save(){if(!this.storageAvailable)return;try{localStorage.setItem(this.key,JSON.stringify(this.saved));}catch{this.storageAvailable=false;}}
 platforms(){return 'ABCDEFG'.split('').map(id=>({id,name:'Платформа '+id,mode:'clipboard',verified:false,configured:false,status:'not_configured'}));}
 async bootstrap(){const stats={};for(const list of Object.values(this.saved.events))for(const e of list)stats[e.type]=(stats[e.type]||0)+1;return {version:VERSION,mode:'preview',storageAvailable:this.storageAvailable,user:null,ai:{enabled:false},platforms:this.platforms(),cases:Object.values(this.saved.cases).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),stats,demos:DEMOS};}
 async detail(id){const state=this.saved.cases[id];if(!state)throw new DomainError('NOT_FOUND','Дело не найдено.',404);return {state:structuredClone(state),events:structuredClone(this.saved.events[id]),audit:{consistent:JSON.stringify(replay(this.saved.events[id]))===JSON.stringify(state),eventsChecked:this.saved.events[id].length,storedVersion:state.version,replayedVersion:replay(this.saved.events[id])?.version},comparison:comparison(state.claim,state.finalClaim,state.draft),invites:[],comparisons:[],handoffs:this.saved.events[id].filter(e=>e.type==='handoff_created').map(e=>({id:e.data.handoffId,platform_id:e.data.platformId,mode:'clipboard',verdict_id:state.verdictId,created_at:e.at,expires_at:0,redeemed_at:null,revoked_at:null,confirmed_actions:0})).reverse(),findings:analyze(state.finalClaim||state.claim,state.draft),dialogue:dialogue(state)};}
 async create(body){const id=clientUUID(),at=new Date().toISOString(),data={id,claim:body.claim,draft:body.draft||{},createdAt:at};const s=initialState(data);this.saved.cases[id]=s;this.saved.events[id]=[{type:'case_created',data,at}];this.save();return this.detail(id);}
 async command(id,action,body){
 const state=this.saved.cases[id];if(!state)throw new DomainError('NOT_FOUND','Дело не найдено.',404);
 if(this.saved.commands[body.commandId])return {...await this.detail(id),duplicate:true};
 if(state.version!==body.expectedVersion)throw new DomainError('VERSION_CONFLICT','Дело изменилось. Обновите страницу.',409);
 const events=[],at=new Date().toISOString();let s=structuredClone(state);let extra={};
 const add=(type,data)=>{const e={type,data,at};s=reduceEvent(s,e);events.push(e);};
 if(action==='action')add('action_chosen',{action:body.action});
 else if(action==='brief')add('brief_prepared',{draft:body.draft});
 else if(action==='reopen'){add('owner_reopen',{reason:'owner_requested_revision'});}
 else if(action==='verdict'){add('claim_rewritten',{claim:body.claim,acknowledged:body.acknowledged});add('verdict_issued',{verdictId:clientUUID()});}
 else if(action==='handoff'){
  if(s.phase!=='verdict')throw new DomainError('STATE','Сначала завершите дело.',409);
  if(!this.platforms().some(p=>p.id===body.platformId))throw new DomainError('PLATFORM','Платформа не найдена.');
  const handoffId=clientUUID();add('handoff_created',{handoffId,platformId:body.platformId,mode:'clipboard',deliveryConfirmed:false});
  extra={handoff:{id:handoffId,mode:'clipboard',url:null,text:briefText(s),brief:makeBrief(s),deliveryConfirmed:false}};
 }else throw new DomainError('PREVIEW','Эта функция доступна только в серверной сборке.',503);
 this.saved.cases[id]=s;this.saved.events[id].push(...events);this.saved.commands[body.commandId]=true;this.save();return {...await this.detail(id),...extra};
 }
 async request(path,options={}){
  if(path==='/analytics'){
    const rows=Object.entries(this.saved.events).flatMap(([case_id,events])=>events.map(e=>({...e,case_id})));
    return funnelFromEvents(rows);
  }
  if(path==='/privacy/export')return {schema:'judge-preview-export-1',exportedAt:new Date().toISOString(),...structuredClone(this.saved)};
  if(path==='/privacy/delete'){if(options.body?.confirm!=='DELETE')throw new DomainError('CONFIRM','Введите DELETE.');this.saved={cases:{},events:{},commands:{}};this.save();return {ok:true};}
  throw new DomainError('PREVIEW','Для этой функции нужен сервер из архива. Автономное превью не подключено к интернет-сервисам.',503);
 }
}