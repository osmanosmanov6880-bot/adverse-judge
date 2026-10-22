'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const D=require('../src/data.js');
const E=require('../src/engine.js');
const root=path.resolve(__dirname,'..');
const step=(state,label)=>{
 const scene=E.sceneOf(state),i=scene.choices.findIndex(x=>x.label===label);
 assert.ok(i>=0,`missing ${label} in ${scene.id}`);
 const r=E.choose(state,i);assert.ok(r.ok,r.error||'unexpected failure');return r.state;
};
const draft=(s,name,val)=>{const r=E.setDraft(s,name,val);assert.ok(r.ok);return r.state;};
function journey(strategy='clarity',evidence='missing',witness='conditions'){
 let s=E.fresh();s=step(s,'Пропустить вступление');
 s=draft(s,'claim','Этот продукт гарантированно удвоит ваши продажи за 7 дней.');
 s=step(s,'Передать слово Лексу');s=step(s,'Перейти к уликам');
 if(evidence==='claimed'){
  s=draft(s,'evidence','Внутренняя заметка о неизвестной выборке');s=step(s,'У меня есть источник');
 }else{s=step(s,'Подтверждений пока нет');}
 const pick={clarity:'Уточнить обещание',proof:'Проверить доказательства',empathy:'Вернуть человеческий смысл'};
 s=step(s,pick[strategy]);s=step(s,'Увидеть последствия');s=step(s,'Услышать свидетеля');
 s=step(s,witness==='guarantee'?'Покупатель ждёт гарантии':'Покупателю нужны условия');
 s=step(s,'Принять ответственность');
 s=draft(s,'rewrite','Для организаций мы предлагаем консультацию с описанием условий и применимых ограничений.');
 s=step(s,'Получить вердикт');s=step(s,'Открыть финал');return s;
}
test('graph has 15 reachable scenes and all images are present',()=>{
 assert.deepEqual(E.graph(),{valid:true,problems:[],count:15});
 const ids=new Set();let edges=0;
 for(const scene of D.scenes){
  assert.ok(!ids.has(scene.id));ids.add(scene.id);
  assert.ok(fs.existsSync(path.join(root,'assets',scene.art+'.webp')),scene.art);
  assert.ok(fs.existsSync(path.join(root,'assets',scene.art+'-mobile.webp')),scene.art);
  edges+=scene.choices.length;
 }
 assert.ok(edges>=25);
});
test('fresh state, error handling and invalid transition rejected',()=>{
 let s=E.fresh();assert.equal(s.scene,'scene_001');
 assert.equal(E.choose(s,-1).ok,false);
 assert.equal(E.choose(s,50).ok,false);
 assert.equal(E.revisit(s,'scene_015').ok,false);
 assert.equal(E.collect(s,'archive').ok,false);
 assert.equal(E.setDraft(s,'__proto__','abc').ok,false);
 s=step(s,'Пропустить вступление');
 s=draft(s,'claim','short');assert.equal(E.choose(s,0).ok,false);
});
test('case can branch into every strategy and generate outcome-specific brief',()=>{
 for(const strategy of ['clarity','proof','empathy']){
  const s=journey(strategy);
  assert.equal(s.scene,'scene_015');assert.equal(s.verdictIssued,true);
  const b=E.brief(s);
  assert.equal(b.schema,'adverse.cinematic-brief.v1');
  assert.equal(b.reviewStatus,'draft_requires_human_and_legal_review');
  assert.equal(b.handoff.externalPlatformConnected,false);
  assert.equal(b.claim.selectedStrategy,D.strategies[strategy].label);
  assert.equal(b.evidence.status,'missing');
  assert.ok(b.narrative.visitedScenes.includes('scene_014'));
 }
});
test('claimed evidence is reported unverified; never turns into fact',()=>{
 const s=journey('proof','claimed','guarantee');
 assert.equal(E.brief(s).evidence.status,'user_supplied_unverified');
 assert.equal(E.analyze(s).unverified,true);
 assert.equal(s.witness,'guarantee');
});
test('can collect three archive items in their own scenes only',()=>{
 let s=E.fresh();s=step(s,'Войти в историю');
 s=E.collect(s,'seal').state;
 s=step(s,'Войти в зал');s=step(s,'Открыть дело 001');
 s=step(s,'Сразу открыть доказательства');
 s=E.collect(s,'archive').state;
 s=step(s,'Подтверждений пока нет');s=step(s,'Уточнить обещание');
 s=step(s,'Увидеть последствия');s=step(s,'Услышать свидетеля');
 s=E.collect(s,'witness').state;
 assert.deepEqual(new Set(s.collectibles),new Set(['seal','archive','witness']));
});
test('editing original claim invalidates verdict, proof, and rewriting',()=>{
 let s=journey();
 s=E.revisit(s,'scene_004').state;
 s=draft(s,'claim','Новая проверяемая формулировка рекламного предложения.');
 assert.equal(s.verdictIssued,false);
 assert.equal(s.strategy,null);assert.equal(s.rewrite,'');
 assert.equal(s.evidenceStatus,'unknown');
 assert.equal(E.revisit(s,'scene_015').ok,false);
});
test('revisiting previous strategy clears old verdict and export becomes unavailable',()=>{
 let s=journey();s=step(s,'Прожить альтернативный путь');
 s=step(s,'Вернуть человеческий смысл');
 assert.equal(s.verdictIssued,false);assert.equal(s.strategy,'empathy');
});
test('hydration ignores malformed untrusted fields and preserves valid fields',()=>{
 const orig=journey();const back=E.hydrate(JSON.parse(JSON.stringify(orig)));
 assert.equal(back.scene,'scene_015');assert.equal(back.claim,orig.claim);
 const bad=E.hydrate({schema:1,scene:'unknown',visited:['scene_999','scene_001'],history:['bad'],collectibles:['__proto__','seal'],strategy:'__proto__',claim:{bad:true},rewrite:'short',verdictIssued:true});
 assert.equal(bad.scene,'scene_001');
 assert.equal(bad.verdictIssued,false);
 assert.deepEqual(bad.collectibles,['seal']);
 assert.equal(bad.strategy,null);
});
test('analysis warns about unsupported superlatives and numerical guarantees',()=>{
 const warns=E.warnings('Самый лучший гарантированный 100% рост за 7 дней');
 assert.ok(warns.length>=3);
 assert.equal(E.analyze(journey()).statement.includes('не является юридическим'),false);
});
test('source does not need network dependencies and runs on Node',()=>{
 for(const f of ['index.html','src/data.js','src/engine.js','src/sound.js','src/app.js','src/style.css']) assert.ok(fs.existsSync(path.join(root,f)));
});
