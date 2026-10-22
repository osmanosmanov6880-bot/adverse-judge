import { randomUUID } from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import { initialState,reduceEvent,makeBrief,briefText,text,DomainError,analyze,dialogue,replay,funnelFromEvents,comparison } from '../shared/domain.mjs';
import { hash,token,signPayload,verifyPayload,equal } from './security.mjs';
import {validatePlatformManifest,integrationReadiness} from './platform-config.mjs';

export class JudgeService {
  constructor(store,{platforms=[],secret='',clock=()=>Date.now()}={}) {this.store=store;this.platforms=validatePlatformManifest(platforms);this.secret=secret;this.clock=clock;}
  now() {return new Date(this.clock()).toISOString();}
  pendingHandoffIds(caseId) {return this.store.all('SELECT id FROM handoffs WHERE case_id=? AND mode=? AND redeemed_at IS NULL AND revoked_at IS NULL',caseId,'deeplink').map(x=>x.id);}
  own(owner,id) {
    const row=this.store.one('SELECT * FROM cases WHERE id=? AND owner_id=?',id,owner);
    if (!row) throw new DomainError('NOT_FOUND','Дело не найдено или недоступно.',404);
    return JSON.parse(row.state);
  }
  list(owner) {return this.store.all('SELECT state FROM cases WHERE owner_id=? ORDER BY updated_at DESC LIMIT 200',owner).map(r=>JSON.parse(r.state));}
  eventRows(id) {return this.store.all('SELECT id,type,data,at FROM events WHERE case_id=? ORDER BY id',id).map(r=>({...r,data:JSON.parse(r.data)}));}
  audit(owner,id) {
    const state=this.own(owner,id),events=this.eventRows(id);
    let rebuilt;
    try{rebuilt=replay(events.map(({type,data,at})=>({type,data,at})));}
    catch{return {consistent:false,eventsChecked:events.length,storedVersion:state.version,replayedVersion:null};}
    const ledger=this.store.auditLedger(id);
    return {consistent:isDeepStrictEqual(rebuilt,state)&&ledger.consistent,eventsChecked:events.length,storedVersion:state.version,replayedVersion:rebuilt?.version??null,ledger};
  }
  assertIntegrity(owner,id){
    if(!this.audit(owner,id).consistent)throw new DomainError('INTEGRITY','Журнал решений не совпадает с состоянием. Изменения заблокированы; проверьте резервную копию.',409);
  }
  analytics(owner){
    const rows=this.store.all('SELECT e.case_id,e.type,e.at FROM events e JOIN cases c ON c.id=e.case_id WHERE c.owner_id=? ORDER BY e.id',owner);
    return funnelFromEvents(rows,new Date(this.clock()));
  }
  detail(owner,id) {
    const state=this.own(owner,id);
    return {state,events:this.eventRows(id),audit:this.audit(owner,id),comparison:comparison(state.claim,state.finalClaim,state.draft),findings:analyze(state.finalClaim||state.claim,state.draft),dialogue:dialogue(state),invites:this.store.all('SELECT id,verdict_id,created_at,expires_at,used_at,revoked_at FROM invites WHERE case_id=? ORDER BY created_at DESC',id),handoffs:this.store.all('SELECT h.id,h.platform_id,h.mode,h.verdict_id,h.created_at,h.expires_at,h.redeemed_at,h.revoked_at,(SELECT COUNT(*) FROM integration_receipts r WHERE r.handoff_id=h.id) AS confirmed_actions FROM handoffs h WHERE h.case_id=? ORDER BY h.created_at DESC',id),comparisons:this.comparison?.summaries(owner,id)??[],cinemaImport:this.store.one('SELECT proposed_claim AS proposedClaim,strategy,evidence_status AS evidenceStatus,evidence_text AS evidenceText,witness,imported_at AS importedAt FROM cinema_imports WHERE case_id=? AND owner_id=?',id,owner)??null};
  }
  create(owner,body) {
    const count=this.store.one('SELECT COUNT(*) AS n FROM cases WHERE owner_id=?',owner).n;
    if(count>=200) throw new DomainError('LIMIT','В пилоте разрешено до 200 дел. Удалите ненужные.',409);
    const id=randomUUID(),at=this.now();
    const draft={};
    for (const key of ['product','fact','audience','problem','cta']) if(body.draft?.[key]) draft[key]=text(body.draft[key],key,0,500);
    const data={id,claim:text(body.claim,'Рекламная фраза',5,700),draft,createdAt:at};
    const state=initialState(data);
    this.store.tx(()=>{
      this.store.run('INSERT INTO cases VALUES(?,?,?,?,?,?)',id,owner,JSON.stringify(state),1,at,at);
      this.store.recordEvent(id,'case_created',data,at);
    });
    return this.detail(owner,id);
  }
  append(state,type,data) {
    const e={type,data,at:this.now()};
    const next=reduceEvent(state,e);
    this.store.recordEvent(state.id,type,data,e.at);
    this.store.run('UPDATE cases SET state=?,version=?,updated_at=? WHERE id=?',JSON.stringify(next),next.version,e.at,state.id);
    return next;
  }
  command(owner,id,body,fn) {
    if (typeof body.commandId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(body.commandId)) throw new DomainError('COMMAND','Нужен уникальный commandId.');
    const result=this.store.tx(()=>{
      let state=this.own(owner,id);
      this.assertIntegrity(owner,id);
      if(this.store.one('SELECT 1 FROM commands WHERE case_id=? AND command_id=?',id,body.commandId)) return {duplicate:true};
      if (!Number.isSafeInteger(body.expectedVersion)||state.version!==body.expectedVersion) throw new DomainError('VERSION_CONFLICT','Дело изменилось в другой вкладке. Обновите страницу и повторите.',409);
      const result=fn(state)??{};
      this.store.run('INSERT INTO commands VALUES(?,?)',id,body.commandId);
      return result;
    });
    return {...this.detail(owner,id),...result};
  }
  act(owner,id,body) {return this.command(owner,id,body,s=>{this.append(s,'action_chosen',{action:body.action});});}
  prepare(owner,id,body) {return this.command(owner,id,body,s=>{this.append(s,'brief_prepared',{draft:body.draft});});}
  verdict(owner,id,body) {
    return this.command(owner,id,body,s=>{
      s=this.append(s,'claim_rewritten',{claim:body.claim,acknowledged:body.acknowledged});
      this.append(s,'verdict_issued',{verdictId:randomUUID(),revokedPendingHandoffs:this.pendingHandoffIds(id)});
      this.store.run('UPDATE invites SET revoked_at=? WHERE case_id=? AND revoked_at IS NULL AND used_at IS NULL',this.now(),id);
      this.store.run('UPDATE handoffs SET revoked_at=? WHERE case_id=? AND mode=? AND redeemed_at IS NULL AND revoked_at IS NULL',this.now(),id,'deeplink');
    });
  }
  reopen(owner,id,body){
    return this.command(owner,id,body,s=>{
      this.append(s,'owner_reopen',{reason:'owner_requested_revision',revokedPendingHandoffs:this.pendingHandoffIds(id)});
      this.store.run('UPDATE invites SET revoked_at=? WHERE case_id=? AND revoked_at IS NULL AND used_at IS NULL',this.now(),id);
      this.store.run('UPDATE handoffs SET revoked_at=? WHERE case_id=? AND mode=? AND redeemed_at IS NULL AND revoked_at IS NULL',this.now(),id,'deeplink');
      const active=this.store.all('SELECT id FROM comparisons WHERE case_id=? AND status=?',id,'open').map(x=>x.id);
      if(active.length){
        this.store.run('UPDATE comparisons SET status=?,closed_at=? WHERE case_id=? AND status=?','invalidated',this.now(),id,'open');
        this.append(this.own(owner,id),'comparison_invalidated',{comparisonIds:active,reason:'owner_reopen'});
      }
    });
  }
  defend(owner,id,body) {return this.command(owner,id,body,s=>{this.append(s,'objection_defended',{text:body.text});});}
  invite(owner,id,body) {
    return this.command(owner,id,body,s=>{
      if(s.phase!=='verdict') throw new DomainError('STATE','Сначала завершите дело.',409);
      if(body.consent!==true) throw new DomainError('CONSENT','Подтвердите публикацию итоговой фразы и аудитории по ссылке.');
      const active=this.store.one('SELECT COUNT(*) AS n FROM invites WHERE case_id=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?',id,this.clock()).n;
      if(active>=5) throw new DomainError('LIMIT','Сначала отзовите одно из пяти активных приглашений.',409);
      const raw=token(),inviteId=randomUUID(),expiresAt=this.clock()+7*86400000;
      this.store.run('INSERT INTO invites(id,case_id,token_hash,verdict_id,claim,audience,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)',inviteId,id,hash(raw),s.verdictId,s.finalClaim,s.draft.audience,this.now(),expiresAt);
      this.append(s,'witness_invited',{inviteId,verdictId:s.verdictId,expiresAt});
      return {invite:{id:inviteId,token:raw,expiresAt}};
    });
  }
  revoke(owner,id,body) {
    return this.command(owner,id,body,s=>{
      const row=this.store.one('SELECT id FROM invites WHERE id=? AND case_id=?',body.inviteId,id);
      if(!row) throw new DomainError('NOT_FOUND','Приглашение не найдено.',404);
      this.store.run('UPDATE invites SET revoked_at=? WHERE id=?',this.now(),body.inviteId);
      this.append(s,'invite_revoked',{inviteId:body.inviteId});
    });
  }
  witnessInvite(raw) {
    if(typeof raw!=='string'||raw.length>100) throw new DomainError('NOT_FOUND','Приглашение не найдено.',404);
    const row=this.store.one('SELECT * FROM invites WHERE token_hash=?',hash(raw));
    if(!row) throw new DomainError('NOT_FOUND','Приглашение не найдено.',404);
    if(row.revoked_at||row.expires_at<=this.clock()) throw new DomainError('EXPIRED','Приглашение отозвано или срок его действия истёк.',410);
    if(row.used_at) throw new DomainError('USED','Возражение по этой ссылке уже отправлено.',410);
    return row;
  }
  publicInvite(raw) {
    const row=this.witnessInvite(raw);
    return {claim:row.claim,audience:row.audience,expiresAt:row.expires_at,disclosure:'Вы видите только итоговую фразу и аудиторию. Внутренние материалы автора не раскрываются.'};
  }
  object(owner,raw,body) {
    return this.store.tx(()=>{
      const row=this.witnessInvite(raw);
      const c=this.store.one('SELECT * FROM cases WHERE id=?',row.case_id);
      if(!c) throw new DomainError('NOT_FOUND','Дело больше не существует.',404);
      if(c.owner_id===owner) throw new DomainError('SELF_WITNESS','Откройте ссылку в другом браузере или передайте другому человеку: автор не может быть собственным свидетелем.',409);
      const message=text(body.text,'Возражение',10,1000);
      this.assertIntegrity(c.owner_id,c.id);
      let s=JSON.parse(c.state);
      s=this.append(s,'witness_objection',{id:randomUUID(),text:message,verdictId:row.verdict_id,inviteId:row.id});
      this.append(s,'case_reopened',{reason:'witness_objection',revokedPendingHandoffs:this.pendingHandoffIds(row.case_id)});
      this.store.run('UPDATE handoffs SET revoked_at=? WHERE case_id=? AND mode=? AND redeemed_at IS NULL AND revoked_at IS NULL',this.now(),row.case_id,'deeplink');
      const active=this.store.all('SELECT id FROM comparisons WHERE case_id=? AND status=?',row.case_id,'open').map(x=>x.id);
      if(active.length){
        this.store.run('UPDATE comparisons SET status=?,closed_at=? WHERE case_id=? AND status=?','invalidated',this.now(),row.case_id,'open');
        this.append(this.own(c.owner_id,c.id),'comparison_invalidated',{comparisonIds:active,reason:'witness_objection'});
      }
      this.store.run('UPDATE invites SET used_at=? WHERE id=?',this.now(),row.id);
      return {ok:true,message:'Возражение сохранено. Дело автора действительно открыто повторно.'};
    });
  }
  platformList() {
    return this.platforms.map(p=>integrationReadiness(p,{secret:this.secret}));
  }
  revokeHandoff(owner,id,body){
    return this.command(owner,id,body,s=>{
      const h=this.store.one('SELECT id,mode,redeemed_at,revoked_at FROM handoffs WHERE id=? AND case_id=?',body.handoffId,id);
      if(!h)throw new DomainError('NOT_FOUND','Передача не найдена.',404);
      if(h.mode!=='deeplink')throw new DomainError('STATE','Ручной экспорт нельзя отозвать: копия текста уже могла быть сохранена.',409);
      if(h.redeemed_at)throw new DomainError('ALREADY_REDEEMED','Платформа уже получила бриф. Отозвать его из JUDGE нельзя.',409);
      if(h.revoked_at)throw new DomainError('REVOKED','Передача уже отозвана.',409);
      this.store.run('UPDATE handoffs SET revoked_at=? WHERE id=?',this.now(),h.id);
      this.append(s,'handoff_revoked',{handoffId:h.id});
    });
  }
  handoff(owner,id,body) {
    return this.command(owner,id,body,s=>{
      if(s.phase!=='verdict') throw new DomainError('STATE','Сначала завершите дело.',409);
      const p=this.platforms.find(x=>x.id===body.platformId);
      if(!p) throw new DomainError('PLATFORM','Неизвестная платформа.');
      const b=makeBrief(s),handoffId=randomUUID(),expiresAt=this.clock()+3600000;
      let url=null,mode='clipboard';
      if(p.mode==='api') throw new DomainError('NOT_CONFIGURED','API-адаптер требует подтверждённого контракта конкретного сайта. Используйте копирование брифа.',503);
      if(p.mode==='deeplink') {
        if(!integrationReadiness(p,{secret:this.secret}).configured) throw new DomainError('NOT_CONFIGURED','Подключение платформы ещё не подтверждено.',503);
        if(body.consent!==true) throw new DomainError('CONSENT','Подтвердите передачу брифа на внешнюю платформу.');
        const target=new URL(p.url);
        if(target.protocol!=='https:'||target.username||target.password) throw new DomainError('CONFIG','Для подключения требуется HTTPS-адрес без встроенных учётных данных.',503);
        const signed=signPayload({v:1,id:handoffId,platform:p.id,exp:expiresAt},this.secret);
        target.searchParams.set('judge_token',signed);url=target.href;mode='deeplink';
      }
      this.store.run('INSERT INTO handoffs(id,case_id,platform_id,mode,brief,created_at,expires_at,verdict_id) VALUES(?,?,?,?,?,?,?,?)',handoffId,id,p.id,mode,JSON.stringify(b),this.now(),expiresAt,s.verdictId);
      this.append(s,'handoff_created',{handoffId,platformId:p.id,mode,deliveryConfirmed:false});
      return {handoff:{id:handoffId,mode,url,text:briefText(s),brief:b,expiresAt,deliveryConfirmed:false}};
    });
  }
  authenticateIntegration(platformId,credential) {
    const p=this.platforms.find(x=>x.id===platformId);
    const expected=p?.credentialEnv?process.env[p.credentialEnv]:null;
    if(!p?.verified||!expected||expected.length<20||!equal(credential,expected)) throw new DomainError('AUTH','Нет доступа к интеграции.',401);
    return p;
  }
  redeem(platformId,credential,signed,requestId=null) {
    this.authenticateIntegration(platformId,credential);
    if(requestId!==null && (typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)))
      throw new DomainError('REQUEST_ID','Неверный идентификатор приёма.');
    const requestHash=requestId===null?null:hash(platformId+':'+requestId);
    const p=verifyPayload(signed,this.secret,this.clock());
    if(p.platform!==platformId) throw new DomainError('TOKEN','Токен выдан другой платформе.',403);
    return this.store.tx(()=>{
      const row=this.store.one('SELECT * FROM handoffs WHERE id=? AND platform_id=?',p.id,platformId);
      if(!row||row.mode!=='deeplink') throw new DomainError('NOT_FOUND','Передача не найдена.',404);
      if(row.redeemed_at) {
        // An authenticated receiver may retry a lost HTTP response with the *same*
        // idempotency key during a short window. Different keys never replay data.
        if(!requestHash||!row.redeem_request_hash||!equal(row.redeem_request_hash,requestHash)||
           this.clock()-Date.parse(row.redeemed_at)>300000)
          throw new DomainError('REDEEMED','Передача уже получена.',409);
      }
      if(row.revoked_at) throw new DomainError('REVOKED','Передача отозвана автором или устарела.',410);
      if(row.expires_at<=this.clock()) throw new DomainError('EXPIRED','Передача истекла.',410);
      const owner=this.store.one('SELECT owner_id FROM cases WHERE id=?',row.case_id)?.owner_id;
      if(!owner)throw new DomainError('NOT_FOUND','Дело не найдено.',404);
      this.assertIntegrity(owner,row.case_id);
      const s=JSON.parse(this.store.one('SELECT state FROM cases WHERE id=?',row.case_id).state);
      if(!row.verdict_id||s.phase!=='verdict'||row.verdict_id!==s.verdictId)throw new DomainError('STALE_VERDICT','Этот бриф больше не является действующим вердиктом.',410);
      if(row.redeemed_at)return {handoffId:row.id,brief:JSON.parse(row.brief),duplicate:true};
      this.store.run('UPDATE handoffs SET redeemed_at=?,redeem_request_hash=? WHERE id=?',this.now(),requestHash,row.id);
      this.append(s,'handoff_redeemed',{handoffId:row.id,platformId});
      return {handoffId:row.id,brief:JSON.parse(row.brief),duplicate:false};
    });
  }
  receipt(platformId,credential,body) {
    const p=this.authenticateIntegration(platformId,credential);
    if(!Array.isArray(p.confirmedEvents)||!p.confirmedEvents.includes(body.action)) throw new DomainError('EVENT_CONTRACT','Для этого действия не согласован контракт подтверждения.',403);
    const eventId=text(body.eventId,'eventId',8,100);
    return this.store.tx(()=>{
      const existing=this.store.one('SELECT handoff_id,action FROM integration_receipts WHERE platform_id=? AND event_id=?',platformId,eventId);
      if(existing){
        if(existing.handoff_id!==body.handoffId||(existing.action&&existing.action!==body.action))throw new DomainError('EVENT_CONFLICT','Внешний идентификатор события уже использован с другими данными.',409);
        return {ok:true,duplicate:true};
      }
      const h=this.store.one('SELECT * FROM handoffs WHERE id=? AND platform_id=?',body.handoffId,platformId);
      if(!h?.redeemed_at) throw new DomainError('NOT_FOUND','Нужна подтверждённая передача.',404);
      this.store.run('INSERT INTO integration_receipts(platform_id,event_id,handoff_id,created_at,action) VALUES(?,?,?,?,?)',platformId,eventId,h.id,this.now(),body.action);
      const owner=this.store.one('SELECT owner_id FROM cases WHERE id=?',h.case_id)?.owner_id;
      if(!owner)throw new DomainError('NOT_FOUND','Дело не найдено.',404);
      this.assertIntegrity(owner,h.case_id);
      const s=JSON.parse(this.store.one('SELECT state FROM cases WHERE id=?',h.case_id).state);
      this.append(s,'useful_action',{handoffId:h.id,platformId,action:body.action,externalEventId:eventId,source:'authenticated_platform'});
      return {ok:true,duplicate:false};
    });
  }
  structuredBrief(owner,id){const s=this.own(owner,id);if(s.phase!=='verdict')throw new DomainError('STATE','Бриф доступен после выпуска.',409);return makeBrief(s);}
  stats(owner) {
    const rows=this.store.all('SELECT e.type,COUNT(*) AS n FROM events e JOIN cases c ON c.id=e.case_id WHERE c.owner_id=? GROUP BY e.type',owner);
    return Object.fromEntries(rows.map(x=>[x.type,x.n]));
  }
  export(owner) {
    return {schema:'judge-personal-export-2',exportedAt:this.now(),account:this.store.one('SELECT id,email,created_at FROM users WHERE id=?',owner)??null,cases:this.list(owner).map(s=>({state:s,events:this.eventRows(s.id)})),handoffs:this.store.all('SELECT h.id,h.platform_id,h.mode,h.brief,h.created_at,h.redeemed_at FROM handoffs h JOIN cases c ON c.id=h.case_id WHERE c.owner_id=?',owner).map(h=>({...h,brief:JSON.parse(h.brief)})),comparisons:this.store.all('SELECT x.id,x.case_id,x.verdict_id,x.question,x.variant_a,x.variant_b,x.status,x.created_at,x.closed_at FROM comparisons x JOIN cases c ON c.id=x.case_id WHERE c.owner_id=?',owner).map(x=>({...x,votes:this.store.all('SELECT v.selection,v.note,v.created_at FROM comparison_votes v WHERE v.comparison_id=?',x.id)})),
    research:this.store.all(`SELECT r.* FROM research_studies r JOIN cases c ON c.id=r.case_id WHERE c.owner_id=?`,owner),
    workspaceMemberships:this.store.all(`SELECT w.id,w.name,wm.role,wm.joined_at FROM workspaces w JOIN workspace_members wm ON wm.workspace_id=w.id WHERE wm.user_id=?`,owner),
    workspaceReviewsAuthored:this.store.all('SELECT workspace_id,case_id,comment,created_at FROM workspace_reviews WHERE user_id=?',owner)};
  }
  deleteCase(owner,id) {this.own(owner,id);this.store.run('DELETE FROM cases WHERE id=? AND owner_id=?',id,owner);return {ok:true};}
  deleteOwner(owner) {
    this.store.tx(()=>{this.store.run('DELETE FROM cases WHERE owner_id=?',owner);this.store.run('DELETE FROM sessions WHERE owner_id=?',owner);this.store.run('DELETE FROM users WHERE id=?',owner);});
    return {ok:true};
  }
}