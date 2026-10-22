#!/usr/bin/env python3
"""Real Chromium smoke tests with DOM injection (navigation disallowed in test sandbox)."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json, base64, re
ROOT=Path(__file__).resolve().parents[1]
REPORT=ROOT/'reports'
REPORT.mkdir(exist_ok=True)
HTML=re.sub(r'<script src="src/.*?</script>','', (ROOT/'index.html').read_text(),flags=re.S)
HTML=HTML.replace('<link rel="stylesheet" href="src/style.css">','')
CSS=(ROOT/'src/style.css').read_text()
FILES=[(ROOT/'src'/x).read_text() for x in ['data.js','engine.js','sound.js','app.js']]
ASSETS={p.stem:'data:image/webp;base64,'+base64.b64encode(p.read_bytes()).decode() for p in (ROOT/'assets').glob('*.webp')}

def boot(page,preload=None):
 page.set_content(HTML,wait_until='load')
 page.add_style_tag(content=CSS)
 page.evaluate("""(arg)=>{let contents=arg.preload||{};const store={getItem(k){return Object.hasOwn(contents,k)?contents[k]:null},setItem(k,v){contents[k]=String(v)},removeItem(k){delete contents[k]},clear(){contents={}}};Object.defineProperty(window,'localStorage',{configurable:true,value:store});window.CINEMA_ASSETS=Object.fromEntries(Object.entries(arg.assets).map(([k,v])=>[k+'.webp',v]));}""",{'preload':preload or {},'assets':ASSETS})
 for js in FILES:page.add_script_tag(content=js)

with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 errors=[]
 context=browser.new_context(viewport={'width':1440,'height':900},device_scale_factor=1,accept_downloads=True)
 page=context.new_page()
 page.on('pageerror',lambda e:errors.append(str(e)))
 boot(page)
 page.wait_for_timeout(900)
 page.screenshot(path=str(REPORT/'01-intro-desktop.png'),full_page=True)
 print('intro',page.locator('h1').inner_text(), 'choices:',page.locator('button.choice').count())
 assert page.locator('button.choice').count()==2
 assert not errors,errors
 page.get_by_role('button',name='Пропустить вступление').click()
 assert page.locator('#field-claim').count()==1
 page.locator('#field-claim').fill('Наш сервис гарантирует всем 100% увеличение продаж за три дня')
 page.get_by_role('button',name='Передать слово Лексу').click()
 assert page.evaluate('ADVERSE_CINEMA.scene()')=='scene_005'
 page.get_by_role('button',name='Перейти к уликам').click()
 page.get_by_role('button',name='Подтверждений пока нет').click()
 page.get_by_role('button',name='Уточнить обещание').click()
 assert page.evaluate('ADVERSE_CINEMA.state().strategy')=='clarity'
 page.get_by_role('button',name='Увидеть последствия').click()
 page.get_by_role('button',name='Услышать свидетеля').click()
 page.get_by_role('button',name='Покупателю нужны условия').click()
 page.get_by_role('button',name='Принять ответственность').click()
 page.locator('#field-rewrite').fill('Мы помогаем выбрать подходящее предложение после знакомства с условиями и стоимостью услуги.')
 page.get_by_role('button',name='Получить вердикт').click()
 assert page.evaluate('ADVERSE_CINEMA.scene()')=='scene_014'
 assert page.locator('.verdict-panel').count()==1
 page.wait_for_timeout(300)
 page.screenshot(path=str(REPORT/'02-verdict-desktop.png'),full_page=True)
 print('verdict:',page.locator('.verdict-status').inner_text())
 page.get_by_role('button',name='Открыть финал').click()
 assert page.locator('button.choice').count()==4
 page.screenshot(path=str(REPORT/'03-finale-desktop.png'),full_page=True)
 stored=page.evaluate("localStorage.getItem('adverse.cinema.story.v1')")
 assert json.loads(stored)['scene']=='scene_015'
 # simulate reload into a fresh page with saved same-origin storage
 p2=context.new_page();p2.on('pageerror',lambda e:errors.append(str(e)))
 boot(p2,{'adverse.cinema.story.v1':stored})
 assert 'Сильная реклама' in p2.locator('h1').inner_text()
 print('saved state restored',p2.evaluate('ADVERSE_CINEMA.state().scene'))
 p2.locator('#dossier-btn').click()
 assert p2.get_by_role('button',name='Скачать JSON-бриф').count()==1
 p2.locator('#dialog-close').click()
 with p2.expect_download() as download_info:
  p2.get_by_role('button',name='Скачать рекламный бриф').click()
 path=REPORT/'export-brief.json';download_info.value.save_as(str(path))
 brief=json.loads(path.read_text(encoding='utf8'))
 assert brief['claim']['revised'].startswith('Мы помогаем')
 assert brief['handoff']['externalPlatformConnected'] is False
 p2.get_by_role('button',name='Прожить альтернативный путь').click()
 p2.get_by_role('button',name='Проверить доказательства').click()
 assert p2.evaluate('ADVERSE_CINEMA.state().strategy')=='proof'
 p2.locator('#map-toggle').click()
 assert p2.locator('.map-list').count()==1
 assert p2.locator('.map-list button:disabled').count()>0
 p2.locator('#dialog-close').click()
 p2.locator('#mode-toggle').click()
 assert p2.locator('body.mode-balanced').count()==1
 p2.locator('#settings-toggle').click()
 p2.locator('#quality-select').select_option('lite')
 p2.get_by_role('checkbox',name='Уменьшить движение').check()
 p2.get_by_role('checkbox',name='Высокая контрастность').check()
 p2.locator('#dialog-close').click()
 assert p2.locator('body.mode-lite.reduced-motion.high-contrast').count()==1
 assert not errors,errors
 mobile=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1,is_mobile=True,has_touch=True,accept_downloads=True)
 mp=mobile.new_page();mp.on('pageerror',lambda e:errors.append(str(e)))
 boot(mp)
 mp.wait_for_timeout(550)
 mp.screenshot(path=str(REPORT/'04-intro-mobile.png'),full_page=True)
 print('mobile',mp.evaluate('document.documentElement.scrollWidth'),mp.evaluate('document.documentElement.clientWidth'))
 assert mp.evaluate('document.documentElement.scrollWidth <= window.innerWidth+1')
 mp.get_by_role('button',name='Пропустить вступление').click()
 mp.screenshot(path=str(REPORT/'05-case-mobile.png'),full_page=True)
 assert mp.locator('#field-claim').is_visible()
 assert not errors,errors
 p2.locator('#settings-toggle').click()
 p2.get_by_role('button',name='Сбросить историю').click()
 p2.get_by_role('button',name='Да, очистить и начать заново').click()
 assert p2.evaluate('ADVERSE_CINEMA.state().scene')=='scene_001'
 # End-to-end all 15 scenes, including optional scenes and 3 archive fragments
 full=context.new_page();full.on('pageerror',lambda e:errors.append(str(e)))
 boot(full)
 full.get_by_role('button',name='Войти в историю').click()
 full.locator('#secret-tag').click();assert full.locator('#dialog-title').inner_text()=='Печать Трибунала';full.locator('#dialog-close').click()
 full.get_by_role('button',name='Войти в зал').click()
 full.get_by_role('button',name='Открыть дело 001').click()
 full.get_by_role('button',name='Передать слово Лексу').click()
 full.get_by_role('button',name='Выслушать Аврору').click()
 full.get_by_role('button',name='Открыть архив доказательств').click()
 full.locator('#secret-tag').click();full.locator('#dialog-close').click()
 full.get_by_role('button',name='Подтверждений пока нет').click()
 full.get_by_role('button',name='Вернуть человеческий смысл').click()
 full.get_by_role('button',name='Увидеть последствия').click()
 full.get_by_role('button',name='Услышать свидетеля').click()
 full.locator('#secret-tag').click();full.locator('#dialog-close').click()
 full.get_by_role('button',name='Покупатель ждёт гарантии').click()
 full.get_by_role('button',name='Принять ответственность').click()
 full.locator('#field-rewrite').fill('Мы предлагаем консультацию по выбранной задаче с заранее согласованными условиями и ограничениями.')
 full.get_by_role('button',name='Получить вердикт').click()
 full.get_by_role('button',name='Открыть финал').click()
 summary=full.evaluate('ADVERSE_CINEMA.state()')
 assert len(summary['visited'])==15,summary['visited']
 assert len(summary['collectibles'])==3,summary['collectibles']
 assert summary['strategy']=='empathy'
 assert not errors,errors
 print('All 15 scenes, 3 secrets and alternative empathy branch passed')
 print('BROWSER PASS: scenes, branching, reload state, sound/mode config, export, mobile, reset')
 browser.close()
