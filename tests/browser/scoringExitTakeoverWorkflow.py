"""Dashboard entry -> real lineup UI -> API -> isolated localhost PostgreSQL."""
from playwright.sync_api import sync_playwright, expect
import json, re

base = 'http://127.0.0.1:3600'
fixture = json.load(open('work/browser/lineup-fixtures.json'))
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    errors = []
    def dashboard():
        page = browser.new_context(viewport={'width': 1440, 'height': 1000}).new_page()
        page.set_default_timeout(12000)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.alerts = []
        page.on('dialog', lambda d: (page.alerts.append(d.message), d.accept()))
        page.goto(base)
        token = page.request.get(base+'/test-session?role=umpire').json()['token']
        page.evaluate('''x=>{localStorage.setItem('dugout_auth_token',x.token);sessionStorage.setItem('dugout_auth_token',x.token);localStorage.setItem('userRole','umpire');localStorage.setItem('lastActivity',String(Date.now()));localStorage.setItem('dugout_app_state',JSON.stringify({view:'dashboard',currentLeague:x.league,season:'2026',dashboardTab:'matches'}));}''', {'token':token,'league':fixture['league']})
        page.reload()
        page.wait_for_timeout(1200)
        if page.get_by_role('heading',name='SELECT A LEAGUE',exact=True).is_visible():
            page.get_by_role('button',name='2026 Season '+fixture['league'],exact=True).click()
        expect(page.get_by_role('button',name='Start Game',exact=True).first).to_be_visible()
        return page
    def card(page, scenario):
        return page.locator('div.group').filter(has=page.get_by_text(fixture['games'][scenario]['away']['name'],exact=True))
    def saved(page, scenario):
        return page.request.get(base+'/api/matches?id='+fixture['games'][scenario]['id']).json()

    page=dashboard();page.set_viewport_size({'width':390,'height':844})
    card(page,'lineup-only').get_by_role('button',name='Start Game',exact=True).click()
    expect(page.get_by_role('button',name='Inning 1',exact=True)).to_be_visible()
    page.route('**/api/scoring',lambda r:r.abort('failed'))
    page.get_by_role('button',name='Pitch 1, Score: None',exact=True).first.click();page.get_by_role('button',name='Score 4',exact=True).click()
    if page.get_by_role('button',name='Cancel',exact=True).count():page.get_by_role('button',name='Cancel',exact=True).click()
    page.get_by_title('Exit options: Save & Exit or Exit & Finalize').click()
    with page.expect_event('dialog'):
        page.get_by_role('button',name=re.compile('Save & Exit')).click()
    expect(page.get_by_role('button',name='Cancel — Stay in Match',exact=True)).to_be_visible()
    assert saved(page,'lineup-only')['innings'][0]['away']['playerScores'][0]['pitches'][0]['points'] is None
    page.unroute('**/api/scoring');page.get_by_role('button',name='Cancel — Stay in Match',exact=True).click()
    page.get_by_role('button',name='Try again',exact=True).click();expect(page.get_by_text('✓ All scores saved',exact=True)).to_be_visible()
    page.get_by_title('Exit options: Save & Exit or Exit & Finalize').click();page.get_by_role('button',name=re.compile('Save & Exit')).click()
    expect(card(page,'lineup-only').get_by_role('button',name='Score',exact=True)).to_be_visible()
    state=saved(page,'lineup-only');assert not state['is_complete'];assert state['innings'][0]['away']['playerScores'][0]['pitches'][0]['points']==4
    card(page,'lineup-only').get_by_role('button',name='Score',exact=True).click()
    expect(page.get_by_role('button',name='Pitch 1, Score: 4',exact=True).first).to_be_visible()
    print('PASS mobile: offline Save & Exit stays open; manual retry saves; exit and dashboard resume retain pitch4 without finalizing',flush=True)

    second=dashboard();card(second,'lineup-only').get_by_role('button',name='Score',exact=True).click()
    expect(second.get_by_role('heading',name='Scoring is unavailable',exact=True)).to_be_visible()
    admin=browser.new_context(viewport={'width':390,'height':844}).new_page();admin.goto(base)
    token=admin.request.get(base+'/test-session?role=admin').json()['token'];game_id=fixture['games']['lineup-only']['id']
    admin.evaluate("x=>{localStorage.setItem('dugout_auth_token',x.token);sessionStorage.setItem('dugout_auth_token',x.token);localStorage.setItem('userRole','admin');localStorage.setItem('lastActivity',String(Date.now()));localStorage.setItem('dugout_app_state',JSON.stringify({view:'scoring',currentMatchId:x.id,currentLeague:x.league,season:'2026',dashboardTab:'matches'}));}",{'token':token,'id':game_id,'league':fixture['league']})
    admin.on('dialog',lambda d:d.accept());admin.reload();admin.get_by_role('button',name='Admin: Take over',exact=True).click()
    expect(admin.get_by_role('button',name='Pitch 1, Score: 4',exact=True).first).to_be_visible()
    page.get_by_role('button',name='Pitch 2, Score: None',exact=True).first.click();page.get_by_role('button',name='Score 3',exact=True).click()
    expect(page.get_by_role('heading',name='Scores need checking',exact=True)).to_be_visible()
    expect(page.get_by_role('button',name='Download saved scores',exact=True)).to_be_visible()
    state=saved(admin,'lineup-only');assert state['innings'][0]['away']['playerScores'][0]['pitches'][:2]==[{'points':4},{'points':None}]
    assert not errors,errors
    print('PASS mobile: second umpire blocked; admin takeover retains score; old owner cannot overwrite and keeps a recovery copy',flush=True)
    browser.close()
