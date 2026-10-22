/** Human preference pilot: snapshot two claims, balance presentation, never claim ad performance.
 * The server remains the only source of case truth. No token is stored in plaintext. */
import {randomUUID,randomInt} from 'node:crypto';
import {DomainError,text} from '../shared/domain.mjs';
import {hash,token} from './security.mjs';

const QUESTION='Какая из двух формулировок понятнее с первого прочтения?';
const NOTE='Это выбор приглашённых читателей, а не A/B-тест в рекламной сети. Маленькая и нерепрезентативная выборка не доказывает эффективность, продажи или причинность.';
const identifier=id=>{
  if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))throw new DomainError('VALIDATION','Неверный идентификатор теста.');
  return id;
};

export class ComparisonService {
  constructor(judge){this.judge=judge;this.store=judge.store;}
  now(){return this.judge.now();}
  getOwned(owner,caseId,id){
    this.judge.own(owner,caseId);
    const x=this.store.one('SELECT * FROM comparisons WHERE id=? AND case_id=?',identifier(id),caseId);
    if(!x)throw new DomainError('NOT_FOUND','Тест не найден.',404);
    return x;
  }
  summaries(owner,caseId){
    this.judge.own(owner,caseId);
    const list=this.store.all('SELECT * FROM comparisons WHERE case_id=? ORDER BY created_at DESC',caseId);
    return list.map(x=>{
      const counts=this.store.one(`SELECT COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN selection='a' THEN 1 ELSE 0 END),0) AS a,
        COALESCE(SUM(CASE WHEN selection='b' THEN 1 ELSE 0 END),0) AS b,
        COALESCE(SUM(CASE WHEN selection='neither' THEN 1 ELSE 0 END),0) AS neither
        FROM comparison_votes WHERE comparison_id=?`,x.id);
      const invitations=this.store.one(`SELECT COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN used_at IS NOT NULL THEN 1 ELSE 0 END),0) AS answered,
        COALESCE(SUM(CASE WHEN used_at IS NULL AND revoked_at IS NULL AND expires_at>? THEN 1 ELSE 0 END),0) AS active
        FROM comparison_links WHERE comparison_id=?`,this.judge.clock(),x.id);
      return {id:x.id,verdictId:x.verdict_id,question:x.question,variantA:x.variant_a,variantB:x.variant_b,
        status:x.status==='open'&&x.expires_at<=this.judge.clock()?'expired':x.status,
        createdAt:x.created_at,expiresAt:x.expires_at,closedAt:x.closed_at,
        counts,invites:invitations,
        notes:this.store.all('SELECT selection,note,created_at FROM comparison_votes WHERE comparison_id=? AND note<>? ORDER BY created_at DESC LIMIT 20',x.id,'').map(v=>({selection:v.selection,note:v.note,at:v.created_at})),
        disclaimer:NOTE};
    });
  }
  start(owner,caseId,body){
    return this.judge.command(owner,caseId,body,s=>{
      if(s.phase!=='verdict')throw new DomainError('STATE','Сначала выпустите редакторский бриф.',409);
      if(body.consent!==true)throw new DomainError('CONSENT','Подтвердите передачу двух формулировок участникам по ссылке.');
      if(s.claim.trim().toLowerCase()===s.finalClaim.trim().toLowerCase())throw new DomainError('SAME_VARIANTS','Для сравнения нужны две разные формулировки. Измените итоговую версию.',409);
      const count=this.store.one('SELECT COUNT(*) AS n FROM comparisons WHERE case_id=? AND verdict_id=?',caseId,s.verdictId).n;
      if(count>=3)throw new DomainError('LIMIT','Для одного вердикта разрешено до трёх тестов.',409);
      const id=randomUUID(),createdAt=this.now(),expiresAt=this.judge.clock()+14*86400000;
      this.store.run(`INSERT INTO comparisons(id,case_id,verdict_id,question,variant_a,variant_b,seed,created_at,expires_at)
        VALUES(?,?,?,?,?,?,?,?,?)`,id,caseId,s.verdictId,QUESTION,s.claim,s.finalClaim,randomInt(2),createdAt,expiresAt);
      this.judge.append(s,'comparison_started',{comparisonId:id,verdictId:s.verdictId,question:QUESTION,expiresAt});
      return {comparisonId:id};
    });
  }
  invite(owner,caseId,body){
    return this.judge.command(owner,caseId,body,s=>{
      if(s.phase!=='verdict')throw new DomainError('STATE','Тест доступен только для действующего вердикта.',409);
      const x=this.getOwned(owner,caseId,body.comparisonId);
      if(x.status!=='open'||x.expires_at<=this.judge.clock()||x.verdict_id!==s.verdictId)throw new DomainError('CLOSED','Тест закрыт или относится к устаревшему вердикту.',410);
      const n=this.store.one('SELECT COUNT(*) AS n FROM comparison_links WHERE comparison_id=?',x.id).n;
      if(n>=30)throw new DomainError('LIMIT','Достигнут предел: 30 индивидуальных ссылок на тест.',409);
      const raw=token(),id=randomUUID(),order=(n+x.seed)%2===0?'ab':'ba';
      const expiresAt=Math.min(this.judge.clock()+7*86400000,x.expires_at);
      this.store.run('INSERT INTO comparison_links(id,comparison_id,token_hash,display_order,created_at,expires_at) VALUES(?,?,?,?,?,?)',id,x.id,hash(raw),order,this.now(),expiresAt);
      this.judge.append(s,'comparison_link_issued',{comparisonId:x.id,linkId:id,expiresAt});
      return {comparisonInvite:{token:raw,expiresAt}};
    });
  }
  close(owner,caseId,body){
    return this.judge.command(owner,caseId,body,s=>{
      const x=this.getOwned(owner,caseId,body.comparisonId);
      if(x.status!=='open')throw new DomainError('CLOSED','Тест уже закрыт.',409);
      this.store.run('UPDATE comparisons SET status=?,closed_at=? WHERE id=?','closed',this.now(),x.id);
      this.judge.append(s,'comparison_closed',{comparisonId:x.id});
    });
  }
  getLink(raw){
    if(typeof raw!=='string'||!/^[A-Za-z0-9_-]{20,100}$/.test(raw))throw new DomainError('NOT_FOUND','Ссылка не найдена.',404);
    const row=this.store.one(`SELECT l.*,c.case_id,c.verdict_id,c.question,c.variant_a,c.variant_b,c.status,c.expires_at AS comparison_expires
      FROM comparison_links l JOIN comparisons c ON c.id=l.comparison_id WHERE l.token_hash=?`,hash(raw));
    if(!row)throw new DomainError('NOT_FOUND','Ссылка не найдена.',404);
    if(row.used_at)throw new DomainError('USED','По этой ссылке уже отправлен ответ.',410);
    if(row.revoked_at||row.status!=='open'||row.expires_at<=this.judge.clock()||row.comparison_expires<=this.judge.clock())throw new DomainError('EXPIRED','Тест закрыт или срок ссылки истёк.',410);
    const c=this.store.one('SELECT state FROM cases WHERE id=?',row.case_id);
    if(!c)throw new DomainError('NOT_FOUND','Дело удалено.',404);
    const s=JSON.parse(c.state);
    if(s.phase!=='verdict'||s.verdictId!==row.verdict_id)throw new DomainError('STALE_VERDICT','Вердикт уже пересматривается.',410);
    return row;
  }
  public(raw){
    const x=this.getLink(raw);
    return {question:x.question,first:x.display_order==='ab'?x.variant_a:x.variant_b,
      second:x.display_order==='ab'?x.variant_b:x.variant_a,expiresAt:x.expires_at,
      disclosure:'Это редакторский опрос об ясности текста. Ответ будет доступен автору, участие добровольное; регистрация не нужна. Порядок вариантов меняется между приглашениями.'};
  }
  vote(owner,raw,body){
    return this.store.tx(()=>{
      const x=this.getLink(raw);
      const caseRow=this.store.one('SELECT owner_id FROM cases WHERE id=?',x.case_id);
      if(!caseRow)throw new DomainError('NOT_FOUND','Дело удалено.',404);
      if(caseRow.owner_id===owner)throw new DomainError('SELF_VOTE','Автор не может оценивать собственные варианты из этого сеанса.',409);
      if(body.accepted!==true)throw new DomainError('CONSENT','Подтвердите добровольное участие.');
      if(!['first','second','neither'].includes(body.choice))throw new DomainError('VALIDATION','Выберите первый, второй или ни один вариант.');
      const selection=body.choice==='neither'?'neither':(body.choice==='first'?x.display_order[0]:x.display_order[1]);
      const note=text(body.note??'','Комментарий',0,500);
      this.judge.assertIntegrity(caseRow.owner_id,x.case_id);
      const id=randomUUID();
      this.store.run('INSERT INTO comparison_votes(id,comparison_id,link_id,selection,note,created_at) VALUES(?,?,?,?,?,?)',id,x.comparison_id,x.id,selection,note,this.now());
      this.store.run('UPDATE comparison_links SET used_at=? WHERE id=?',this.now(),x.id);
      const s=JSON.parse(this.store.one('SELECT state FROM cases WHERE id=?',x.case_id).state);
      this.judge.append(s,'comparison_voted',{comparisonId:x.comparison_id,linkId:x.id,selection});
      return {ok:true,message:'Выбор сохранён без рейтинга эффективности рекламы.'};
    });
  }
}
