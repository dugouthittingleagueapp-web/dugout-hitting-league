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
        expect(page.get_by_role('button',name='Start Game',exact=True).first).to_be_visible()
        return page
    def card(page, scenario):
        return page.locator('div.group').filter(has=page.get_by_text(fixture['games'][scenario]['away']['name'],exact=True))
    def saved(page, scenario):
        return page.request.get(base+'/api/matches?id='+fixture['games'][scenario]['id']).json()

    page = dashboard(); sequence = []
    page.on('request',lambda r: sequence.append((r.url,r.method,r.post_data_json)) if r.method in ['POST','PUT'] else None)
    card(page,'lineup').get_by_role('button',name='Set Lineup',exact=True).click()
    page.get_by_role('button',name=re.compile('Home Team \\(Bats 2nd\\)')).click()
    page.locator('select').filter(has=page.locator('option[value="'+fixture['home']['players'][1]['id']+'"]')).first.select_option(fixture['home']['players'][1]['id'])
    page.get_by_role('button',name=re.compile('Save & Start Scoring')).click()
    expect(page.get_by_role('button',name='Inning 1',exact=True)).to_be_visible()
    state=saved(page,'lineup'); assert state['status']=='IN_PROGRESS'
    assert state['innings'][0]['home']['playerScores'][0]['playerId']==fixture['home']['players'][1]['id']
    assert sequence[0][0].endswith('/api/scoring-lock') and sequence[0][2]['action']=='acquire'
    assert sequence[1][0].endswith('/api/matches') and sequence[1][1]=='PUT'
    page.get_by_role('button',name='Pitch 1, Score: None',exact=True).first.click()
    page.get_by_role('button',name='Score 4',exact=True).click()
    expect(page.get_by_text('✓ All scores saved',exact=True)).to_be_visible()
    assert saved(page,'lineup')['innings'][0]['away']['playerScores'][0]['pitches'][0]['points']==4
    print('PASS: scheduled Save & Start acquires access, saves batting order, opens scoring and saves a pitch',flush=True)

    page=dashboard();card(page,'direct').get_by_role('button',name='Start Game',exact=True).click()
    expect(page.get_by_role('button',name='Inning 1',exact=True)).to_be_visible()
    assert saved(page,'direct')['status']=='IN_PROGRESS'
    print('PASS: direct Start Game also confirms access and status before opening scoring',flush=True)

    page=dashboard();game_id=fixture['games']['owned']['id'];other=page.evaluate('crypto.randomUUID()')
    admin=page.request.get(base+'/test-session?role=admin').json()['token']
    assert page.request.post(base+'/api/scoring-lock',data={'matchId':game_id,'token':other,'action':'acquire'},headers={'Authorization':'Bearer '+admin}).status==200
    before=saved(page,'owned');writes=[]
    page.on('request',lambda r:writes.append(r.url) if r.method=='PUT' else None)
    card(page,'owned').get_by_role('button',name='Set Lineup',exact=True).click()
    page.get_by_role('button',name=re.compile('Save & Start Scoring')).click()
    expect(page.get_by_text(re.compile('Another umpire is scoring this game'))).to_be_visible()
    assert not writes and saved(page,'owned')==before
    page.get_by_title('Close',exact=True).click()
    with page.expect_event('dialog'):
        card(page,'owned').get_by_role('button',name='Start Game',exact=True).click()
    assert saved(page,'owned')==before and not writes
    assert page.request.post(base+'/api/scoring-lock',data={'matchId':game_id,'token':other,'action':'status'},headers={'Authorization':'Bearer '+admin}).json()['owned']
    print('PASS: both entry paths respect a genuine other-device owner and keep the scheduled game unchanged',flush=True)

    page=dashboard();page.route('**/api/matches',lambda r:r.fulfill(status=503,content_type='application/json',body='{"error":"Temporary database failure"}') if r.request.method=='PUT' else r.continue_())
    with page.expect_event('dialog'):
        card(page,'failure').get_by_role('button',name='Start Game',exact=True).click()
    assert saved(page,'failure')['status']=='SCHEDULED'
    assert page.evaluate("localStorage.getItem('dugout_active_match_id')") is None
    expect(card(page,'failure').get_by_role('button',name='Start Game',exact=True)).to_be_visible()
    page.unroute('**/api/matches');card(page,'failure').get_by_role('button',name='Start Game',exact=True).click()
    expect(page.get_by_role('button',name='Inning 1',exact=True)).to_be_visible()
    print('PASS: failed status save stays on the dashboard and can safely retry',flush=True)

    page=dashboard();card(page,'lineup-only').get_by_role('button',name='Set Lineup',exact=True).click()
    page.get_by_role('button',name='Save Lineup',exact=True).click()
    expect(page.get_by_role('heading',name='Set Batting Order & Lineup',exact=True)).to_have_count(0)
    assert saved(page,'lineup-only')['status']=='SCHEDULED'
    token=page.evaluate('crypto.randomUUID()');game_id=fixture['games']['lineup-only']['id']
    auth=page.evaluate("localStorage.getItem('dugout_auth_token')")
    assert page.request.post(base+'/api/scoring-lock',data={'matchId':game_id,'token':token,'action':'status'},headers={'Authorization':'Bearer '+auth}).json()['locked'] is False
    assert not errors,errors
    print('PASS: Save Lineup alone leaves the game scheduled and available to an umpire; no application errors',flush=True)
    browser.close()
