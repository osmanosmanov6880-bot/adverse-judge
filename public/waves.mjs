/** ADVERSE JUDGE v0.30, WAVE 21–25. All displays bind to actual server facts.
 * Autonomous preview never simulates remote delivery or account verification. */
export function makeFiveWaves({client,esc,B,I,shell,heading,showModal,closeModal,toast,navigate,boot}){
 const e=esc;let current=null,account=null,imports=null,delivery=null,ops=null,advanced=null,preview=null;
 const link=(cid,extra='')=>`#/next/${e(cid)}${extra}`;
 const stamp=x=>x?new Date(x).toLocaleString('ru-RU'):'—';
 const small=(x)=>String(x??'').slice(0,8);
 const block=(n,name,subtitle,inner)=>`<section id="next-wave-${n}" class="card next-card"><div class="next-head"><div><span class="eyebrow">WAVE ${n} / ADVERSE</span><h2>${e(name)}</h2><p class="panel-sub">${e(subtitle)}</p></div><div class="next-numeral">${n}</div></div>${inner}</section>`;
 const options=(items)=>items.map(x=>`<option value="${e(x.id)}">v${e(x.revision)} · ${e(small(x.id))}</option>`).join('');
 async function detail(cid){
  if(boot()?.mode==='preview'){
   shell(`${heading('Пять новых волн — 0.30.0','Этот экран доступен с серверным хранилищем и настоящими учётными записями.')}<section class="card"><h2>Что вошло в релиз</h2><p>Подтверждение email, история креативов, CSV-отчёты, очередь доставки и операционная диагностика.</p><p class="notice">Автономное демо не отправляет письма, не собирает отчёты и не утверждает подключений к партнёрам.</p><a href="#/campaigns" class="btn primary">К кампаниям</a></section>`,'WAVE 21–25','campaigns');return;
  }
  [current,advanced,imports,delivery,account]=await Promise.all([
   client.request('/production/campaigns/'+cid),client.request('/ops/campaigns/'+cid),client.request('/imports/campaigns/'+cid),client.request('/delivery/campaigns/'+cid),client.request('/auth/identity')
  ]);
  ops=await client.request('/ops/workspaces/'+current.campaign.workspaceId);
  const c=current.campaign,r=current.releases||[],owner=c.role==='owner',edit=c.role!=='viewer';
  const reSelect=r.length?`<select name="releaseId" required>${options(r)}</select>`:'<p class="source-note">Для операций сначала выпустите редакторски согласованный пакет.</p>';
  const w21=block(21,'Подтверждение аккаунта','Письмо с одноразовым кодом, доказательство владения адресом и безопасное восстановление доступа.',`
   <div class="next-kpis"><div><small>Адрес</small><strong>${e(account.email||'Нет аккаунта')}</strong></div><div><small>Статус</small><strong>${account.verified?'Подтверждён':'Не подтверждён'}</strong></div><div><small>Почтовый провайдер</small><strong>${account.deliveryAvailable?'Настроен':'Не настроен'}</strong></div></div>
   <p class="source-note">${account.deliveryAvailable?'Код приходит через настроенный оператором почтовый транспорт.':'Для реальных писем администратору нужно настроить защищённый почтовый webhook; тестовые коды не публикуются в кабинете.'}</p>
   <div class="button-row">${!account.verified?B('Отправить код','next-verify-request','ghost',account.deliveryAvailable?'':'disabled'):''}${!account.verified?B('Ввести код','next-verify-confirm','ghost'):''}</div>`);
  const w22=block(22,'Версии и восстановление креативов','Посмотрите, как текст изменился после утверждённого выпуска. Восстановление создаёт только новый черновик, не новое одобрение.',`
   <div class="next-kpis"><div><small>Текущая редакция</small><strong>v${c.revision}</strong></div><div><small>Выпущенные пакеты</small><strong>${r.length}</strong></div><div><small>Одобрение</small><strong>${e(c.status)}</strong></div></div>
   ${r.length?`<form id="next-version-form" class="next-form"><label>Выберите исторический пакет</label>${reSelect}<button class="btn ghost" type="submit">Сравнить редакции</button></form>`:''}
   <p class="source-note">Если в исходном деле поменялся вердикт или отозван доступ к нему, восстановление будет запрещено.</p>`);
  const csvDemo=`date,spend_minor,impressions,clicks,leads,currency,note\n2026-10-20,12500,8000,350,18,EUR,Manual export from campaign manager`;
  const w23=block(23,'Импорт фактических метрик','Покажем предпросмотр, проверим арифметику, валюту, дату и дубликаты. Никакой «подтверждённой» рекламной аналитики из CSV не возникает.',`
   ${edit&&r.length?`<form id="next-csv-form" class="next-form"><label>Пакет рекламы, к которому относятся цифры</label>${reSelect}<label>Название источника</label><input name="sourceName" minlength="3" maxlength="120" required value="Manual campaign CSV"><label>CSV · точные колонки: date,spend_minor,impressions,clicks,leads,currency,note</label><textarea name="csv" rows="5" required maxlength="24000" spellcheck="false">${e(csvDemo)}</textarea><button class="btn primary" type="submit">Проверить CSV до импорта</button></form>`:'<p class="source-note">Нужны редакторские права и хотя бы один выпущенный пакет.</p>'}
   <div class="next-list">${imports.batches.length?imports.batches.map(b=>`<article><strong>${e(b.sourceName)}</strong><small>${b.rowCount} строк · ${stamp(b.createdAt)} · ${e(small(b.digest))}</small></article>`).join(''):'<p class="source-note">Массовых загрузок ещё не было.</p>'}</div>`);
  const partners=(boot()?.platforms||[]).filter(p=>p.configured&&p.mode==='api');
  const pending=delivery.deliveries||[];
  const w24=block(24,'Очередь доставки партнёру','Сервер отправляет согласованный пакет только проверенному получателю. Повторы используют один идентификатор; HTTP-приём не считается публикацией рекламы.',`
   <div class="next-kpis"><div><small>Подготовленных API-партнёров</small><strong>${partners.length}</strong></div><div><small>Задач доставки</small><strong>${pending.length}</strong></div><div><small>Подтверждено созданий рекламы</small><strong>Не выводим из HTTP</strong></div></div>
   ${edit&&partners.length&&r.length?`<form id="next-delivery-form" class="next-form"><label>Подтверждённая API-платформа</label><select name="platformId">${partners.map(x=>`<option value="${e(x.id)}">${e(x.name)}</option>`).join('')}</select><label>Выпущенный пакет</label>${reSelect}<label class="checkbox"><input type="checkbox" name="consent" required> <span>Понимаю, что пакет будет отправлен внешней платформе</span></label><button class="btn primary" type="submit">Создать задание доставки</button></form>`:'<p class="notice">Реальные платформы A–G ещё не настроены для API. Очередь работает с тестовым получателем; отправка в реальные сайты невозможна без их проверенных контрактов.</p>'}
   <div class="next-list">${pending.length?pending.map(q=>`<article><strong>${e(q.platformId)} · ${e(q.status)}</strong><small>Попытки: ${q.attempts} · ${e(q.lastError||'нет ошибки')} · ${stamp(q.createdAt)}</small>${owner&&['queued','retry'].includes(q.status)?B('Повторить отправку','next-delivery-attempt','small ghost',`data-id="${e(q.id)}"`):''}</article>`).join(''):'<p class="source-note">Очередь пуста.</p>'}</div>`);
  const w25=block(25,'Операционная готовность','Показывает реальные блокировки — без накручивания статуса «production». Общий технический отчёт выпускается отдельно операторской командой.',`
   <div class="next-kpis"><div><small>Кампаний в команде</small><strong>${ops.campaigns}</strong></div><div><small>С блокировками</small><strong>${ops.blockedCampaigns}</strong></div><div><small>Ожидают отправки</small><strong>${ops.pendingDeliveries}</strong></div></div>
   <div class="notice amber"><strong>Production не подтверждён</strong><p>Нужны реальная платформа, независимый аудит, производственное хранение и бэкапы. Успешный локальный тест не заменяет эти требования.</p></div>
   <a class="btn ghost" href="#/governance/${e(cid)}">Просмотреть риски кампании ${I('arrow')}</a>`);
  shell(`${heading('Центр развития · WAVE 21–25','Пять связанных функций для управления жизненным циклом рекламной кампании.',`<a class="btn ghost" href="#/campaign/${e(cid)}">${I('back')} К кампании</a>`)}<div class="next-topline"><span class="eyebrow">ADVERSE / RELEASE RELIABILITY</span><h2>${e(c.name)}</h2><p>v${c.revision} · ${e(c.status)} · ${r.length} выпусков · ${ops.pendingDeliveries} задач доставки</p><div class="next-jump">${[21,22,23,24,25].map(n=>`<a href="#next-wave-${n}" data-action="next-scroll" data-target="next-wave-${n}">WAVE ${n}</a>`).join('')}</div></div><div class="next-grid">${w21}${w22}${w23}${w24}${w25}</div>`,'Надёжный выпуск','campaigns');
 }
 async function action(name,button){
  if(!name.startsWith('next-'))return false;
  const cid=current?.campaign?.id;
  if(name==='next-scroll'){document.querySelector('#'+button.dataset.target)?.scrollIntoView({behavior:'smooth',block:'start'});return true;}
  if(name==='next-verify-request'){await client.request('/auth/verify/request',{method:'POST',body:{}});toast('Код отправлен на зарегистрированный email.');return true;}
  if(name==='next-verify-confirm'){showModal('Подтвердить email',`<form id="next-verify-code-form" class="next-form"><p>Вставьте одноразовый код из письма. Он действует 30 минут и используется один раз.</p><label>Код подтверждения</label><input name="code" required autocomplete="one-time-code" maxlength="100"><div class="inline-error" hidden role="alert"></div><button class="btn primary full" type="submit">Подтвердить адрес</button></form>`);return true;}
  if(name==='next-compare-restore'){
   if(!preview?.canRestore){toast('Для этой версии восстановление недоступно: источник устарел или содержит несколько брифов.');return true;}
   await client.request(`/revisions/campaigns/${cid}/${preview.releaseId}/restore`,{method:'POST',body:{expectedRevision:current.campaign.revision,acknowledged:true}});
   closeModal();await detail(cid);toast('Исторический текст восстановлен как новый ЧЕРНОВИК. Согласование требуется заново.');return true;
  }
  if(name==='next-csv-commit'){
   if(!preview?.rows)throw Error('Нет предварительно проверенного CSV.');
   const r=await client.request('/imports/campaigns/'+cid+'/commit',{method:'POST',body:{...preview.input,digest:preview.digest,expectedRevision:current.campaign.revision,acknowledged:true}});
   closeModal();await detail(cid);toast(r.duplicate?'Такой отчёт уже загружен.':'Импортировано '+r.rowCount+' наблюдений с пометкой «ручные данные».');return true;
  }
  if(name==='next-delivery-attempt'){
   const r=await client.request(`/delivery/campaigns/${cid}/attempt/${button.dataset.id}`,{method:'POST',body:{}});
   await detail(cid);toast(r.partnerAccepted?'Партнёр принял пакет. Подтверждение рекламного действия ожидается.':'Статус: '+r.status);return true;
  }
  return true;
 }
 async function submit(form,d){
  if(!form.id.startsWith('next-'))return false;
  const cid=current?.campaign?.id;
  if(form.id==='next-verify-code-form'){await client.request('/auth/verify/confirm',{method:'POST',body:{code:d.code}});closeModal();await detail(cid);toast('Email подтверждён.');return true;}
  if(form.id==='next-version-form'){
   const result=await client.request(`/revisions/campaigns/${cid}/${d.releaseId}`);preview=result;
   showModal('Сравнение редакций',`<div class="next-compare"><p>Выпуск v${result.releaseRevision} → текущая v${result.currentRevision}.</p><p><strong>Добавлено:</strong> ${result.added.length} · <strong>Удалено:</strong> ${result.removed.length} · <strong>Без изменений:</strong> ${result.unchanged}</p><p><strong>Исходные брифы актуальны:</strong> ${result.briefStatuses.every(x=>x.stillCurrent)?'Да':'Нет'}</p><p class="source-note">Восстановление не переносит прежнее одобрение и доказательства на новый черновик.</p><div class="inline-error" hidden role="alert"></div>${result.canRestore?B('Восстановить текст в новый черновик','next-compare-restore','primary full'):'<p class="notice amber">Нельзя восстановить: исходный бриф устарел, исчез или неоднозначен.</p>'}</div>`);return true;
  }
  if(form.id==='next-csv-form'){
   const input={releaseId:d.releaseId,csv:d.csv,sourceName:d.sourceName};const result=await client.request('/imports/campaigns/'+cid+'/preview',{method:'POST',body:input});preview={...result,input};
   showModal('Предварительная проверка CSV',`<div class="next-compare"><p>Получено строк: <strong>${result.rows.length}</strong>.</p><p>SHA-256 пакета: <small class="mono">${e(result.digest)}</small></p>${result.totals.map(t=>`<p>${e(t.currency)} · ${t.impressions} показов · ${t.clicks} кликов · ${t.leads} лидов · ${(t.spendMinor/100).toFixed(2)} затрат</p>`).join('')}<p class="source-note">Это ручная выгрузка. JUDGE не проверял истинность цифр и не измерял продажи.</p>${result.alreadyImported?'<p class="notice">Эта загрузка уже зарегистрирована.</p>':B('Подтвердить импорт','next-csv-commit','primary full')}</div>`);return true;
  }
  if(form.id==='next-delivery-form'){
   const result=await client.request('/ops/campaigns/'+cid+'/dispatch',{method:'POST',body:{releaseId:d.releaseId,platformId:d.platformId,consent:d.consent==='on'}});
   await client.request('/delivery/campaigns/'+cid+'/queue',{method:'POST',body:{dispatchId:result.dispatchId}});
   await detail(cid);toast('Задание доставки создано. Это ещё не доставка и не публикация.');return true;
  }
  return false;
 }
 return {detail,action,submit};
}
