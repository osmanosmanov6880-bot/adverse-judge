/** Wave 3 — multilingual operational UI, explicit fallbacks (no machine-invented translations).
 * Never translate form values, user HTML or text entered by people. */
const rows=`Обзор|Overview|概览
Мои дела|My cases|我的案件
Команды|Teams|团队
Кампании|Campaigns|广告活动
Исследования|Research|研究
Аналитика|Analytics|分析
Как это работает|How it works|工作原理
Семь платформ|Seven platforms|七个平台
Настройки|Settings|设置
Новое дело|New case|新案件
Рабочее пространство|Workspace|工作区
Рабочие пространства|Workspaces|工作区
Сохранение на сервере|Saved on server|已保存到服务器
Автономное превью|Offline preview|离线预览
Сценарный режим|Rules-based mode|规则模式
Вашу рекламу|Your ad|你的广告
можно |can it be |能否
защитить?|be defended?|经得起质疑？
Без регистрации|No sign-up|无需注册
Вы контролируете каждое решение|You control every decision|每个决定由你掌控
Открыть первое дело|Open the first case|打开第一个案件
Проверить свою фразу|Check my claim|检查我的广告语
С чего начнём?|Where shall we begin?|从哪里开始？
Принесите обещание|Bring your claim|提出广告承诺
Выберите линию защиты|Choose a defense|选择辩护方式
Заберите готовый бриф|Get your brief|获取广告简报
Что видит JUDGE|What JUDGE sees|JUDGE 的分析
На рассмотрении|Under review|审理中
Уточнение|Clarification|澄清
Выбор формулировки|Choose wording|选择措辞
Бриф готов|Brief ready|简报已完成
Есть возражение|Objection received|收到异议
Мои приглашения|My invitations|我的邀请
Вызвать свидетеля|Call a witness|邀请证人
Создать аккаунт|Create account|创建账户
Войти|Sign in|登录
Выйти|Sign out|退出
Email|Email|邮箱
Пароль|Password|密码
Название продукта|Product name|产品名称
Для кого|For whom|面向谁
Рекламная фраза|Advertising claim|广告语
Начать рассмотрение|Start hearing|开始审理
Рассмотрение дела|Case hearing|案件审理
Рекламное обещание|Advertising claim|广告承诺
Подготовить передачу|Prepare transfer|准备传输
Скопировать бриф|Copy brief|复制简报
Скачать .txt|Download .txt|下载 .txt
Скачать .json|Download .json|下载 .json
Создать тест понятности|Create clarity test|创建清晰度测试
Слепой тест|Blind test|盲测
Варианты формулировки|Copy variants|文案版本
Отправить возражение|Send objection|提交异议
Первый вариант|First variant|第一个版本
Второй вариант|Second variant|第二个版本
Ни один|Neither|都不选
Отправить выбор|Submit choice|提交选择
Закрыть тест|Close test|结束测试
Обновить дело|Refresh case|刷新案件
Информация|Information|信息
Управлять приглашениями|Manage invitations|管理邀请
Изменить пароль|Change password|更改密码
Активные сеансы|Active sessions|活跃会话
Создать аккаунт / войти|Create account / Sign in|注册 / 登录
Ваши данные и настройки|Data and settings|数据与设置
Роли и ИИ|Roles and AI|角色与人工智能
Экспорт и удаление|Export and deletion|导出与删除
Готовность к публикации|Deployment readiness|部署就绪情况
Выгрузить данные|Export data|导出数据
Удалить мои данные|Delete my data|删除我的数据
Статус|Status|状态
Хранение|Storage|存储
Локальная SQLite|Local SQLite|本地 SQLite
Этот браузер|This browser|此浏览器
Гостевая сессия|Guest session|访客会话
Аккаунт|Account|账户
Доступ|Access|访问权限
Пользователь|User|用户
Модель|Model|模型
Все команды|All teams|所有团队
Командные пространства|Team workspaces|团队工作区
Новое пространство|New workspace|新工作区
COLLABORATION / 01|COLLABORATION / 01|协作 / 01
Рабочее пространство · Владелец|Workspace · Owner|工作区 · 所有者
Владелец|Owner|所有者
Редактор|Reviewer|审核者
Наблюдатель|Viewer|查看者
Создать пространство|Create workspace|创建工作区
Название команды|Team name|团队名称
Открыть пространство|Open workspace|打开工作区
Подготовка совместной работы|Preparing collaboration|准备协作
Как защищены данные|How data is protected|数据如何受到保护
Участники|Members|成员
Опубликованные дела|Shared cases|共享案件
Открыть своё дело|Open my case|打开我的案件
Оставить замечание|Leave feedback|添加反馈
Комментарий к делу|Case feedback|案件反馈
Отправить команде|Send to team|发送给团队
Пригласить|Invite|邀请
Пригласить коллегу|Invite colleague|邀请同事
Роль участника|Member role|成员角色
Редактор — комментирует дела|Reviewer — can comment|审核者—可以评论
Наблюдатель — только читает|Viewer — read only|查看者—只读
Создать приглашение|Create invitation|创建邀请
Ссылка готова|Link ready|链接已准备好
Скопировать ссылку|Copy link|复制链接
Вы уже состоите в пространстве.|You are already a member.|你已经是成员。
TEAM INVITATION|TEAM INVITATION|团队邀请
Вас приглашают в команду.|You have been invited.|你收到团队邀请。
Принять приглашение|Accept invitation|接受邀请
Исключить|Remove|移除
Исключить участника?|Remove this member?|移除此成员？
Исключить из команды|Remove from team|从团队移除
Удалить пространство|Delete workspace|删除工作区
Удалить пространство?|Delete workspace?|删除工作区？
Сильную идею полезно оспорить.|A strong idea deserves a challenge.|强有力的想法值得质疑。
Поделиться с командой|Share with team|分享给团队
Открыть дело команде|Share case with team|将案件分享给团队
Поделиться делом|Share case|分享案件
Следующий шаг — проверить идею|Next: validate the idea|下一步：验证想法
Исследовать гипотезу|Study the hypothesis|研究假设
EVIDENCE / 02|EVIDENCE / 02|证据 / 02
Данные прежде выводов.|Data before conclusions.|数据优先于结论。
Результаты исследования|Research results|研究结果
К данным и решению|View evidence and decision|查看证据和决策
Новая исследовательская гипотеза|New research hypothesis|新的研究假设
Какая пара формулировок|Which copy pair|哪组文案
Гипотеза до сбора ответов|Hypothesis before responses|收集回答前的假设
Целевое число участников (5–30)|Target participants (5–30)|目标参与人数（5–30）
Зафиксировать гипотезу|Save hypothesis|保存假设
Реальный выбор читателей|Actual reader choices|读者的真实选择
Исходная формулировка|Original copy|原始文案
Новая формулировка|Revised copy|改进文案
Ни одна|Neither|都不选
Оценка неопределённости|Uncertainty|不确定性估计
Доля выбора A среди определившихся|A share among decisive votes|明确投票中 A 的比例
Условный интервал A (Wilson 95%)|Conditional interval A (Wilson 95%)|A 的条件区间（Wilson 95%）
Определившихся|Decisive responses|明确的回答
До цели|Remaining to target|距目标
Редакторское решение|Editorial decision|编辑决策
Решение по материалу|Decision on copy|文案决策
Недостаточно данных|Inconclusive|证据不足
Изменить формулировку|Revise wording|修改措辞
Оставить для следующего эксперимента|Keep for next experiment|保留用于下一次实验
Почему|Rationale|理由
Зафиксировать решение|Record decision|记录决策
Назад к исследованиям|Back to research|返回研究
Выгрузить CSV|Export CSV|导出 CSV
Исследования|Studies|研究
Коллективная ясность.|Collective clarity.|集体清晰。
Без хаоса в документах.|Without document chaos.|告别文件混乱。
Сам бриф доступен и без регистрации.|The brief works without registration.|无需注册也可获取简报。
Правки|Revisions|修改
История решений|Decision history|决策历史
Отозвать|Revoke|撤销
Действует|Active|有效
Истекло|Expired|已过期
Отозвано|Revoked|已撤销
Получен ответ|Response received|收到回答
Готово|Done|完成
Дальше|Continue|继续
Закрыть|Close|关闭
Отмена|Cancel|取消
Повторить|Retry|重试
Сохранить|Save|保存
Запустить|Start|启动
Для этой функции нужен сервер из архива. Автономное превью не подключено к интернет-сервисам.|This feature needs the server build. Offline preview has no remote services.|此功能需要服务器版本，离线预览无法连接远程服务。
`;const dict=new Map();
for(const row of rows.split('\n').filter(Boolean)){
 const a=row.split('|');if(a.length===3)dict.set(a[0],{en:a[1],zh:a[2]});
}
const supported=new Set(['ru','en','zh']);
let lang='ru';
try{const v=localStorage.getItem('judge-locale');if(supported.has(v))lang=v;}catch{}
const originals=new WeakMap();const attrOriginals=new WeakMap();
export const getLocale=()=>lang;
export function setLocale(code){if(!supported.has(code))return;lang=code;try{localStorage.setItem('judge-locale',code);}catch{}document.documentElement.lang=code==='zh'?'zh-CN':code;}
function translateText(s){
 if(lang==='ru')return s;
 const match=s.match(/^(\s*)(.*?)(\s*)$/s);if(!match)return s;
 const translation=dict.get(match[2])?.[lang];return translation?match[1]+translation+match[3]:s;
}
export function translateUI(root=document.body){
 if(!root)return;
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;
 while(n=walker.nextNode()){
   if(n.parentElement?.closest('script,style,textarea,[data-no-translate]'))continue;
   const previous=originals.get(n);
   if(!previous||previous.last!==n.nodeValue)originals.set(n,{source:n.nodeValue,last:n.nodeValue});
   const data=originals.get(n);const output=translateText(data.source);
   if(n.nodeValue!==output)n.nodeValue=output;data.last=output;
 }
 for(const el of [root,...root.querySelectorAll?.('[placeholder],[aria-label],[title]')??[]]){
   const o=attrOriginals.get(el)||{};
   for(const name of ['placeholder','aria-label','title']){
     if(!el.hasAttribute?.(name))continue;
     let source=o[name]?.source;if(!o[name]||o[name].last!==el.getAttribute(name))source=el.getAttribute(name);
     const output=translateText(source);if(el.getAttribute(name)!==output)el.setAttribute(name,output);
     o[name]={source,last:output};
   }attrOriginals.set(el,o);
 }
 document.documentElement.lang=lang==='zh'?'zh-CN':lang;
}
export const translationsCount=dict.size;
