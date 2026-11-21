"""Real app/API/localhost PostgreSQL fault tests. Never point this at a deployment."""
from playwright.sync_api import sync_playwright, expect
import json, re, os
from urllib.parse import urlparse

base = os.environ.get('DUGOUT_BROWSER_BASE_URL','http://127.0.0.1:3700')
assert urlparse(base).hostname=='127.0.0.1'
fixture = json.load(open('work/browser/scoring-fixtures.json'))

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    errors = []

    def open_game(scenario, width=1440, context=None, copied_token=None, role='admin'):
        context = context or browser.new_context(viewport={'width': width, 'height': 1000}, accept_downloads=True)
        page = context.new_page()
        page.route('**/api/schedule-admin',lambda route:route.abort())
        page.set_default_timeout(12000)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.alerts = []
        page.on('dialog', lambda d: (page.alerts.append(d.message), d.accept()))
        page.goto(base);page.wait_for_load_state('networkidle')
        auth = page.request.get(base + '/test-session?role=' + role).json()['token']
        game_id = fixture['ids'][scenario]
        state = {'view': 'scoring', 'currentLeague': fixture['league'], 'currentMatchId': game_id, 'season': '2026', 'dashboardTab': 'matches'}
        page.evaluate('''x=>{localStorage.setItem('dugout_auth_token',x.auth);sessionStorage.setItem('dugout_auth_token',x.auth);localStorage.setItem('userRole',x.role);localStorage.setItem('lastActivity',String(Date.now()));localStorage.setItem('dugout_app_state',JSON.stringify(x.state));if(x.token)sessionStorage.setItem('dugout_scoring_token_'+x.state.currentMatchId,x.token);}''', {'auth': auth, 'role': role, 'state': state, 'token': copied_token})
        page.reload()
        expect(page.get_by_role('button', name='Inning 1', exact=True)).to_be_visible()
        return page

    def server(page, scenario):
        return page.request.get(base + '/api/matches?id=' + fixture['ids'][scenario]).json()

    def close_score(page):
        button = page.get_by_role('button', name='Cancel', exact=True)
        if button.count(): button.click()

    def retry(page):
        if page.get_by_text('✓ All scores saved', exact=True).is_visible(): return
        try: page.get_by_role('button', name='Try again', exact=True).click(timeout=3000)
        except Exception:
            if not page.get_by_text('✓ All scores saved', exact=True).is_visible():
                print('RETRY FAILURE SCREEN:', page.locator('body').inner_text()[:1800], flush=True)
                raise
        expect(page.get_by_text('✓ All scores saved', exact=True)).to_be_visible()

    expect.set_options(timeout=12000)
    gate=browser.new_context(ignore_https_errors=True).new_page();gate.goto(base)
    recovered_token=gate.evaluate('crypto.randomUUID()')
    handoff=gate.request.post(base+'/api/scoring-lock',data={'matchId':fixture['ids']['substitution'],'token':recovered_token,'action':'takeover'},headers={'Authorization':'Bearer '+gate.request.get(base+'/test-session?role=admin').json()['token']})
    assert handoff.status==200
    page=open_game('substitution',role='umpire',copied_token=recovered_token)
    game_id=fixture['ids']['substitution']
    auth=page.evaluate("localStorage.getItem('dugout_auth_token')")
    token=page.evaluate("id=>sessionStorage.getItem('dugout_scoring_token_'+id)",game_id)
    headers={'Authorization':'Bearer '+auth,'X-Scoring-Token':token}
    before=server(page,'substitution')
    for bad in [99,-1,1.5,'4',{},None]:
        cmd={'kind':'pitch','inning':1,'side':'away','playerId':fixture['away']['players'][0]['id'],'pitchIndex':0,'expected':None,'points':bad}
        if bad is None: del cmd['expected']
        r=page.request.post(base+'/api/scoring',data={'protocol':1,'id':game_id,'revision':0,'writeId':page.evaluate('crypto.randomUUID()'),'command':cmd},headers=headers)
        assert r.status==400,(bad,r.status)
        assert server(page,'substitution')==before
    print('PASS P0-04: malformed scoring requests are rejected without changing saved state',flush=True)

    page.get_by_role('button',name=re.compile('Set Lineup')).last.click()
    page.get_by_title('Remove from lineup (switch to Ghost Mode)',exact=True).first.click()
    expect(page.get_by_text('Batting Order (2 Batters)',exact=True)).to_be_visible()
    page.get_by_text('Sub Test',exact=True).locator('..').get_by_role('button',name='+ Put in Lineup',exact=True).click()
    expect(page.get_by_text('Batting Order (3 Batters)',exact=True)).to_be_visible()
    page.get_by_role('button',name='Done Editing Lineup',exact=True).click()
    page.get_by_role('button',name='Pitch 1, Score: None',exact=True).last.click()
    page.get_by_role('button',name='Score 4',exact=True).click()
    expect(page.get_by_text('✓ All scores saved',exact=True)).to_be_visible()
    page.get_by_role('button',name='Undo Previous',exact=True).click()
    expect(page.get_by_text('✓ All scores saved',exact=True)).to_be_visible()
    saved=server(page,'substitution')
    for inning in saved['innings']:
        assert inning['home']['playerScores'][2]['playerId']==fixture['home']['subs'][0]['id']
    assert saved['innings'][0]['home']['playerScores'][2]['pitches'][0]['points'] is None
    page.get_by_role('button',name='Score 3',exact=True).click();close_score(page)
    expect(page.get_by_text('✓ All scores saved',exact=True)).to_be_visible()
    saved=server(page,'substitution')
    assert saved['innings'][0]['home']['playerScores'][2]['pitches'][0]['points']==3
    print('PASS: umpire substitutes through the lineup controls, records a pitch, undoes it and records its replacement',flush=True)

    r=page.request.put(base+'/api/matches',data={'id':game_id,'revision':int(saved['revision']),'innings':[]},headers=headers)
    assert r.status==400,r.status
    assert server(page,'substitution')==saved
    print('PASS P0-04: destructive score replacement is rejected without losing the substitute score',flush=True)

    r=page.request.put(base+'/api/matches',data={'id':game_id,'revision':int(saved['revision']),'isForfeit':True,'forfeitingTeamId':fixture['home']['id'],'winningTeamId':fixture['away']['id']},headers=headers)
    assert r.status==200,(r.status,r.text())
    forfeit=server(page,'substitution')
    assert forfeit['is_forfeit'] and forfeit['winning_team_id']==fixture['away']['id']
    assert forfeit['innings']==saved['innings']
    print('PASS: valid forfeit preserves recorded player scores and the correct automatic winner',flush=True)

    # Fan sees the committed score and cannot issue an authenticated mutation.
    fan=page.context.new_page();fan.goto(base)
    fan.evaluate("x=>{localStorage.removeItem('dugout_auth_token');sessionStorage.removeItem('dugout_auth_token');localStorage.setItem('userRole','fan');localStorage.setItem('dugout_app_state',JSON.stringify({view:'scoring',currentLeague:x.league,currentMatchId:x.id,season:'2026',dashboardTab:'matches'}));}",{'league':fixture['league'],'id':game_id})
    fan.reload();expect(fan.get_by_role('button',name='Inning 1',exact=True)).to_be_visible()
    expect(fan.get_by_role('button',name=re.compile('Set Lineup'))).to_have_count(0)
    r=fan.request.post(base+'/api/scoring',data={'protocol':1,'id':game_id,'revision':int(forfeit['revision']),'writeId':fan.evaluate('crypto.randomUUID()'),'command':{'kind':'pitch','inning':1,'side':'home','playerId':fixture['home']['subs'][0]['id'],'pitchIndex':0,'expected':3,'points':4}})
    assert r.status==401,r.status
    assert server(fan,'substitution')==forfeit
    print('PASS: fan view loads saved results and anonymous score mutation is denied',flush=True)
    assert not errors,errors
    browser.close()
