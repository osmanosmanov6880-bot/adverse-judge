/** Team workspaces and evidence-first study dashboard. Production routes require server. */
export function makeStudio({client,esc,B,I,shell,heading,showModal,closeModal,toast,copy,download,navigate,render,boot,caseDetail}){
 const e=esc;
 const unavailable=()=>boot()?.mode==='preview';
 const serverNotice=()=>'<section class="card"><h2>Доступно в серверной сборке</h2><p>Командные пространства и исследования доступны после запуска Node.js. HTML-превью не передаёт данные другим пользователям.</p><a class="btn primary" href="#/">К первому делу</a></section>';
 function labelRole(role){return {owner:'Владелец',reviewer:'Редактор',viewer:'Наблюдатель'}[role]||role;}
 function fmtDate(d){return new Date(d).toLocaleString('ru-RU',{day:'2-digit',month:'short',year:'numeric'});}
 function empty(text){return `<p class="notice">${e(text)}</p>`;}
 async function listWorkspaces(){
  if(unavailable()){shell(heading('Командные пространства','Подготовка совместной работы')+serverNotice(),'Команды','workspaces');return;}
  const {workspaces}=await client.request('/workspaces');
  shell(`${heading('Командные пространства','Обсуждайте рекламные решения без раскрытия личных дел.',B(I('plus')+' Новое пространство','studio-workspace-new','primary'))}
   <section class="studio-hero"><div><span class="eyebrow">COLLABORATION / 01</span><h2>Коллективная ясность.<br>Без хаоса в документах.</h2><p>Владелец дела выбирает, какие материалы открыть команде. Редакторы оставляют замечания, но не меняют авторский журнал.</p></div><div class="studio-deco">W<span>01—07</span></div></section>
   <div class="studio-grid">${workspaces.length?workspaces.map(w=>`<a class="studio-item card" href="#/workspace/${e(w.id)}"><span class="eyebrow">${e(labelRole(w.role))}</span><h3>${e(w.name)}</h3><p>${w.memberCount} участников · ${w.caseCount} общих дел</p><span class="studio-arrow">Открыть пространство ${I('arrow')}</span></a>`).join(''):empty('Пока нет командных пространств. Создайте первое для совместного анализа.')}</div>
   <section class="card"><h3>Как защищены данные</h3><p>Создание команды не публикует все ваши дела. Доступ появляется только после явного действия «Поделиться с командой». Приглашения одноразовые и имеют срок действия.</p></section>`,'Команды','workspaces');
 }
 async function workspace(id){
  if(unavailable())return listWorkspaces();
  const w=await client.request('/workspaces/'+id);
  const canReview=w.role!=='viewer',owner=w.role==='owner';
  shell(`${heading(e(w.name),`Рабочее пространство · ${labelRole(w.role)}`,`<a href="#/workspaces" class="btn ghost">${I('back')} Все команды</a>`)}
   <div class="studio-tabs"><span class="pill">${w.members.length} участников</span><span class="pill">${w.cases.length} общих дел</span><span class="pill">${w.reviews.length} комментариев</span></div>
   <div class="studio-columns"><section class="card"><div class="section-head"><div><h3>Опубликованные дела</h3><p>Только то, чем поделились авторы.</p></div></div>
    ${w.cases.length?w.cases.map(c=>`<article class="studio-case"><strong>${e(c.state.finalClaim||c.state.claim)}</strong><small>Обновлено: ${fmtDate(c.state.updatedAt)} · ${e(c.state.phase)}</small><div class="studio-case-meta">${e(c.state.draft?.product||'Продукт не указан')}</div>${canReview?`<button data-action="studio-review-new" data-id="${e(id)}" data-case="${e(c.id)}" class="btn small">${I('file')} Оставить замечание</button>`:''}${boot().cases.some(x=>x.id===c.id)?`<a class="btn small ghost" href="#/case/${e(c.id)}">Открыть своё дело</a>`:''}</article>`).join(''):empty('Опубликованных дел пока нет. Автор может добавить дело из экрана вердикта.')}
    </section><section class="card"><div class="section-head"><h3>Участники</h3>${owner?B(I('plus')+' Пригласить','studio-invite','small primary',`data-id="${e(id)}"`):''}</div>
    ${w.members.map(m=>`<div class="studio-member"><div><strong>${e(m.email)}</strong><small>${labelRole(m.role)}</small></div>${owner&&m.role!=='owner'?B('Исключить','studio-remove-member','small ghost',`data-id="${e(id)}" data-user="${e(m.id)}"`):''}</div>`).join('')}
    ${owner?`<div class="studio-bottom">${B('Удалить пространство','studio-workspace-delete','small danger',`data-id="${e(id)}"`)}</div>`:''}
   </section></div>
   <section class="card"><div class="section-head"><h3>Комментарии и решения команды</h3><span class="pill">${w.reviews.length}</span></div>
     ${w.reviews.length?w.reviews.map(r=>`<div class="studio-review"><div class="studio-review-header"><strong>${e(r.email)}</strong><small>${fmtDate(r.createdAt)}</small></div><p>${e(r.comment)}</p></div>`).join(''):empty('Комментарии появятся здесь после первого обсуждения.')}
     <p class="source-note">Замечания команды хранятся отдельно от решения автора и не являются вердиктами JUDGE.</p>
   </section>`,'Команда','workspaces');
 }
 async function invitation(raw){
  if(unavailable()){shell(serverNotice(),'Приглашение','workspaces');return;}
  const data=await client.request('/workspaces/invitation/'+encodeURIComponent(raw));
  shell(`<div class="studio-invite-wrap"><span class="eyebrow">TEAM INVITATION</span><h1>Вас приглашают в команду.</h1><section class="card"><h2>${e(data.workspace)}</h2><p>Роль: ${e(labelRole(data.role))}. Приглашение действует до ${fmtDate(data.expiresAt)}.</p><p>Вступление не публикует ваши личные дела; они останутся приватными.</p>${boot().user?B('Принять приглашение','studio-accept','primary',`data-token="${e(raw)}"`):'<p class="notice">Для вступления сначала создайте локальный аккаунт или войдите, затем откройте эту ссылку снова.</p>'}</section></div>`,'Приглашение','workspaces');
 }
 async function studies(){
  if(unavailable()){shell(heading('Исследования','Только серверная версия')+serverNotice(),'Исследования','research');return;}
  const {studies}=await client.request('/research');
  shell(`${heading('Исследования','Проверяем гипотезы реальными ответами — без выдуманных конверсий.',B(I('download')+' Выгрузить CSV','studio-research-csv','ghost'))}
   <section class="studio-hero research-hero"><div><span class="eyebrow">EVIDENCE / 02</span><h2>Данные прежде выводов.</h2><p>Фиксируйте гипотезу до опроса. Получайте ответы приглашённых читателей и сохраняйте редакторское решение отдельно от сырых голосов.</p></div><div class="studio-deco">R<span>95%</span></div></section>
   <div class="studio-grid">${studies.length?studies.map(x=>`<a href="#/research/${e(x.id)}" class="studio-item card"><span class="eyebrow">${x.status==='active'?'В ИССЛЕДОВАНИИ':'ЗАВЕРШЕНО'}</span><h3>${e(x.hypothesis)}</h3><p>${x.sample.total} / ${x.targetResponses} ответов · ${x.sample.neither} «ни один»</p><div class="studio-progress"><span style="width:${Math.min(100,100*x.sample.total/x.targetResponses)}%"></span></div><span class="studio-arrow">К данным и решению ${I('arrow')}</span></a>`).join(''):empty('Исследований пока нет. Откройте готовый бриф, создайте слепое сравнение и затем сформулируйте гипотезу.')}</div>
   <section class="card"><h3>Честная интерпретация</h3><p>Мы отображаем лишь ответы приглашённых людей. Никаких прогнозов CTR, статистической значимости рекламных продаж или гарантий результата.</p></section>`,'Исследования','research');
 }
 function pct(n){return n===null?'—':(100*n).toFixed(1)+'%';}
 async function study(id){
  if(unavailable())return studies();
  const x=await client.request('/research/'+id),v=x.sample;
  const bars=[{name:'Исходная формулировка',n:v.a,k:'a'},{name:'Новая формулировка',n:v.b,k:'b'},{name:'Ни одна',n:v.neither,k:'neither'}];
  shell(`${heading('Результаты исследования',e(x.hypothesis),'<a class="btn ghost" href="#/research">Назад к исследованиям</a>')}
    <div class="studio-tabs"><span class="pill">${v.total} ответов</span><span class="pill">Цель: ${x.targetResponses}</span><span class="pill">${x.status==='active'?'Открыто':'Закрыто'}</span></div>
    <div class="studio-columns"><section class="card"><h3>Реальный выбор читателей</h3>${bars.map(b=>`<div class="research-bar"><div class="research-bar-head"><strong>${e(b.name)}</strong><span>${b.n} голосов</span></div><div class="studio-progress"><span style="width:${v.total?100*b.n/v.total:0}%"></span></div></div>`).join('')}
      <p class="source-note">Вариант A: ${e(x.variants.a)}</p><p class="source-note">Вариант B: ${e(x.variants.b)}</p>
    </section><section class="card"><h3>Оценка неопределённости</h3><div class="metric-split"><span>Доля выбора A среди определившихся</span><strong>${pct(x.preference.a)}</strong></div><div class="metric-split"><span>Условный интервал A (Wilson 95%)</span><strong>${pct(x.preference.aInterval.low)}–${pct(x.preference.aInterval.high)}</strong></div>
      <div class="metric-split"><span>Определившихся</span><strong>${v.decisive}</strong></div>
      <div class="metric-split"><span>До цели</span><strong>${v.remaining}</strong></div>
      <p class="source-note">Интервал не делает добровольную выборку случайной. Даже после достижения цели нельзя говорить о росте продаж.</p>
    </section></div>
    <section class="card"><h3>Редакторское решение</h3>${x.status==='active'?`<form id="studio-research-decision-form" data-id="${e(id)}" class="studio-form"><label for="research-decision">Решение по материалу</label><select id="research-decision" name="decision"><option value="inconclusive">Недостаточно данных</option><option value="iterate">Изменить формулировку</option><option value="retain">Оставить для следующего эксперимента</option></select><label for="decision-note">Почему</label><textarea id="decision-note" required name="note" minlength="15" maxlength="1200" placeholder="Запишите наблюдения и ограничения, без выводов о продажах."></textarea><button class="btn primary" type="submit">Зафиксировать решение</button></form>`:`<div class="studio-review"><strong>${e(x.decision==='inconclusive'?'Недостаточно данных':x.decision==='retain'?'Сохранить идею':'Пересмотреть идею')}</strong><p>${e(x.decisionNote||'')}</p></div>`}
    </section><div class="notice top-gap">${e(x.disclaimer)}</div>`,'Исследование','research');
 }
 function caseTools(s,comparisons){
  if(s.phase!=='verdict'||unavailable())return '';
  return `<section class="card studio-case-tools"><span class="eyebrow">TEAM & RESEARCH</span><h3>Следующий шаг — проверить идею</h3><p>Передайте итоговый материал команде или создайте исследование на основе реального слепого сравнения.</p><div class="button-row">${B(I('users')+' Поделиться с командой','studio-share','ghost')}${comparisons?.length?B(I('target')+' Исследовать гипотезу','studio-research-new','primary'):''}</div></section>`;
 }
 async function action(a,b){
  if(!a.startsWith('studio-'))return false;
  const id=b.dataset.id;
  if(a==='studio-workspace-new'){
   if(!boot().user){showModal('Нужен аккаунт','<p>Создайте локальный аккаунт в разделе «Настройки». Гостевые дела остаются приватными.</p>');return true;}
   showModal('Новое пространство','<form id="studio-workspace-create-form"><label>Название команды</label><input name="name" required minlength="3" maxlength="80" placeholder="Creative Strategy Team"><div class="inline-error" role="alert" hidden></div><button class="btn primary full" type="submit">Создать пространство</button></form>');return true;
  }
  if(a==='studio-invite'){showModal('Пригласить коллегу',`<form id="studio-invite-form" data-id="${e(id)}"><label>Роль участника</label><select name="role"><option value="reviewer">Редактор — комментирует дела</option><option value="viewer">Наблюдатель — только читает</option></select><p class="source-note">Коллега получит доступ только к явно опубликованным делам. Ссылка одноразовая, действует три дня.</p><button class="btn primary full" type="submit">Создать приглашение</button></form>`);return true;}
  if(a==='studio-accept'){const r=await client.request('/workspaces/invitation/'+encodeURIComponent(b.dataset.token),{method:'POST',body:{}});navigate('/workspace/'+r.workspaceId);return true;}
  if(a==='studio-share'){
   const arr=boot().workspaces?.filter(w=>w.role!=='viewer')||[];if(!arr.length){showModal('Нет доступной команды','<p>Создайте рабочее пространство или вступите в него с ролью редактора.</p>');return true;}
   showModal('Открыть дело команде',`<form id="studio-share-form" data-case="${e(caseDetail().state.id)}"><p class="modal-sub">Всем участникам команды будут доступны исходная формулировка, бриф и его последующие изменения. Публикация не открывает само дело для редактирования.</p><label>Пространство</label><select name="workspaceId">${arr.map(w=>`<option value="${e(w.id)}">${e(w.name)}</option>`).join('')}</select><label class="checkbox"><input type="checkbox" required name="confirm"><span>Разрешаю участникам выбранной команды видеть материалы дела.</span></label><button class="btn primary full" type="submit">Поделиться делом</button></form>`);return true;
  }
  if(a==='studio-review-new'){showModal('Оставить замечание',`<form id="studio-review-form" data-id="${e(id)}" data-case="${e(b.dataset.case)}"><label>Комментарий к делу</label><textarea name="comment" minlength="10" maxlength="1200" required placeholder="Уточните фактическое основание рекламного обещания…"></textarea><button class="btn primary full" type="submit">Отправить команде</button></form>`);return true;}
  if(a==='studio-remove-member'){showModal('Исключить участника?',`<p>Доступ участника ко всем опубликованным делам этого пространства будет прекращён.</p>${B('Исключить из команды','studio-remove-confirm','danger full',`data-id="${e(id)}" data-user="${e(b.dataset.user)}"`)}`);return true;}
  if(a==='studio-remove-confirm'){await client.request('/workspaces/'+id+'/remove-member',{method:'POST',body:{memberId:b.dataset.user}});closeModal();await workspace(id);return true;}
  if(a==='studio-workspace-delete'){showModal('Удалить пространство?',`<p>Команда, приглашения и отзывы будут удалены. Авторские дела останутся у своих владельцев.</p>${B('Удалить пространство','studio-workspace-delete-confirm','danger full',`data-id="${e(id)}"`)}`);return true;}
  if(a==='studio-workspace-delete-confirm'){await client.request('/workspaces/'+id+'/delete',{method:'POST',body:{}});closeModal();navigate('/workspaces');return true;}
  if(a==='studio-research-new'){
   const comparisons=caseDetail()?.comparisons?.filter(x=>x.status==='open')||[];
   if(!comparisons.length){showModal('Нужен открытый слепой тест','<p>Сначала создайте слепое сравнение в «Evidence Room», затем вернитесь сюда.</p>');return true;}
   showModal('Новая исследовательская гипотеза',`<form id="studio-research-create-form" data-case="${e(caseDetail().state.id)}"><label>Какая пара формулировок</label><select name="comparisonId">${comparisons.map(c=>`<option value="${e(c.id)}">${e(c.variantA.slice(0,55))} / ${e(c.variantB.slice(0,55))}</option>`).join('')}</select><label>Гипотеза до сбора ответов</label><textarea name="hypothesis" required minlength="15" maxlength="240" placeholder="Более конкретная формулировка будет понятнее с первого прочтения."></textarea><label>Целевое число участников (5–30)</label><input type="number" name="targetResponses" min="5" max="30" value="10" required><p class="source-note">Это исследование понятности, не рекламный A/B-тест. Участники приглашены вручную.</p><button class="btn primary full" type="submit">Зафиксировать гипотезу</button></form>`);return true;
  }
  if(a==='studio-research-csv'){
   const response=await fetch('/api/research/export.csv',{credentials:'same-origin'});
   if(!response.ok)throw Error('Не удалось скачать CSV');download('JUDGE-research.csv',await response.text(),'text/csv;charset=utf-8');return true;
  }
  return true;
 }
 async function submit(form,d){
  if(!form.id.startsWith('studio-'))return false;
  if(form.id==='studio-workspace-create-form'){const w=await client.request('/workspaces',{method:'POST',body:{name:d.name}});closeModal();navigate('/workspace/'+w.id);return true;}
  if(form.id==='studio-invite-form'){
   const w=await client.request('/workspaces/'+form.dataset.id+'/invite',{method:'POST',body:{role:d.role}});
   const url=location.origin+location.pathname+'#/workspace-invite/'+w.token;
   showModal('Ссылка готова',`<p>Передайте её одному коллеге. После принятия ссылка станет недействительной.</p><textarea class="link-box" readonly>${e(url)}</textarea><button class="btn primary full" data-action="studio-copy-invite" type="button">Скопировать ссылку</button>`);return true;
  }
  if(form.id==='studio-share-form'){
   if(d.confirm!=='on')throw Error('Подтвердите публикацию');await client.request('/workspaces/'+d.workspaceId+'/share',{method:'POST',body:{caseId:form.dataset.case}});
   closeModal();toast('Дело открыто выбранной команде.');return true;
  }
  if(form.id==='studio-review-form'){
   await client.request('/workspaces/'+form.dataset.id+'/review',{method:'POST',body:{caseId:form.dataset.case,comment:d.comment}});closeModal();await workspace(form.dataset.id);return true;
  }
  if(form.id==='studio-research-create-form'){
   const study=await client.request('/research',{method:'POST',body:{caseId:form.dataset.case,comparisonId:d.comparisonId,hypothesis:d.hypothesis,targetResponses:Number(d.targetResponses)}});closeModal();navigate('/research/'+study.id);return true;
  }
  if(form.id==='studio-research-decision-form'){
   const result=await client.request('/research/'+form.dataset.id+'/conclude',{method:'POST',body:{decision:d.decision,note:d.note}});await study(result.id);toast('Решение сохранено отдельно от голосов.');return true;
  }
  return true;
 }
 async function actionExtra(a){if(a==='studio-copy-invite'){await copy(document.querySelector('#modal .link-box').value);return true;}return false;}
 return {listWorkspaces,workspace,invitation,studies,study,caseTools,action:async(a,b)=>await actionExtra(a)||await action(a,b),submit};
}
