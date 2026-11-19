"""Create-team UI, lost response, import reuse and empty-roster setup on localhost only."""
from playwright.sync_api import sync_playwright, expect
from urllib.parse import urlparse
import json, os, uuid, re

base=os.environ.get('DUGOUT_BROWSER_BASE_URL','http://127.0.0.1:4100')
assert urlparse(base).hostname=='127.0.0.1'
league='Create Team QC '+str(uuid.uuid4())
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':393,'height':852});page.set_default_timeout(12000)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 token=page.request.get(base+'/test-session').json()['token'];auth={'Authorization':'Bearer '+token}
 assert page.request.post(base+'/api/leagues',headers=auth,data={'id':league,'season':'2027'}).ok
 page.add_init_script('('+'''x=>{localStorage.setItem('userRole','admin');localStorage.setItem('dugout_auth_token',x);sessionStorage.setItem('dugout_auth_token',x);localStorage.setItem('lastActivity',String(Date.now()));localStorage.setItem('dugout_current_season','2027');localStorage.setItem('dugout_app_state',JSON.stringify({view:'admin',season:'2027'}));}'''+')('+json.dumps(token)+');')
 page.goto(base);page.get_by_role('button',name='Rosters',exact=True).click()
 page.get_by_label('League',exact=True).select_option(league)
 page.get_by_role('button',name='Create team',exact=True).click()
 expect(page.get_by_label('New team name',exact=True)).to_be_focused()
 expect(page.get_by_role('button',name='Create team',exact=True)).to_be_disabled()
 page.get_by_role('button',name='Cancel new team',exact=True).click()
 expect(page.get_by_label('New team name',exact=True)).to_have_count(0)
 page.get_by_role('button',name='Create team',exact=True).click()
 page.get_by_label('New team name',exact=True).fill('Before Import')
 expect(page.get_by_label('Find a previous player for Team player 1',exact=True)).to_have_count(0)
 expect(page.get_by_role('button',name='Move to substitutes',exact=True).first).not_to_be_visible()
 first=page.get_by_label('Team player 1 first name',exact=True).bounding_box();last=page.get_by_label('Team player 1 last name',exact=True).bounding_box()
 assert abs(first['y']-last['y'])<1
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 page.screenshot(path='work/browser/clean-roster-create-mobile.png',full_page=True)
 page.set_viewport_size({'width':1440,'height':1100});page.screenshot(path='work/browser/clean-roster-create-desktop.png',full_page=True);page.set_viewport_size({'width':393,'height':852})
 expect(page.get_by_label('Team player 3 first name',exact=True)).to_be_visible()
 expect(page.get_by_role('button',name='Add team player',exact=True)).to_have_count(0)
 for i,name in enumerate(['First','Second','Third'],1):page.get_by_label(f'Team player {i} first name',exact=True).fill(name)
 page.get_by_role('button',name='Add substitute',exact=True).click()
 page.get_by_label('Substitute 1 first name',exact=True).fill('Substitute')
 def lose_response(route):
  if route.request.method=='POST':
   response=route.fetch();assert response.status==201;route.abort('internetdisconnected')
  else:route.continue_()
 # A request that never responds must release the form and preserve stable IDs.
 pending=[]
 def hold(route):
  if route.request.method=='POST':pending.append(route)
  else:route.continue_()
 page.route('**/api/teams',hold);page.clock.install()
 page.get_by_role('button',name='Create team',exact=True).click()
 expect(page.get_by_role('button',name='Saving…',exact=True)).to_be_disabled()
 page.wait_for_timeout(100);assert len(pending)==1
 page.clock.fast_forward(15001)
 expect(page.get_by_role('alert')).to_contain_text('Your entries are still here')
 expect(page.get_by_role('button',name='Create team',exact=True)).to_be_enabled()
 expect(page.get_by_label('New team name',exact=True)).to_have_value('Before Import')
 expect(page.get_by_label('Substitute 1 first name',exact=True)).to_have_value('Substitute')
 pending[0].abort('internetdisconnected');page.unroute('**/api/teams',hold)
 page.evaluate("async ()=>(await import('/services/storageService.ts')).getAllTeams()")
 print('PASS: hanging request times out, releases form, preserves team/member/substitute draft',flush=True)
 page.route('**/api/teams',lose_response)
 page.get_by_role('button',name='Create team',exact=True).click()
 expect(page.get_by_role('alert')).to_be_visible()
 expect(page.get_by_label('New team name',exact=True)).to_have_value('Before Import')
 expect(page.get_by_label('Substitute 1 first name',exact=True)).to_have_value('Substitute')
 page.unroute('**/api/teams',lose_response)
 page.get_by_role('button',name='Create team',exact=True).click()
 expect(page.get_by_text('Team and roster created. You can now use this team in the schedule.',exact=True)).to_be_visible()
 def teams():return [t for t in page.request.get(base+'/api/teams?season=2027').json() if t['league']==league]
 assert len(teams())==1;before=teams()[0];assert len(before['players'])==3 and len(before['subs'])==1
 page.route('**/api/teams?ids=*',lambda route:route.abort('internetdisconnected'))
 offline=page.evaluate("async id=>(await import('/services/storageService.ts')).getMatchTeams(id,id)",before['id'])
 assert len(offline)==1 and offline[0]['players']==before['players']
 page.unroute('**/api/teams?ids=*')
 print('PASS: successful creation is available immediately to offline game-team lookup',flush=True)
 print('PASS: mobile create team, substitute, committed-but-lost response and duplicate-free retry',flush=True)
 csv='Date,Start Time,End Time,Location,Group,Home Team,Away Team\n2027-12-24,6:00 pm,7:00 pm,Tunnels 5/6,QC, before IMPORT ,After Import'
 page.get_by_role('button',name='Schedule',exact=True).click()
 page.get_by_role('button',name='+ Import Schedule CSV',exact=True).click()
 dialog=page.get_by_role('dialog');dialog.get_by_role('button',name='Paste CSV Text').click();dialog.locator('textarea').fill(csv)
 dialog.get_by_label('Destination for QC',exact=True).select_option(league)
 dialog.get_by_role('button',name='Import Season Schedule (1 Games)',exact=True).click()
 expect(dialog).not_to_be_visible();assert len(teams())==2
 assert next(t for t in teams() if t['id']==before['id'])['players']==before['players']
 after=next(t for t in teams() if t['id']!=before['id']);assert after['players']==[]
 page.get_by_role('button',name='Rosters',exact=True).click();page.get_by_label('League',exact=True).select_option(league)
 expect(page.get_by_label('Team',exact=True).get_by_role('option',name='After Import — roster needed',exact=True)).to_have_count(1)
 page.get_by_role('button',name='Create team',exact=True).click();page.get_by_label('New team name',exact=True).fill(' after import ')
 expect(page.get_by_role('button',name='Create team',exact=True)).to_be_disabled()
 page.get_by_role('button',name='Open existing team',exact=True).click()
 page.get_by_role('button',name='Set up three players',exact=True).click()
 for i in range(3):
  page.get_by_label(f'Team player {i+1} first name',exact=True).fill('Imported '+str(i+1))
 page.get_by_role('button',name='Save roster',exact=True).click()
 expect(page.get_by_text('Roster saved. Recorded games and scores are preserved.',exact=True)).to_be_visible()
 saved=next(t for t in teams() if t['id']==after['id']);assert len(saved['players'])==3
 games=page.request.get(base+'/api/matches?season=2027').json()
 game=next(g for g in games if g['league']==league)
 assert [x['playerId'] for x in game['innings'][0]['away']['playerScores']]==[x['id'] for x in saved['players']]
 assert len(game['innings'][0]['home']['playerScores'])==3
 assert len(game['innings'][0]['home']['playerScores'][0]['pitches'])==10
 print('PASS: actual CSV upload UI reuses existing roster; empty imported team opens and initializes 3-v-3 game',flush=True)
 page.get_by_role('button',name='Create team',exact=True).click();page.get_by_label('New team name',exact=True).fill('Created Later')
 for i in range(3):page.get_by_label(f'Team player {i+1} first name',exact=True).fill('Later '+str(i+1))
 page.get_by_role('button',name='Create team',exact=True).click()
 expect(page.get_by_text('Team and roster created. You can now use this team in the schedule.',exact=True)).to_be_visible()
 later=next(t for t in teams() if t['name']=='Created Later')
 page.get_by_role('button',name='Schedule',exact=True).click()
 # Filter to this disposable league before choosing its game.
 page.get_by_label('Filter by league',exact=True).select_option(league)
 page.get_by_role('button',name='Edit',exact=True).click();dialog=page.get_by_role('dialog',name='Edit scheduled game',exact=True)
 dialog.get_by_role('combobox',name=re.compile('^Home team')).select_option(later['id']);dialog.get_by_role('button',name='Save changes',exact=True).click();expect(dialog).not_to_be_visible()
 saved_game=page.request.get(base+'/api/matches?id='+game['id']).json()
 assert saved_game['home_team_id']==later['id']
 assert [x['playerId'] for x in saved_game['innings'][0]['home']['playerScores']]==[x['id'] for x in later['players']]
 print('PASS: team created after import appears in Schedule Edit and uses its actual roster',flush=True)
 assert not errors,errors
 b.close()
