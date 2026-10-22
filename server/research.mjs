/** Wave 2 — registered, reproducible, descriptive studies of invited readers.
 * Preference is NOT ad effectiveness. Counts never derive from LLM output. */
import {randomUUID} from 'node:crypto';
import {DomainError,text} from '../shared/domain.mjs';
export function wilson95(successes,total){
 if(!Number.isSafeInteger(total)||total<0||!Number.isSafeInteger(successes)||successes<0||successes>total)throw new RangeError('invalid counts');
 if(total===0)return {low:null,high:null};
 const z=1.959963984540054,p=successes/total,z2=z*z,denom=1+z2/total;
 const center=(p+z2/(2*total))/denom,delta=(z*Math.sqrt((p*(1-p)+z2/(4*total))/total))/denom;
 return {low:Number(Math.max(0,center-delta).toFixed(4)),high:Number(Math.min(1,center+delta).toFixed(4))};
}
const STATEMENT='Описательные результаты приглашённых читателей. Это не репрезентативная выборка, не реклама в сети и не оценка влияния на продажи. Wilson-интервалы показаны только как математическая характеристика доли при условной модели независимых ответов — приглашения не гарантируют случайную выборку.';
export class ResearchService{
 constructor(judge){this.judge=judge;this.store=judge.store;}
 now(){return this.judge.now();}
 own(user,id){
  const row=this.store.one(`SELECT r.* FROM research_studies r JOIN cases c ON c.id=r.case_id
     WHERE r.id=? AND c.owner_id=?`,id,user);
  if(!row)throw new DomainError('NOT_FOUND','Исследование не найдено.',404);
  return row;
 }
 list(user){
  return this.store.all(`SELECT r.id FROM research_studies r JOIN cases c ON c.id=r.case_id
    WHERE c.owner_id=? ORDER BY r.created_at DESC`,user).map(r=>this.detail(user,r.id));
 }
 detail(user,id){
  const r=this.own(user,id);
  const votes=this.store.one(`SELECT COUNT(*) AS total,
    COALESCE(SUM(CASE WHEN selection='a' THEN 1 ELSE 0 END),0) AS a,
    COALESCE(SUM(CASE WHEN selection='b' THEN 1 ELSE 0 END),0) AS b,
    COALESCE(SUM(CASE WHEN selection='neither' THEN 1 ELSE 0 END),0) AS neither
    FROM comparison_votes WHERE comparison_id=?`,r.comparison_id);
  const decisive=votes.a+votes.b;
  const compare=this.store.one('SELECT status,expires_at,variant_a,variant_b FROM comparisons WHERE id=?',r.comparison_id);
  const currentState=this.judge.own(user,r.case_id);
  const latest=currentState.phase==='verdict'&&currentState.verdictId===r.verdict_id;
  return {id:r.id,caseId:r.case_id,comparisonId:r.comparison_id,hypothesis:r.hypothesis,
    targetResponses:r.target_responses,status:r.status,comparisonStatus:compare?.status??'deleted',
    basedOnCurrentVerdict:latest,createdAt:r.created_at,closedAt:r.closed_at,
    variants:{a:compare?.variant_a??'',b:compare?.variant_b??''},
    sample:{...votes,decisive,remaining:Math.max(0,r.target_responses-votes.total),targetReached:votes.total>=r.target_responses},
    preference:{a:decisive?Number((votes.a/decisive).toFixed(4)):null,b:decisive?Number((votes.b/decisive).toFixed(4)):null,aInterval:wilson95(votes.a,decisive),bInterval:wilson95(votes.b,decisive)},
    decision:r.decision,decisionNote:r.decision_note,disclaimer:STATEMENT};
 }
 create(user,body){
  const caseId=body.caseId,comparisonId=body.comparisonId;
  const s=this.judge.own(user,caseId);this.judge.assertIntegrity(user,caseId);
  if(s.phase!=='verdict')throw new DomainError('STATE','Исследование доступно для действующего вердикта.',409);
  const x=this.store.one('SELECT * FROM comparisons WHERE id=? AND case_id=?',comparisonId,caseId);
  if(!x||x.verdict_id!==s.verdictId)throw new DomainError('STATE','Выберите актуальное сравнение этого дела.',409);
  if(x.status!=='open'||x.expires_at<=this.judge.clock())throw new DomainError('STATE','Для начала исследования нужно открытое сравнение.',409);
  const hypothesis=text(body.hypothesis,'Гипотеза',15,240),target=Number(body.targetResponses);
  if(!Number.isSafeInteger(target)||target<5||target>30)throw new DomainError('VALIDATION','Размер пилота должен быть от 5 до 30 приглашённых.',400);
  const count=this.store.one('SELECT COUNT(*) AS n FROM research_studies WHERE case_id=?',caseId).n;
  if(count>=10)throw new DomainError('LIMIT','Для одного дела не более десяти исследований.',409);
  const id=randomUUID();
  this.store.run(`INSERT INTO research_studies(id,case_id,comparison_id,verdict_id,hypothesis,target_responses,status,created_at)
      VALUES(?,?,?,?,?,?,?,?)`,id,caseId,comparisonId,s.verdictId,hypothesis,target,'active',this.now());
  return this.detail(user,id);
 }
 conclude(user,id,body){
  const r=this.own(user,id);
  if(r.status!=='active')throw new DomainError('STATE','Решение уже сохранено.',409);
  if(!['iterate','retain','inconclusive'].includes(body.decision))throw new DomainError('VALIDATION','Выберите одно из допустимых решений.');
  const note=text(body.note,'Обоснование',15,1200);
  const view=this.detail(user,id);
  if(!view.basedOnCurrentVerdict && body.decision!=='inconclusive')throw new DomainError('STALE_VERDICT','Старый вердикт можно закрыть только как неопределённый.',409);
  this.store.run(`UPDATE research_studies SET status='concluded',decision=?,decision_note=?,closed_at=? WHERE id=?`,body.decision,note,this.now(),id);
  return this.detail(user,id);
 }
 exportCSV(user){
  const rows=this.list(user);
  const escape=value=>'"'+String(value??'').replaceAll('"','""').replace(/^[=+@\-\t\r]/,'\'$&')+'"';
  const cols=['id','caseId','hypothesis','status','a','b','neither','targetResponses','decision','createdAt'];
  return '\ufeff'+[cols.join(','),...rows.map(r=>[
    r.id,r.caseId,r.hypothesis,r.status,r.sample.a,r.sample.b,r.sample.neither,r.targetResponses,r.decision||'',r.createdAt].map(escape).join(','))].join('\r\n')+'\r\n';
 }
}
