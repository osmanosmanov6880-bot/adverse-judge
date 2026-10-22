from playwright.sync_api import sync_playwright
from pathlib import Path
ROOT=Path('/mnt/data/ADVERSE-JUDGE-CINEMA')
HTML=(ROOT/'dist'/'ADVERSE-JUDGE-CINEMATIC-DEMO.html').read_text('utf-8')
OUT=ROOT/'reports';OUT.mkdir(exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
 page=browser.new_page(viewport={'width':1440,'height':900},device_scale_factor=1)
 errors=[]
 page.on('pageerror',lambda err:errors.append(str(err)))
 page.set_content(HTML,wait_until='load',timeout=30000)
 page.wait_for_timeout(1200)
 print('Title:',page.title(),'Header:',page.locator('.scene-headline').inner_text())
 print('Scene:',page.evaluate('ADVERSE_CINEMA.scene()'))
 print('Backdrop:',page.evaluate('getComputedStyle(document.getElementById("plate-prev")).backgroundImage.slice(0,60)'))
 print('Dialog hidden:',page.locator('#dialog-layer').is_hidden())
 page.screenshot(path=str(OUT/'01-desktop-intro.png'),full_page=True)
 print('Errors:',errors)
 browser.close()
