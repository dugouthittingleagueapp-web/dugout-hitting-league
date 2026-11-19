"""Same display names remain separate through actual roster, import and history workflows."""
from playwright.sync_api import sync_playwright,expect
import json,re
base='http://127.0.0.1:4100';f=json.load(open('work/browser/same-name-fixture.json'))
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':393,'height':900});page.set_default_timeout(15000)
 token=page.request.get(base+'/test-session').json()['token'];auth={'Authorization':'Bearer '+token}
 for league in ['9U','11U']:assert page.request.post(base+'/api/leagues',headers=auth,data={'id':league,'season':'2027'}).ok
 page.add_init_script('('+'''x=>{localStorage.setItem('userRole','admin');localStorage.setItem('dugout_auth_token',x);sessionStorage.setItem('dugout_auth_token',x);localStorage.setItem('lastActivity',String(Date.now()));localStorage.setItem('dugout_current_season','2027');localStorage.setItem('dugout_app_state',JSON.stringify({view:'admin',season:'2027'}));}'''+')('+json.dumps(token)+');')
 page.goto(base);page.get_by_role('button',name='Rosters',exact=True).click()
 ids={}
 for league in ['9U','11U']:
  page.get_by_label('League',exact=True).select_option(league);page.get_by_role('button',name='Create team',exact=True).click();page.get_by_label('New team name',exact=True).fill('Eagles')
  for i in range(3):page.get_by_label(f'Team player {i+1} first name',exact=True).fill(league+' Member '+str(i+1))
  if league=='9U':
   page.get_by_label('League',exact=True).select_option('11U')
   expect(page.get_by_label('New team name',exact=True)).to_have_value('Eagles')
   expect(page.get_by_label('Team player 3 first name',exact=True)).to_have_value('9U Member 3')
   page.get_by_label('League',exact=True).select_option('9U')
  page.get_by_role('button',name='Create team',exact=True).click();expect(page.get_by_text('Team and roster created. You can now use this team in the schedule.',exact=True)).to_be_visible()
  team=next(t for t in page.request.get(base+'/api/teams?season=2027').json() if t['league']==league)
  assert team['name']=='Eagles';ids[league]=team['id']
  expect(page.get_by_label('Team',exact=True).get_by_role('option',name='Eagles',exact=True)).to_have_attribute('value',team['id'])
 assert ids['9U']!=ids['11U']
 print('PASS: create Eagles in both leagues without adding league names; each league selects its own roster',flush=True)
 page.get_by_role('button',name='Schedule',exact=True).click();page.get_by_role('button',name='+ Import Schedule CSV',exact=True).click();dialog=page.get_by_role('dialog');dialog.get_by_role('button',name='Paste CSV Text').click()
 dialog.locator('textarea').fill('Date,Start Time,End Time,Location,Group,Home Team,Away Team\n2027-12-22,6:00 pm,7:00 pm,Tunnels 5/6,Young,Eagles,Panthers\n2027-12-22,6:00 pm,7:00 pm,Tunnels 7/8,Older,Eagles,Panthers')
 dialog.get_by_label('Destination for Young',exact=True).select_option('9U');dialog.get_by_label('Destination for Older',exact=True).select_option('11U')
 expect(dialog.get_by_text('4 Teams',exact=True)).to_be_visible()
 dialog.get_by_role('button',name='Import Season Schedule (2 Games)',exact=True).click();expect(dialog).not_to_be_visible()
 data=page.request.get(base+'/api/schedule-admin?season=2027',headers=auth).json()
 for game in data['matches']:assert game['home_team_id']==ids[game['league']]
 for league in ['9U','11U']:
  page.get_by_label('Filter by league',exact=True).select_option(league);page.get_by_role('button',name='Edit',exact=True).click();dialog=page.get_by_role('dialog',name='Edit scheduled game',exact=True)
  expect(dialog.get_by_role('heading',name='Edit scheduled game · '+league,exact=True)).to_be_visible()
  home=dialog.get_by_role('combobox',name=re.compile('^Home team'));expect(home).to_have_value(ids[league]);expect(home.locator('option[value="'+ids['11U' if league=='9U' else '9U']+'"]')).to_have_count(0)
  dialog.get_by_role('button',name='Cancel',exact=True).click()
 print('PASS: import counts four league-specific teams; both Eagles reuse the correct ID; game editor excludes the other league',flush=True)
 page.get_by_role('button',name='Rosters',exact=True).click();page.get_by_label('League',exact=True).select_option('9U');page.get_by_label('Team',exact=True).select_option(ids['9U'])
 other=next(t for t in page.request.get(base+'/api/teams?season=2027').json() if t['id']==ids['11U'])
 page.get_by_label('Team player 1 first name',exact=True).fill('Corrected Nine')
 page.get_by_role('button',name='Add substitute',exact=True).click();page.get_by_role('button',name='Search history for Substitute 1',exact=True).click();page.get_by_label('Find a previous player for Substitute 1',exact=True).fill('Eagles')
 history=page.get_by_label('Previous-season matches for Substitute 1',exact=True)
 for league in ['9U','11U']:expect(history.get_by_text('Eagles · '+league+' (2026)',exact=True)).to_be_visible()
 history.get_by_text('Eagles · 11U (2026)',exact=True).locator('..').locator('..').get_by_role('button').click()
 expect(page.get_by_label('Substitute 1 first name',exact=True)).to_have_value('Alex');expect(page.get_by_label('Substitute 1 last name',exact=True)).to_have_value(f['lastName'])
 page.get_by_role('button',name='Save roster',exact=True).click();expect(page.get_by_text('Roster saved. Recorded games and scores are preserved.',exact=True)).to_be_visible()
 saved=page.request.get(base+'/api/teams?adminRoster=1&season=2027',headers=auth).json();team=next(t for t in saved['teams'] if t['id']==ids['9U'])
 assert next(link for link in saved['identityLinks'] if link['rosterPlayerId']==team['subs'][0]['id'])['personId']==next(person['person'] for person in f['people'] if person['league']=='11U')
 assert next(t for t in saved['teams'] if t['id']==ids['11U'])==other
 assert page.request.get(base+'/api/schedule-admin?season=2027',headers=auth).json()['matches']==data['matches']
 print('PASS: identical historic Eagles names show their leagues; selected player link and autofill are correct; other league and all games remain unchanged',flush=True)
 b.close()
