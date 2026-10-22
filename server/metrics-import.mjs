/** Wave 23: deterministic preview/commit of manual CSV metrics with provenance.
 * Rows are unverified human reports, never platform-confirmed attribution.
 */
import {randomUUID,createHash} from 'node:crypto';
import {DomainError,text} from '../shared/domain.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const FIELDS=['date','spend_minor','impressions','clicks','leads','currency','note'];
const UUID=/^[0-9a-f-]{36}$/i;
function parseCSV(input){
 if(typeof input!=='string'||input.length>24000)throw new DomainError('CSV_SIZE','CSV must be at most 24 KB.');
 let rows=[],row=[],field='',quoted=false,closed=false;
 for(let i=0;i<input.length;i++){
  const c=input[i];
  if(quoted){if(c==='"'){if(input[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
  if(c==='"'&&!field&&!closed){quoted=true;continue;}
  if(c===','||c==='\n'||c==='\r'){
   row.push(field);field='';closed=false;
   if(c!==','){
    if(c==='\r'&&input[i+1]==='\n')i++;
    if(row.some(v=>v!==''))rows.push(row);
    row=[];
   }
   continue;
  }
  if(closed)throw new DomainError('CSV_PARSE','Unexpected content after a closing quote.');
  if(c==='"')throw new DomainError('CSV_PARSE','Unexpected quote inside a field.');
  field+=c;
 }
 if(quoted)throw new DomainError('CSV_PARSE','Unterminated quoted field.');
 if(field||row.length){row.push(field);if(row.some(v=>v!==''))rows.push(row);}
 if(rows.length<2||rows.length>101)throw new DomainError('CSV_ROWS','CSV needs a header and 1–100 rows.');
 if(rows[0].length!==FIELDS.length||FIELDS.some((f,i)=>rows[0][i]!==f))throw new DomainError('CSV_HEADER','Expected exactly: '+FIELDS.join(','));
 if(rows.slice(1).some(row=>row.length!==FIELDS.length))throw new DomainError('CSV_COLUMNS','Every row needs seven columns.');
 return rows.slice(1);
}
function isIso(day){return /^20\d{2}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day+'T00:00:00Z'))&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;}
function cleanRows(csv,now=Date.now()){
 const rows=parseCSV(csv).map((r,i)=>{
  const [date,...rest]=r;
  if(!isIso(date)||Date.parse(date+'T00:00:00Z')>now+86400000)throw new DomainError('CSV_DATE',`Invalid date on CSV row ${i+2}.`);
  const ints=rest.slice(0,4).map((s,j)=>{
   if(!/^(0|[1-9]\d{0,9})$/.test(s)||!Number.isSafeInteger(+s))throw new DomainError('CSV_NUMBER',`Invalid integer at row ${i+2}, column ${j+2}.`);return +s;
  });
  const [spendMinor,impressions,clicks,leads]=ints;
  if(clicks>impressions||leads>clicks)throw new DomainError('CSV_FUNNEL',`Click and lead counts invalid at row ${i+2}.`);
  const currency=r[5];if(!['EUR','USD','SEK','GBP'].includes(currency))throw new DomainError('CSV_CURRENCY',`Invalid currency at row ${i+2}.`);
  const note=text(r[6],'CSV source note',12,400);
  return {date,spendMinor,impressions,clicks,leads,currency,note};
 });
 const unique=new Set(rows.map(row=>JSON.stringify(row)));
 if(unique.size!==rows.length)throw new DomainError('CSV_DUPLICATE','Duplicate observation rows in CSV.');
 return rows;
}
export class MetricsImportService{
 constructor(advanced){this.adv=advanced;this.prod=advanced.prod;this.store=advanced.store;}
 preview(user,cid,{releaseId,csv,sourceName}={}){
  const c=this.prod.campaign(user,cid,'reviewer');
  if(typeof releaseId!=='string'||!UUID.test(releaseId)||!this.store.one('SELECT 1 FROM campaign_releases WHERE id=? AND campaign_id=?',releaseId,cid))throw new DomainError('NOT_FOUND','Release not found in campaign.',404);
  const name=text(sourceName,'Source file label',3,120);
  const rows=cleanRows(csv),digest=sha(JSON.stringify([releaseId,name,rows.slice().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
  const existing=this.store.one('SELECT id FROM measurement_batches WHERE campaign_id=? AND digest=?',cid,digest);
  const already=this.store.one('SELECT COUNT(*) AS n FROM campaign_observations WHERE campaign_id=?',cid).n;
  if(already+rows.length>500)throw new DomainError('LIMIT','Would exceed the 500-observation campaign limit.',409);
  const totals={};for(const r of rows){const t=totals[r.currency]??(totals[r.currency]={currency:r.currency,spendMinor:0,impressions:0,clicks:0,leads:0});for(const k of ['spendMinor','impressions','clicks','leads'])t[k]+=r[k];}
  return {campaignId:c.id,revision:c.revision,releaseId,sourceName:name,rows,digest,alreadyImported:!!existing,existingBatchId:existing?.id||null,totals:Object.values(totals),disclaimer:'CSV is a human-supplied report, not a verified partner integration. No attribution or ROI is inferred.'};
 }
 commit(user,cid,input){return this.store.tx(()=>{
  const preview=this.preview(user,cid,input),c=this.prod.campaign(user,cid,'reviewer');
  if(input.expectedRevision!==c.revision)throw new DomainError('VERSION_CONFLICT','Campaign changed. Preview again.',409);
  if(input.digest!==preview.digest)throw new DomainError('CSV_CHANGED','CSV content differs from the approved preview.',409);
  if(input.acknowledged!==true)throw new DomainError('ACK_REQUIRED','Confirm that these values are unverified manual reports.');
  if(preview.alreadyImported)return {duplicate:true,batchId:preview.existingBatchId,rowCount:preview.rows.length};
  const batchId=randomUUID(),at=this.prod.now();
  this.store.run('INSERT INTO measurement_batches VALUES(?,?,?,?,?,?,?,?)',batchId,cid,preview.releaseId,preview.digest,preview.sourceName,preview.rows.length,user,at);
  for(let i=0;i<preview.rows.length;i++){
   const r=preview.rows[i],oid=randomUUID();
   this.store.run(`INSERT INTO campaign_observations(id,campaign_id,release_id,date,source,spend_minor,impressions,clicks,leads,currency,note,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,oid,cid,preview.releaseId,r.date,'manual',r.spendMinor,r.impressions,r.clicks,r.leads,r.currency,r.note,user,at);
   this.store.run('INSERT INTO measurement_batch_rows(batch_id,observation_id,source_row) VALUES(?,?,?)',batchId,oid,i+2);
  }
  this.adv.event(cid,user,'manual_csv_batch_imported',{batchId,rows:preview.rows.length,digest:preview.digest});
  return {batchId,rowCount:preview.rows.length,duplicate:false,totals:this.adv.measurements(user,cid).totals};
 });}
 list(user,cid){this.prod.campaign(user,cid);return this.store.all('SELECT id,release_id AS releaseId,digest,source_name AS sourceName,row_count AS rowCount,created_at AS createdAt FROM measurement_batches WHERE campaign_id=? ORDER BY created_at DESC LIMIT 100',cid);}
}
export {parseCSV,cleanRows};
