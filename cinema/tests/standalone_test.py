from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'dist/ADVERSE-JUDGE-CINEMA-STANDALONE.html').read_text('utf8')
assert 'data:image/webp;base64' in html
assert 'src/app.js' not in html
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=b.new_page(viewport={'width':1440,'height':900})
 errors=[];page.on('pageerror',lambda x:errors.append(str(x)))
 page.set_content(html,wait_until='load')
 page.wait_for_timeout(350)
 assert page.locator('button.choice').count()==2
 page.get_by_role('button',name='Войти в историю').click()
 assert page.evaluate('ADVERSE_CINEMA.scene()')=='scene_002'
 assert 'data:image/webp;base64' in page.evaluate("document.querySelector('#plate-active').style.backgroundImage + document.querySelector('#plate-prev').style.backgroundImage")
 assert not errors,errors
 print('STANDALONE PASS: scenes, embedded image rendered, no missing scripts',len(html))
 b.close()
