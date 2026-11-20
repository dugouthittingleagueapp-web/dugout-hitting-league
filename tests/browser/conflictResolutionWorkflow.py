"""Real Admin UI and handlers, disposable localhost PostgreSQL. Never uses cloud data."""
from playwright.sync_api import sync_playwright,expect
import json,os
from urllib.parse import urlparse
base=os.environ.get('DUGOUT_BROWSER_BASE_URL','http://127.0.0.1:4100');assert urlparse(base).hostname=='127.0.0.1'
f=json.load(open('work/browser/conflict-fixtures.json'))
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':1440,'height':1000});page.set_default_timeout(12000)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 token=page.request.get(base+'/test-session').json()['token'];headers={'Authorization':'Bearer '+token}
 page.add_init_script('('+'''token=>{localStorage.setItem('userRole','admin');localStorage.setItem('dugout_auth_token',token);sessionStorage.setItem('dugout_auth_token',token);localStorage.setItem('lastActivity',String(Date.now()));localStorage.setItem('dugout_app_state',JSON.stringify({view:'admin',season:'2027'}));}'''+')('+json.dumps(token)+');')
 def games():return {k:page.request.get(base+'/api/matches?id='+v).json() for k,v in f['ids'].items()}
 def edit_a():
  page.get_by_text('Eagles vs Panthers',exact=True).first.locator('xpath=../..').get_by_role('button',name='Edit',exact=True).click()
  return page.get_by_role('dialog')
 def section(d,name):return d.get_by_role('region').filter(has=page.get_by_text(name,exact=True))
 def save(d):d.get_by_role('button',name='Save Changes',exact=True).click();expect(d).to_have_count(0)
 page.goto(base);page.get_by_role('button',name='Schedule',exact=True).click();page.get_by_label('Filter by league',exact=True).select_option(f['league'])
 before=games();d=edit_a();a=section(d,'Eagles vs Panthers')
 expect(a.get_by_label('Start time',exact=True)).to_have_value('18:10')
 expect(a.get_by_label('Start time',exact=True).get_by_role('option',name='6:10 PM (current)',exact=True)).to_have_count(1)
 a.get_by_label('Start time',exact=True).select_option('19:00');a.get_by_label('End time',exact=True).select_option('20:00')
 expect(d.get_by_role('heading',name='Resolve schedule conflicts',exact=True)).to_be_visible();expect(d.get_by_role('button',name='Save Changes',exact=True)).to_be_disabled()
 expect(d.get_by_text('2 games overlap',exact=True)).to_be_visible()
 expect(a.get_by_text('Overlaps Game 2: Wolves vs Raptors',exact=True)).to_be_visible()
 expect(a.get_by_text('Tunnels 5/6 is booked twice',exact=True)).to_be_visible()
 d.screenshot(path='work/browser/conflict-clarity-desktop.png');page.set_viewport_size({'width':393,'height':852});d.screenshot(path='work/browser/conflict-clarity-mobile.png');assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.set_viewport_size({'width':1440,'height':1000})
 expect(a.get_by_label('Cage / location')).to_have_attribute('aria-invalid','true')
 other=section(d,'Wolves vs Raptors');expect(other).to_be_visible();other.get_by_label('Start time').select_option('20:00');other.get_by_label('End time').select_option('21:00')
 chain=section(d,'Storm vs Mavericks');expect(chain).to_be_visible();chain.get_by_label('Start time').select_option('21:00');chain.get_by_label('End time').select_option('22:00')
 expect(d.get_by_text('Ready to save — no overlaps',exact=True)).to_be_visible();save(d)
 after=games();assert after['a']['start_time']=='19:00' and after['b']['start_time']=='20:00' and after['c']['start_time']=='21:00'
 for k in before:assert before[k]['innings']==after[k]['innings'] and before[k]['status']==after[k]['status']
 print('PASS: immediate conflicts, highlighted fields, editable neighbors, chained game discovery and one atomic three-game save',flush=True)
 # A committed response that is lost must keep one safe retry, not create a second game.
 page.get_by_role('button',name='+ Add game',exact=True).click();d=page.get_by_role('dialog')
 d.get_by_label('League',exact=True).select_option(f['league']);d.get_by_label('Date',exact=True).fill('2027-11-05')
 d.get_by_label('Home team',exact=True).select_option(f['teams'][0]['id']);d.get_by_label('Away team',exact=True).select_option(f['teams'][1]['id'])
 def lose_response(route):
  if route.request.method=='POST' and route.request.post_data_json.get('action')=='resolve_schedule':
   response=route.fetch();assert response.status==200;route.abort('internetdisconnected')
  else:route.continue_()
 page.route('**/api/schedule-admin',lose_response);d.get_by_role('button',name='Save Changes',exact=True).click()
 expect(d.get_by_role('alert')).to_contain_text('Could not confirm the save');expect(d.get_by_text('Save needs confirmation',exact=True)).to_be_visible();expect(d.get_by_label('Date',exact=True)).to_be_disabled()
 page.unroute('**/api/schedule-admin',lose_response);save(d)
 created=[g for g in page.request.get(base+'/api/matches?season=2027').json() if g['date'].startswith('2027-11-05') and g['league']==f['league']]
 assert len(created)==1
 print('PASS: new-game creation and a committed-but-lost response retry create exactly one game',flush=True)
 before=games();d=edit_a();a=section(d,'Eagles vs Panthers');a.get_by_label('Start time').select_option('20:00');a.get_by_label('End time').select_option('21:00')
 expect(section(d,'Wolves vs Raptors')).to_be_visible();d.get_by_role('button',name='Cancel',exact=True).click();assert games()==before
 print('PASS: Cancel changes no game, score, revision or status',flush=True)
 d=edit_a();a=section(d,'Eagles vs Panthers');a.get_by_label('Start time').select_option('18:00');a.get_by_label('End time').select_option('19:00');a.get_by_label('Cage / location').select_option('The Dugout: Tunnels 7/8')
 protected=section(d,'Final Home vs Final Away');expect(protected.get_by_label('Date',exact=True)).to_be_disabled();expect(protected.get_by_text('Read-only',exact=True)).to_be_visible()
 a.get_by_label('Start time').select_option('22:00');a.get_by_label('End time').select_option('23:00');save(d);assert games()['protected']==before['protected']
 print('PASS: completed conflicting game stays read-only; eligible game resolves conflict without changing protected history',flush=True)
 # A conflicting team remains a conflict even in another cage.
 d=edit_a();a=section(d,'Eagles vs Panthers');a.get_by_label('Start time').select_option('20:00');a.get_by_label('End time').select_option('21:00');a.get_by_label('Home team').select_option(f['teams'][2]['id'])
 expect(d.get_by_text('Wolves is playing in two games at once',exact=False).first).to_be_visible();expect(d.get_by_role('button',name='Save Changes',exact=True)).to_be_disabled();d.get_by_role('button',name='Cancel',exact=True).click()
 print('PASS: team conflict identifies the team and blocks save across separate cages',flush=True)
 # A game hidden by the league filter is still included in validation.
 d=edit_a();a=section(d,'Eagles vs Panthers');a.get_by_label('Date',exact=True).fill('2027-11-02');a.get_by_label('Start time').select_option('18:30');a.get_by_label('End time').select_option('19:30');a.get_by_label('Cage / location').select_option('The Dugout: Tunnels 5/6')
 expect(section(d,'Other Home vs Other Away')).to_be_visible();d.get_by_role('button',name='Cancel',exact=True).click()
 print('PASS: conflicts check the whole season including games hidden by league filters',flush=True)
 # Force a real optimistic-concurrency rejection before the next background poll.
 d=edit_a();a=section(d,'Eagles vs Panthers');a.get_by_label('Start time').select_option('19:00');a.get_by_label('End time').select_option('20:00')
 state=page.request.post(base+'/api/schedule-admin',headers=headers,data={'action':'preview_resolution','season':'2027'}).json();target=next(g for g in state['games'] if g['id']==f['ids']['a'])
 target['startTime']='20:00';target['endTime']='21:00';target['location']='The Dugout: Tunnels 7/8'
 import uuid
 assert page.request.post(base+'/api/schedule-admin',headers=headers,data={'action':'resolve_schedule','season':'2027','requestId':str(uuid.uuid4()),'changes':[target]}).ok
 d.get_by_role('button',name='Save Changes',exact=True).click();expect(d.get_by_role('alert')).to_contain_text('Another administrator changed')
 expect(a.get_by_label('Start time')).to_have_value('19:00');expect(d.get_by_text('Your edits remain below',exact=False)).to_be_visible();save(d)
 print('PASS: stale save refreshes server context, retains the administrator draft and allows a safe second save',flush=True)
 page.set_viewport_size({'width':393,'height':852})
 page.get_by_role('button',name='+ Import Schedule CSV',exact=True).click();d=page.get_by_role('dialog');d.get_by_role('button',name='Paste CSV Text',exact=True).click()
 csv='Date,Start Time,End Time,Location,Group,Home Team,Away Team\n2027-11-01,20:00,21:00,Tunnels 5/6,QC,Imported Home,Imported Away\n2027-11-01,20:15,21:00,Tunnels 5/6,QC,Imported Other,Imported Fourth'
 d.locator('textarea').fill(csv);d.get_by_label('Destination for QC',exact=True).select_option(f['league'])
 expect(page.get_by_role('heading',name='Resolve schedule conflicts',exact=True)).to_be_visible();d=page.get_by_role('dialog');expect(d.get_by_role('button',name='Save Changes',exact=True)).to_be_disabled()
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 imported=section(d,'Imported Home vs Imported Away');imported.get_by_label('Date',exact=True).fill('2027-11-03')
 imported2=section(d,'Imported Other vs Imported Fourth');imported2.get_by_label('Date',exact=True).fill('2027-11-04')
 expect(d.get_by_role('button',name='Save Changes',exact=True)).to_be_enabled()
 d.screenshot(path='work/browser/conflict-resolution-mobile.png')
 d.get_by_role('button',name='Save Changes',exact=True).click();expect(page.get_by_role('dialog')).to_have_count(0)
 saved=page.request.get(base+'/api/teams?season=2027').json();assert len([t for t in saved if t['league']==f['league'] and t['name'].startswith('Imported')])==4
 allgames=page.request.get(base+'/api/matches?season=2027').json();assert len([g for g in allgames if g['home_team_id'] in [t['id'] for t in saved if t['name']=='Imported Home']])==1
 assert not errors,errors
 print('PASS: CSV conflicts open the same mobile editor automatically; imported and existing games editable; all rows provisioned together after validation',flush=True)
 b.close()
