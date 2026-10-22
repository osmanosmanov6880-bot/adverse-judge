/** Waves 11–15: actual server-backed operational workbench. */
export function makeAdvanced({client,esc,B,I,shell,heading,showModal,closeModal,toast,download,navigate,boot,getLocale}) {
 const e=esc;let record=null;
 const api=(cid,action,body)=>client.request('/ops/campaigns/'+cid+'/'+action,{method:'POST',body});
 const channels=['search','social','email'],langs=['ru','en','zh'];
 const uString=(v)=>v===null||v===undefined?'—':String(v);
 const tabs=[['brand','11','Бренд'],['locale','12','Языки'],['quality','13','Контроль'],['dispatch','14','Передача'],['measure','15','Результаты']];
 const card=(wave,title,subtitle,body)=>`<section class="card ops-card" id="wave-${wave}"><span class="eyebrow">WAVE ${wave} / PRODUCTION CONTROL</span><h2>${e(title)}</h2><p class="panel-sub">${e(subtitle)}</p>${body}</section>`;
 const formInput=(key,label,type='text',value='',attr='')=>`<label for="ops-${e(key)}">${e(label)}</label><input id="ops-${e(key)}" name="${e(key)}" type="${e(type)}" value="${e(value)}" ${attr}>`;
 const notReady=()=>boot()?.mode==='preview';
 async function detail(cid){
  if(notReady()) {shell(`${heading('Контроль выпуска','Для реальных проверок нужен запущенный сервер JUDGE.')}<section class="card"><h3>Автономная демонстрация</h3><p>Здесь доступны только сценарные дела. Данные брендов, согласование, интеграции и измерения не подменяются фиктивными ответами.</p><a class="btn primary" href="#/campaigns">К кампаниям</a></section>`,'Контроль выпуска','campaigns');return;}
  record=await client.request('/ops/campaigns/'+cid);
  const p=record,edit=p.role!=='viewer',brand=p.brand,quality=p.quality?.revision===p.revision?p.quality:null;
  const brandOptions=p.brands.map(b=>`<option value="${e(b.id)}" ${brand?.id===b.id?'selected':''}>${e(b.name)} · v${b.version}</option>`).join('');
  const matrix=channels.map(ch=>`<div class="ops-locale-row"><strong>${e(ch)}</strong>${langs.map(l=>`<label class="ops-locale-item"><input type="checkbox" name="target" value="${ch}:${l}" ${p.targets.some(t=>t.channel===ch&&t.language===l)?'checked':''} ${edit?'':'disabled'}><span>${e(l.toUpperCase())}</span></label>`).join('')}</div>`).join('');
  const flags=p.qaGate.map(x=>`<div class="campaign-check">${I('alert')} ${e(x)}</div>`).join('');
  const rows=p.measurements.observations||[];
  const overview=`${heading('Центр качества и выпуска','Пять волн: правила бренда → форматы → аудит → подписанная передача → реальные наблюдения.',`<div class="button-row"><a class="btn ghost" href="#/campaign/${e(cid)}">${I('back')} Назад к кампании</a><a class="btn primary" href="#/governance/${e(cid)}">${I('shield')} Контроль рисков · WAVE 16–20</a></div>`)}<div class="ops-top"><span class="pill">v${p.revision}</span><span class="pill">${e(p.role)}</span><span class="pill">${p.qaGate.length?'Требуются проверки':'Проверки готовы'}</span></div><nav class="ops-jump" aria-label="Пять волн">${tabs.map(([key,n,title])=>`<button type="button" data-action="ops-jump" data-target="wave-${n}"><small>${n}</small>${e(title)}</button>`).join('')}</nav>`;
  const brandSection=card(11,'Бренд-правила','Правила принадлежат рабочему пространству. Обновление бренда делает старые согласования кампании неактуальными.',`
    <p><strong>Текущая политика:</strong> ${e(brand?.name||'Не назначена')} ${brand?`· v${brand.version}`:''}</p>
    ${brand?`<p class="source-note">Тон: ${e(brand.voice)}</p><p class="source-note">Запрещено: ${e(brand.forbiddenTerms.join(', ')||'—')} · Обязательно: ${e(brand.requiredTerms.join(', ')||'—')}</p>`:''}
    ${edit?`<form id="ops-brand-assign-form" class="ops-inline"><label for="ops-brand-select">Бренд этой кампании</label><select id="ops-brand-select" name="brandId"><option value="">Без бренд-политики</option>${brandOptions}</select><button class="btn primary" type="submit">Применить</button></form>`:''}
    <div class="button-row">${p.role==='owner'?B(I('plus')+' Создать бренд','ops-brand-create','ghost'):''}${p.role==='owner'&&brand?B('Изменить правила','ops-brand-edit','ghost'):''}</div>`);
  const localeSection=card(12,'Матрица языков и каналов','Отмеченные пары становятся обязательными для выпуска. Перевод и адаптация выполняются человеком; фиктивная локализация не создаётся.',`
    <form id="ops-targets-form" class="studio-form"><div class="ops-locale">${matrix}</div>${edit?'<button class="btn primary" type="submit">Сохранить целевые форматы</button>':''}</form>
    <p class="source-note">При отсутствии выбранных форматов JUDGE сохраняет прежние правила выпуска.</p>`);
  const qualitySection=card(13,'Creative QA — детерминированный аудит','Проверка запретных и обязательных формулировок, языкового покрытия и рискованных абсолютных заявлений. Не юридическое заключение.',`
    <div class="ops-stats"><div><small>Редакция</small><strong>${quality?'v'+quality.revision:'—'}</strong></div><div><small>Блокеры</small><strong>${quality?quality.findings.filter(x=>x.severity==='blocker').length:'—'}</strong></div><div><small>Предупреждения</small><strong>${quality?quality.findings.filter(x=>x.severity==='warning').length:'—'}</strong></div></div>
    ${quality?`<p class="pill ${quality.passed?'green':'amber'}">${quality.passed?'Сканирование пройдено':'Найдены блокирующие правила'}</p><div class="ops-findings">${quality.findings.map(x=>`<div class="campaign-check ${x.severity==='warning'?'good':''}"><strong>${e(x.severity.toUpperCase())}</strong> ${e(x.code)} ${x.target?e(x.target):''} ${x.term?'«'+e(x.term)+'»':''}</div>`).join('')||'<p class="source-note">Блокирующих проблем не найдено. Семантическая и юридическая проверка всё ещё нужна.</p>'}</div>`:'<p class="notice amber">Для этой редакции аудит ещё не выполнялся.</p>'}
    ${flags?`<div class="ops-checklist">${flags}</div>`:''}
    ${edit?B(I('shield')+' Запустить аудит','ops-scan','primary'):''}
    <p class="source-note">Отчёт привязан к версии кампании и хешу исходных материалов. После правок запустите проверку снова.</p>`);
  const options=p.platforms.filter(x=>x.configured).map(x=>`<option value="${e(x.id)}">${e(x.name)}</option>`).join('');
  const dispatchSection=card(14,'Подписанная передача партнёру','Передача доступна лишь после согласованного контракта. Только аутентифицированный ответ партнёра меняет статус на «подтверждено».',`
    <div class="notice ${options?'':'amber'}">Подготовлено конфигураций: <strong>${p.platforms.filter(x=>x.configured).length}/${p.platforms.length}</strong>. ${options?'Можно выдать один токен на конкретный выпуск.':'Реальные сайты ещё не сконфигурированы: токены недоступны.'}</div>
    ${edit&&options&&p.releases.length?`<form id="ops-dispatch-form" class="studio-form">${formInput('releaseId','ID пакета выпуска','hidden',p.releases[0].id)}<label>Рекламная платформа</label><select name="platformId">${options}</select><label class="checkbox"><input type="checkbox" name="consent" required>Разрешаю передачу утверждённого пакета указанному партнёру.</label><button class="btn primary" type="submit">Выдать подписанную передачу</button></form>`:''}
    <div class="ops-list">${p.dispatches.length?p.dispatches.map(x=>`<article class="ops-activity"><div><strong>${e(x.platformId)} / ${e(x.status)}</strong><small>${e(x.releaseId.slice(0,8))} · ${e(new Date(x.createdAt).toLocaleString())}</small></div>${edit&&x.status==='issued'?B('Отозвать','ops-dispatch-revoke','small ghost',`data-id="${e(x.id)}"`):''}</article>`).join(''):'<p class="source-note">История передач пуста. Ручной экспорт JSON не считается доставкой.</p>'}</div>`);
  const totals=p.measurements.totals.map(x=>`<div class="ops-statline"><strong>${e(x.currency)}</strong><span>${x.impressions.toLocaleString('ru-RU')} показов</span><span>${x.clicks.toLocaleString('ru-RU')} кликов</span><span>CTR ${x.ctrPercent==null?'—':x.ctrPercent+'%'}</span><span>${x.leads} заявок</span><span>${(x.spendMinor/100).toFixed(2)} ${e(x.currency)}</span></div>`).join('');
  const measureSection=card(15,'Наблюдения и отчётность','Только введённые пользователем показатели. Источник — ручной ввод; связь с продажами, эффективность и атрибуция не выводятся автоматически.',`
    <div class="ops-totals">${totals||'<p class="source-note">Наблюдений ещё нет.</p>'}</div>
    ${edit&&p.releases.length?`<form id="ops-observation-form" class="studio-form"><label>Пакет выпуска</label><select name="releaseId">${p.releases.map(r=>`<option value="${e(r.id)}">v${r.revision} · ${e(r.digest.slice(0,12))}</option>`).join('')}</select><div class="ops-measure-form">${formInput('date','Дата наблюдения','date',new Date().toISOString().slice(0,10),'required')}${formInput('spendMinor','Затраты в сотых долях валюты','number',0,'min="0" step="1" required')}${formInput('impressions','Показы','number',0,'min="0" step="1" required')}${formInput('clicks','Клики','number',0,'min="0" step="1" required')}${formInput('leads','Заявки','number',0,'min="0" step="1" required')}<label>Валюта</label><select name="currency"><option>EUR</option><option>USD</option><option>SEK</option><option>GBP</option></select></div><label>Откуда получены цифры</label><textarea name="note" required minlength="12" maxlength="500" placeholder="Из какого отчёта, для какого периода; ограничение качества данных"></textarea><button class="btn primary" type="submit">Записать наблюдение</button></form>`:''}
    <div class="ops-list">${rows.slice(0,50).map(r=>`<article class="ops-activity"><div><strong>${e(r.date)} · ${e(r.currency)} · ${r.clicks} кликов</strong><small>${e(r.source)} · ${e(r.note)}${r.retractedAt?' · ОТОЗВАНО: '+e(r.retractionNote):''}</small></div>${edit&&!r.retractedAt?B('Исправить запись','ops-retract','small ghost',`data-id="${e(r.id)}"`):''}</article>`).join('')}</div>`);
  shell(`${overview}<div class="ops-stack">${brandSection}${localeSection}${qualitySection}${dispatchSection}${measureSection}</div><section class="card"><strong>Прозрачность</strong><p class="source-note">JUDGE 0.20 — локальный пилот. Бренд-правила — редактируемые нормы команды; автоматический анализ может пропускать нарушения. Подписанные передачи проверены только с тестовым партнёром. Ручные показатели не проходят внешнюю верификацию.</p></section>`,'Центр выпуска','campaigns');
 }
 async function action(name,b){
  if(!name.startsWith('ops-'))return false;if(!record)return true;
  const cid=record.campaignId,br=record.brand;
  if(name==='ops-jump'){document.getElementById(b.dataset.target)?.scrollIntoView({behavior:'smooth',block:'start'});return true;}
  if(name==='ops-scan'){await api(cid,'audit',{});await detail(cid);toast('Отчёт качества сохранён для текущей редакции.');return true;}
  if(name==='ops-brand-create'||name==='ops-brand-edit'){
   const updating=name==='ops-brand-edit'&&br;
   showModal(updating?'Редактировать бренд':'Новый бренд',`<form id="ops-brand-form" class="studio-form" data-update="${updating?'yes':'no'}"><label>Название бренда</label><input name="name" required minlength="3" maxlength="100" value="${e(updating?br.name:'')}"><label>Тональность и голос бренда</label><textarea name="voice" required minlength="10" maxlength="500">${e(updating?br.voice:'')}</textarea><label>Запрещённые фразы (каждая с новой строки)</label><textarea name="forbiddenTerms" maxlength="740">${e(updating?br.forbiddenTerms.join('\n'):'')}</textarea><label>Обязательные фразы (каждая с новой строки)</label><textarea name="requiredTerms" maxlength="740">${e(updating?br.requiredTerms.join('\n'):'')}</textarea><p class="source-note">Изменение бренд-правил делает прежние согласования устаревшими.</p><button class="btn primary full" type="submit">Сохранить бренд</button></form>`);return true;
  }
  if(name==='ops-dispatch-revoke'){showModal('Отозвать передачу?',`<p>Можно отозвать только ещё не полученную партнёром передачу.</p>${B('Подтвердить отзыв','ops-dispatch-confirm','danger full',`data-id="${e(b.dataset.id)}"`)}`);return true;}
  if(name==='ops-dispatch-confirm'){await api(cid,'dispatch-revoke',{dispatchId:b.dataset.id});closeModal();await detail(cid);return true;}
  if(name==='ops-retract'){showModal('Исправить ошибочный отчёт',`<form id="ops-retract-form" data-id="${e(b.dataset.id)}"><p>Старая запись сохранится как отозванная. Для исправления добавьте новую запись отдельно.</p><label>Причина</label><textarea name="note" required minlength="10" maxlength="500"></textarea><button class="btn danger full" type="submit">Отозвать запись</button></form>`);return true;}
  return true;
 }
 async function submit(form,d){
  if(!form.id.startsWith('ops-'))return false;
  const cid=record.campaignId,revision=record.revision;
  if(form.id==='ops-brand-form'){
   const split=s=>s.split('\n').map(x=>x.trim()).filter(Boolean);
   const body={name:d.name,voice:d.voice,forbiddenTerms:split(d.forbiddenTerms||''),requiredTerms:split(d.requiredTerms||'')};
   if(form.dataset.update==='yes'&&record.brand){body.id=record.brand.id;body.expectedVersion=record.brand.version;}
   await client.request(`/ops/workspaces/${record.workspaceId}/brands`,{method:'POST',body});
  }
  if(form.id==='ops-brand-assign-form')await api(cid,'brand',{expectedRevision:revision,brandId:d.brandId||null});
  if(form.id==='ops-targets-form'){
   const targets=new FormData(form).getAll('target').map(x=>{const [channel,language]=x.split(':');return {channel,language};});
   await api(cid,'targets',{expectedRevision:revision,targets});
  }
  if(form.id==='ops-dispatch-form'){
   const ticket=await api(cid,'dispatch',{releaseId:d.releaseId,platformId:d.platformId,consent:d.consent==='on'});
   showModal('Подписанная передача создана',`<p>Только сервер указанной платформы с верными учётными данными может получить этот пакет. Не пересылайте ключ широкой аудитории.</p><textarea class="link-box" readonly>${e(ticket.token)}</textarea><p class="source-note">Передача подготовлена, но ещё не получена и не подтверждена.</p>`);
   await detail(cid);return true;
  }
  if(form.id==='ops-observation-form'){
   const body={...d,spendMinor:Number(d.spendMinor),impressions:Number(d.impressions),clicks:Number(d.clicks),leads:Number(d.leads)};
   await api(cid,'observation',body);
  }
  if(form.id==='ops-retract-form')await api(cid,'observation-retract',{observationId:form.dataset.id,note:d.note});
  closeModal();await detail(cid);toast('Изменение сохранено.');return true;
 }
 return {detail,action,submit};
}
