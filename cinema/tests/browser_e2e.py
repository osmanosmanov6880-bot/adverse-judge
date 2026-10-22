"""Headless end-to-end QA for the complete self-contained HTML.
The sandbox blocks URL navigation, so this uses Playwright set_content, which
validates the same embedded HTML/CSS/JS as the downloadable preview.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path('/mnt/data/ADVERSE-JUDGE-CINEMA'); OUT=ROOT/'reports';OUT.mkdir(exist_ok=True)
HTML=(ROOT/'dist/ADVERSE-JUDGE-CINEMATIC-DEMO.html').read_text('utf-8')
logs=[]
def setup(browser,w,h,mobile=False):
    page=browser.new_page(viewport={'width':w,'height':h},device_scale_factor=1,is_mobile=mobile,has_touch=mobile)
    page.on('pageerror',lambda err: logs.append('PAGEERROR '+str(err)))
    page.on('console',lambda msg: logs.append('CONSOLE '+msg.text) if msg.type=='error' else None)
    page.set_content(HTML,wait_until='load',timeout=30000)
    page.wait_for_timeout(300)
    return page

def scene(page,s):
    assert page.evaluate('ADVERSE_CINEMA.scene()')==s, f"Expected {s}, got {page.evaluate('ADVERSE_CINEMA.scene()')}"

def choice(page,index,expected):
    page.locator('.choice').nth(index).click()
    scene(page,expected)

def save(page,stem):
    page.wait_for_timeout(200)
    page.screenshot(path=str(OUT/(stem+'.png')),full_page=True)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
    page=setup(browser,1440,900)
    scene(page,'scene_001');save(page,'01-desktop-intro')
    choice(page,0,'scene_002');save(page,'02-gates')
    page.locator('#secret-tag').click();assert 'Печать Трибунала' in page.locator('#dialog-title').inner_text()
    page.locator('#dialog-close').click()
    choice(page,0,'scene_003')
    choice(page,0,'scene_004');save(page,'03-claim')
    # Cannot commit too-short claims.
    page.locator('#field-claim').fill('Тест')
    page.locator('.choice').nth(0).click();assert page.locator('#toast').is_visible()
    page.locator('#field-claim').fill('Продажи вырастут вдвое всего за 7 дней гарантированно!')
    choice(page,0,'scene_005');save(page,'04-lex')
    choice(page,0,'scene_006');save(page,'05-aurora')
    choice(page,0,'scene_007');save(page,'06-archive')
    page.locator('#secret-tag').click();assert 'Протокол №07' in page.locator('#dialog-title').inner_text()
    page.locator('#dialog-close').click()
    # no evidence branch
    choice(page,1,'scene_008');save(page,'07-strategy')
    choice(page,0,'scene_009');assert page.evaluate('ADVERSE_CINEMA.state().strategy')=='clarity'
    choice(page,0,'scene_010')
    choice(page,0,'scene_011');save(page,'08-witness')
    page.locator('#secret-tag').click()
    assert '3 / 3' in page.locator('#dialog-content').inner_text()
    page.locator('#dialog-close').click()
    choice(page,0,'scene_012');save(page,'09-twist')
    choice(page,0,'scene_013');save(page,'10-rewrite')
    page.locator('#field-rewrite').fill('Для малых команд мы помогаем подготовить план рекламных кампаний; результаты зависят от бюджета и спроса.')
    choice(page,0,'scene_014');save(page,'11-verdict')
    assert 'ЭВРИСТИКА' in page.locator('.verdict-metrics').inner_text()
    choice(page,0,'scene_015');save(page,'12-finale')
    assert page.evaluate('ADVERSE_CINEMA.state().verdictIssued')
    assert page.evaluate('ADVERSE_CINEMA.state().collectibles.length')==3
    page.locator('#dossier-btn').click()
    assert 'Новый' not in page.locator('#dialog-title').inner_text()
    assert 'НОВОЕ ОБЕЩАНИЕ' in page.locator('#dialog-content').inner_text()
    page.locator('#dialog-close').click()
    # Alternative story path, and prevention of stale verdict reuse.
    choice(page,2,'scene_008')
    choice(page,1,'scene_009');assert page.evaluate('ADVERSE_CINEMA.state().strategy')=='proof'
    assert page.evaluate('ADVERSE_CINEMA.state().verdictIssued') is False
    page.locator('#back-btn').click();scene(page,'scene_008')
    page.locator('#back-btn').click();assert page.evaluate('ADVERSE_CINEMA.scene()')!='scene_015'
    # Modal settings, map and reduced motion behavior.
    page.locator('#settings-toggle').click()
    page.locator('#quality-select').select_option('lite')
    assert page.evaluate('ADVERSE_CINEMA.mode()')=='lite'
    page.locator('#dialog-close').click()
    page.locator('#map-toggle').click();assert page.locator('.map-choice').count()==15
    page.locator('#dialog-close').click()
    desktop_errors=list(logs)
    mobile=setup(browser,390,844,mobile=True)
    scene(mobile,'scene_001');save(mobile,'13-mobile-intro')
    choice(mobile,1,'scene_004');save(mobile,'14-mobile-claim')
    choice(mobile,2,'scene_007')
    choice(mobile,1,'scene_008');save(mobile,'15-mobile-strategy')
    choice(mobile,2,'scene_009')
    choice(mobile,0,'scene_010')
    choice(mobile,0,'scene_011')
    choice(mobile,1,'scene_012')
    choice(mobile,0,'scene_013')
    mobile.locator('#field-rewrite').fill('Для бизнеса: доступ к понятным инструментам рекламы, при условии настройки кампании и проверки результатов.')
    choice(mobile,0,'scene_014');save(mobile,'16-mobile-verdict')
    choice(mobile,0,'scene_015');save(mobile,'17-mobile-finale')
    mobile.locator('#settings-toggle').click()
    mobile.locator('#quality-select').select_option('lite')
    mobile.locator('#dialog-close').click()
    assert mobile.evaluate('ADVERSE_CINEMA.mode()')=='lite'
    overflow=mobile.evaluate('document.documentElement.scrollWidth>window.innerWidth')
    print('Desktop tests complete. Mobile overflow:',overflow,'Scenes:',mobile.evaluate('ADVERSE_CINEMA.state().visited.length'))
    print('Console/browser errors:',logs)
    assert not overflow, 'mobile horizontal overflow'
    assert not logs, 'browser JS errors occurred'
    browser.close()
print('PASS: complete story, alternate path, hidden records, settings, mobile, no console errors')
