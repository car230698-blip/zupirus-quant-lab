"""Run against an isolated local test instance, not a customer deployment."""
import os,json,time
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.getenv('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':1440,'height':1050},device_scale_factor=1)
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto('http://127.0.0.1:18081')
    page.screenshot(path='/tmp/zupirus-login.png',full_page=True)
    page.locator('#email').fill('admin@zupirus.local');page.locator('#password').fill('ui-test-password-123');page.locator('#login-form button[type=submit]').click()
    page.locator('#shell').wait_for(state='visible');page.locator('#stats .stat').first.wait_for()
    page.screenshot(path='/tmp/zupirus-dashboard.png',full_page=True)
    page.locator('[data-page=accounts]').click();page.locator('[data-account]').first.wait_for()
    before=page.locator('[data-account]').count();page.locator('#new-replay').click()
    page.wait_for_function('(n)=>document.querySelectorAll("[data-account]").length>n',arg=before)
    card=page.locator('[data-account]').last;card.locator('.toggle').click();page.wait_for_timeout(300)
    assert 'Tạm dừng copy' in page.locator('[data-account]').last.inner_text()
    page.locator('[data-page=assistant]').click();page.locator('#question').fill('Tôi có bao nhiêu tài khoản?');page.locator('#ask-form button').click()
    page.wait_for_function('document.querySelector("#answer").textContent.includes("Trợ lý quy tắc")')
    page.locator('[data-page=lab]').click();page.locator('#run-research').click()
    page.wait_for_function('document.querySelector("#jobs").textContent.includes("QUEUED") || document.querySelector("#jobs").textContent.includes("WAITING_APPROVAL")')
    page.locator('[data-page=monitor]').click();page.locator('#monitor-accounts table').wait_for()
    page.screenshot(path='/tmp/zupirus-monitor.png',full_page=True)
    page.locator('[data-page=overview]').click();page.set_viewport_size({'width':390,'height':844})
    page.screenshot(path='/tmp/zupirus-mobile.png',full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Mobile horizontal overflow'
    assert not errors,errors
    browser.close()
print('PASS: Chromium login, dashboard, create Replay, toggle copy, scoped assistant, queue research, admin monitor, 390px mobile layout; zero uncaught JavaScript errors.')
