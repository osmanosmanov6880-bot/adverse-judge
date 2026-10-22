/** Wave 5: safe retention sweep. Dry-run by default; never erase reader votes. */
import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';import {resolve} from 'node:path';
const file=resolve(process.env.JUDGE_DB||'data/judge.sqlite');
const apply=process.argv.includes('--apply')&&process.argv.includes('--confirm-purge');
if(!existsSync(file)){console.error('Database does not exist: '+file);process.exit(1);}
const db=new DatabaseSync(file,{readOnly:!apply});
db.exec('PRAGMA foreign_keys=ON');
const now=Date.now();
const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));
const safe=table=>tables.has(table);
const counts={expiredSessions:safe('sessions')?db.prepare('SELECT COUNT(*) n FROM sessions WHERE expires_at<?').get(now).n:0,
  expiredUnusedInvites:safe('invites')?db.prepare('SELECT COUNT(*) n FROM invites WHERE expires_at<? AND used_at IS NULL').get(now).n:0,
  expiredUnusedComparisonLinks:safe('comparison_links')?db.prepare('SELECT COUNT(*) n FROM comparison_links WHERE expires_at<? AND used_at IS NULL AND NOT EXISTS(SELECT 1 FROM comparison_votes v WHERE v.link_id=comparison_links.id)').get(now).n:0,
  expiredUnusedTeamInvites:safe('workspace_invites')?db.prepare('SELECT COUNT(*) n FROM workspace_invites WHERE expires_at<? AND used_at IS NULL').get(now).n:0};
if(apply){
 db.exec('BEGIN IMMEDIATE');
 try{
  if(safe('sessions'))db.prepare('DELETE FROM sessions WHERE expires_at<?').run(now);
  if(safe('invites'))db.prepare('DELETE FROM invites WHERE expires_at<? AND used_at IS NULL').run(now);
  if(safe('comparison_links'))db.prepare('DELETE FROM comparison_links WHERE expires_at<? AND used_at IS NULL AND NOT EXISTS(SELECT 1 FROM comparison_votes v WHERE v.link_id=comparison_links.id)').run(now);
  if(safe('workspace_invites'))db.prepare('DELETE FROM workspace_invites WHERE expires_at<? AND used_at IS NULL').run(now);
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
db.close();
console.log(JSON.stringify({mode:apply?'APPLIED':'DRY_RUN',removed:apply?counts:null,candidates:counts,warning:'Reader votes, published cases, and evidence ledgers are never purged by this job.'},null,2));
