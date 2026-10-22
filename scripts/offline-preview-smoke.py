"""Independent local-browser test of the generated single-file preview (no backend)."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
import os, json
ROOT=Path(__file__).resolve().parents[1]
HTML=ROOT/'dist/JUDGE-ADVERSE-preview.html'
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE','/usr/bin/chromium'),args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1280,'height':900},reduced_motion='reduce')
    exceptions=[];page.on('pageerror',lambda e:exceptions.append(str(e)))
    page.set_content(HTML.read_text(encoding='utf-8'),wait_until='load')
    expect(page.locator('.hero')).to_be_visible()
    page.locator('.hero [data-action=demo]').click()
    expect(page.locator('.action-card')).to_have_count(3)
    page.locator('[data-action=choose][data-id=narrow]').click()
    page.locator('#brief-form [type=submit]').click()
    expect(page.locator('.variant')).to_have_count(3)
    page.locator('#verdict-form [name=acknowledged]').check()
    page.locator('#verdict-form [type=submit]').click()
    expect(page.locator('.verdict-banner')).to_be_visible()
    page.locator('[data-action=handoff]').click()
    page.locator('#handoff-form [name=consent]').check()
    page.locator('#handoff-form [type=submit]').click()
    expect(page.locator('#modal')).to_contain_text('доставка не выполнена')
    page.locator('[data-action=close]').click()
    expect(page.locator('.transfer-history')).to_contain_text('Подготовлен текст')
    assert not exceptions, exceptions
    browser.close()
print('Offline single-file preview: complete claim → verdict → clipboard handoff, no JS exceptions')
