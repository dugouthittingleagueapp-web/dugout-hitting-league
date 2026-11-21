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

    # Both pitches must already exist in persistent recovery before request #1 finishes.
    page = open_game('hanging')
    held = []
    page.route('**/api/scoring', lambda r: held.append(r) if r.request.method == 'POST' else r.continue_())
    page.get_by_role('button', name='Pitch 1, Score: None', exact=True).first.click()
    page.get_by_role('button', name='Score 4', exact=True).click()
    page.get_by_role('button', name='Score 3', exact=True).click()
    close_score(page)
    before_reload = page.evaluate("Object.keys(localStorage).filter(k=>k.includes('scoring_journal_v1:entry:')).map(k=>JSON.parse(localStorage[k]))")
    assert len(before_reload) == 2 and all(not e.get('ack') for e in before_reload) and len(held) == 1
    page.evaluate("id=>sessionStorage.removeItem('dugout_scoring_token_'+id)", fixture['ids']['hanging'])
    page.reload()
    expect(page.get_by_role('button', name='Pitch 1, Score: 4', exact=True).first).to_be_visible()
    expect(page.get_by_role('button', name='Pitch 2, Score: 3', exact=True).first).to_be_visible()
    page.unroute('**/api/scoring')
    for route in held:
        try: route.abort('failed')
        except Exception: pass  # Navigation already canceled the previous document's route.
    retry(page)
    saved = server(page, 'hanging')
    assert saved['innings'][0]['away']['playerScores'][0]['pitches'][:2] == [{'points': 4}, {'points': 3}]
    assert int(saved['revision']) == 2
    print('PASS P0-01: two rapid pitches survive hanging request + page refresh + retry', flush=True)
    page.context.close()

    page = open_game('lost-response')
    count = [0]
    def lose_response(route):
        if route.request.method != 'POST': return route.continue_()
        response = route.fetch()
        count[0] += 1
        if count[0] == 1: route.abort('failed')
        else: route.fulfill(response=response)
    page.route('**/api/scoring', lose_response)
    page.get_by_role('button', name='Pitch 1, Score: None', exact=True).first.click()
    page.get_by_role('button', name='Score 4', exact=True).click(); close_score(page)
    retry(page)
    assert int(server(page, 'lost-response')['revision']) == 1
    assert count[0] == 2
    print('PASS: server-committed lost response retries exactly once without duplicate scoring', flush=True)
    page.context.close()

    page = open_game('storage', width=390)
    puts = []
    page.on('request', lambda r: puts.append(r.url) if r.method == 'POST' and '/api/scoring' in r.url else None)
    page.evaluate("""()=>{window.restoreStorageWrite=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.includes('scoring_journal_v1:entry:'))throw new DOMException('Full','QuotaExceededError');return window.restoreStorageWrite.call(this,k,v);};}""")
    page.get_by_role('button', name='Pitch 1, Score: None', exact=True).first.click()
    page.get_by_role('button', name='Score 4', exact=True).click()
    assert page.alerts and 'could not be saved on this device' in page.alerts[-1]
    assert not puts
    expect(page.get_by_role('button', name='Pitch 1, Score: 4', exact=True)).to_have_count(0)
    page.evaluate('()=>{Storage.prototype.setItem=window.restoreStorageWrite;}')
    close_score(page)
    assert server(page, 'storage')['innings'][0]['away']['playerScores'][0]['pitches'][0]['points'] is None
    print('PASS P0-01: unavailable storage blocks acknowledgement and sends no score', flush=True)
    page.context.close()

    page = open_game('stale-profile')
    page.get_by_role('button', name='Pitch 1, Score: None', exact=True).first.click()
    page.get_by_role('button', name='Score 4', exact=True).click(); close_score(page)
    expect(page.get_by_text('✓ All scores saved', exact=True)).to_be_visible()
    game_id = fixture['ids']['stale-profile']
    auth = page.evaluate("localStorage.getItem('dugout_auth_token')")
    token = page.evaluate("id=>sessionStorage.getItem('dugout_scoring_token_'+id)", game_id)
    external = {'protocol': 1, 'id': game_id, 'revision': 1, 'writeId': page.evaluate('crypto.randomUUID()'), 'command': {'kind': 'pitch', 'inning': 2, 'side': 'home', 'playerId': fixture['home']['players'][0]['id'], 'pitchIndex': 0, 'expected': None, 'points': 3}}
    assert page.request.post(base+'/api/scoring', data=external, headers={'Authorization': 'Bearer '+auth, 'X-Scoring-Token': token}).status == 200
    page.get_by_title('View career batting record').first.click()
    expect(page.get_by_role('dialog')).to_be_visible()
    page.wait_for_timeout(350)
    page.get_by_role('button', name='Close career stats modal').click()
    page.get_by_role('button', name='Pitch 1, Score: 4', exact=True).first.click()
    page.get_by_role('button', name='Score 2', exact=True).click()
    page.get_by_role('button', name='Update', exact=True).click()
    expect(page.get_by_role('heading', name='Scores need checking', exact=True)).to_be_visible()
    saved = server(page, 'stale-profile')
    assert saved['innings'][1]['home']['playerScores'][0]['pitches'][0]['points'] == 3
    assert saved['innings'][0]['away']['playerScores'][0]['pitches'][0]['points'] == 4
    with page.expect_download() as download_info:
        page.get_by_role('button', name='Download saved scores', exact=True).click()
    exported = open(download_info.value.path()).read()
    assert 'scoringToken' not in exported and token not in exported
    assert '"points": 2' in exported
    print('PASS P0-02: profile read cannot rebase stale board; rejected intent remains downloadable without credentials', flush=True)
    page.context.close()

    # Two independent tabs share browser storage and copied session ownership.
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    one = open_game('duplicate-tabs', context=context)
    game_id = fixture['ids']['duplicate-tabs']
    token = one.evaluate("id=>sessionStorage.getItem('dugout_scoring_token_'+id)", game_id)
    two = open_game('duplicate-tabs', context=context, copied_token=token)
    one.get_by_role('button', name='Pitch 1, Score: None', exact=True).first.click()
    one.get_by_role('button', name='Score 4', exact=True).click(); close_score(one)
    expect(one.get_by_text('✓ All scores saved', exact=True)).to_be_visible()
    two.get_by_role('button', name='Pitch 2, Score: None', exact=True).first.click()
    two.get_by_role('button', name='Score 3', exact=True).click()
    expect(two.get_by_role('heading', name='Scores need checking', exact=True)).to_be_visible()
    saved = server(two, 'duplicate-tabs')
    assert saved['innings'][0]['away']['playerScores'][0]['pitches'][0]['points'] == 4
    assert saved['innings'][0]['away']['playerScores'][0]['pitches'][1]['points'] is None
    print('PASS: copied-tab ownership cannot overwrite another accepted score', flush=True)
    context.close()

    for scenario in ['extras-five', 'extras-three', 'extras-one']:
        page = open_game(scenario)
        page.get_by_role('button', name='Extras', exact=True).click()
        # Restrict to the last round, after completed earlier 5/3-pitch rounds.
        rounds = page.locator('main').last.locator('table')
        last = rounds.last
        page.route('**/api/scoring', lambda r: r.abort('failed') if r.request.method == 'POST' else r.continue_())
        last.get_by_role('button', name='Pitch 1, Score: None', exact=True).first.click()
        page.get_by_role('button', name='Score 4', exact=True).click(); close_score(page)
        page.reload(); page.get_by_role('button', name='Extras', exact=True).click()
        last = page.locator('main').last.locator('table').last
        expect(last.get_by_role('button', name='Pitch 1, Score: 4', exact=True).first).to_be_visible()
        last.get_by_role('button', name='Pitch 1, Score: 4', exact=True).first.click()
        page.get_by_role('button', name='Score 2', exact=True).click(); page.get_by_role('button', name='Update', exact=True).click()
        page.unroute('**/api/scoring')
        retry(page)
        saved = server(page, scenario)
        assert saved['tie_breaker'][-1]['awayScores'][0] == 2
        assert int(saved['revision']) == 2
        print('PASS P0-03: '+scenario+' survives offline refresh, edit and replay', flush=True)
        page.context.close()

    page = open_game('two-player', width=390)
    page.get_by_role('button', name='Pitch 15, Score: None', exact=True).first.click()
    page.get_by_role('button', name='Score 4', exact=True).click()
    expect(page.get_by_text('✓ All scores saved', exact=True)).to_be_visible()
    page.get_by_role('button', name='Pitch 14, Score: None', exact=True).first.click()
    page.get_by_role('button', name='Score 1', exact=True).click()
    # Auto-advance to pitch15: this is an edit dialog; close it via outside header.
    page.get_by_role('dialog').click(position={'x':5,'y':5})
    page.get_by_role('button', name='Pitch 14, Score: 1', exact=True).first.click()
    page.get_by_role('button', name='Score 2', exact=True).click(); page.get_by_role('button', name='Update', exact=True).click()
    expect(page.get_by_text('✓ All scores saved', exact=True)).to_be_visible()
    saved = server(page, 'two-player')
    assert saved['innings'][0]['home']['playerScores'][0]['pitches'][14]['points'] == 4
    print('PASS: mobile two-player fifteenth pitch remains intact across another edit', flush=True)
    page.context.close()

    page = open_game('finalize')
    page.get_by_role('button', name='Inning 6', exact=True).click()
    page.get_by_role('button', name='Pitch 10, Score: None', exact=True).click()
    page.get_by_role('button', name='Score 2', exact=True).click()
    expect(page.get_by_role('heading', name='Game Over', exact=True)).to_be_visible()
    page.route('**/api/matches', lambda r: r.fulfill(status=503, content_type='application/json', body='{"error":"Temporary failure"}') if r.request.method == 'PUT' else r.continue_())
    with page.expect_event('dialog'):
        page.get_by_role('button', name='Confirm & Finalize', exact=True).click()
    expect(page.get_by_role('heading', name='Game Over', exact=True)).to_be_visible()
    assert page.alerts
    page.unroute('**/api/matches')
    page.get_by_role('button', name='Confirm & Finalize', exact=True).click()
    page.wait_for_timeout(400)
    saved = server(page, 'finalize')
    assert saved['is_complete'] and saved['status'] == 'FINAL'
    assert saved['innings'][5]['home']['playerScores'][2]['pitches'][9]['points'] == 2
    print('PASS: finalization waits for scores, preserves final pitch and stays open after failed save', flush=True)

    # Simulate a second scorer's retained command when somebody else has already
    # finalized the game. The finished/read-only screen must not hide that copy.
    auth = page.request.get(base+'/test-session?role=umpire').json()['token']
    page.evaluate('''x=>{
      localStorage.setItem('dugout_auth_token',x.auth);sessionStorage.setItem('dugout_auth_token',x.auth);localStorage.setItem('userRole','umpire');
      localStorage.setItem('dugout_app_state',JSON.stringify({view:'scoring',currentLeague:x.league,currentMatchId:x.id,season:'2026',dashboardTab:'matches'}));
      const prefix='dugout_scoring_journal_v1:entry:';
      const old=JSON.parse(localStorage[Object.keys(localStorage).find(k=>k.startsWith(prefix))]);
      const id=crypto.randomUUID();
      const pending={...old,id,parentId:old.id,command:{...old.command,expected:2,points:3}};
      delete pending.ack;localStorage.setItem(prefix+id,JSON.stringify(pending));
    }''', {'auth':auth,'league':fixture['league'],'id':fixture['ids']['finalize']})
    page.reload()
    expect(page.get_by_role('heading', name='Scores need checking', exact=True)).to_be_visible()
    expect(page.get_by_role('button', name='Download saved scores', exact=True)).to_be_visible()
    assert server(page, 'finalize')['innings'][5]['home']['playerScores'][2]['pitches'][9]['points'] == 2
    print('PASS: a finished game keeps another umpire copy visible for recovery without reopening results', flush=True)

    assert not errors, errors
    browser.close()
    print('PASS: no uncaught application errors; all mutation traffic used the isolated localhost database', flush=True)
