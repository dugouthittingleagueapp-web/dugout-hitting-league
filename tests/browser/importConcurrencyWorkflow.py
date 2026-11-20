"""Concurrent partial/full CSV import: preserve draft values and reconcile actual IDs."""
from playwright.sync_api import sync_playwright,expect
import json,uuid,os
from urllib.parse import urlparse
base=os.environ.get('DUGOUT_BROWSER_BASE_URL','http://127.0.0.1:4100');assert urlparse(base).hostname=='127.0.0.1'
f=json.load(open('work/browser/conflict-fixtures.json'))
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 for mode,start,end,day in [('partial','19:30','20:30','2027-11-10'),('full','23:00','23:30','2027-11-11')]:
  page=browser.new_page(viewport={'width':1200,'height':1000});page.set_default_timeout(12000)
  token=page.request.get(base+'/test-session').json()['token'];headers={'Authorization':'Bearer '+token}
  page.add_init_script('('+'''x=>{localStorage.setItem('userRole','admin');localStorage.setItem('dugout_auth_token',x);sessionStorage.setItem('dugout_auth_token',x);localStorage.setItem('lastActivity',String(Date.now()));localStorage.setItem('dugout_app_state',JSON.stringify({view:'admin',season:'2027'}));}'''+')('+json.dumps(token)+');')
  page.goto(base);page.get_by_role('button',name='Schedule',exact=True).click();page.get_by_role('button',name='+ Import Schedule CSV',exact=True).click()
  d=page.get_by_role('dialog');d.get_by_role('button',name='Paste CSV Text',exact=True).click()
  header='Date,Start Time,End Time,Location,Group,Home Team,Away Team\n'
  rows=[f'2027-11-02,18:00,19:00,Tunnels 5/6,QC,{mode} Home,{mode} Away',f'2027-11-03,18:00,19:00,Tunnels 5/6,QC,{mode} Other,{mode} Fourth']
  csv=header+'\n'.join(rows);destinations={'QC':{'mode':'existing','name':f['league']}}
  d.locator('textarea').fill(csv);d.get_by_label('Destination for QC',exact=True).select_option(f['league'])
  expect(page.get_by_role('heading',name='Resolve schedule conflicts',exact=True)).to_be_visible();d=page.get_by_role('dialog')
  old=page.request.post(base+'/api/schedule-admin',headers=headers,data={'action':'preview_resolution','season':'2027','import':{'csvText':csv,'leagueDestinations':destinations}}).json()
  def hold_old_refresh(route):
   if route.request.method=='POST' and route.request.post_data_json.get('action')=='preview_resolution' and route.request.post_data_json.get('import'):route.fulfill(status=200,content_type='application/json',body=json.dumps(old))
   else:route.continue_()
  page.route('**/api/schedule-admin',hold_old_refresh)
  first=d.get_by_role('region').filter(has=page.get_by_text(f'{mode} Home vs {mode} Away',exact=True));second=d.get_by_role('region').filter(has=page.get_by_text(f'{mode} Other vs {mode} Fourth',exact=True))
  first.get_by_label('Start time',exact=True).fill(start);first.get_by_label('End time',exact=True).fill(end);second.get_by_label('Date',exact=True).fill(day)
  if mode=='partial':
   subset=header+rows[0].replace('18:00,19:00','21:00,22:00')
   result=page.request.post(base+'/api/schedule-admin',headers=headers,data={'action':'import_schedule','season':'2027','csvText':subset,'leagueDestinations':destinations})
  else:
   pending=[dict(g) for g in old['games'] if g['kind']=='import'];pending[0]['startTime']='21:00';pending[0]['endTime']='22:00'
   result=page.request.post(base+'/api/schedule-admin',headers=headers,data={'action':'resolve_schedule','season':'2027','requestId':str(uuid.uuid4()),'changes':pending,'import':{'csvText':csv,'leagueDestinations':destinations}})
  assert result.ok,result.text()
  d.get_by_role('button',name='Save Changes',exact=True).click();expect(d.get_by_role('alert')).to_contain_text('another screen' if mode=='full' else 'now exists')
  page.unroute('**/api/schedule-admin',hold_old_refresh)
  expect(first.get_by_label('Start time',exact=True)).to_have_value(start);expect(first.get_by_label('End time',exact=True)).to_have_value(end);expect(second.get_by_label('Date',exact=True)).to_have_value(day)
  d.get_by_role('button',name='Save Changes',exact=True).click();expect(page.get_by_role('dialog')).to_have_count(0)
  teams=page.request.get(base+'/api/teams?season=2027').json();home=next(t['id'] for t in teams if t['name']==mode+' Home');other=next(t['id'] for t in teams if t['name']==mode+' Other')
  games=page.request.get(base+'/api/matches?season=2027').json();one=[g for g in games if g['home_team_id']==home];two=[g for g in games if g['home_team_id']==other]
  assert len(one)==len(two)==1 and one[0]['start_time']==start and two[0]['date'].startswith(day)
  print(f'PASS: {mode} concurrent import refreshes real IDs, keeps both local edits, saves once and creates no duplicate game',flush=True)
  page.close()
 browser.close()
