/** Five delivery waves of JUDGE: actual server-backed workflows, not mock cards. */
export function makeProduction({client,esc,B,I,shell,heading,showModal,closeModal,toast,download,navigate,boot,getLocale}){
 const e=esc;
 let active=null;
 const labels={
  ru:{title:'Кампании',subtitle:'От рекламной идеи до согласованного пакета.',new:'Новая кампания',none:'Кампаний пока нет. Сначала создайте рабочую команду.',server:'Кампании доступны в серверной сборке. Автономное демо не имитирует решения коллег.',workspace:'Команда',name:'Название',objective:'Цель',audience:'Аудитория',channel:'Канал',due:'Дата',create:'Создать',back:'Все кампании',edit:'Изменить условия',attach:'Добавить бриф',proof:'Добавить основание',creative:'Новый креатив',review:'Отправить на согласование',approve:'Согласовать',changes:'Запросить изменения',release:'Выпустить пакет',export:'Скачать JSON',revision:'Редакция',briefs:'Прикреплённые брифы',sources:'Основания утверждений',creatives:'Рекламные варианты',approvals:'Согласование',deliveries:'Пакеты выпуска',audit:'История',missing:'Что ещё необходимо',ready:'Можно отправлять на согласование',noBrief:'Пока нет брифов. Добавьте только явно открытое команде дело.',noEvidence:'Оснований пока нет. Их проверяет другой участник команды.',noCreative:'Креативов пока нет. Они создаются на основе сохранённого брифа.',note:'Комментарий',role:'Ваша роль',scope:'Содержимое доступно только участникам выбранной команды.',status:'Статус',add:'Добавить',source:'Источник',type:'Тип',statement:'Проверяемое утверждение',explanation:'Что именно проверять',inspect:'Я изучил указанный источник',inspected:'Изучено участником (не независимая верификация)',head:'Заголовок',body:'Основной текст',cta:'Действие',language:'Язык',format:'Формат',refresh:'Обновить',reviewNote:'Пояснение для редактора',decision:'Почему принято решение',editorial:'Редакторское согласование не означает законность рекламы или подтверждённые продажи.',noDelivery:'Не отправлено ни на одну рекламную платформу. Пакет предназначен для ручного использования.',latest:'Текущий вердикт',outdated:'Бриф изменился — обновите вложение',unshared:'Доступ отозван',draft:'Черновик',in_review:'На согласовании',approved:'Согласовано внутри команды',archived:'Архив',confirm:'Подтверждаю',delete:'Удалить',model:'Подсказка из исходного брифа',source_review:'Изучить основание',download:'Скачать',error:'Действие недоступно для текущей редакции.'},
  en:{title:'Campaigns',subtitle:'From a defended claim to an approved editorial package.',new:'New campaign',none:'No campaigns yet. Create a team workspace first.',server:'Campaigns require the server build. Offline demo does not simulate approvals.',workspace:'Team',name:'Name',objective:'Objective',audience:'Audience',channel:'Channel',due:'Due date',create:'Create',back:'All campaigns',edit:'Edit campaign',attach:'Attach brief',proof:'Add evidence',creative:'New creative',review:'Request editorial review',approve:'Approve',changes:'Request changes',release:'Create package',export:'Download JSON',revision:'Revision',briefs:'Attached briefs',sources:'Evidence registry',creatives:'Creative variants',approvals:'Reviews',deliveries:'Release packages',audit:'Activity',missing:'Outstanding checks',ready:'Ready for editorial review',noBrief:'No briefs yet. Attach a case explicitly shared with the team.',noEvidence:'No evidence reviewed by a second member yet.',noCreative:'No creative variants. Build one from an attached brief.',note:'Note',role:'Your role',scope:'Only members of this workspace can access its materials.',status:'Status',add:'Add',source:'Source',type:'Type',statement:'Claim to substantiate',explanation:'How to inspect source',inspect:'I inspected the source',inspected:'Human inspected (not independently verified)',head:'Headline',body:'Body',cta:'Call to action',language:'Language',format:'Format',refresh:'Refresh',reviewNote:'Note for reviewer',decision:'Decision rationale',editorial:'Editorial approval is not legal clearance or proof of sales.',noDelivery:'No advertising platform delivery. Export for manual use only.',latest:'Current verdict',outdated:'Verdict changed; refresh',unshared:'Access revoked',draft:'Draft',in_review:'In review',approved:'Approved internally',archived:'Archived',confirm:'Confirm',delete:'Remove',model:'Seeded from existing brief',source_review:'Inspect evidence',download:'Download',error:'This action is unavailable for the current revision.'},
  zh:{title:'广告活动',subtitle:'从广告主张到经过团队审核的材料包。',new:'新建活动',none:'暂无活动。请先创建团队空间。',server:'此功能需要本地服务器；离线演示不会模拟审批。',workspace:'团队',name:'名称',objective:'目标',audience:'受众',channel:'渠道',due:'截止日期',create:'创建',back:'所有活动',edit:'编辑活动',attach:'关联简报',proof:'添加证据',creative:'新建文案',review:'申请审核',approve:'批准',changes:'要求修改',release:'生成材料包',export:'下载 JSON',revision:'版本',briefs:'简报',sources:'证据登记',creatives:'广告文案',approvals:'审核',deliveries:'发布材料包',audit:'活动记录',missing:'尚需完成',ready:'可以申请审核',noBrief:'暂无简报；先共享案件到团队。',noEvidence:'尚无第二位成员审阅的证据。',noCreative:'暂无文案；请从简报创建。',note:'备注',role:'您的角色',scope:'仅本团队成员可访问内容。',status:'状态',add:'添加',source:'来源',type:'类型',statement:'需证明的主张',explanation:'审阅说明',inspect:'已查看来源',inspected:'人工审阅（并非独立验证）',head:'标题',body:'正文',cta:'行动号召',language:'语言',format:'格式',refresh:'刷新',reviewNote:'审核备注',decision:'决定理由',editorial:'内部批准不等于法律合规或实际销售业绩。',noDelivery:'未发送到广告平台；仅供手动使用。',latest:'当前结论',outdated:'简报已过期，请更新',unshared:'访问已撤销',draft:'草稿',in_review:'审核中',approved:'内部已批准',archived:'已归档',confirm:'确认',delete:'移除',model:'根据已有简报生成的初稿',source_review:'检查证据',download:'下载',error:'当前版本不可执行此操作。'}
 };
 const t=k=>(labels[getLocale()]||labels.ru)[k]||labels.ru[k]||k;
 const unavailable=()=>boot()?.mode==='preview';
 const use=()=>boot()?.workspaces||[];
 const request=(id,action,body)=>client.request('/production/campaigns/'+id+(action?'/'+action:''),{method:'POST',body});
 const status=s=>t(s)||s;
 const reason=k=>{
  if(k==='NO_BRIEF')return t('noBrief');
  if(k==='NO_CREATIVE')return t('noCreative');
  if(k==='ARCHIVED')return t('archived');
  if(k.startsWith('STALE_BRIEF'))return t('outdated');
  if(k.startsWith('SOURCE_UNAVAILABLE'))return t('unshared');
  if(k.startsWith('UNREVIEWED_EVIDENCE'))return t('noEvidence');
  return e(k);
 };
 const fields=(name,label,value='',opts='')=>`<label for="prod-${e(name)}">${e(label)}</label><input id="prod-${e(name)}" name="${e(name)}" value="${e(value)}" ${opts}>`;
 const textarea=(name,label,value='',extra='')=>`<label for="prod-${e(name)}">${e(label)}</label><textarea id="prod-${e(name)}" name="${e(name)}" ${extra}>${e(value)}</textarea>`;
 const choice=(name,label,options,current)=>`<label for="prod-${e(name)}">${e(label)}</label><select name="${e(name)}" id="prod-${e(name)}">${options.map(([v,k])=>`<option value="${e(v)}" ${current===v?'selected':''}>${e(k)}</option>`).join('')}</select>`;
 const channels=[['search','Search / 30 + 90'],['social','Social / 80 + 250'],['email','Email / 78 + 1200']];
 const languages=[['ru','RU'],['en','EN'],['zh','中文']];
 function serverNotice(){return `<section class="card"><h2>${e(t('server'))}</h2><a class="btn primary" href="#/">JUDGE</a></section>`;}
 async function list(){
  if(unavailable()){shell(heading(t('title'),t('subtitle'))+serverNotice(),t('title'),'campaigns');return;}
  const teams=use();let rows=[];
  for(const w of teams){const r=await client.request('/production/campaigns?workspaceId='+encodeURIComponent(w.id));rows.push(...r.campaigns.map(c=>({...c,team:w.name,role:w.role})));}
  shell(`${heading(t('title'),t('subtitle'),B(I('plus')+' '+e(t('new')),'prod-new','primary'))}
   <section class="studio-hero campaign-hero"><div><span class="eyebrow">PRODUCTION / 06—10</span><h2>Brief → Evidence → Approval → Release.</h2><p>${e(t('scope'))}</p></div><div class="studio-deco">P<span>10/10</span></div></section>
   ${rows.length?`<div class="studio-grid">${rows.map(c=>`<a class="studio-item card" href="#/campaign/${e(c.id)}"><span class="eyebrow">${e(c.team)} · v${c.revision}</span><h3>${e(c.name)}</h3><p>${e(c.objective)}</p><span class="pill ${c.status==='approved'?'green':''}">${e(status(c.status))}</span><span class="studio-arrow">${e(t('latest'))} ${I('arrow')}</span></a>`).join('')}</div>`:`<section class="card empty"><p>${e(t('none'))}</p><a class="btn ghost" href="#/workspaces">${e(t('workspace'))} ${I('arrow')}</a></section>`}
   <section class="card"><h3>Editorial only</h3><p>${e(t('editorial'))} ${e(t('noDelivery'))}</p></section>`,t('title'),'campaigns');
 }
 async function detail(id){
  if(unavailable())return list();
  active=await client.request('/production/campaigns/'+id);
  const {campaign:c,briefs,evidence,creatives,reviews,releases,preflight}=active,edit=c.role!=='viewer';
  const latestReview=reviews.find(r=>r.revision===c.revision&&r.status==='pending');
  const canApprove=latestReview&&latestReview.requestedBy!==boot()?.user?.id&&edit;
  const names=new Map(briefs.map(b=>[b.id,b.snapshot?.finalClaim||b.caseId]));
  shell(`${heading(e(c.name),e(c.objective),`<a class="btn ghost" href="#/campaigns">${I('back')} ${e(t('back'))}</a>`)}
   <div class="studio-tabs"><span class="pill">${e(t('workspace'))}: ${e(c.workspaceId.slice(0,8))}</span><span class="pill">${e(t('revision'))}: ${c.revision}</span><span class="pill ${c.status==='approved'?'green':''}">${e(status(c.status))}</span><span class="pill">${e(c.channel)}</span><span class="pill">${e(t('role'))}: ${e(c.role)}</span></div>
   <section class="card campaign-overview"><div><span class="eyebrow">WAVE 06 · CAMPAIGN PLANNER</span><h3>${e(t('audience'))}: ${e(c.audience)}</h3><p>${e(t('objective'))}: ${e(c.objective)}</p><p>${e(t('due'))}: ${e(c.dueDate||'—')}</p></div><div class="button-row">${B(I('refresh')+' '+e(t('refresh')),'prod-refresh','ghost')}${edit?B(I('file')+' '+e(t('edit')),'prod-edit','ghost',`data-id="${e(id)}"`):''}</div></section>
   <div class="studio-columns"><section class="card"><div class="section-head"><div><span class="eyebrow">WAVE 06</span><h3>${e(t('briefs'))}</h3></div>${edit?B(I('plus')+' '+e(t('attach')),'prod-attach','small primary',`data-id="${e(id)}"`):''}</div>
   ${briefs.length?briefs.map(b=>`<article class="campaign-line"><div><strong>${e(b.snapshot?.finalClaim||b.caseId)}</strong><small>${e(b.caseId.slice(0,8))} · ${b.stale?e(t('outdated')):b.accessible?e(t('latest')):e(t('unshared'))}</small></div>${edit?B(b.stale?e(t('refresh')):e(t('delete')),'prod-brief-action','small ghost',`data-id="${e(b.id)}" data-case="${e(b.caseId)}" data-mode="${b.stale?'refresh':'detach'}"`):''}</article>`).join(''):`<p class="source-note">${e(t('noBrief'))}</p>`}</section>
   <section class="card"><div class="section-head"><div><span class="eyebrow">WAVE 07</span><h3>${e(t('sources'))}</h3></div>${edit&&briefs.length?B(I('plus')+' '+e(t('proof')),'prod-proof','small primary'):''}</div>
   ${evidence.length?evidence.map(p=>`<article class="campaign-line"><div><strong>${e(p.statement)}</strong><small>${e(p.kind)} · ${e(p.locator)}</small><p>${e(p.explanation)}</p><span class="pill ${p.reviewValid?'green':''}">${p.reviewValid?e(t('inspected')):'Pending'}</span></div>${edit&&!p.reviewValid&&p.createdBy!==boot()?.user?.id?B(e(t('source_review')),'prod-proof-review','small ghost',`data-id="${e(p.id)}"`):''}</article>`).join(''):`<p class="source-note">${e(t('noEvidence'))}</p>`}</section></div>
   <section class="card"><div class="section-head"><div><span class="eyebrow">WAVE 09</span><h3>${e(t('creatives'))}</h3></div>${edit&&briefs.length?B(I('plus')+' '+e(t('creative')),'prod-creative','small primary'):''}</div>
   ${creatives.length?`<div class="campaign-creatives">${creatives.map(v=>`<article class="campaign-copy"><span class="eyebrow">${e(v.channel)} / ${e(v.language)}</span><h3>${e(v.headline)}</h3><p>${e(v.body)}</p><span class="pill">${e(v.cta)}</span>${edit?B(e(t('delete')),'prod-creative-remove','small ghost',`data-id="${e(v.id)}"`):''}</article>`).join('')}</div>`:`<p class="source-note">${e(t('noCreative'))}</p>`}</section>
   <div class="studio-columns"><section class="card"><div class="section-head"><div><span class="eyebrow">WAVE 08</span><h3>${e(t('approvals'))}</h3></div></div>
    <div class="campaign-checks">${preflight.ready?`<div class="campaign-check good">${I('check')} ${e(t('ready'))}</div>`:preflight.reasons.map(x=>`<div class="campaign-check">${I('alert')} ${e(reason(x))}</div>`).join('')}</div>
    ${reviews.slice(0,5).map(r=>`<article class="studio-review"><strong>${e(r.status)} / v${r.revision}</strong><p>${e(r.requestNote)}</p>${r.reviewNote?`<p>${e(r.reviewNote)}</p>`:''}</article>`).join('')}
    <div class="button-row">${edit&&c.status==='draft'&&preflight.ready?B(e(t('review')),'prod-review','primary'):''}${canApprove?B(e(t('approve')),'prod-decision','primary',`data-choice="approve"`):''}${canApprove?B(e(t('changes')),'prod-decision','ghost',`data-choice="changes"`):''}</div>
    <p class="source-note">${e(t('editorial'))}</p>
   </section><section class="card"><span class="eyebrow">WAVE 10</span><h3>${e(t('deliveries'))}</h3><p class="source-note">${e(t('noDelivery'))}</p>
   ${edit&&c.status==='approved'&&preflight.ready?B(I('download')+' '+e(t('release')),'prod-release','primary'):''}
   ${releases.length?releases.map(r=>`<article class="campaign-release"><strong>Release v${r.revision}</strong><small class="mono">SHA256 ${e(r.digest.slice(0,24))}…</small>${B(I('download')+' '+e(t('export')),'prod-export','small ghost',`data-id="${e(r.id)}"`)}</article>`).join(''):`<p class="source-note">${e(t('missing'))}: editorial approval.</p>`}
   </section></div>
   <section class="card ops-entry-card"><span class="eyebrow">WAVES 11–15 · RELEASE OPERATIONS</span><h3>Бренд · Локализация · Качество · Передача · Результаты</h3><p>Пять новых этапов, связанных с редакцией кампании и реальными подтверждениями. Сначала определите правила бренда, затем проверьте материалы перед согласованием.</p><a class="btn primary" href="#/ops/${e(c.id)}">Открыть центр контроля ${I('arrow')}</a></section>
   <section class="card ops-entry-card"><span class="eyebrow">WAVES 21–25 · RELEASE RELIABILITY</span><h3>Аккаунт · Версии · CSV · Очередь доставки · Готовность</h3><p>Следующие пять инженерных модулей для безопасной подготовки релизов без фиктивных подключений и показателей.</p><a class="btn primary" href="#/next/${e(c.id)}">Открыть WAVE 21–25 ${I('arrow')}</a></section>
   <section class="card"><details><summary><strong>${e(t('audit'))}</strong> <span class="pill">${active.events.length}</span></summary><div class="campaign-events">${active.events.slice(0,40).map(x=>`<div><span>${e(x.type)}</span><small>${e(new Date(x.createdAt).toLocaleString(getLocale()==='zh'?'zh-CN':getLocale()==='en'?'en-US':'ru-RU'))}</small></div>`).join('')}</div></details></section>`,t('title'),'campaigns');
 }
 async function action(a,b){
  if(!a.startsWith('prod-'))return false;
  if(a==='prod-new'){
   const teams=use().filter(w=>w.role!=='viewer');if(!teams.length){showModal(t('workspace'),`<p>${e(t('none'))}</p>`);return true;}
   showModal(t('new'),`<form id="prod-new-form" class="studio-form">${choice('workspaceId',t('workspace'),teams.map(w=>[w.id,w.name]))}${fields('name',t('name'),'','required minlength="3" maxlength="100"')}${textarea('objective',t('objective'),'','required minlength="10" maxlength="500"')}${fields('audience',t('audience'),'','required minlength="3" maxlength="200"')}${choice('channel',t('channel'),channels,'social')}${fields('dueDate',t('due'),'','type="date"')}<button class="btn primary full" type="submit">${e(t('create'))}</button></form>`);return true;
  }
  if(!active)return true;
  const {campaign:c,briefs}=active;
  if(a==='prod-refresh'){await detail(c.id);return true;}
  if(a==='prod-edit'){
   showModal(t('edit'),`<form id="prod-edit-form" class="studio-form">${fields('name',t('name'),c.name,'required minlength="3" maxlength="100"')}${textarea('objective',t('objective'),c.objective,'required minlength="10" maxlength="500"')}${fields('audience',t('audience'),c.audience,'required minlength="3" maxlength="200"')}${choice('channel',t('channel'),channels,c.channel)}${fields('dueDate',t('due'),c.dueDate||'','type="date"')}<button class="btn primary full" type="submit">${e(t('confirm'))}</button></form>`);return true;
  }
  if(a==='prod-attach'){
   const w=await client.request('/workspaces/'+c.workspaceId),candidates=w.cases.filter(x=>x.state.phase==='verdict');
   if(!candidates.length){showModal(t('attach'),`<p>${e(t('noBrief'))}</p>`);return true;}
   showModal(t('attach'),`<form id="prod-attach-form" class="studio-form">${choice('caseId',t('briefs'),candidates.map(x=>[x.id,(x.state.finalClaim||x.state.claim).slice(0,90)]))}<p class="source-note">${e(t('scope'))}</p><button class="btn primary full" type="submit">${e(t('attach'))}</button></form>`);return true;
  }
  if(a==='prod-brief-action'){
   if(b.dataset.mode==='refresh')await request(c.id,'attach',{caseId:b.dataset.case,expectedRevision:c.revision});
   else await request(c.id,'detach',{briefId:b.dataset.id,expectedRevision:c.revision});
   await detail(c.id);return true;
  }
  if(a==='prod-proof'){
   showModal(t('proof'),`<form id="prod-proof-form" class="studio-form">${choice('briefId',t('briefs'),briefs.filter(b=>b.accessible).map(b=>[b.id,(b.snapshot?.finalClaim||b.caseId).slice(0,70)]))}${textarea('statement',t('statement'),'','required minlength="5" maxlength="400"')}${choice('kind',t('type'),[['document','Document'],['dataset','Dataset'],['url','HTTPS URL'],['testimonial','Testimonial']])}${fields('locator',t('source'),'','required minlength="5" maxlength="500"')}${textarea('explanation',t('explanation'),'','required minlength="10" maxlength="1000"')}${fields('expiresAt',t('due'),'','type="date"')}<p class="source-note">${e(t('noEvidence'))}</p><button class="btn primary full" type="submit">${e(t('add'))}</button></form>`);return true;
  }
  if(a==='prod-proof-review'){
   const p=active.evidence.find(x=>x.id===b.dataset.id);
   showModal(t('source_review'),`<form id="prod-proof-review-form" class="studio-form" data-id="${e(p.id)}"><h3>${e(p.statement)}</h3><p>${e(p.locator)}</p><p>${e(p.explanation)}</p><label class="checkbox"><input type="checkbox" name="inspected" required><span>${e(t('inspect'))}</span></label><p class="source-note">${e(t('inspected'))}</p><button class="btn primary full" type="submit">${e(t('confirm'))}</button></form>`);return true;
  }
  if(a==='prod-creative'){
   const bid=briefs.find(x=>x.accessible&&!x.stale)?.id;
   if(!bid){showModal(t('creative'),`<p>${e(t('noBrief'))}</p>`);return true;}
   const hint=await client.request(`/production/campaigns/${c.id}/creatives?briefId=${encodeURIComponent(bid)}&channel=social&language=${encodeURIComponent(getLocale())}`);
   showModal(t('creative'),`<form id="prod-creative-form" class="studio-form">${choice('briefId',t('briefs'),briefs.filter(x=>x.accessible&&!x.stale).map(x=>[x.id,x.snapshot?.finalClaim||x.caseId]),bid)}${choice('channel',t('format'),channels,'social')}${choice('language',t('language'),languages,getLocale())}${fields('headline',t('head'),hint.headline,'required minlength="2" maxlength="78"')}${textarea('body',t('body'),hint.body,'required minlength="2" maxlength="1200"')}${fields('cta',t('cta'),hint.cta,'required minlength="2" maxlength="50"')}<p class="source-note">${e(t('model'))}: ${e(hint.note)}</p><button class="btn primary full" type="submit">${e(t('add'))}</button></form>`);return true;
  }
  if(a==='prod-creative-remove'){
   await request(c.id,'creatives/'+b.dataset.id,{expectedRevision:c.revision});await detail(c.id);return true;
  }
  if(a==='prod-review'||a==='prod-decision'){
   const choiceValue=a==='prod-review'?'review':b.dataset.choice;
   showModal(a==='prod-review'?t('review'):a==='prod-decision'?t(choiceValue==='approve'?'approve':'changes'):t('review'),`<form id="prod-review-form" data-choice="${choiceValue}" class="studio-form">${textarea('note',t('reviewNote'),'','required minlength="10" maxlength="700"')}<p class="source-note">${e(t('editorial'))}</p><button class="btn primary full" type="submit">${e(t('confirm'))}</button></form>`);return true;
  }
  if(a==='prod-release'){
   const out=await request(c.id,'release',{expectedRevision:c.revision});await detail(c.id);
   showModal(t('release'),`<p>SHA-256: <code>${e(out.digest)}</code></p><p>${e(t('noDelivery'))}</p><button class="btn primary" data-action="prod-export" data-id="${e(out.releaseId)}">${e(t('download'))}</button>`);return true;
  }
  if(a==='prod-export'){
   const out=await client.request(`/production/campaigns/${c.id}/export/${b.dataset.id}`);
   download(`JUDGE-release-v${out.campaign.revision}.json`,JSON.stringify(out,null,2),'application/json;charset=utf-8');return true;
  }
  return true;
 }
 async function submit(form,d){
  if(!form.id.startsWith('prod-'))return false;
  let result;const c=active?.campaign;
  if(form.id==='prod-new-form'){result=await client.request('/production/campaigns',{method:'POST',body:d});closeModal();navigate('/campaign/'+result.campaign.id);return true;}
  if(!c)return true;
  const expectedRevision=c.revision;
  if(form.id==='prod-edit-form')result=await request(c.id,'update',{...d,expectedRevision});
  if(form.id==='prod-attach-form')result=await request(c.id,'attach',{caseId:d.caseId,expectedRevision});
  if(form.id==='prod-proof-form')result=await request(c.id,'evidence',{...d,expectedRevision});
  if(form.id==='prod-proof-review-form')result=await request(c.id,'evidence/'+form.dataset.id,{inspected:d.inspected==='on',expectedRevision});
  if(form.id==='prod-creative-form')result=await request(c.id,'creatives',{...d,expectedRevision});
  if(form.id==='prod-review-form'){
   if(form.dataset.choice==='review')result=await request(c.id,'review-request',{expectedRevision,note:d.note});
   else result=await request(c.id,'review-decision',{expectedRevision,decision:form.dataset.choice,note:d.note});
  }
  closeModal();await detail(c.id);toast(t('confirm'));return true;
 }
 return {list,detail,action,submit};
}
