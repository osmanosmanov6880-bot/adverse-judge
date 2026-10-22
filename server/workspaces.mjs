/** Wave 1 — account-bound collaboration. No guest can join a workspace.
 * Members see ONLY cases deliberately shared to their workspace.
 * Sharing never grants permission to modify the underlying case ledger. */
import {randomUUID} from 'node:crypto';
import {DomainError,text} from '../shared/domain.mjs';
import {token,hash} from './security.mjs';

const ROLES=new Set(['reviewer','viewer']);
export class WorkspaceService {
  constructor(judge,{identity=null}={}){this.judge=judge;this.store=judge.store;this.identity=identity;}
  now(){return this.judge.now();}
  registered(user){
    if(!this.store.one('SELECT 1 FROM users WHERE id=?',user))throw new DomainError('ACCOUNT_REQUIRED','Командная работа доступна только зарегистрированным пользователям.',403);
    this.identity?.assertVerified(user);
  }
  member(user,id,min='viewer'){
    this.registered(user);
    const ws=this.store.one('SELECT * FROM workspaces WHERE id=?',id);
    if(!ws)throw new DomainError('NOT_FOUND','Пространство не найдено.',404);
    const member=this.store.one('SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?',id,user);
    if(!member)throw new DomainError('NOT_FOUND','Пространство не найдено или недоступно.',404);
    if(min==='owner'&&member.role!=='owner'||min==='reviewer'&&member.role==='viewer')throw new DomainError('FORBIDDEN','Недостаточно прав для действия.',403);
    return {...ws,role:member.role};
  }
  list(user){
    if(!this.store.one('SELECT 1 FROM users WHERE id=?',user))return [];
    return this.store.all(`SELECT w.id,w.name,w.created_at AS createdAt,m.role,
       (SELECT COUNT(*) FROM workspace_cases wc WHERE wc.workspace_id=w.id) AS caseCount,
       (SELECT COUNT(*) FROM workspace_members wm WHERE wm.workspace_id=w.id) AS memberCount
       FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=? ORDER BY w.created_at DESC`,user);
  }
  create(user,body){
    this.registered(user);
    const name=text(body.name,'Название пространства',3,80);
    if(this.store.one('SELECT COUNT(*) AS n FROM workspaces WHERE owner_id=?',user).n>=10)throw new DomainError('LIMIT','Достигнут предел: десять пространств.',409);
    const id=randomUUID(),now=this.now();
    this.store.tx(()=>{
      this.store.run('INSERT INTO workspaces(id,owner_id,name,created_at) VALUES(?,?,?,?)',id,user,name,now);
      this.store.run('INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES(?,?,?,?)',id,user,'owner',now);
      this.log(id,user,'workspace_created',{name});
    });
    return {id,name,role:'owner'};
  }
  log(id,actor,type,data){this.store.run('INSERT INTO workspace_events(workspace_id,actor_id,type,data,created_at) VALUES(?,?,?,?,?)',id,actor,type,JSON.stringify(data),this.now());}
  detail(user,id){
    const ws=this.member(user,id);
    const members=this.store.all(`SELECT wm.user_id AS id,u.email,wm.role,wm.joined_at AS joinedAt FROM workspace_members wm
      JOIN users u ON u.id=wm.user_id WHERE wm.workspace_id=? ORDER BY wm.joined_at`,id);
    const cases=this.store.all(`SELECT wc.case_id AS id,wc.shared_at AS sharedAt,c.state FROM workspace_cases wc
      JOIN cases c ON c.id=wc.case_id WHERE wc.workspace_id=? ORDER BY wc.shared_at DESC LIMIT 150`,id)
      .map(x=>({id:x.id,sharedAt:x.sharedAt,state:JSON.parse(x.state)}));
    const reviews=this.store.all(`SELECT r.id,r.case_id AS caseId,r.user_id AS userId,u.email,r.comment,r.created_at AS createdAt
      FROM workspace_reviews r JOIN users u ON u.id=r.user_id WHERE r.workspace_id=? ORDER BY r.created_at DESC LIMIT 100`,id);
    const events=this.store.all('SELECT type,created_at AS at FROM workspace_events WHERE workspace_id=? ORDER BY id DESC LIMIT 30',id);
    return {...ws,members,cases,reviews,events};
  }
  issueInvite(user,id,body){
    this.member(user,id,'owner');
    const role=body.role;
    if(!ROLES.has(role))throw new DomainError('VALIDATION','Роль должна быть reviewer или viewer.');
    if(this.store.one('SELECT COUNT(*) AS n FROM workspace_invites WHERE workspace_id=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?',id,this.judge.clock()).n>=20)
      throw new DomainError('LIMIT','Слишком много активных приглашений.',409);
    const idToken=token(),inviteId=randomUUID(),expiresAt=this.judge.clock()+3*86400000;
    this.store.tx(()=>{
      this.store.run('INSERT INTO workspace_invites(id,workspace_id,token_hash,role,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?)',inviteId,id,hash(idToken),role,user,this.now(),expiresAt);
      this.log(id,user,'invite_created',{inviteId,role});
    });
    return {token:idToken,role,expiresAt};
  }
  inviteInfo(raw){
    if(typeof raw!=='string'||!/^[A-Za-z0-9_-]{20,100}$/.test(raw))throw new DomainError('NOT_FOUND','Приглашение не найдено.',404);
    const invite=this.store.one(`SELECT i.id,i.workspace_id,i.role,i.expires_at,i.used_at,i.revoked_at,w.name
      FROM workspace_invites i JOIN workspaces w ON w.id=i.workspace_id WHERE token_hash=?`,hash(raw));
    if(!invite)throw new DomainError('NOT_FOUND','Приглашение не найдено.',404);
    if(invite.used_at||invite.revoked_at||invite.expires_at<=this.judge.clock())throw new DomainError('EXPIRED','Приглашение больше не действует.',410);
    return {workspace:invite.name,role:invite.role,expiresAt:invite.expires_at};
  }
  accept(user,raw){
    this.registered(user);
    return this.store.tx(()=>{
      this.inviteInfo(raw);
      const i=this.store.one('SELECT * FROM workspace_invites WHERE token_hash=?',hash(raw));
      if(this.store.one('SELECT 1 FROM workspace_members WHERE workspace_id=? AND user_id=?',i.workspace_id,user))throw new DomainError('ALREADY_MEMBER','Вы уже состоите в пространстве.',409);
      if(this.store.one('SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id=?',i.workspace_id).n>=25)throw new DomainError('LIMIT','Рабочее пространство заполнено (25 участников).',409);
      this.store.run('INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES(?,?,?,?)',i.workspace_id,user,i.role,this.now());
      this.store.run('UPDATE workspace_invites SET used_at=? WHERE id=?',this.now(),i.id);
      this.log(i.workspace_id,user,'member_joined',{role:i.role});
      return {workspaceId:i.workspace_id,role:i.role};
    });
  }
  share(user,id,caseId){
    this.member(user,id,'reviewer');
    this.judge.own(user,caseId);
    this.judge.assertIntegrity(user,caseId);
    return this.store.tx(()=>{
      const previous=this.store.one('SELECT 1 FROM workspace_cases WHERE workspace_id=? AND case_id=?',id,caseId);
      if(previous)return {ok:true,duplicate:true};
      if(this.store.one('SELECT COUNT(*) AS n FROM workspace_cases WHERE workspace_id=?',id).n>=150)throw new DomainError('LIMIT','Достигнут предел общих дел.',409);
      this.store.run('INSERT INTO workspace_cases(workspace_id,case_id,shared_by,shared_at) VALUES(?,?,?,?)',id,caseId,user,this.now());
      this.log(id,user,'case_shared',{caseId});
      return {ok:true,duplicate:false};
    });
  }
  unshare(user,id,caseId){
    this.member(user,id,'reviewer');this.judge.own(user,caseId);
    return this.store.tx(()=>{
      this.store.run('DELETE FROM workspace_cases WHERE workspace_id=? AND case_id=?',id,caseId);
      this.log(id,user,'case_unshared',{caseId});return {ok:true};
    });
  }
  comment(user,id,body){
    this.member(user,id,'reviewer');
    const caseId=body.caseId,comment=text(body.comment,'Комментарий',10,1200);
    if(!this.store.one('SELECT 1 FROM workspace_cases WHERE workspace_id=? AND case_id=?',id,caseId))throw new DomainError('NOT_FOUND','Дело не опубликовано в пространстве.',404);
    if(this.store.one('SELECT COUNT(*) AS n FROM workspace_reviews WHERE workspace_id=?',id).n>=2000)throw new DomainError('LIMIT','Превышен лимит комментариев.',409);
    return this.store.tx(()=>{
      const cid=randomUUID();this.store.run('INSERT INTO workspace_reviews(id,workspace_id,case_id,user_id,comment,created_at) VALUES(?,?,?,?,?,?)',cid,id,caseId,user,comment,this.now());
      this.log(id,user,'review_added',{caseId,reviewId:cid});return {id:cid};
    });
  }
  removeMember(user,id,memberId){
    this.member(user,id,'owner');
    if(user===memberId)throw new DomainError('STATE','Владелец не может удалить самого себя.',409);
    return this.store.tx(()=>{
      const r=this.store.run('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=? AND role<>?',id,memberId,'owner');
      if(!r.changes)throw new DomainError('NOT_FOUND','Участник не найден.',404);
      this.log(id,user,'member_removed',{});return {ok:true};
    });
  }
  deleteWorkspace(user,id){
    this.member(user,id,'owner');
    this.store.run('DELETE FROM workspaces WHERE id=?',id);return {ok:true};
  }
  cleanupUser(user){
    const owned=this.store.all('SELECT id FROM workspaces WHERE owner_id=?',user).map(x=>x.id);
    for(const id of owned)this.store.run('DELETE FROM workspaces WHERE id=?',id);
    this.store.run('DELETE FROM workspace_members WHERE user_id=?',user);
    this.store.run('DELETE FROM workspace_invites WHERE created_by=?',user);
    this.store.run('DELETE FROM workspace_reviews WHERE user_id=?',user);
    this.store.run('UPDATE workspace_events SET actor_id=NULL WHERE actor_id=?',user);
  }
}
