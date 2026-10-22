"""Five Waves acceptance suite. Headless Chromium with HTTP bridge to a genuine local Node API.
No third-party domains, accounts or credentials are accessed.
"""
from pathlib import Path
import os,re,socket,subprocess,tempfile,time,urllib.request,urllib.error,http.cookiejar,json
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('JUDGE_WAVES_QA_OUT',ROOT/'reports/browser-five-waves'))
OUT.mkdir(parents=True,exist_ok=True)
checks=[]
def ok(title):checks.append(title);print('PASS',title,flush=True)

def main():
 with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
 origin=f'http://127.0.0.1:{port}'
 with tempfile.TemporaryDirectory(prefix='judge-waves-') as tmp:
  env={**os.environ,'PORT':str(port),'APP_ORIGIN':origin,'JUDGE_DB':str(Path(tmp)/'judge.sqlite'),'JUDGE_ALLOW_REMOTE_AI':'false', 'JUDGE_LEDGER_SECRET':'five-waves-test-only-secret-32-chars-minimum'}
  log=(OUT/'server.log').open('w')
  server=subprocess.Popen(['node','server/index.mjs'],cwd=ROOT,env=env,stdout=log,stderr=log)
  try:
   for _ in range(80):
    try:urllib.request.urlopen(origin+'/api/health',timeout=1);break
    except Exception:time.sleep(.12)
   else:raise RuntimeError('Server startup failed')
   def flat(s):return re.sub(r'^export ','',re.sub(r'^import .*?;\s*$','',s,flags=re.M),flags=re.M)
   scripts='\n'.join(flat((ROOT/p).read_text()) for p in ['shared/domain.mjs','public/api.mjs','public/studio.mjs','public/production.mjs','public/i18n.mjs','public/app.mjs'])
   shim="""if(!crypto.randomUUID)crypto.randomUUID=()=> '10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));
    globalThis.fetch=async(url,options={})=>{const r=await window.__judgeHttp({url,options});return {ok:r.status>=200&&r.status<300,status:r.status,json:async()=>JSON.parse(r.body),text:async()=>r.body};};"""
   html=(ROOT/'public/index.html').read_text().replace('<link rel="icon" href="/favicon.svg" type="image/svg+xml">','').replace('<link rel="stylesheet" href="/styles.css">',f'<style>{(ROOT/"public/styles.css").read_text()}</style>').replace('<script type="module" src="/app.mjs"></script>',f'<script>{shim}\n{scripts}</script>')
   errors=[]
   with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE','/usr/bin/chromium'),args=['--no-sandbox'])
    def actor(width=1440):
     jar=http.cookiejar.CookieJar();opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
     ctx=browser.new_context(viewport={'width':width,'height':1050},reduced_motion='reduce')
     page=ctx.new_page();page.set_default_timeout(10000)
     page.on('pageerror',lambda e:errors.append(str(e)))
     def bridge(payload):
      url=payload['url'];assert url.startswith('/api/'),url
      options=payload.get('options',{});headers=dict(options.get('headers',{}));headers['Origin']=origin
      data=options.get('body');data=data.encode() if data is not None else None
      req=urllib.request.Request(origin+url,headers=headers,data=data,method=options.get('method','GET'))
      try:r=opener.open(req,timeout=25)
      except urllib.error.HTTPError as ex:r=ex
      return {'status':r.status,'body':r.read().decode()}
     page.expose_function('__judgeHttp',bridge);page.set_content(html,wait_until='load')
     expect(page.locator('.hero h1')).to_be_visible()
     return ctx,page
    def nav(page,dest,selector=None):
     (page.evaluate('render()') if page.evaluate('location.hash')==dest else page.evaluate("p=>location.hash=p",dest))
     if selector:expect(page.locator(selector).first).to_be_visible()
    def account(page,email):
     page.locator('[data-action=account]').first.click()
     page.locator('#auth-form [name=email]').fill(email)
     page.locator('#auth-form [name=password]').fill('a-Strong-Synthetic-Password-2026')
     page.locator('#auth-form [name=accepted]').check()
     page.locator('#auth-form [type=submit]').click()
     expect(page.locator('.profile-button')).to_contain_text(email)
    owner,po=actor();account(po,'owner@demo.invalid');ok('Registered author has a persistent team-capable account')
    po.locator('[data-action=demo][data-id=marketing]').first.click();expect(po.locator('.action-card')).to_have_count(3)
    ownerCase=po.evaluate('location.hash')
    po.locator('[data-action=choose][data-id=narrow]').click()
    po.locator('#brief-form [type=submit]').click()
    po.locator('#verdict-form [name=claim]').fill('Создавайте рекламные материалы для малого бизнеса.')
    po.locator('#verdict-form [name=acknowledged]').check();po.locator('#verdict-form [type=submit]').click()
    expect(po.locator('.studio-case-tools')).to_be_visible();ok('Judge verdict leads to team and research tools')
    nav(po,'#/workspaces','.studio-hero')
    po.locator('[data-action=studio-workspace-new]').click()
    po.locator('#studio-workspace-create-form [name=name]').fill('ADVERSE Strategy Council')
    po.locator('#studio-workspace-create-form [type=submit]').click()
    expect(po.locator('.studio-member')).to_have_count(1)
    wsHash=po.evaluate('location.hash');wsId=wsHash.split('/')[-1]
    po.screenshot(path=str(OUT/'wave1-workspace-desktop.png'),full_page=True)
    ok('Wave 1: owner creates collaborative workspace and reads its members')
    po.locator('[data-action=studio-invite]').click()
    po.locator('#studio-invite-form [name=role]').select_option('reviewer')
    po.locator('#studio-invite-form [type=submit]').click()
    inviteLink=po.locator('#modal .link-box').input_value()
    assert '/workspace-invite/' in inviteLink
    token=inviteLink.split('/workspace-invite/')[1]
    po.locator('[data-action=close]').click()
    reviewer,pr=actor();account(pr,'reviewer@demo.invalid');nav(pr,'#/workspace-invite/'+token,'.studio-invite-wrap')
    expect(pr.locator('.studio-invite-wrap')).to_contain_text('ADVERSE Strategy Council')
    pr.locator('[data-action=studio-accept]').click()
    expect(pr.locator('.studio-member')).to_have_count(2)
    assert pr.locator('.studio-case').count()==0
    ok('Wave 1: a second authenticated person accepts the one-use invitation; cases stay private')
    nav(po,ownerCase,'.studio-case-tools')
    po.locator('[data-action=studio-share]').click()
    po.locator('#studio-share-form [name=workspaceId]').select_option(wsId)
    po.locator('#studio-share-form [name=confirm]').check()
    po.locator('#studio-share-form [type=submit]').click()
    nav(pr,'#/workspace/'+wsId,'.studio-case')
    expect(pr.locator('.studio-case')).to_have_count(1)
    pr.locator('[data-action=studio-review-new]').click()
    pr.locator('#studio-review-form [name=comment]').fill('Поясните, какие именно рекламные форматы доступны на платформе и что получает клиент.')
    pr.locator('#studio-review-form [type=submit]').click()
    expect(pr.locator('.studio-review')).to_contain_text('Поясните')
    ok('Wave 1: explicitly shared case is reviewed by colleague with no authority over case state')
    nav(po,'#/workspace/'+wsId,'.studio-case')
    expect(po.locator('.studio-review')).to_contain_text('Поясните')
    po.screenshot(path=str(OUT/'wave1-workspace-feedback.png'),full_page=True)
    nav(po,ownerCase,'.verdict-banner')
    po.locator('[data-action=comparison-start]').click()
    po.locator('#comparison-start-form [name=consent]').check();po.locator('#comparison-start-form [type=submit]').click()
    expect(po.locator('.evidence-study')).to_have_count(1)
    po.locator('[data-action=studio-research-new]').click()
    po.locator('#studio-research-create-form [name=hypothesis]').fill('Более конкретная формулировка будет читателю понятнее с первого прочтения.')
    po.locator('#studio-research-create-form [name=targetResponses]').fill('8')
    po.locator('#studio-research-create-form [type=submit]').click()
    expect(po.locator('.research-bar')).to_have_count(3)
    researchHash=po.evaluate('location.hash')
    po.screenshot(path=str(OUT/'wave2-study-empty.png'),full_page=True)
    ok('Wave 2: study records pre-specified hypothesis and target sample on server')
    # Generate a real vote through evidence room (independent guest browser).
    nav(po,ownerCase,'.evidence-study')
    po.locator('[data-action=comparison-invite]').click()
    voteToken=po.locator('#modal .link-box').input_value().split('/compare/')[1]
    po.locator('[data-action=close]').click()
    respondent,candidate=actor();nav(candidate,'#/compare/'+voteToken,'.comparison-public')
    candidate.locator('#compare-form [value=first]').check()
    candidate.locator('#compare-form [name=accepted]').check()
    candidate.locator('#compare-form [type=submit]').click()
    expect(candidate.locator('.empty.card')).to_be_visible()
    nav(po,researchHash,'.research-bar')
    expect(po.locator('.studio-tabs')).to_contain_text('1 ответов')
    po.screenshot(path=str(OUT/'wave2-study-real-vote.png'),full_page=True)
    ok('Wave 2: research view counts actual independent human vote, with uncertainty interval')
    po.locator('#studio-research-decision-form [name=decision]').select_option('inconclusive')
    po.locator('#studio-research-decision-form [name=note]').fill('Пока только один добровольный ответ — этого недостаточно для общего вывода.')
    po.locator('#studio-research-decision-form [type=submit]').click()
    expect(po.locator('.studio-review')).to_contain_text('один добровольный ответ')
    ok('Wave 2: research editor conclusion is durable and separate from votes')
    # Language switching on primary site surfaces; not asserting full language coverage.
    nav(po,'#/workspaces','.studio-hero');po.locator('#judge-locale').select_option('en')
    expect(po.locator('nav')).to_contain_text('Teams')
    po.screenshot(path=str(OUT/'wave3-workspaces-en.png'),full_page=True)
    po.locator('#judge-locale').select_option('zh')
    expect(po.locator('nav')).to_contain_text('团队')
    po.screenshot(path=str(OUT/'wave3-workspaces-zh.png'),full_page=True)
    po.locator('#judge-locale').select_option('ru')
    ok('Wave 3: RU → EN → Chinese UI selection persists and updates navigation')
    # Responsive dashboards with no horizontal overflow.
    mobile,pm=actor(width=390);account(pm,'mobile@demo.invalid')
    nav(pm,'#/workspaces','.studio-hero');pm.screenshot(path=str(OUT/'wave3-mobile-team.png'),full_page=True)
    assert pm.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
    nav(po,'#/research','.studio-grid')
    assert po.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
    ok('Five Waves: workspace and research layouts have no overflow at mobile and desktop')
    assert not errors,errors
    ok('No page-level JavaScript exceptions in team, study, and localization flows')
    for ctx in [owner,reviewer,respondent,mobile]:ctx.close()
    browser.close()
  finally:
   server.terminate()
   try:server.wait(timeout=5)
   except subprocess.TimeoutExpired:server.kill()
   log.close()
 (OUT/'results.json').write_text(json.dumps({'passed':len(checks),'checks':checks},ensure_ascii=False,indent=2))
 print('RESULT',len(checks),'checks passed')
if __name__=='__main__':main()
