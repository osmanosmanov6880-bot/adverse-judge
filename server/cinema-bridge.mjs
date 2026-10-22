/** CINEMA 1.1 -> JUDGE 0.30 integration.
 * Explicit consent, same-origin CSRF (enforced by index.mjs), owner-scoped dedupe,
 * no promotion of screenplay verdict into a real JUDGE approval.
 */
import {createHash,randomUUID} from 'node:crypto';
import {DomainError,initialState,text} from '../shared/domain.mjs';

const strategies=new Set(['Уточнить обещание','Проверить доказательства','Вернуть человеческий смысл']);
const statuses=new Set(['unknown','missing','user_supplied_unverified']);
const witnesses=new Set(['guarantee','conditions']);
export function validateCinemaBrief(body) {
  if (!body||typeof body!=='object'||Array.isArray(body)||body.consent!==true)
    throw new DomainError('CONSENT','Подтвердите перенос черновика в серверный JUDGE.',400);
  const b=body.brief;
  if (!b||typeof b!=='object'||Array.isArray(b)||b.schema!=='adverse.cinematic-brief.v1'||b.reviewStatus!=='draft_requires_human_and_legal_review')
    throw new DomainError('SCHEMA','Ожидается черновой бриф ADVERSE CINEMA v1.',400);
  if (!b.claim||!b.evidence||typeof b.claim!=='object'||typeof b.evidence!=='object')
    throw new DomainError('SCHEMA','Отсутствует исходная формулировка или сведения об основаниях.',400);
  const original=text(b.claim.original,'Исходное обещание',10,240);
  const revised=text(b.claim.revised,'Новая формулировка',16,320);
  const strategy=b.claim.selectedStrategy??null;
  if (strategy!==null&&!strategies.has(strategy))throw new DomainError('SCHEMA','Неизвестная стратегия.',400);
  const evidenceStatus=b.evidence.status;
  if(!statuses.has(evidenceStatus))throw new DomainError('SCHEMA','Недопустимый статус источника.',400);
  const evidence=evidenceStatus==='user_supplied_unverified'?text(b.evidence.description,'Описание источника',8,500):'';
  const witness=b.witness??null;
  if(witness!==null&&!witnesses.has(witness))throw new DomainError('SCHEMA','Неизвестный вариант свидетельства.',400);
  // Ignore LLM-sounding scores and arbitrary navigation history. Both are untrusted.
  return {original,revised,strategy,evidenceStatus,evidence,witness};
}
export function cinemaFingerprint(fields) {
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}
export class CinemaBridge {
  constructor(store){this.store=store;}
  import(owner,body){
    const fields=validateCinemaBrief(body),fingerprint=cinemaFingerprint(fields);
    return this.store.tx(()=>{
      const existing=this.store.one('SELECT case_id FROM cinema_imports WHERE owner_id=? AND fingerprint=?',owner,fingerprint);
      if(existing)return {caseId:existing.case_id,created:false,phase:'hearing',origin:'cinema',message:'Этот черновик уже перенесён. Открываем сохранённое дело.'};
      const count=this.store.one('SELECT COUNT(*) AS n FROM cases WHERE owner_id=?',owner).n;
      if(count>=200)throw new DomainError('LIMIT','В пилоте разрешено до 200 дел.',409);
      const caseId=randomUUID(),at=new Date().toISOString();
      // Intentionally do NOT create a finalClaim, fact, product, or a verdict:
      // a screenplay does not establish real product capabilities or proof.
      const data={id:caseId,claim:fields.original,draft:{},createdAt:at};
      const state=initialState(data);
      this.store.run('INSERT INTO cases VALUES(?,?,?,?,?,?)',caseId,owner,JSON.stringify(state),1,at,at);
      this.store.recordEvent(caseId,'case_created',data,at);
      this.store.run(`INSERT INTO cinema_imports(case_id,owner_id,fingerprint,proposed_claim,strategy,evidence_status,evidence_text,witness,imported_at)
        VALUES(?,?,?,?,?,?,?,?,?)`,caseId,owner,fingerprint,fields.revised,fields.strategy,fields.evidenceStatus,fields.evidence,fields.witness,at);
      return {caseId,created:true,phase:'hearing',origin:'cinema',message:'Создано новое дело. Редакторская проверка в JUDGE начинается заново.'};
    });
  }
  forCase(owner,caseId){
    const row=this.store.one(`SELECT proposed_claim AS proposedClaim,strategy,evidence_status AS evidenceStatus,evidence_text AS evidenceText,witness,imported_at AS importedAt
      FROM cinema_imports WHERE case_id=? AND owner_id=?`,caseId,owner);
    return row?{...row,verifiedEvidence:false,reviewStatus:'unreviewed_proposal',disclosure:'Импортировано из интерактивного фильма. Рекламные факты и вердикт не проверены сервером JUDGE.'}:null;
  }
  export(owner){return this.store.all(`SELECT c.case_id AS caseId,c.proposed_claim AS proposedClaim,c.strategy,c.evidence_status AS evidenceStatus,c.evidence_text AS evidenceText,c.witness,c.imported_at AS importedAt
    FROM cinema_imports c JOIN cases k ON k.id=c.case_id WHERE c.owner_id=? AND k.owner_id=?`,owner,owner);}
}
