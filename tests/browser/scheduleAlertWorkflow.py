"""Whole-season warning, one-click review and read-only protection with a local synthetic calendar."""
from playwright.sync_api import sync_playwright,expect
import json,os,subprocess
from urllib.parse import urlparse
base=os.environ.get('DUGOUT_BROWSER_BASE_URL','http://127.0.0.1:4100');assert urlparse(base).hostname=='127.0.0.1'
f=json.load(open('work/browser/conflict-fixtures.json'))
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':393,'height':852});page.set_default_timeout(12000)
 token=page.request.get(base+'/test-session').json()['token']
 page.add_init_script('('+'''x=>{localStorage.setItem('userRole','admin');localStorage.setItem('dugout_auth_token',x);sessionStorage.setItem('dugout_auth_token',x);localStorage.setItem('lastActivity',String(Date.now()));localStorage.setItem('dugout_app_state',JSON.stringify({view:'admin',season:'2027'}));}'''+')('+json.dumps(token)+');')
 page.goto(base);page.get_by_role('button',name='Schedule',exact=True).click()
 banner=page.get_by_role('alert',name='Schedule overlap warning',exact=True)
 expect(banner.get_by_role('heading',name='2 games overlap',exact=True)).to_be_visible();page.screenshot(path='work/browser/schedule-overlap-alert-mobile.png',full_page=True)
 page.get_by_label('Filter by league',exact=True).select_option(f['otherLeague']);page.get_by_label('Find games',exact=True).fill('No matching team')
 expect(page.get_by_text('No games found for these filters.',exact=True)).to_be_visible();expect(banner).to_be_visible()
 before=page.request.get(base+'/api/matches?id='+f['ids']['b']).json()
 banner.get_by_role('button',name='Review unplayed games',exact=True).click();d=page.get_by_role('dialog')
 target=d.get_by_role('region').filter(has=page.get_by_text('Wolves vs Raptors',exact=True))
 target.get_by_label('Start time',exact=True).select_option('19:00');expect(target.get_by_label('End time',exact=True)).to_have_value('20:00')
 assert page.request.get(base+'/api/matches?id='+f['ids']['b']).json()==before
 d.get_by_role('button',name='Save Changes',exact=True).click();expect(d).to_have_count(0);expect(banner).to_have_count(0)
 saved=page.request.get(base+'/api/matches?id='+f['ids']['b']).json();assert saved['start_time']=='19:00' and saved['end_time']=='20:00'
 page.get_by_role('button',name='Refresh',exact=True).click();expect(banner).to_have_count(0)
 print('PASS: prominent whole-season alert survives hidden league/search filters, opens review directly and clears after a one-hour booking is saved',flush=True)
 subprocess.check_call(['node','tests/browser/scheduleAlertSetup.mjs','protected'])
 f=json.load(open('work/browser/conflict-fixtures.json'));page.get_by_role('button',name='Refresh',exact=True).click();expect(banner).to_be_visible()
 before=[page.request.get(base+'/api/matches?id='+f['ids'][key]).json() for key in ['protected','protectedOverlap']]
 banner.get_by_role('button',name='View overlaps',exact=True).click();d=page.get_by_role('dialog')
 expect(d.get_by_role('button',name='Save Changes',exact=True)).to_be_disabled()
 for node in d.get_by_role('region').all():expect(node.get_by_label('Start time',exact=True)).to_be_disabled()
 d.get_by_role('button',name='Cancel',exact=True).click()
 after=[page.request.get(base+'/api/matches?id='+f['ids'][key]).json() for key in ['protected','protectedOverlap']];assert after==before
 print('PASS: protected-only overlaps remain visible and can be reviewed without enabling edits or changing scores/status',flush=True)
 b.close()
