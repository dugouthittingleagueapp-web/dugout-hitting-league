"""Identity suggestions and actual career totals against isolated localhost APIs/PG."""
from playwright.sync_api import sync_playwright,expect
import json
base='http://127.0.0.1:4100';f=json.load(open('work/browser/identity-fixture.json'))
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':393,'height':900});page.set_default_timeout(15000)
 token=page.request.get(base+'/test-session').json()['token']
 page.add_init_script('('+'''x=>{localStorage.setItem('userRole','admin');localStorage.setItem('dugout_auth_token',x);sessionStorage.setItem('dugout_auth_token',x);localStorage.setItem('lastActivity',String(Date.now()));localStorage.setItem('dugout_current_season','2027');localStorage.setItem('dugout_app_state',JSON.stringify({view:'admin',season:'2027'}));}'''+')('+json.dumps(token)+');')
 page.goto(base);page.get_by_role('button',name='Rosters',exact=True).click()
 page.get_by_label('League',exact=True).select_option(f['league']);page.get_by_label('Team',exact=True).select_option(f['home']['id'])
 def games():return [page.request.get(base+'/api/matches?id='+id).json() for id in f['ids'].values()]
 before=games()
 page.get_by_role('button',name='Add team player',exact=True).click()
 page.get_by_label('Team player 3 first name',exact=True).fill('Alexander');page.get_by_label('Team player 3 last name',exact=True).fill(f['lastName'][0])
 section=page.get_by_label('Previous-season matches for Team player 3',exact=True)
 expect(section.get_by_text('Has this player played before?',exact=True)).to_be_visible()
 expect(section.get_by_text('Alex Previous Team 1 (2026)',exact=True)).to_be_visible();expect(section.get_by_text('Alex Previous Team 2 (2026)',exact=True)).to_be_visible()
 page.get_by_role('button',name='Save roster',exact=True).click();expect(page.get_by_role('alert')).to_contain_text('Confirm the previous-season matches')
 section.get_by_text('Alex Previous Team 1 (2026)',exact=True).locator('..').get_by_role('button').click()
 expect(page.get_by_label('Team player 3 first name',exact=True)).to_have_value('Alex')
 expect(page.get_by_label('Team player 3 last name',exact=True)).to_have_value(f['lastName'])
 page.get_by_role('button',name='Save roster',exact=True).click();expect(page.get_by_text('Roster saved. Recorded games and scores are preserved.',exact=True)).to_be_visible()
 data=page.request.get(base+'/api/teams?adminRoster=1&season=2027',headers={'Authorization':'Bearer '+token}).json()
 team=next(t for t in data['teams'] if t['id']==f['home']['id']);new_id=team['players'][2]['id']
 selected=next(l for l in data['identityLinks'] if l['rosterPlayerId']==new_id)
 assert selected['personId'] in [x['person'] for x in f['people']]
 old=next(x for x in f['people'] if x['person']==selected['personId'])
 points=4 if old==f['people'][0] else 2
 career=page.evaluate("async id=>(await import('/services/storageService.ts')).getPlayerCareerStats(id)",new_id)
 assert career['careerTotals']['totalPoints']==points,career
 page.get_by_label('Team player 3 first name',exact=True).fill('Alex Renamed')
 page.get_by_role('button',name='Save roster',exact=True).click();expect(page.get_by_text('Roster saved. Recorded games and scores are preserved.',exact=True)).to_be_visible()
 career=page.evaluate("async id=>(await import('/services/storageService.ts')).getPlayerCareerStats(id)",new_id)
 assert career['careerTotals']['totalPoints']==points
 assert games()==before
 print('PASS: one name-entry flow, two same-name suggestions with prior teams/seasons, confirmation required, actual ID-based career totals and rename stability',flush=True)
 page.get_by_role('button',name='Add substitute',exact=True).click()
 page.get_by_label('Substitute 2 first name',exact=True).fill('Alex');page.get_by_label('Substitute 2 last name',exact=True).fill(f.get('lastName','IdentityTest'))
 other=page.get_by_label('Previous-season matches for Substitute 2',exact=True)
 other.get_by_role('button',name='No, this is a different player',exact=True).click()
 page.get_by_role('button',name='Save roster',exact=True).click();expect(page.get_by_text('Roster saved. Recorded games and scores are preserved.',exact=True)).to_be_visible()
 data=page.request.get(base+'/api/teams?adminRoster=1&season=2027',headers={'Authorization':'Bearer '+token}).json()
 team=next(t for t in data['teams'] if t['id']==f['home']['id']);sub_id=team['subs'][1]['id'];link=next(l for l in data['identityLinks'] if l['rosterPlayerId']==sub_id)
 assert link['personId'] not in [x['person'] for x in f['people']]
 assert games()==before
 page.screenshot(path='work/browser/player-identities-mobile.png',full_page=True)
 print('PASS: explicit different-player answer creates a separate permanent identity; saved game rows stay identical',flush=True)
 # Correct a missed connection after the new name has already been saved.
 page.get_by_label('Substitute 2 first name',exact=True).fill('Distinct Name')
 page.get_by_label('Substitute 2 last name',exact=True).fill('')
 page.get_by_role('button',name='Save roster',exact=True).click();expect(page.get_by_text('Roster saved. Recorded games and scores are preserved.',exact=True)).to_be_visible()
 page.get_by_label('Find a previous player for Substitute 2',exact=True).fill('Alex Previous Team 2')
 match=page.get_by_label('Previous-season matches for Substitute 2',exact=True)
 match.get_by_text('Alex '+f.get('lastName','IdentityTest'),exact=True).locator('..').get_by_role('button').click()
 expect(page.get_by_label('Substitute 2 first name',exact=True)).to_have_value('Alex')
 expect(page.get_by_label('Substitute 2 last name',exact=True)).to_have_value(f['lastName'])
 expect(match.locator('button[aria-pressed="true"]')).to_have_text('✓ Same player selected')
 page.get_by_role('button',name='Save roster',exact=True).click();expect(page.get_by_text('Roster saved. Recorded games and scores are preserved.',exact=True)).to_be_visible()
 data=page.request.get(base+'/api/teams?adminRoster=1&season=2027',headers={'Authorization':'Bearer '+token}).json()
 saved_team=next(t for t in data['teams'] if t['id']==f['home']['id'])
 assert saved_team['subs'][1]['id']==sub_id and saved_team['subs'][1]['name']=='Alex' and saved_team['subs'][1]['lastName']==f['lastName']
 assert next(l for l in data['identityLinks'] if l['rosterPlayerId']==sub_id)['personId']==f['people'][1]['person']
 career=page.evaluate("async id=>(await import('/services/storageService.ts')).getPlayerCareerStats(id)",sub_id)
 assert career['careerTotals']['totalPoints']==2
 expect(page.get_by_label('Substitute 2 connected history',exact=True)).to_contain_text('Alex Previous Team 2 (2026)')
 assert games()==before
 print('PASS: selecting a previous player autofills both name fields, saves them and retains the roster ID; career history joins by ID without changing any pitches',flush=True)

 # A fresh team starts with empty names; manual matching should fill both fields too.
 page.get_by_role('button',name='Create team',exact=True).click()
 page.get_by_label('New team name',exact=True).fill('Autofill Creation Test')
 page.get_by_label('Find a previous player for Team player 1',exact=True).fill('Alex Previous Team 1')
 creation_match=page.get_by_label('Previous-season matches for Team player 1',exact=True)
 creation_match.get_by_text('Alex Previous Team 1 (2026)',exact=True).locator('..').get_by_role('button').click()
 expect(page.get_by_label('Team player 1 first name',exact=True)).to_have_value('Alex')
 expect(page.get_by_label('Team player 1 last name',exact=True)).to_have_value(f['lastName'])
 page.get_by_label('Team player 2 first name',exact=True).fill('Unmatched Teammate')
 page.get_by_role('button',name='Create team and roster',exact=True).click()
 expect(page.get_by_text('Team and roster created. You can now use this team in the schedule.',exact=True)).to_be_visible()
 data=page.request.get(base+'/api/teams?adminRoster=1&season=2027',headers={'Authorization':'Bearer '+token}).json()
 created=next(t for t in data['teams'] if t['name']=='Autofill Creation Test')
 assert created['players'][0]['name']=='Alex' and created['players'][0]['lastName']==f['lastName']
 assert next(link for link in data['identityLinks'] if link['rosterPlayerId']==created['players'][0]['id'])['personId']==f['people'][0]['person']
 assert games()==before
 print('PASS: new-team matching from empty fields fills both names and saves the selected permanent identity',flush=True)
 b.close()
