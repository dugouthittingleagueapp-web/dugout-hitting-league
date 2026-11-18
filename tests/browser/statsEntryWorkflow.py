"""Admin correction ownership regression; disposable localhost database only."""
from playwright.sync_api import sync_playwright,expect
import json,os
base=os.environ.get('DUGOUT_PHASE2_BROWSER_BASE','http://127.0.0.1:3700')
assert base in ['http://127.0.0.1:3700','http://127.0.0.1:3800']
f=json.load(open('work/browser/scoring-fixtures.json'));id=f['ids']['stats-repair']
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 errors=[]
 def dashboard():
  page=b.new_context().new_page();page.set_default_timeout(12000);page.alerts=[]
  page.on('dialog',lambda d:(page.alerts.append(d.message),d.accept()));page.on('pageerror',lambda e:errors.append(str(e)))
  token=page.request.get(base+'/test-session?role=admin').json()['token']
  page.add_init_script('''(()=>{const x='''+json.dumps({'token':token,'league':f['league']})+''';localStorage.setItem('dugout_auth_token',x.token);sessionStorage.setItem('dugout_auth_token',x.token);localStorage.setItem('userRole','admin');localStorage.setItem('lastActivity',String(Date.now()));localStorage.setItem('dugout_current_season','2026');localStorage.setItem('dugout_app_state',JSON.stringify({view:'dashboard',currentLeague:x.league,season:'2026',dashboardTab:'matches'}));})();''')
  page.goto(base);return page,token
 page,auth=dashboard()
 def game():return page.request.get(base+'/api/matches?id='+id).json()
 before=game();assert before['is_complete']
 # There are two completed synthetic games. Find the exact card by its Fix Stats
 # button position derived from the dashboard API's order and matching game date.
 def open_modal(page):
  cards=page.locator('div.group').filter(has=page.get_by_title('Fix / Re-assign match player stats',exact=True))
  # Both final fixtures have same teams; selecting last selects stats-repair
  # only after dates are given unique fixture values by the setup script.
  cards.filter(has=page.get_by_text('Stats Repair Away',exact=True)).get_by_title('Fix / Re-assign match player stats',exact=True).click()
  page.get_by_role('button',name='Home: Home Test',exact=True).click()
  page.locator('select').filter(has=page.locator('option[value="'+f['home']['subs'][0]['id']+'"]')).last.select_option(f['home']['subs'][0]['id'])
 open_modal(page);calls=[]
 page.on('request',lambda r:calls.append((r.url,r.post_data_json)) if r.method in ['POST','PUT'] else None)
 with page.expect_response(lambda r:'/api/matches' in r.url and r.request.method=='PUT') as response:
  page.get_by_role('button',name='💾 Save & Re-link Stats',exact=True).click()
 assert response.value.status==200,(response.value.status,response.value.text())
 assert calls[0][0].endswith('/api/scoring-lock') and calls[0][1]['action']=='acquire',calls
 after=game();assert after['is_complete'] and after['status']=='FINAL';assert int(after['revision'])==int(before['revision'])+1
 for old,new in zip(before['innings'],after['innings']):
  assert old['away']==new['away']
  assert [p['pitches'] for p in old['home']['playerScores']]==[p['pitches'] for p in new['home']['playerScores']]
 assert after['innings'][0]['home']['playerScores'][2]['playerId']==f['home']['subs'][0]['id']
 print('PASS P1-02: dashboard Fix Stats acquires ownership before saving, preserves finalized status and every pitch',flush=True)
 other,other_auth=dashboard();open_modal(other);before=game();writes=[]
 other.on('request',lambda r:writes.append(r.url) if r.method=='PUT' else None)
 with other.expect_event('dialog'):other.get_by_role('button',name='💾 Save & Re-link Stats',exact=True).click()
 assert not writes;assert game()==before
 assert other.alerts and 'Another umpire' in other.alerts[-1]
 assert not errors,errors
 print('PASS P1-02: another admin cannot silently take over correction access or write roster/match data',flush=True)
 b.close()
