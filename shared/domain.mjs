/* Pure, deterministic domain logic. Shared by the server, tests and local preview.
   No LLM output is allowed to mutate this state. No scores predict ad performance. */
export function clientUUID() {
  if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();
  const b=globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
  const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export const VERSION = '0.30.0';
export const RULES_VERSION = 'judge-rules-1';
export const DEMOS = [
  {id:'marketing', tag:'Размытое обещание', claim:'Маркетинг, который работает', product:'Рекламный сервис', fact:'Создавайте рекламные материалы для своего бизнеса.', audience:'Владельцы малого бизнеса', problem:'Нужна реклама для вашего продукта?', cta:'Создать рекламный материал'},
  {id:'best', tag:'Неподтверждённое превосходство', claim:'Лучший выбор для бизнеса', product:'Сервис для команд', fact:'Собирайте рабочие задачи в одном списке.', audience:'Руководители небольших команд', problem:'Задачи теряются в переписках?', cta:'Посмотреть пример'},
  {id:'speed', tag:'Обещание результата', claim:'Удвойте продажи за семь дней', product:'Студия рекламы', fact:'Подготовьте рекламные материалы для своего продукта.', audience:'Владельцы интернет-магазинов', problem:'Готовите следующую рекламную кампанию?', cta:'Обсудить задачу'},
  {id:'all', tag:'Слишком широкая формулировка', claim:'Всё необходимое для каждого', product:'Рабочий кабинет', fact:'Храните заметки и списки задач в одном кабинете.', audience:'Независимые специалисты', problem:'Нужен отдельный кабинет для рабочих заметок?', cta:'Открыть пример кабинета'}
];
export const ACTIONS = [
  {id:'narrow',title:'Уточнить обещание',subtitle:'Назвать аудиторию и конкретную пользу.',icon:'target',lex:'Сужаем границы. За конкретные слова уже можно отвечать.',aurora:'Сохраним силу, уберём туман. Не нужно обещать всё, чтобы быть нужным.',witness:'Что именно я смогу сделать с вашим продуктом?'},
  {id:'evidence',title:'Предъявить основание',subtitle:'Добавить источник и границы применимости.',icon:'file',lex:'Источник принят к рассмотрению. Это ещё не означает, что он подтверждает обещание.',aurora:'Покажем основание, не превратим рекламный текст в диссертацию.',witness:'Условия этого примера похожи на мою ситуацию?'},
  {id:'reframe',title:'Изменить подход',subtitle:'Начать с задачи, а не с гарантии результата.',icon:'spark',lex:'Меняем функцию фразы. Вопрос не даёт права прятать ложное обещание.',aurora:'Можно заинтересовать человека и не обещать за него весь будущий успех.',witness:'Это моя задача? Покажите, с чего начать.'}
];
export class DomainError extends Error {
  constructor(code, message, status=400) { super(message); this.code=code; this.status=status; }
}
export function text(value, name, min=0, max=1000) {
  if (typeof value !== 'string') throw new DomainError('VALIDATION',`Поле «${name}» должно быть текстом.`);
  const v=value.trim();
  if (v.length<min || v.length>max) throw new DomainError('VALIDATION',`Поле «${name}»: от ${min} до ${max} символов.`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v)) throw new DomainError('VALIDATION','Недопустимые управляющие символы.');
  return v;
}
export function validateDraft(d) {
  const out={product:text(d.product,'Продукт',2,100),audience:text(d.audience,'Аудитория',2,160),fact:text(d.fact,'Факт о продукте',5,500),problem:text(d.problem??'','Задача',0,240),cta:text(d.cta??'Посмотреть продукт','Действие',2,100),evidence:text(d.evidence??'','Основание',0,1000),source:text(d.source??'','Источник',0,500)};
  if (out.source) {
    let u; try {u=new URL(out.source);} catch {throw new DomainError('VALIDATION','Источник должен быть корректной HTTPS-ссылкой.');}
    if (u.protocol!=='https:' || u.username || u.password) throw new DomainError('VALIDATION','Источник должен быть HTTPS-ссылкой без логина и пароля.');
  }
  return out;
}
export function analyze(claim, draft={}) {
  const findings=[];
  const add=(id,label,detail,tone,match='')=>findings.push({id,label,detail,tone,match});
  const absolute=claim.match(/самый|самая|самое|самые|лучш\p{L}*|номер\s*1|№\s*1|гарант\p{L}*|100\s*%|best|guarantee\w*/iu);
  if (absolute) add('absolute','Сильное утверждение','Превосходство или гарантия требуют основания и условий сравнения.','warning',absolute[0]);
  const metric=claim.match(/\d+|удво\p{L}*|рост\s+продаж|повыс\p{L}*\s+продаж|увелич\p{L}*\s+продаж|double|increase\s+sales/iu);
  if (metric) add('outcome','Измеримое обещание','Не переносите единичный результат на каждого покупателя. Проверьте условия.','warning',metric[0]);
  const vague=claim.match(/работает|инновацион\p{L}*|качеств\p{L}*|эффектив\p{L}*|всё\s+необходимое|для\s+каждого|для\s+всех|works|innovative/iu);
  if (vague) add('vague','Неясная польза','Объясните, что сможет сделать человек, а не только как хорошо звучит продукт.','warning',vague[0]);
  if (!draft.audience) add('audience','Аудитория не названа','Укажите конкретного получателя предложения.','neutral');
  else add('audience','Аудитория указана',draft.audience,'ok');
  if (draft.evidence) add('evidence','Основание заявлено','Записано со слов автора. JUDGE не проверял достоверность источника.','neutral');
  else if (absolute||metric) add('evidence','Основание не приложено','Не выдавайте обещание за доказанный результат.','warning');
  if (!absolute&&!metric&&!vague) add('scope','Явных шаблонных сигналов нет','Это результат ограниченных правил, не гарантия точности, законности или эффективности.','neutral');
  return findings;
}
export function candidates(draft, action) {
  const d=validateDraft(draft);
  const sentence=d.fact.replace(/[.!?]+$/u,'');
  const list=[
    {id:'clear',label:'Ясность',description:'Польза без надстроек.',text:`${sentence}.\n${d.cta}.`},
    {id:'context',label:'Контекст',description:'Обращение к конкретной аудитории.',text:`${d.audience}.\n${sentence}.`},
    {id:'question',label:'Вовлечение',description:'Задача перед предложением.',text:`${d.problem || 'Подходит ли это вашей задаче?'}\n${sentence}.\n${d.cta}.`}
  ];
  if (action==='reframe') return [list[2],list[0],list[1]];
  return list;
}
export function initialState(input) {
  const claim=text(input.claim,'Рекламная фраза',5,700);
  return {id:input.id,phase:'hearing',version:1,rulesVersion:RULES_VERSION,claim,draft:input.draft??{},action:null,candidates:[],finalClaim:null,verdictId:null,objections:[],defenses:[],createdAt:input.createdAt,updatedAt:input.createdAt};
}
export function reduceEvent(previous,event) {
  if (event.type==='case_created') {
    if (previous) throw new DomainError('STATE','Дело уже создано.',409);
    return initialState(event.data);
  }
  if (!previous) throw new DomainError('STATE','Дело не существует.',404);
  const s=structuredClone(previous),d=event.data??{};
  switch(event.type) {
    case 'action_chosen':
      if (!['hearing','revision','review','reopened'].includes(s.phase)) throw new DomainError('STATE','В этом состоянии нельзя выбрать действие.',409);
      if (!ACTIONS.some(a=>a.id===d.action)) throw new DomainError('VALIDATION','Неизвестное действие.');
      s.action=d.action; s.phase='revision'; break;
    case 'brief_prepared':
      if (s.phase!=='revision') throw new DomainError('STATE','Сначала выберите действие.',409);
      s.draft=validateDraft(d.draft);
      if (s.action==='evidence' && s.draft.evidence.length<10) throw new DomainError('VALIDATION','Опишите основание хотя бы в 10 символах. Ссылка сама по себе не доказательство.');
      s.candidates=candidates(s.draft,s.action); s.phase='review'; break;
    case 'claim_rewritten':
      if (s.phase!=='review') throw new DomainError('STATE','Сначала подготовьте варианты.',409);
      s.finalClaim=text(d.claim,'Итоговая фраза',5,1000);
      if (d.acknowledged!==true) throw new DomainError('ACK_REQUIRED','Подтвердите проверку фактов перед выпуском.');
      s.phase='ready'; break;
    case 'verdict_issued':
      if (s.phase!=='ready') throw new DomainError('STATE','Сначала утвердите новую формулировку.',409);
      s.phase='verdict'; s.verdictId=d.verdictId; break;
    case 'witness_objection':
      if (!['verdict','reopened'].includes(s.phase)) throw new DomainError('STATE','Этот приговор уже пересматривается.',409);
      if (s.verdictId!==d.verdictId) throw new DomainError('STALE_INVITE','Приговор изменился. Попросите новое приглашение.',409);
      s.objections.push({id:d.id,text:text(d.text,'Возражение',10,1000),createdAt:event.at,verdictId:d.verdictId}); break;
    case 'owner_reopen':
      if (s.phase!=='verdict') throw new DomainError('STATE','Пересмотр возможен после выпуска брифа.',409);
      s.phase='reopened'; break;
    case 'case_reopened':
      if (!['verdict','reopened'].includes(s.phase)) throw new DomainError('STATE','Нельзя открыть дело повторно.',409);
      s.phase='reopened'; break;
    case 'objection_defended':
      if (s.phase!=='reopened') throw new DomainError('STATE','Нет открытого возражения.',409);
      s.defenses.push({text:text(d.text,'Ответ',10,1000),createdAt:event.at}); s.phase='verdict'; break;
    case 'witness_invited':
    case 'invite_revoked':
    case 'handoff_created':
    case 'handoff_revoked':
    case 'handoff_redeemed':
    case 'useful_action':
    case 'ai_commentary':
    case 'comparison_started':
    case 'comparison_link_issued':
    case 'comparison_voted':
    case 'comparison_closed':
    case 'comparison_invalidated':
      break;
    default: throw new DomainError('EVENT','Неизвестный тип события.');
  }
  s.version=previous.version+1; s.updatedAt=event.at; return s;
}
export function replay(events) {
  return events.reduce((s,e)=>reduceEvent(s,e),null);
}
export function dialogue(state) {
  const a=ACTIONS.find(x=>x.id===state.action);
  const results=analyze(state.claim,state.draft);
  let lex=results.find(x=>x.tone==='warning')?.detail || 'Формальных сигналов немного. Теперь уточним, для кого и зачем существует эта фраза.';
  let aurora='Хорошая реклама не обязана быть скучной. Защитим идею, а не каждое исходное слово.';
  let witness='Я вижу обещание. Что конкретно изменится для меня?';
  if (a && ['revision','review'].includes(state.phase)) {lex=a.lex;aurora=a.aurora;witness=a.witness;}
  if (state.phase==='verdict') {lex='Формулировка зафиксирована. Факты всё ещё требуют вашей проверки. Печать — не машина истины.';aurora='Теперь у идеи есть форма. Следующий шаг — сделать рекламный материал и проверить его на реальной аудитории.';witness='Я могу прочитать предложение. Готов ли я действовать? Это уже вопрос настоящего теста.';}
  if (state.phase==='reopened') {lex='Поступило настоящее возражение. Ваш друг нашёл повод не закрывать дело. Уважаю.';aurora='Возражение не отменяет идею. Можно уточнить её или объяснить свой выбор.';witness=state.objections.at(-1)?.text || 'Нужно повторное рассмотрение.';}
  return [{role:'lex',name:'Лекс',job:'Обвинение',text:lex},{role:'aurora',name:'Аврора',job:'Защита',text:aurora},{role:'witness',name:'Свидетель 404',job:'Взгляд покупателя',text:witness}];
}
export function makeBrief(s) {
  if (!s.finalClaim) throw new DomainError('STATE','Итоговый текст ещё не выбран.',409);
  return {schemaVersion:'judge-brief-1',caseId:s.id,verdictId:s.verdictId,product:s.draft.product,audience:s.draft.audience,originalClaim:s.claim,finalClaim:s.finalClaim,declaredFact:s.draft.fact,desiredAction:s.draft.cta,evidence:{text:s.draft.evidence??'',source:s.draft.source??'',status:'user_supplied_unverified'},risks:analyze(s.finalClaim,s.draft).filter(x=>x.tone==='warning').map(x=>x.detail),disclaimer:'Редакторский бриф. Не юридическое заключение и не прогноз эффективности рекламы.',rulesVersion:s.rulesVersion};
}
export function briefText(s) {
  const b=makeBrief(s);
  return `JUDGE / ADVERSE\nРЕДАКТОРСКИЙ БРИФ\n\nПродукт: ${b.product}\nАудитория: ${b.audience}\n\nИсходная фраза:\n${b.originalClaim}\n\nНовая формулировка:\n${b.finalClaim}\n\nДействие: ${b.desiredAction}\n\nЗаявленный факт: ${b.declaredFact}\nОснование: ${b.evidence.text || 'Не приложено'}\nИсточник: ${b.evidence.source || 'Не указан'}\nСтатус: со слов автора, независимо не проверено.\n\n${b.risks.length?'Проверить:\n'+b.risks.map(x=>'- '+x).join('\n')+'\n\n':''}${b.disclaimer}\n`;
}
/** Funnel measures observed server-side events, not claimed ad performance or page views. */
export function funnelFromEvents(rows,now=new Date()) {
  const stages=[
    ['case_created','Открыто дел'],['action_chosen','Выбрана защита'],
    ['brief_prepared','Собраны варианты'],['verdict_issued','Бриф зафиксирован'],
    ['handoff_created','Передача подготовлена'],['handoff_redeemed','Передача получена'],
    ['useful_action','Действие подтверждено платформой']
  ];
  const sets=new Map(stages.map(([key])=>[key,new Set()]));
  const social=new Map(['witness_invited','witness_objection','owner_reopen','case_reopened'].map(x=>[x,new Set()]));
  const daily=new Map();
  for(const row of rows) {
    if(typeof row.case_id!=='string'||typeof row.type!=='string')continue;
    sets.get(row.type)?.add(row.case_id);
    social.get(row.type)?.add(row.case_id);
    const day=typeof row.at==='string'?row.at.slice(0,10):'';
    if(/^\d{4}-\d{2}-\d{2}$/.test(day)){
      if(!daily.has(day))daily.set(day,{day,events:0,newCases:0,verdicts:0});
      const cell=daily.get(day);cell.events++;
      if(row.type==='case_created')cell.newCases++;
      if(row.type==='verdict_issued')cell.verdicts++;
    }
  }
  const size=key=>sets.get(key)?.size??0;
  const base=size('case_created');
  const funnel=stages.map(([key,label],i)=>({key,label,count:size(key),rate:base?Math.round(size(key)*1000/base)/10:0,kind:key==='useful_action'?'externally_confirmed':'internal_event'}));
  const timestamp=now instanceof Date?now:new Date(now);
  const series=[];
  for(let i=13;i>=0;i--){const day=new Date(timestamp.getTime()-i*86400000).toISOString().slice(0,10);series.push(daily.get(day)??{day,events:0,newCases:0,verdicts:0});}
  return {definition:'unique_cases_with_event',funnel,social:{invited:social.get('witness_invited').size,objected:social.get('witness_objection').size,ownerReopened:social.get('owner_reopen').size,witnessReopened:social.get('case_reopened').size},series,eventsTotal:rows.length,disclaimer:'Считаются реальные события JUDGE. Копирование не равно доставке. Подтверждение платформы не равно рекламной эффективности.'};
}
/** Lexical comparison only; a decrease in signals never proves legality or quality. */
export function comparison(original,finalClaim,draft={}) {
  const before=analyze(original,draft),after=analyze(finalClaim??original,draft);
  const caution=entries=>entries.filter(x=>x.tone==='warning');
  return {before:caution(before),after:caution(after),resolved:caution(before).filter(x=>!caution(after).some(y=>y.id===x.id)),newWarnings:caution(after).filter(x=>!caution(before).some(y=>y.id===x.id)),disclaimer:'Сравнение по ограниченным словарным правилам. Отсутствие сигнала не означает, что утверждение проверено.'};
}
export const EVENT_NAMES={owner_reopen:'Автор открыл повторный редакторский пересмотр',case_created:'Дело открыто',action_chosen:'Выбран способ защиты',brief_prepared:'Подготовлены варианты',claim_rewritten:'Фраза переписана',verdict_issued:'Вынесен редакторский вердикт',witness_invited:'Создано приглашение',witness_objection:'Получено возражение свидетеля',case_reopened:'Дело открыто повторно',objection_defended:'Защита ответила',invite_revoked:'Приглашение отозвано',handoff_created:'Подготовлена передача брифа',handoff_revoked:'Передача отозвана автором',handoff_redeemed:'Платформа получила бриф',useful_action:'Платформа подтвердила действие',ai_commentary:'Получен комментарий ИИ',comparison_started:'Создан слепой тест формулировок',comparison_link_issued:'Выдана ссылка участнику теста',comparison_voted:'Получен выбор участника теста',comparison_closed:'Слепой тест закрыт',comparison_invalidated:'Тест остановлен из-за пересмотра вердикта'};