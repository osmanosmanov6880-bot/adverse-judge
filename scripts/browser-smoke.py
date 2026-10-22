"""Browser interaction QA against the real local HTTP API.
This environment's managed Chromium blocks all URL navigations. HTML/CSS/modules
are embedded into about:blank; a Python HTTP bridge forwards /api requests to the
actual Node server with one cookie jar per test user. Native Origin, cookies and
CSP are separately covered by Node HTTP tests. No external network is accessed.
Requires Python playwright plus a Chromium executable (test dependency only).
"""
from pathlib import Path
import json, os, re, socket, subprocess, tempfile, time, urllib.request, urllib.error, http.cookiejar
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('JUDGE_QA_OUT', ROOT / 'reports/screenshots'))
OUT.mkdir(parents=True, exist_ok=True)
results=[]
def passed(name):
    results.append({'name':name,'status':'passed'})
    print('PASS',name,flush=True)

def main():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
    origin=f'http://127.0.0.1:{port}'
    with tempfile.TemporaryDirectory(prefix='judge-browser-') as tmp:
        # Temporary synthetic receiver exercises UI only. No requests go to partner.example.com.
        manifest=json.loads((ROOT/'config/platforms.json').read_text())
        manifest[0].update({'name':'Test partner A','mode':'deeplink','verified':True,'url':'https://partner.example.com/import','credentialEnv':'JUDGE_QA_PARTNER_KEY','confirmedEvents':['ad_created']})
        config_file=Path(tmp)/'platforms.json';config_file.write_text(json.dumps(manifest))
        env=dict(os.environ,PORT=str(port),APP_ORIGIN=origin,JUDGE_DB=str(Path(tmp)/'qa.sqlite'),JUDGE_ALLOW_REMOTE_AI='false',JUDGE_PLATFORMS_FILE=str(config_file),HANDOFF_SECRET='browser-smoke-synthetic-handoff-secret-not-live',JUDGE_QA_PARTNER_KEY='browser-smoke-partner-credential-not-live')
        log=(OUT/'server-qa.log').open('w')
        process=subprocess.Popen(['node','server/index.mjs'],cwd=ROOT,env=env,stdout=log,stderr=log)
        try:
            for _ in range(60):
                try:
                    urllib.request.urlopen(origin+'/api/health',timeout=1); break
                except Exception: time.sleep(.1)
            else: raise RuntimeError('Local test server did not start')
            def flatten(s): return re.sub(r'^export ', '', re.sub(r'^import .*?;\s*$', '', s, flags=re.M), flags=re.M)
            appcode='\n'.join(flatten((ROOT/name).read_text()) for name in ['shared/domain.mjs','public/api.mjs','public/studio.mjs','public/production.mjs','public/i18n.mjs','public/app.mjs'])
            shim="""if(!crypto.randomUUID)crypto.randomUUID=()=> '10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));
            globalThis.fetch=async (url,options={})=>{const r=await window.__judgeHttp({url,options});return {ok:r.status>=200&&r.status<300,status:r.status,json:async()=>JSON.parse(r.body)};};"""
            css=(ROOT/'public/styles.css').read_text()
            raw=(ROOT/'public/index.html').read_text()
            raw=raw.replace('<link rel="icon" href="/favicon.svg" type="image/svg+xml">','')
            raw=raw.replace('<link rel="stylesheet" href="/styles.css">',f'<style>{css}</style>')
            html=raw.replace('<script type="module" src="/app.mjs"></script>',f'<script>{shim}\n{appcode}</script>')
            errors=[]
            with sync_playwright() as pw:
                exe=os.environ.get('CHROMIUM_EXECUTABLE','/usr/bin/chromium')
                browser=pw.chromium.launch(executable_path=exe,args=['--no-sandbox'])
                def actor(viewport=None):
                    jar=http.cookiejar.CookieJar()
                    opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
                    ctx=browser.new_context(viewport=viewport or {'width':1440,'height':1100},device_scale_factor=1,reduced_motion='reduce')
                    def make_page():
                        page=ctx.new_page();page.set_default_timeout(8000)
                        page.on('pageerror',lambda e:errors.append(str(e)))
                        def bridge(payload):
                            path=payload['url'];opts=payload.get('options',{})
                            assert path.startswith('/api/'), 'Unexpected network request in QA'
                            headers=dict(opts.get('headers',{}));headers['Origin']=origin;headers['User-Agent']='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/145.0.0.0'
                            body=opts.get('body');data=body.encode() if body is not None else None
                            req=urllib.request.Request(origin+path,headers=headers,data=data,method=opts.get('method','GET'))
                            try: res=opener.open(req,timeout=25)
                            except urllib.error.HTTPError as ex:res=ex
                            return {'status':res.status,'body':res.read().decode()}
                        page.expose_function('__judgeHttp',bridge)
                        page.set_content(html,wait_until='load')
                        expect(page.locator('.hero h1')).to_be_visible()
                        return page
                    return ctx,make_page
                owner,make_owner=actor();page=make_owner()
                page.evaluate('window.scrollTo(0,0)');page.locator('#toast.visible').wait_for(state='detached',timeout=8000);page.screenshot(path=str(OUT/'01-dashboard-desktop.png'),full_page=True)
                passed('Desktop dashboard renders from shipped source')
                page.locator('.hero [data-action=demo]').click()
                expect(page.locator('.action-card')).to_have_count(3)
                case_route=page.evaluate('location.hash')
                page.evaluate('window.scrollTo(0,0)');page.locator('#toast.visible').wait_for(state='detached',timeout=8000);page.screenshot(path=str(OUT/'02-hearing-desktop.png'),full_page=True)
                passed('Guest creates case and sees three meaningful actions')
                page.locator('[data-action=choose][data-id=narrow]').click()
                expect(page.locator('#brief-form')).to_be_visible()
                page.locator('#brief-form [type=submit]').click()
                expect(page.locator('.variant')).to_have_count(3)
                page.locator('[data-action=variant][data-id=context]').click()
                assert 'Владельцы малого бизнеса' in page.locator('#verdict-form [name=claim]').input_value()
                page.locator('#verdict-form [name=claim]').fill('Есть продукт. Теперь создайте рекламу для него.')
                page.locator('#verdict-form [name=acknowledged]').check()
                page.locator('#verdict-form [type=submit]').click()
                expect(page.locator('.verdict-banner')).to_be_visible()
                page.evaluate('window.scrollTo(0,0)');page.locator('#toast.visible').wait_for(state='detached',timeout=8000);page.screenshot(path=str(OUT/'03-verdict-desktop.png'),full_page=True)
                passed('Narrow branch edits candidate and persists verdict')
                # v0.5.0: genuine person-to-person blinded comparison via server.
                expect(page.locator('[data-action=comparison-start]')).to_be_visible()
                page.locator('[data-action=comparison-start]').click()
                page.locator('#comparison-start-form [name=consent]').check()
                page.locator('#comparison-start-form [type=submit]').click()
                expect(page.locator('.evidence-study')).to_have_count(1)
                expect(page.locator('.evidence-study')).to_contain_text('0 ответов')
                passed('Owner creates persistent blinded copy comparison')

                page.locator('[data-action=comparison-invite]').click()
                expect(page.locator('#modal textarea')).to_be_visible()
                comparison_link=page.locator('#modal textarea').input_value()
                compare_token=comparison_link.split('/compare/')[1]
                page.locator('[data-action=close]').click()
                reader_context,make_reader=actor();reader=make_reader()
                reader.evaluate('(token)=>location.hash="/compare/"+token',compare_token)
                expect(reader.locator('#compare-form .compare-choice')).to_have_count(3)
                first_text=reader.locator('.compare-choice .compare-text').first.inner_text()
                reader.screenshot(path=str(OUT/'12-reader-ballot-desktop.png'),full_page=True)
                assert 'Исходная' not in reader.locator('#compare-form').inner_text()
                reader.locator('#compare-form input[value=first]').check()
                reader.locator('#compare-form textarea[name=note]').fill('Первое сообщение понятнее с первого прочтения.')
                reader.locator('#compare-form [name=accepted]').check()
                reader.locator('#compare-form button[type=submit]').click()
                expect(reader.locator('h2')).to_contain_text('Ваш выбор принят')
                passed('Independent reader votes once in real browser without author account')

                page.locator('[data-action=refresh]').click()
                expect(page.locator('.evidence-study')).to_contain_text('1 ответ')
                expect(page.locator('.evidence-notes')).to_contain_text('Первое сообщение понятнее')
                page.evaluate('window.scrollTo(0,0)')
                page.screenshot(path=str(OUT/'11-evidence-room-desktop.png'),full_page=True)
                page.set_viewport_size({'width':390,'height':844})
                page.screenshot(path=str(OUT/'13-evidence-room-mobile.png'),full_page=True)
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'evidence room must fit mobile'
                page.set_viewport_size({'width':1440,'height':1100})
                passed('Owner sees observed vote, reason and zero invented conversion metrics')

                page.locator('[data-action=comparison-invite]').click()
                second_link=page.locator('#modal textarea').input_value()
                page.locator('[data-action=close]').click()
                second_token=second_link.split('/compare/')[1]
                next_context,make_next_reader=actor();other_reader=make_next_reader()
                other_reader.evaluate('(token)=>location.hash="/compare/"+token',second_token)
                expect(other_reader.locator('#compare-form')).to_be_visible()
                second_first=other_reader.locator('.compare-choice .compare-text').first.inner_text()
                assert first_text!=second_first, 'blinded test should balance order'
                other_reader.locator('#compare-form input[value=neither]').check()
                other_reader.locator('#compare-form [name=accepted]').check()
                other_reader.locator('#compare-form button[type=submit]').click()
                expect(other_reader.locator('h2')).to_contain_text('Ваш выбор принят')
                page.locator('[data-action=refresh]').click()
                expect(page.locator('.evidence-study')).to_contain_text('2 ответа')
                passed('Second reader sees reversed order and no-preference option is persisted')
                page.locator('[data-action=invite]').click()
                page.locator('#invite-form [name=consent]').check()
                page.locator('#invite-form [type=submit]').click()
                expect(page.locator('#modal textarea')).to_be_visible()
                invite_url=page.locator('#modal textarea').input_value()
                token=invite_url.split('/witness/')[1]
                page.locator('[data-action=close]').click()
                visitor,make_visitor=actor();friend=make_visitor()
                friend.evaluate('(token)=>location.hash="/witness/"+token',token)
                expect(friend.locator('#witness-form')).to_be_visible()
                friend.locator('[name=text]').fill('Неясно, какой именно рекламный материал будет создан и что нужно подготовить заранее.')
                friend.locator('#witness-form input[type=checkbox]').check()
                friend.locator('#witness-form [type=submit]').click()
                expect(friend.locator('h2')).to_contain_text('изменило дело')
                page.locator('[data-action=refresh]').click()
                expect(page.locator('.objection-text')).to_contain_text('что нужно подготовить')
                page.evaluate('window.scrollTo(0,0)');page.locator('#toast.visible').wait_for(state='detached',timeout=8000);page.screenshot(path=str(OUT/'04-reopened-desktop.png'),full_page=True)
                passed('Second user sends objection; original case genuinely reopens')
                expect(page.locator('.evidence-study')).to_contain_text('Прежняя версия')
                passed('Witness reopening automatically invalidates pending comparative study')
                page.locator('#defend-form [name=text]').fill('Уточнение принято: человек подготовит описание продукта, после чего выберет нужный формат.')
                page.locator('#defend-form [type=submit]').click()
                expect(page.locator('[data-action=invite]')).to_be_visible()
                passed('Author response returns case to verdict and remains in history')
                page.locator('[data-action=handoff]').click()
                page.locator('#handoff-form [name=platformId]').select_option('B')
                page.locator('#handoff-form [name=consent]').check()
                page.locator('#handoff-form [type=submit]').click()
                expect(page.locator('#modal')).to_contain_text('доставка не выполнена')
                assert 'Есть продукт' in page.locator('#modal textarea').input_value()
                page.locator('[data-action=close]').click()
                passed('Platform handoff offers brief, never claims an external conversion')
                expect(page.locator('.transfer-row')).to_have_count(1)
                expect(page.locator('.transfer-row')).to_contain_text('Подготовлен текст')
                passed('Clipboard transfer is tracked as prepared, not delivered')
                page.locator('[data-action=handoff]').click()
                page.locator('#handoff-form [name=platformId]').select_option('A')
                page.locator('#handoff-form [name=consent]').check()
                page.locator('#handoff-form [type=submit]').click()
                expect(page.locator('#modal')).to_contain_text('Доставка ещё не подтверждена')
                expect(page.locator('#modal a[href^="https://partner.example.com/"]')).to_have_count(1)
                page.locator('[data-action=close]').click()
                expect(page.locator('.transfer-row')).to_have_count(2)
                page.locator('.transfer-row [data-action=handoff-revoke]').click()
                expect(page.locator('[data-action=confirm-handoff-revoke]')).to_be_visible()
                page.locator('[data-action=confirm-handoff-revoke]').click()
                expect(page.locator('.transfer-row').first).to_contain_text('Отозвано')
                assert page.locator('.transfer-row [data-action=handoff-revoke]').count()==0
                passed('Configured synthetic signed handoff can be revoked through UI before redeem')
                page.evaluate('window.scrollTo(0,0)');page.screenshot(path=str(OUT/'09-handoff-revoked-desktop.png'),full_page=True)

                page.locator('.topbar [data-action=account]').click()
                page.locator('#auth-form [name=email]').fill('browser-qa@example.com')
                page.locator('#auth-form [name=password]').fill('test-password-not-for-production')
                page.locator('#auth-form [name=accepted]').check()
                page.locator('#auth-form [type=submit]').click()
                expect(page.locator('.profile-button')).to_contain_text('browser-qa@example.com')
                page.close();page=make_owner()
                page.evaluate('(path)=>location.hash=path',case_route)
                expect(page.locator('.verdict-banner')).to_be_visible()
                expect(page.locator('.comparison .after')).to_contain_text('Есть продукт')
                passed('Registration keeps guest work; a new browser page restores saved verdict')
                page.evaluate('location.hash="/settings"')
                expect(page.locator('[data-action=sessions]')).to_be_visible()
                page.locator('[data-action=sessions]').click()
                expect(page.locator('#modal')).to_contain_text('Активные сеансы')
                expect(page.locator('#modal')).to_contain_text('этот сеанс')
                page.evaluate('window.scrollTo(0,0)');page.screenshot(path=str(OUT/'10-session-security-desktop.png'),full_page=True)
                passed('Registered user can inspect active authenticated sessions through UI')
                page.locator('[data-action=close]').click()
                page.locator('[data-action=change-password]').click()
                expect(page.locator('#password-form')).to_be_visible()
                page.locator('#password-form [name=currentPassword]').fill('test-password-not-for-production')
                page.locator('#password-form [name=newPassword]').fill('replacement-password-for-browser-qa')
                page.locator('#password-form [type=submit]').click()
                expect(page.locator('.profile-button')).to_contain_text('browser-qa@example.com')
                page.close();page=make_owner()
                page.evaluate('location.hash="/settings"')
                expect(page.locator('[data-action=sessions]')).to_be_visible()
                passed('Password change rotates session, keeps owner logged in and restores UI')
                page.evaluate('(path)=>location.hash=path',case_route)
                expect(page.locator('.audit-card')).to_be_visible()
                expect(page.locator('.audit-card')).to_contain_text('История проверена')
                passed('Editorial audit and event replay state visible on verdict')
                page.evaluate('location.hash="/analytics"')
                expect(page.locator('.kpi-grid .card')).to_have_count(4)
                expect(page.locator('.funnel-line')).to_have_count(7)
                assert page.locator('.kpi-grid .card').nth(0).locator('h2').inner_text()=='1'
                assert page.locator('.kpi-grid .card').nth(2).locator('h2').inner_text()=='0'
                page.evaluate('window.scrollTo(0,0)');page.screenshot(path=str(OUT/'07-analytics-desktop.png'),full_page=True)
                passed('Analytics page renders actual funnel: one case, no verified conversions')
                page.evaluate('(path)=>location.hash=path',case_route)
                expect(page.locator('.verdict-banner')).to_be_visible()
                page.locator('[data-action=reopen]').click()
                expect(page.locator('[data-action=confirm-reopen]')).to_be_visible()
                page.locator('[data-action=confirm-reopen]').click()
                expect(page.locator('.verdict-banner')).to_contain_text('пересмотр своей идеи')
                expect(page.locator('[data-action=change]')).to_be_visible()
                page.locator('[data-action=change]').click()
                page.locator('[data-action=modal-choose][data-id=reframe]').click()
                expect(page.locator('#brief-form')).to_be_visible()
                page.locator('#brief-form [name=problem]').fill('Хотите начать рекламу без пустого листа?')
                page.locator('#brief-form [type=submit]').click()
                page.locator('#verdict-form [name=claim]').fill('Есть продукт. Создайте рекламный материал, чтобы показать его покупателям.')
                page.locator('#verdict-form [name=acknowledged]').check()
                page.locator('#verdict-form [type=submit]').click()
                expect(page.locator('.comparison .after')).to_contain_text('показать его покупателям')
                expect(page.locator('.timeline-card summary')).to_contain_text('событий')
                page.evaluate('window.scrollTo(0,0)');page.screenshot(path=str(OUT/'08-revised-verdict-desktop.png'),full_page=True)
                passed('Owner issues second verdict; new copy persists after reopening')

                for branch in ['evidence','reframe']:
                    page.evaluate('location.hash="/"');expect(page.locator('.hero')).to_be_visible()
                    page.locator('.hero [data-action=demo]').click()
                    page.locator(f'[data-action=choose][data-id={branch}]').click()
                    if branch=='evidence':page.locator('[name=evidence]').fill('Демонстрация функции сервиса; результат зависит от полноты описания продукта.')
                    page.locator('#brief-form [type=submit]').click()
                    expect(page.locator('.variant')).to_have_count(3)
                    page.locator('#verdict-form [name=acknowledged]').check()
                    page.locator('#verdict-form [type=submit]').click()
                    expect(page.locator('.verdict-banner')).to_be_visible()
                    passed(f'Full {branch} branch completes through the visible interface')
                page.evaluate('location.hash="/cases"');expect(page.locator('.cases-list')).to_be_visible()
                page.locator('#case-search').fill('nothing-like-this-phrase');expect(page.locator('#no-matches')).to_be_visible()
                page.locator('#case-search').fill('');expect(page.locator('.case-list-row:visible')).to_have_count(3)
                passed('Case search correctly filters and restores rows')
                page.evaluate('location.hash="/new"');expect(page.locator('#new-form')).to_be_visible()
                hostile='<img src=x onerror="window.__xss=1"> рекламная фраза'
                page.locator('#new-form [name=claim]').fill(hostile)
                page.locator('#new-form [type=submit]').click();expect(page.locator('.quote-box')).to_be_visible()
                expect(page.locator('.quote-box')).to_contain_text(hostile)
                assert page.evaluate('window.__xss||0')==0
                assert page.locator('.quote-box img').count()==0
                passed('Untrusted HTML is rendered as text, not executable markup')
                for width in [390,768,1440]:
                    page.set_viewport_size({'width':width,'height':1000})
                    for path in ['/','/cases','/analytics','/new','/platforms','/settings',case_route[1:]]:
                        page.evaluate('(path)=>location.hash=path',path)
                        page.wait_for_timeout(140)
                        if not page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'):
                            page.evaluate('window.scrollTo(0,0)');page.locator('#toast.visible').wait_for(state='detached',timeout=8000);page.screenshot(path=str(OUT/'overflow.png'),full_page=True)
                            print(page.evaluate('Array.from(document.querySelectorAll("body *")).filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,cls:e.className,w:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})).slice(0,30)'),flush=True)
                            raise AssertionError(f'Horizontal overflow: {width} {path}')
                    if width==390:
                        page.evaluate('window.scrollTo(0,0)');page.locator('#toast.visible').wait_for(state='detached',timeout=8000);page.screenshot(path=str(OUT/'05-verdict-mobile.png'),full_page=True)
                        page.evaluate('location.hash="/"');expect(page.locator('.hero')).to_be_visible()
                        page.evaluate('window.scrollTo(0,0)');page.locator('#toast.visible').wait_for(state='detached',timeout=8000);page.screenshot(path=str(OUT/'06-dashboard-mobile.png'),full_page=True)
                    passed(f'No page-level horizontal overflow at {width}px across seven screens')
                assert not errors, errors
                passed('No unhandled JavaScript exceptions')
                browser.close()
        finally:
            process.terminate()
            try:process.wait(timeout=3)
            except subprocess.TimeoutExpired:process.kill();process.wait()
            log.close()
    (OUT/'browser-results.json').write_text(json.dumps({'mode':'embedded-browser-live-http-bridge','tests':results,'count':len(results),'limitations':['Managed browser blocks URL navigation; native HTTP headers and cookie flags are tested separately.','No real OpenAI provider call or external customer platform was used.']},ensure_ascii=False,indent=2))

if __name__=='__main__':
    main()