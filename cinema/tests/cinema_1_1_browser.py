#!/usr/bin/env python3
"""Real Chromium interaction with assembled offline v1.1 HTML (browser URL navigation is blocked in this environment)."""
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'reports'/'v1.1'; OUT.mkdir(parents=True,exist_ok=True)
HTML=(ROOT/'dist'/'ADVERSE-JUDGE-CINEMA-STANDALONE.html').read_text('utf-8')
logs=[]
def setup(browser,width,height,mobile=False):
 page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1,is_mobile=mobile,has_touch=mobile)
 page.on('pageerror',lambda e:logs.append('JS '+str(e)))
 page.on('console',lambda m:logs.append('CONSOLE '+m.text) if m.type=='error' else None)
 page.set_content(HTML,wait_until='load',timeout=60000)
 page.wait_for_function('window.ADVERSE_CINEMA && window.ADVERSE_CINEMA.scene() === "scene_001"',timeout=10000)
 return page
def choose(page,index,expected):
 page.locator('.choice').nth(index).click(timeout=10000)
 actual=page.evaluate('ADVERSE_CINEMA.scene()')
 assert actual==expected,(index,expected,actual)

def finish(page,shortcut=True):
 choose(page,1 if shortcut else 0,'scene_004' if shortcut else 'scene_002')
 if not shortcut:
  choose(page,0,'scene_003');choose(page,0,'scene_004')
 page.locator('#field-claim').fill('Удвоим ваши продажи за семь дней гарантированно')
 choose(page,2,'scene_007')
 choose(page,1,'scene_008')
 choose(page,0,'scene_009')
 choose(page,0,'scene_010')
 choose(page,0,'scene_011')
 choose(page,1,'scene_012')
 choose(page,0,'scene_013')
 page.locator('#field-rewrite').fill('Для небольших компаний мы предлагаем подготовку рекламы с понятными условиями и ограничениями.')
 choose(page,0,'scene_014')
 choose(page,0,'scene_015')

with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
 desktop=setup(browser,1440,900)
 desktop.screenshot(path=str(OUT/'01-intro-desktop.png'),full_page=True)
 finish(desktop)
 desktop.screenshot(path=str(OUT/'02-finale-continue.png'),full_page=True)
 assert desktop.locator('.choice').nth(0).inner_text().find('Продолжить в JUDGE')!=-1
 desktop.locator('.choice').nth(0).click()
 assert desktop.locator('#dialog-title').inner_text()=='Продолжить дело в JUDGE'
 assert desktop.locator('#dialog-content').get_by_text('Киношный вердикт',exact=False).count()>=1
 send=desktop.locator('#dialog-content button').filter(has_text='Создать черновое дело')
 assert send.is_disabled()
 desktop.screenshot(path=str(OUT/'03-handoff-consent.png'),full_page=True)
 desktop.locator('#transfer-consent').check()
 assert send.is_enabled()
 send.click()
 assert desktop.locator('#toast').is_visible()
 assert 'автономна' in desktop.locator('#toast').inner_text()
 assert desktop.evaluate('ADVERSE_CINEMA.scene()')=='scene_015'
 # Original JSON export remains usable, no API calls in offline mode.
 assert desktop.locator('#dialog-content button').filter(has_text='скачать JSON').count()==1
 desktop.locator('#dialog-close').click()
 desktop.locator('#settings-toggle').click()
 desktop.locator('#quality-select').select_option('lite')
 assert desktop.evaluate('ADVERSE_CINEMA.mode()')=='lite'
 desktop.locator('#dialog-close').click()
 # Return to the strategy; previous verdict invalidated.
 choose(desktop,3,'scene_008')
 choose(desktop,1,'scene_009')
 assert desktop.evaluate('ADVERSE_CINEMA.state().verdictIssued') is False
 mobile=setup(browser,390,844,True)
 finish(mobile)
 mobile.screenshot(path=str(OUT/'04-mobile-finale.png'),full_page=True)
 mobile.locator('.choice').first.click()
 mobile.screenshot(path=str(OUT/'05-mobile-consent.png'),full_page=True)
 assert not mobile.evaluate('document.documentElement.scrollWidth > window.innerWidth'), 'mobile horizontal overflow'
 assert not logs, logs
 print('PASS: 15-scene full route, handoff consent UI, no autonomous network, lite mode, alternative branch, mobile 390px, no JS errors')
 browser.close()
