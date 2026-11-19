"""Admin roster UI -> real API -> disposable localhost PostgreSQL."""
from playwright.sync_api import sync_playwright,expect
import json,os
from urllib.parse import urlparse
base=os.environ.get('DUGOUT_BROWSER_BASE_URL','http://127.0.0.1:4100')
assert urlparse(base).hostname=='127.0.0.1'
f=json.load(open('work/browser/roster-fixture.json'))
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 errors=[]
 def open_admin(width=1440):
  c=b.new_context(viewport={'width':width,'height':900})
  page=c.new_page();page.set_default_timeout(12000);page.on('pageerror',lambda e:errors.append(str(e)))
  token=page.request.get(base+'/test-session').json()['token']
  state={'auth':token}
  page.add_init_script('('+'''x=>{localStorage.setItem('userRole','admin');localStorage.setItem('dugout_auth_token',x.auth);sessionStorage.setItem('dugout_auth_token',x.auth);localStorage.setItem('lastActivity',String(Date.now()));localStorage.setItem('dugout_current_season','2027');localStorage.setItem('dugout_app_state',JSON.stringify({view:'admin',season:'2027'}));}'''+')('+json.dumps(state)+');')
  page.goto(base);page.get_by_role('button',name='Rosters',exact=True).click()
  expect(page.get_by_label('League',exact=True)).to_be_enabled()
  page.get_by_label('League',exact=True).select_option(f['league']);page.get_by_label('Team',exact=True).select_option(f['home']['id'])
  expect(page.get_by_label('Team player 1 first name',exact=True)).to_be_visible()
  return page
 def team(page):return next(t for t in page.request.get(base+'/api/teams?season=2027').json() if t['id']==f['home']['id'])
 def games(page):return [page.request.get(base+'/api/matches?id='+id).json() for id in f['ids'].values()]
 page=open_admin();before=games(page)
 assert page.get_by_label('Team',exact=True).get_by_role('option',name='Other League Test',exact=True).count()==0
 page.get_by_label('Team player 1 first name',exact=True).fill('Cody Corrected')
 page.get_by_role('button',name='Add team player',exact=True).click()
 page.get_by_label('Team player 3 first name',exact=True).fill('Third Player')
 page.get_by_role('button',name='Add substitute',exact=True).click()
 page.get_by_label('Substitute 2 first name',exact=True).fill('New Substitute')
 page.get_by_role('button',name='Save roster',exact=True).click()
 expect(page.get_by_text('Roster saved. Recorded games and scores are preserved.',exact=True)).to_be_visible()
 saved=team(page);assert len(saved['players'])==3 and len(saved['subs'])==2
 assert saved['players'][0]['id']==f['home']['players'][0]['id'] and saved['players'][0]['name']=='Cody Corrected'
 assert games(page)==before
 print('PASS: admin tab, league/team filtering, rename/add roster player/substitute, saved IDs and historical/future matches preserved',flush=True)
 page.get_by_label('Options for Team player 3',exact=True).click()
 page.get_by_role('button',name='Move to substitutes',exact=True).click()
 page.get_by_label('Options for Substitute 1',exact=True).click()
 page.get_by_role('button',name='Make team player',exact=True).first.click()
 page.get_by_role('button',name='Save roster',exact=True).click()
 expect(page.get_by_text('Roster saved. Recorded games and scores are preserved.',exact=True)).to_be_visible()
 saved=team(page);assert saved['players'][2]['id']==f['home']['subs'][0]['id']
 assert any(p['id']==f['home']['subs'][0]['id'] for p in saved['players'])
 print('PASS: promote/demote retains player identity',flush=True)
 second=open_admin(393)
 page.get_by_label('Team player 1 first name',exact=True).fill('Saved On First Screen')
 page.get_by_role('button',name='Save roster',exact=True).click();expect(page.get_by_text('Roster saved. Recorded games and scores are preserved.',exact=True)).to_be_visible()
 second.get_by_label('Team player 1 first name',exact=True).fill('Stale Screen')
 second.get_by_role('button',name='Save roster',exact=True).click()
 expect(second.get_by_role('alert')).to_contain_text('changed on another screen')
 expect(second.get_by_label('Team player 1 first name',exact=True)).to_have_value('Stale Screen')
 assert team(second)['players'][0]['name']=='Saved On First Screen'
 second.on('dialog',lambda d:d.accept());second.get_by_role('button',name='Reload rosters',exact=True).click()
 second.get_by_label('League',exact=True).select_option(f['league']);second.get_by_label('Team',exact=True).select_option(f['home']['id'])
 expect(second.get_by_label('Team player 1 first name',exact=True)).to_have_value('Saved On First Screen')
 second.get_by_label('Team player 1 last name',exact=True).fill('Mobile')
 second.get_by_role('button',name='Save roster',exact=True).click()
 expect(second.get_by_text('Roster saved. Recorded games and scores are preserved.',exact=True)).to_be_visible()
 second.screenshot(path='work/browser/admin-rosters-mobile.png',full_page=True)
 assert games(second)==before
 print('PASS: concurrent editor rejected without discarding draft; reload and mobile save succeed',flush=True)
 # An interrupted save must retain the draft and must not claim success.
 second.get_by_label('Team player 1 first name',exact=True).fill('Unsaved Draft')
 second.route('**/api/teams',lambda r:r.abort('internetdisconnected') if r.request.method=='PUT' else r.continue_())
 second.get_by_role('button',name='Save roster',exact=True).click();expect(second.get_by_role('alert')).to_be_visible()
 expect(second.get_by_label('Team player 1 first name',exact=True)).to_have_value('Unsaved Draft')
 assert team(second)['players'][0]['name']=='Saved On First Screen'
 print('PASS: failed save retains draft and never changes server roster or claims success',flush=True)
 assert not errors,errors
 b.close()
