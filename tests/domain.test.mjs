import test from 'node:test';
import assert from 'node:assert/strict';
import {DEMOS,ACTIONS,initialState,reduceEvent,replay,analyze,candidates,makeBrief,briefText,validateDraft,DomainError} from '../shared/domain.mjs';
const data={...DEMOS[0],id:'test-case',createdAt:'2026-10-22T00:00:00.000Z'};
const e=(type,data)=>({type,data,at:'2026-10-22T00:01:00.000Z'});
function base(){return initialState(data);}
function ready(action='narrow'){
 let s=base();s=reduceEvent(s,e('action_chosen',{action}));
 s=reduceEvent(s,e('brief_prepared',{draft:{...DEMOS[0],evidence:action==='evidence'?'Демонстрация работы функции, предоставленная автором.':''}}));
 return s;
}
test('initial claim is trimmed and invalid lengths are rejected',()=>{assert.equal(initialState({...data,claim:'  valid claim  '}).claim,'valid claim');assert.throws(()=>initialState({...data,claim:'a'}),DomainError);});
test('initial phase and rules are explicit',()=>{const s=base();assert.equal(s.phase,'hearing');assert.equal(s.version,1);assert.equal(s.rulesVersion,'judge-rules-1');});
for(const a of ACTIONS)test(`branch ${a.id}: preparation and three variants`,()=>{const s=ready(a.id);assert.equal(s.phase,'review');assert.equal(s.candidates.length,3);assert.equal(s.draft.product,DEMOS[0].product);});
test('cannot issue verdict from hearing',()=>assert.throws(()=>reduceEvent(base(),e('verdict_issued',{})),x=>x.code==='STATE'));
test('cannot skip action selection',()=>assert.throws(()=>reduceEvent(base(),e('brief_prepared',{draft:DEMOS[0]})),x=>x.code==='STATE'));
test('unknown action is rejected',()=>assert.throws(()=>reduceEvent(base(),e('action_chosen',{action:'approve_everything'})),x=>x.code==='VALIDATION'));
test('evidence branch requires a substantive statement',()=>{const s=reduceEvent(base(),e('action_chosen',{action:'evidence'}));assert.throws(()=>reduceEvent(s,e('brief_prepared',{draft:{...DEMOS[0],evidence:'short'}})),x=>x.code==='VALIDATION');});
test('author acknowledgement is required',()=>assert.throws(()=>reduceEvent(ready(),e('claim_rewritten',{claim:'New final claim'})),x=>x.code==='ACK_REQUIRED'));
test('state is immutable and event versions advance',()=>{const s=base(),next=reduceEvent(s,e('action_chosen',{action:'narrow'}));assert.equal(s.phase,'hearing');assert.equal(next.version,2);});
test('replay reconstructs exactly the same state',()=>{const events=[e('case_created',data),e('action_chosen',{action:'narrow'}),e('brief_prepared',{draft:DEMOS[0]}),e('claim_rewritten',{claim:'Final ad text for review',acknowledged:true}),e('verdict_issued',{verdictId:'v1'})];let s=null;for(const ev of events)s=reduceEvent(s,ev);assert.deepEqual(replay(events),s);});
test('unknown events cannot silently mutate state',()=>assert.throws(()=>reduceEvent(base(),e('make_everything_true',{})),x=>x.code==='EVENT'));
test('absolute claims are flagged, not scored',()=>{const out=analyze('Самый лучший сервис');assert.ok(out.some(x=>x.id==='absolute'));assert.ok(!('score' in out));});
test('numeric guarantees are flagged',()=>assert.ok(analyze('Продажи +100% за 7 дней').some(x=>x.id==='outcome')));
test('vague promise is flagged',()=>assert.ok(analyze('Маркетинг, который работает').some(x=>x.id==='vague')));
test('absence of trigger is not a guarantee',()=>assert.ok(analyze('Соберите заметки в одном месте',{audience:'Команды'}).some(x=>x.id==='scope')));
test('source is stored, never treated as verified',()=>{let s=ready();s=reduceEvent(s,e('claim_rewritten',{claim:'Final claim',acknowledged:true}));s=reduceEvent(s,e('verdict_issued',{verdictId:'v1'}));assert.equal(makeBrief(s).evidence.status,'user_supplied_unverified');assert.match(briefText(s),/не проверено/);});
test('source must be https without credentials',()=>{for(const source of ['javascript:alert(1)','http://example.org','https://user:pass@example.org'])assert.throws(()=>validateDraft({...DEMOS[0],source}),DomainError);});
test('empty optional source is valid',()=>assert.equal(validateDraft(DEMOS[0]).source,''));
test('candidate content only uses submitted facts',()=>{const d={product:'Example',fact:'Store notes.',audience:'Writers',cta:'Open demo',problem:'Need notes?'};const options=candidates(d,'narrow');assert.equal(options.length,3);for(const v of options){assert.match(v.text,/Store notes/);assert.doesNotMatch(v.text,/guaranteed|100%|AI-powered/);}});
test('stale witness cannot reopen a new verdict',()=>{let s=ready();s=reduceEvent(s,e('claim_rewritten',{claim:'Final claim',acknowledged:true}));s=reduceEvent(s,e('verdict_issued',{verdictId:'new'}));assert.throws(()=>reduceEvent(s,e('witness_objection',{verdictId:'old',text:'An objection long enough.'})),x=>x.code==='STALE_INVITE');});
test('AI commentary cannot change core domain values',()=>{const s=base(),next=reduceEvent(s,e('ai_commentary',{phase:'verdict',finalClaim:'forged'}));assert.equal(next.phase,'hearing');assert.equal(next.finalClaim,null);assert.equal(next.claim,s.claim);});