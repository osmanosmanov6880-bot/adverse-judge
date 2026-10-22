import http from 'node:http';
import {readFileSync,existsSync,statSync} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {Store} from './store.mjs';
import {JudgeService} from './service.mjs';
import {ComparisonService} from './comparison.mjs';
import {WorkspaceService} from './workspaces.mjs';
import {ResearchService} from './research.mjs';
import {ProductionService} from './production.mjs';
import {AdvancedService} from './advanced.mjs';
import {GovernanceService} from './governance.mjs';
import {IdentityService,webhookMailer} from './identity.mjs';
import {RevisionService} from './revisions.mjs';
import {MetricsImportService} from './metrics-import.mjs';
import {DeliveryService} from './delivery.mjs';
import {ReadinessService} from './ops25.mjs';
import {CinemaBridge} from './cinema-bridge.mjs';
import {token,hash,equal,passwordHash,verifyPassword,deviceLabel,Limiter} from './security.mjs';
import {DomainError,VERSION,DEMOS,briefText} from '../shared/domain.mjs';
import {generateCommentary,modelStatus} from './llm.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
function cookieValue(header,name) {for(const part of (header||'').split(';')){const [k,...v]=part.trim().split('=');if(k===name)return v.join('=');}return null;}
async function readBody(req) {
  if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json')) throw new DomainError('CONTENT_TYPE','Ожидается application/json.',415);
  let n=0;const chunks=[];for await(const part of req){n+=part.length;if(n>32768)throw new DomainError('BODY_LIMIT','Запрос слишком большой.',413);chunks.push(part);}
  let b;try {b=JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw new DomainError('JSON','Неверный JSON.');}
  if(!b||typeof b!=='object'||Array.isArray(b)) throw new DomainError('JSON','Ожидается JSON-объект.');return b;
}
export function createApp(options={}) {
  const port=Number(options.port??process.env.PORT??3000),host=options.host??process.env.HOST??'127.0.0.1';
  const origin=options.origin??process.env.APP_ORIGIN??`http://localhost:${port}`;
  const address=new URL(origin);
  if(!['http:','https:'].includes(address.protocol)||address.username||address.password||address.pathname!=='/'||address.search||address.hash)throw new Error('APP_ORIGIN must be a clean http(s) origin');
  const localhost=['localhost','127.0.0.1','[::1]'].includes(address.hostname);
  if(address.protocol!=='https:'&&!localhost)throw new Error('Public APP_ORIGIN must use HTTPS');
  if(!['localhost','127.0.0.1','::1','[::1]'].includes(host)&&address.protocol!=='https:')throw new Error('Refusing to expose insecure HTTP outside loopback');
  const allowed=new Set([origin]);
  if(new URL(origin).hostname==='localhost'||new URL(origin).hostname==='127.0.0.1'){allowed.add(`http://localhost:${port}`);allowed.add(`http://127.0.0.1:${port}`);}
  const modelEnv=options.env??process.env,provider=options.commentator??generateCommentary;
  const store=options.store??new Store(resolve(process.env.JUDGE_DB??resolve(ROOT,'data/judge.sqlite')));
  const platforms=options.platforms??JSON.parse(readFileSync(resolve(process.env.JUDGE_PLATFORMS_FILE??resolve(ROOT,'config/platforms.json')),'utf-8'));
  const svc=new JudgeService(store,{platforms,secret:options.secret??process.env.HANDOFF_SECRET??''});
  const cinema=new CinemaBridge(store);
  const comparison=new ComparisonService(svc);svc.comparison=comparison;
  const identity=new IdentityService(store,{mailer:options.mailer??webhookMailer({env:modelEnv}),requireVerified:options.requireVerifiedEmail??(modelEnv.JUDGE_REQUIRE_VERIFIED_EMAIL==='1')});
  const workspaces=new WorkspaceService(svc,{identity});
  const research=new ResearchService(svc);
  const production=new ProductionService(svc,workspaces);
  const advanced=new AdvancedService(production,svc);production.advanced=advanced;
  const governance=new GovernanceService(production,advanced);production.governance=governance;advanced.governance=governance;
  const revisions=new RevisionService(production);
  const imports=new MetricsImportService(advanced);
  const delivery=new DeliveryService(advanced,{fetcher:options.deliveryFetch??fetch,env:modelEnv,clock:options.clock??(()=>Date.now()),allowLoopbackTest:options.allowLoopbackDeliveryTest===true});
  const readiness=new ReadinessService({store,judge:svc,identity,delivery,env:modelEnv,origin,dbPath:process.env.JUDGE_DB||null});
  const limiter=new Limiter(),secure=origin.startsWith('https:');
  const aiLimit=Number(process.env.AI_DAILY_REQUEST_LIMIT??50);
  if(!Number.isSafeInteger(aiLimit)||aiLimit<1||aiLimit>10000)throw new Error('AI_DAILY_REQUEST_LIMIT must be an integer from 1 to 10000');
  store.db.exec('CREATE TABLE IF NOT EXISTS ai_requests(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,day TEXT NOT NULL,status TEXT NOT NULL)');
  store.db.exec('CREATE TABLE IF NOT EXISTS ai_reservations(case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,command_id TEXT NOT NULL,request_id TEXT NOT NULL,PRIMARY KEY(case_id,command_id))');
  svc.env=modelEnv;
  const sessionCookie=(value,maxAge=604800)=>`judge_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`;
  function newSession(res,owner,agent) {
    const raw=token(),at=new Date().toISOString(),csrf=token();
    store.run('INSERT INTO sessions(id_hash,owner_id,csrf,expires_at,created_at,device_label,last_seen_at) VALUES(?,?,?,?,?,?,?)',hash(raw),owner??randomUUID(),csrf,Date.now()+604800000,at,deviceLabel(agent),Date.now());
    res.setHeader('Set-Cookie',sessionCookie(raw));return store.one('SELECT * FROM sessions WHERE id_hash=?',hash(raw));
  }
  function getSession(req,res,create=false) {
    const raw=cookieValue(req.headers.cookie,'judge_session');
    const session=raw&&raw.length<100?store.one('SELECT * FROM sessions WHERE id_hash=? AND expires_at>?',hash(raw),Date.now()):null;
    if(session)return session;
    if(create)return newSession(res,null,req.headers['user-agent']);
    throw new DomainError('SESSION','Сессия истекла. Обновите страницу.',401);
  }
  const json=(res,status,obj)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(obj));};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
    res.setHeader('Cache-Control','no-store');
    if(secure)res.setHeader('Strict-Transport-Security','max-age=31536000');
    try {
      const hostHeader=req.headers.host;
      if(![...allowed].some(o=>new URL(o).host===hostHeader)) throw new DomainError('HOST','Неверный адрес приложения.',403);
      const url=new URL(req.url,origin),path=url.pathname,method=req.method;
      if(!['GET','POST','DELETE'].includes(method)) throw new DomainError('METHOD','Метод не поддерживается.',405);
      const ip=hash(req.socket.remoteAddress??'local');
      limiter.check(ip,180);
      if(path==='/api/health')return json(res,200,{ok:true,version:VERSION,storage:'sqlite',mode:'local-pilot'});
      if(path==='/api/ready'){const check=store.one('PRAGMA quick_check');const ok=Object.values(check||{}).every(x=>x==='ok');return json(res,ok?200:503,{ok,version:VERSION,storage:'sqlite',deployment:'pilot-only',identity:'unverified-local-accounts'});}
      if(!path.startsWith('/api/')) {
        if(method!=='GET')throw new DomainError('METHOD','Метод не поддерживается.',405);
        let file;
        if(path==='/')file=resolve(ROOT,'public/index.html');
        else if(path==='/cinema'||path==='/cinema/')file=resolve(ROOT,'cinema/index.html');
        else if(/^\/cinema\/(?:src\/(?:app|data|engine|sound)\.js|src\/style\.css|assets\/[a-z0-9-]+\.(?:webp|svg))$/.test(path))file=resolve(ROOT,path.slice(1));
        else if(path==='/shared/domain.mjs')file=resolve(ROOT,'shared/domain.mjs');
        else if(/^\/(app\.mjs|studio\.mjs|production\.mjs|advanced\.mjs|governance\.mjs|waves\.mjs|i18n\.mjs|api\.mjs|styles\.css|favicon\.svg)$/.test(path))file=resolve(ROOT,'public',path.slice(1));
        else throw new DomainError('NOT_FOUND','Страница не найдена.',404);
        if(!existsSync(file)||!statSync(file).isFile())throw new DomainError('NOT_FOUND','Файл не найден.',404);
        res.writeHead(200,{'Content-Type':MIME[extname(file)]||'application/octet-stream'});return res.end(readFileSync(file));
      }
      if(path.startsWith('/api/integrations/')) {
        limiter.check('integration:'+ip,40,60000);
        if(method!=='POST')throw new DomainError('METHOD','Ожидается POST.',405);
        const body=await readBody(req),credential=String(req.headers.authorization??'').replace(/^Bearer /,'');
        if(path==='/api/integrations/redeem')return json(res,200,svc.redeem(body.platformId,credential,body.token,body.requestId??null));
        if(path==='/api/integrations/events')return json(res,200,svc.receipt(body.platformId,credential,body));
        if(path==='/api/integrations/release-redeem')return json(res,200,advanced.redeemDispatch(body.platformId,credential,body.token,body.requestId));
        if(path==='/api/integrations/release-events')return json(res,200,advanced.receiptDispatch(body.platformId,credential,body));
        throw new DomainError('NOT_FOUND','Маршрут не найден.',404);
      }
      if(path==='/api/bootstrap'&&method==='GET') {
        store.run('DELETE FROM sessions WHERE expires_at<=?',Date.now());
        store.run('DELETE FROM auth_failures WHERE reset_at<?',Date.now()-3600000);
        const session=getSession(req,res,true),user=store.one('SELECT id,email FROM users WHERE id=?',session.owner_id);
        store.run('UPDATE sessions SET last_seen_at=? WHERE id_hash=?',Date.now(),session.id_hash);
        return json(res,200,{csrf:session.csrf,user:user?{...user,emailVerified:identity.status(user.id).verified}:null,identity:identity.status(session.owner_id),mode:'server',version:VERSION,storage:'sqlite',ai:modelStatus(modelEnv),platforms:svc.platformList(),workspaces:workspaces.list(session.owner_id),cases:svc.list(session.owner_id),stats:svc.stats(session.owner_id),demos:DEMOS});
      }
      const session=getSession(req,res),owner=session.owner_id;
      let body={};
      if(method==='POST'||method==='DELETE') {
        if(!allowed.has(req.headers.origin))throw new DomainError('ORIGIN','Запрос с другого сайта запрещён.',403);
        if(!equal(req.headers['x-csrf-token'],session.csrf))throw new DomainError('CSRF','Проверка безопасности не пройдена. Обновите страницу.',403);
        body=await readBody(req);
      }
      // CINEMA -> JUDGE uses the existing session, CSRF and same-origin checks.
      // Browser never sends story data until the viewer confirms the transfer.
      if(path==='/api/cinema/import'&&method==='POST'){
        limiter.check('cinema-import:'+owner,12,60000);
        return json(res,201,cinema.import(owner,body));
      }
      if(path==='/api/auth/register'&&method==='POST') {
        limiter.check('register:'+ip,5,600000);
        if(store.one('SELECT id FROM users WHERE id=?',owner))throw new DomainError('ACCOUNT','Сначала выйдите из текущего аккаунта.',409);
        const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
        if(!/^[^\s@]{1,100}@[^\s@]{1,150}\.[^\s@]{2,30}$/.test(email)||email.length>254)throw new DomainError('EMAIL','Введите корректный email.');
        if(body.accepted!==true)throw new DomainError('CONSENT','Подтвердите условия локального пилота.');
        const pw=await passwordHash(body.password);
        if(store.one('SELECT id FROM users WHERE email=?',email))throw new DomainError('ACCOUNT','Не удалось создать аккаунт. Попробуйте войти или укажите другой адрес.',409);
        store.tx(()=>{store.run('INSERT INTO users VALUES(?,?,?,?)',owner,email,pw,new Date().toISOString());store.run('DELETE FROM sessions WHERE id_hash=?',session.id_hash);});
        const next=newSession(res,owner,req.headers['user-agent']);return json(res,201,{user:{id:owner,email,emailVerified:false},csrf:next.csrf});
      }
      if(path==='/api/auth/login'&&method==='POST') {
        limiter.check('login:'+ip,12,600000);
        const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
        const attemptKey=hash('login:'+email),now=Date.now(),windowMs=15*60*1000;
        const prior=store.one('SELECT attempts,reset_at FROM auth_failures WHERE key_hash=?',attemptKey);
        if(prior&&prior.reset_at>now&&prior.attempts>=8)throw new DomainError('LOGIN_LOCKED','Слишком много неудачных входов. Повторите через 15 минут.',429);
        const user=store.one('SELECT * FROM users WHERE email=?',email);
        if(!await verifyPassword(body.password,user?.password_hash)){
          store.run('INSERT INTO auth_failures(key_hash,attempts,reset_at) VALUES(?,?,?) ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN auth_failures.reset_at<=? THEN 1 ELSE auth_failures.attempts+1 END,reset_at=CASE WHEN auth_failures.reset_at<=? THEN excluded.reset_at ELSE auth_failures.reset_at END',attemptKey,1,now+windowMs,now,now);
          throw new DomainError('LOGIN','Email или пароль не совпадают.',401);
        }
        store.run('DELETE FROM auth_failures WHERE key_hash=?',attemptKey);
        store.tx(()=>{
          if(!store.one('SELECT id FROM users WHERE id=?',owner))store.run('UPDATE cases SET owner_id=? WHERE owner_id=?',user.id,owner);
          store.run('DELETE FROM sessions WHERE id_hash=?',session.id_hash);
        });
        const next=newSession(res,user.id,req.headers['user-agent']);return json(res,200,{user:{id:user.id,email:user.email,emailVerified:identity.status(user.id).verified},csrf:next.csrf});
      }
      // Wave 21 — identity proof/recovery. Tokens are never included in responses.
      if(path==='/api/auth/identity'&&method==='GET')return json(res,200,identity.status(owner));
      if(path==='/api/auth/verify/request'&&method==='POST'){
        limiter.check('verify-request:'+ip,8,3600000);
        if(!store.one('SELECT 1 FROM users WHERE id=?',owner))throw new DomainError('ACCOUNT','Register first.',403);
        return json(res,200,await identity.issue(owner,'verify'));
      }
      if(path==='/api/auth/verify/confirm'&&method==='POST'){
        limiter.check('verify-confirm:'+ip,10,3600000);
        return json(res,200,identity.verify(owner,body.code));
      }
      if(path==='/api/auth/recovery/request'&&method==='POST'){
        limiter.check('recovery-request:'+ip,5,3600000);
        return json(res,200,await identity.requestReset(body.email));
      }
      if(path==='/api/auth/recovery/confirm'&&method==='POST'){
        limiter.check('recovery-confirm:'+ip,10,3600000);
        return json(res,200,await identity.reset(body.code,body.newPassword));
      }
      if(path==='/api/auth/logout'&&method==='POST'){store.run('DELETE FROM sessions WHERE id_hash=?',session.id_hash);res.setHeader('Set-Cookie',sessionCookie('',0));return json(res,200,{ok:true});}
      if(path==='/api/auth/sessions'&&method==='GET') {
        if(!store.one('SELECT id FROM users WHERE id=?',owner))throw new DomainError('ACCOUNT','Управление сеансами доступно после регистрации.',403);
        const rows=store.all('SELECT id_hash,created_at,last_seen_at,expires_at,device_label FROM sessions WHERE owner_id=? AND expires_at>? ORDER BY created_at DESC',owner,Date.now());
        return json(res,200,{sessions:rows.map(row=>({id:row.id_hash.slice(0,20),device:row.device_label,createdAt:row.created_at,lastSeenAt:row.last_seen_at,expiresAt:row.expires_at,current:row.id_hash===session.id_hash}))});
      }
      if(path==='/api/auth/sessions/revoke'&&method==='POST') {
        if(!store.one('SELECT id FROM users WHERE id=?',owner))throw new DomainError('ACCOUNT','Нужна учётная запись.',403);
        if(typeof body.id!=='string'||!/^[a-f0-9]{20}$/.test(body.id))throw new DomainError('SESSION_ID','Неверный идентификатор сеанса.');
        const target=store.one('SELECT id_hash FROM sessions WHERE owner_id=? AND substr(id_hash,1,20)=?',owner,body.id);
        if(!target)throw new DomainError('NOT_FOUND','Сеанс не найден.',404);
        store.run('DELETE FROM sessions WHERE owner_id=? AND id_hash=?',owner,target.id_hash);
        const current=target.id_hash===session.id_hash;
        if(current)res.setHeader('Set-Cookie',sessionCookie('',0));
        return json(res,200,{ok:true,loggedOut:current});
      }
      if(path==='/api/auth/password'&&method==='POST') {
        limiter.check('password:'+owner,5,600000);
        const user=store.one('SELECT id,password_hash FROM users WHERE id=?',owner);
        if(!user)throw new DomainError('ACCOUNT','Нужна зарегистрированная учётная запись.',403);
        if(!await verifyPassword(body.currentPassword,user.password_hash))throw new DomainError('PASSWORD','Текущий пароль неверен.',401);
        if(body.currentPassword===body.newPassword)throw new DomainError('PASSWORD','Новый пароль должен отличаться от текущего.');
        const replacement=await passwordHash(body.newPassword);
        store.tx(()=>{
          store.run('UPDATE users SET password_hash=? WHERE id=?',replacement,owner);
          store.run('DELETE FROM sessions WHERE owner_id=?',owner);
        });
        const next=newSession(res,owner,req.headers['user-agent']);
        return json(res,200,{ok:true,csrf:next.csrf,otherSessionsRevoked:true});
      }

      // Waves 22–24 — release history, CSV import and durable partner outbox.
      let x=path.match(/^\/api\/revisions\/campaigns\/([0-9a-f-]{36})\/([0-9a-f-]{36})(?:\/(restore))?$/i);
      if(x){
        if(method==='GET'&&!x[3])return json(res,200,revisions.compare(owner,x[1],x[2]));
        if(method==='POST'&&x[3]==='restore')return json(res,200,revisions.restore(owner,x[1],x[2],body));
      }
      x=path.match(/^\/api\/imports\/campaigns\/([0-9a-f-]{36})(?:\/(preview|commit))?$/i);
      if(x){
        if(method==='GET'&&!x[2])return json(res,200,{batches:imports.list(owner,x[1])});
        if(method==='POST'&&x[2]==='preview')return json(res,200,imports.preview(owner,x[1],body));
        if(method==='POST'&&x[2]==='commit')return json(res,201,imports.commit(owner,x[1],body));
      }
      x=path.match(/^\/api\/delivery\/campaigns\/([0-9a-f-]{36})(?:\/(queue|attempt))?(?:\/([0-9a-f-]{36}))?$/i);
      if(x){
        if(method==='GET'&&!x[2])return json(res,200,{deliveries:delivery.list(owner,x[1])});
        if(method==='POST'&&x[2]==='queue')return json(res,201,delivery.enqueue(owner,x[1],body.dispatchId));
        if(method==='POST'&&x[2]==='attempt')return json(res,200,await delivery.attempt(owner,x[1],x[3]));
      }
      // Wave 25 — scoped safety status; cross-tenant readiness remains CLI-only.
      x=path.match(/^\/api\/ops\/workspaces\/([0-9a-f-]{36})$/i);
      if(x&&method==='GET'){
        const c=governance.portfolio(owner,x[1]);
        const queued=store.one("SELECT COUNT(*) AS n FROM delivery_queue q JOIN release_dispatches d ON d.id=q.dispatch_id JOIN campaigns ca ON ca.id=d.campaign_id WHERE ca.workspace_id=? AND q.status IN ('queued','retry','sending')",x[1]).n;
        return json(res,200,{workspaceId:x[1],emailVerified:identity.status(owner).verified,pendingDeliveries:queued,blockedCampaigns:c.withBlockers,campaigns:c.total,productionReady:false,disclaimer:'Workspace status only. Server-wide production and partner availability are not verified.'});
      }
      // Wave 1. Guests may inspect an invitation, but only verified local accounts can join.
      if(path==='/api/workspaces'&&method==='GET')return json(res,200,{workspaces:workspaces.list(owner)});
      if(path==='/api/workspaces'&&method==='POST')return json(res,201,workspaces.create(owner,body));
      let wm=path.match(/^\/api\/workspaces\/invitation\/([A-Za-z0-9_-]{20,100})$/);
      if(wm&&method==='GET')return json(res,200,workspaces.inviteInfo(wm[1]));
      if(wm&&method==='POST')return json(res,200,workspaces.accept(owner,wm[1]));
      wm=path.match(/^\/api\/workspaces\/([0-9a-f-]{36})(?:\/(invite|share|unshare|review|remove-member|delete))?$/i);
      if(wm){
        const [,wid,action]=wm;
        if(!action&&method==='GET')return json(res,200,workspaces.detail(owner,wid));
        if(method==='POST'&&action==='invite')return json(res,201,workspaces.issueInvite(owner,wid,body));
        if(method==='POST'&&action==='share')return json(res,200,workspaces.share(owner,wid,body.caseId));
        if(method==='POST'&&action==='unshare')return json(res,200,workspaces.unshare(owner,wid,body.caseId));
        if(method==='POST'&&action==='review')return json(res,201,workspaces.comment(owner,wid,body));
        if(method==='POST'&&action==='remove-member')return json(res,200,workspaces.removeMember(owner,wid,body.memberId));
        if(method==='POST'&&action==='delete')return json(res,200,workspaces.deleteWorkspace(owner,wid));
      }
      // Wave 2: research findings are descriptive; no synthetic marketing claims.
      if(path==='/api/research'&&method==='GET')return json(res,200,{studies:research.list(owner)});
      if(path==='/api/research'&&method==='POST')return json(res,201,research.create(owner,body));
      if(path==='/api/research/export.csv'&&method==='GET'){
        res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="JUDGE-research.csv"'});
        return res.end(research.exportCSV(owner));
      }
      let rm=path.match(/^\/api\/research\/([0-9a-f-]{36})(?:\/(conclude))?$/i);
      if(rm){
        if(method==='GET'&&!rm[2])return json(res,200,research.detail(owner,rm[1]));
        if(method==='POST'&&rm[2]==='conclude')return json(res,200,research.conclude(owner,rm[1],body));
      }
      // Waves 16-20: operational control of live editorial releases, never platform publication.
      let gm=path.match(/^\/api\/governance\/campaigns\/([0-9a-f-]{36})(?:\/(policy|link|unlink|issue|issue-resolve|budget|audit-bundle))?$/i);
      if(gm){
        const cid=gm[1],action=gm[2];
        if(method==='GET'&&!action)return json(res,200,governance.detail(owner,cid));
        if(method==='GET'&&action==='audit-bundle')return json(res,200,governance.exportAudit(owner,cid));
        if(method==='POST'){
          limiter.check('governance:'+owner,80,60000);
          if(action==='policy')return json(res,200,governance.policy(owner,cid,body));
          if(action==='link')return json(res,200,governance.bind(owner,cid,body));
          if(action==='unlink')return json(res,200,governance.unbind(owner,cid,body));
          if(action==='issue')return json(res,201,governance.issueCreate(owner,cid,body));
          if(action==='issue-resolve')return json(res,200,governance.issueResolve(owner,cid,body.issueId,body));
          if(action==='budget')return json(res,200,governance.budget(owner,cid,body));
        }
        throw new DomainError('METHOD','Unsupported governance action.',405);
      }
      gm=path.match(/^\/api\/governance\/workspaces\/([0-9a-f-]{36})(?:\/(portfolio|control))?$/i);
      if(gm){
        const wid=gm[1],action=gm[2];
        if(method==='GET'&&action==='portfolio')return json(res,200,governance.portfolio(owner,wid));
        if(method==='POST'&&action==='control')return json(res,200,governance.controlUpdate(owner,wid,body));
        throw new DomainError('METHOD','Unsupported governance action.',405);
      }
      // Waves 11-15: opt-in brand/locale policies, quality, authenticated delivery, manual metrics.
      let om=path.match(/^\/api\/ops\/workspaces\/([0-9a-f-]{36})\/brands$/i);
      if(om){
        if(method==='GET')return json(res,200,{brands:advanced.brandList(owner,om[1])});
        if(method==='POST')return json(res,201,advanced.brandSave(owner,om[1],body));
      }
      om=path.match(/^\/api\/ops\/campaigns\/([0-9a-f-]{36})(?:\/(brand|targets|audit|dispatch|dispatch-revoke|observation|observation-retract))?$/i);
      if(om){
        const [,cid,action]=om;
        if(!action&&method==='GET')return json(res,200,advanced.detail(owner,cid));
        if(method==='POST'){
          limiter.check('ops:'+owner,80,60000);
          if(action==='brand')return json(res,200,advanced.setBrand(owner,cid,body));
          if(action==='targets')return json(res,200,advanced.setTargets(owner,cid,body));
          if(action==='audit')return json(res,200,advanced.quality(owner,cid));
          if(action==='dispatch')return json(res,201,advanced.prepareDispatch(owner,cid,body.releaseId,body));
          if(action==='dispatch-revoke')return json(res,200,advanced.revokeDispatch(owner,cid,body.dispatchId));
          if(action==='observation')return json(res,201,advanced.addObservation(owner,cid,body));
          if(action==='observation-retract')return json(res,200,advanced.retractObservation(owner,cid,body.observationId,body));
        }
      }
      // Waves 6-10: workspace-scoped campaign production. No external ad delivery.
      if(path==='/api/production/campaigns'&&method==='GET')return json(res,200,{campaigns:production.list(owner,url.searchParams.get('workspaceId'))});
      if(path==='/api/production/campaigns'&&method==='POST')return json(res,201,production.create(owner,body));
      let pm=path.match(/^\/api\/production\/campaigns\/([0-9a-f-]{36})(?:\/(update|attach|detach|evidence|creatives|review-request|review-decision|release|export))?(?:\/([0-9a-f-]{36}))?$/i);
      if(pm){
        const [,cid,action,subId]=pm;
        if(!action&&method==='GET')return json(res,200,production.detail(owner,cid));
        if(action==='export'&&subId&&method==='GET')return json(res,200,production.exportRelease(owner,cid,subId));
        if(action==='creatives'&&method==='GET')return json(res,200,production.suggest(owner,cid,url.searchParams.get('briefId'),url.searchParams.get('channel')||'search',url.searchParams.get('language')||'ru'));
        if(method==='POST'){
          limiter.check('production:'+owner,80,60000);
          if(action==='update')return json(res,200,production.update(owner,cid,body));
          if(action==='attach')return json(res,200,production.attach(owner,cid,body));
          if(action==='detach')return json(res,200,production.detach(owner,cid,body));
          if(action==='evidence'&&!subId)return json(res,201,production.addEvidence(owner,cid,body));
          if(action==='evidence'&&subId)return json(res,200,production.reviewEvidence(owner,cid,subId,body));
          if(action==='creatives'&&!subId)return json(res,201,production.creative(owner,cid,body));
          if(action==='creatives'&&subId)return json(res,200,production.removeCreative(owner,cid,subId,body));
          if(action==='review-request')return json(res,200,production.requestReview(owner,cid,body));
          if(action==='review-decision')return json(res,200,production.decide(owner,cid,body));
          if(action==='release')return json(res,200,production.release(owner,cid,body));
        }
      }
      if(path==='/api/cases'&&method==='GET')return json(res,200,{cases:svc.list(owner),stats:svc.stats(owner)});
      if(path==='/api/analytics'&&method==='GET')return json(res,200,svc.analytics(owner));
      if(path==='/api/cases'&&method==='POST'){limiter.check('create:'+owner,20);return json(res,201,svc.create(owner,body));}
      let m=path.match(/^\/api\/cases\/([a-zA-Z0-9-]{36})(?:\/([a-z-]+))?$/);
      if(m) {
        const [,id,action]=m;
        if(!action&&method==='GET')return json(res,200,svc.detail(owner,id));
        if(!action&&method==='DELETE')return json(res,200,svc.deleteCase(owner,id));
        if(action==='audit'&&method==='GET')return json(res,200,svc.audit(owner,id));
        if(action==='comparisons'&&method==='GET')return json(res,200,{comparisons:comparison.summaries(owner,id)});
        if(action==='brief'&&method==='GET'){
          const s=svc.own(owner,id);
          if(s.phase!=='verdict')throw new DomainError('STATE','Сначала завершите дело.',409);
          return json(res,200,{...svc.detail(owner,id).comparison,brief:svc.structuredBrief(owner,id)});
        }
        if(action==='export'&&method==='GET') {
          const s=svc.own(owner,id);
          res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':`attachment; filename="JUDGE-${id.slice(0,8)}.txt"`});return res.end(briefText(s));
        }
        if(method==='POST') {
          const operations={action:'act',brief:'prepare',verdict:'verdict',reopen:'reopen',defend:'defend',invite:'invite',revoke:'revoke',handoff:'handoff','handoff-revoke':'revokeHandoff'};
          if(Object.hasOwn(operations,action))return json(res,200,svc[operations[action]](owner,id,body));
          if(action==='comparison-start')return json(res,200,comparison.start(owner,id,body));
          if(action==='comparison-invite')return json(res,200,comparison.invite(owner,id,body));
          if(action==='comparison-close')return json(res,200,comparison.close(owner,id,body));
          if(action==='ai') {
            limiter.check('ai:'+owner,3,60000);
            if(body.consent!==true)throw new DomainError('CONSENT','Нужно согласие на передачу содержания дела провайдеру ИИ.');
            if(!modelStatus(modelEnv).enabled)throw new DomainError('AI_DISABLED','Живой ИИ не подключён. Доступен сценарный режим.',503);
            const s=svc.own(owner,id),day=new Date().toISOString().slice(0,10);
            svc.assertIntegrity(owner,id);
            if(typeof body.commandId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(body.commandId))throw new DomainError('COMMAND','Нужен уникальный commandId.');
            if(store.one('SELECT 1 FROM commands WHERE case_id=? AND command_id=?',id,body.commandId))return json(res,200,{...svc.detail(owner,id),duplicate:true});
            if(store.one('SELECT 1 FROM ai_reservations WHERE case_id=? AND command_id=?',id,body.commandId))throw new DomainError('AI_ALREADY_ATTEMPTED','Этот запрос ИИ уже выполнялся. Обновите дело перед новой попыткой.',409);
            if(s.version!==body.expectedVersion)throw new DomainError('VERSION_CONFLICT','Дело изменилось. Обновите страницу.',409);
            const count=store.one('SELECT COUNT(*) AS n FROM ai_requests WHERE day=?',day).n;
            if(count>=aiLimit)throw new DomainError('AI_BUDGET','Дневной лимит запросов ИИ исчерпан.',429);
            const requestId=randomUUID();store.tx(()=>{store.run('INSERT INTO ai_requests VALUES(?,?,?,?)',requestId,owner,day,'started');store.run('INSERT INTO ai_reservations VALUES(?,?,?)',id,body.commandId,requestId);});
            try {
              const result=await provider(s,{env:modelEnv});
              const output=svc.command(owner,id,body,current=>{svc.append(current,'ai_commentary',result);return {ai:result};});
              store.run('UPDATE ai_requests SET status=? WHERE id=?','completed',requestId);return json(res,200,output);
            } catch(e){store.run('UPDATE ai_requests SET status=? WHERE id=?','failed',requestId);throw e;}
          }
        }
      }
      m=path.match(/^\/api\/witness\/([A-Za-z0-9_-]{20,100})$/);
      if(m&&method==='GET')return json(res,200,svc.publicInvite(m[1]));
      if(m&&method==='POST'){limiter.check('objection:'+ip,10,600000);return json(res,200,svc.object(owner,m[1],body));}
      const compareMatch=path.match(/^\/api\/compare\/([A-Za-z0-9_-]{20,100})$/);
      if(compareMatch&&method==='GET')return json(res,200,comparison.public(compareMatch[1]));
      if(compareMatch&&method==='POST'){
        limiter.check('compare-vote:'+ip,12,600000);
        return json(res,200,comparison.vote(owner,compareMatch[1],body));
      }
      if(path==='/api/privacy/export'&&method==='GET')return json(res,200,{...svc.export(owner),cinemaImports:cinema.export(owner),production:production.exportUser(owner),advanced:advanced.exportUser(owner),governance:governance.exportUser(owner),
        waves21to25:{identity:identity.status(owner),emailChallengeHistory:store.all('SELECT purpose,issued_at AS issuedAt,consumed_at AS consumedAt,revoked_at AS revokedAt FROM email_challenges WHERE user_id=? ORDER BY issued_at DESC LIMIT 100',owner),
          revisionRestorations:store.all('SELECT campaign_id AS campaignId,release_id AS releaseId,previous_revision AS previousRevision,new_revision AS newRevision,created_at AS createdAt FROM creative_revision_snapshots WHERE created_by=?',owner),
          manualCsvBatches:store.all('SELECT campaign_id AS campaignId,release_id AS releaseId,source_name AS sourceName,row_count AS rowCount,created_at AS createdAt FROM measurement_batches WHERE created_by=?',owner),
          partnerDeliveryHistory:store.all('SELECT q.platform_id AS platformId,q.status,q.attempts,q.created_at AS createdAt FROM delivery_queue q JOIN release_dispatches d ON d.id=q.dispatch_id WHERE d.created_by=?',owner)} });
      if(path==='/api/privacy/delete'&&method==='POST') {
        if(body.confirm!=='DELETE')throw new DomainError('CONFIRM','Нужно подтвердить удаление.');
        const existingUser=store.one('SELECT email FROM users WHERE id=?',owner);
        store.run('DELETE FROM ai_requests WHERE owner_id=?',owner);
        if(existingUser)store.run('DELETE FROM auth_failures WHERE key_hash=?',hash('login:'+existingUser.email));
        // The new workspace-level data tables do not reference users through
        // foreign keys. Remove account-authored snapshots/CSV metadata before
        // deleting the user, including user-controlled filenames and text.
        store.run('DELETE FROM creative_revision_snapshots WHERE created_by=?',owner);
        store.run('DELETE FROM measurement_batches WHERE created_by=?',owner);
        governance.cleanupUser(owner);advanced.cleanupUser(owner);production.cleanupUser(owner);workspaces.cleanupUser(owner);svc.deleteOwner(owner);res.setHeader('Set-Cookie',sessionCookie('',0));return json(res,200,{ok:true});
      }
      throw new DomainError('NOT_FOUND','Маршрут не найден.',404);
    }catch(e){
      if(!res.headersSent){const status=e instanceof DomainError?e.status:500;if(status===429)res.setHeader('Retry-After','60');json(res,status,{error:{code:e.code??'INTERNAL',message:e instanceof DomainError?e.message:'Ошибка сервера. Содержание дела не выводится в журнал.'}});}
      else res.end();
      if(!(e instanceof DomainError))console.error('[judge] internal error',e.name);
    }
  });
  server.requestTimeout=30000;server.headersTimeout=10000;
  server.on('clientError',(_,socket)=>socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
  return {server,store,svc,comparison,workspaces,research,production,advanced,governance,identity,revisions,imports,delivery,readiness,host,port,origin};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major<22||(major===22&&minor<13)){console.error('JUDGE requires Node.js >= 22.13.0.');process.exit(1);}
  const app=createApp();
  app.server.listen(app.port,app.host,()=>console.log(`\n  ADVERSE / JUDGE v${VERSION}\n  ${app.origin}\n  SQLite persistence enabled. Remote AI: ${modelStatus().enabled?'configured':'off (scenario mode)'}\n  Ctrl+C to stop.\n`));
  app.server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'Port is busy. Set another PORT and APP_ORIGIN.':e.message);process.exit(1);});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.server.close(()=>{app.store.close();process.exit(0);}));
}