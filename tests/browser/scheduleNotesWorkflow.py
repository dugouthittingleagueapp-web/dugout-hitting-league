"""Simplified schedule editor preserves stored notes and rejects conflicting reschedules."""
from playwright.sync_api import sync_playwright,expect
import json,re
base='http://127.0.0.1:4100';fixture=json.load(open('work/browser/notes-fixture.json'))
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':393,'height':852});page.set_default_timeout(12000)
 token=page.request.get(base+'/test-session').json()['token']
 page.add_init_script('('+'''x=>{localStorage.setItem('userRole','admin');localStorage.setItem('dugout_auth_token',x);sessionStorage.setItem('dugout_auth_token',x);localStorage.setItem('lastActivity',String(Date.now()));localStorage.setItem('dugout_current_season','2027');localStorage.setItem('dugout_app_state',JSON.stringify({view:'admin',season:'2027'}));}'''+')('+json.dumps(token)+');')
 page.goto(base);page.get_by_role('button',name='Schedule',exact=True).click();page.get_by_label('Filter by league',exact=True).select_option(fixture['league'])
 before=[page.request.get(base+'/api/matches?id='+id).json() for id in fixture['ids']]
 page.get_by_role('button',name='Edit',exact=True).first.click();dialog=page.get_by_role('dialog')
 expect(dialog.get_by_role('heading',name='Resolve schedule conflicts',exact=True)).to_be_visible()
 root=dialog.get_by_role('region').filter(has=page.get_by_text('Game you opened',exact=True))
 expect(root.get_by_role('textbox',name='Notes',exact=True)).to_have_value('Original notes')
 expect(dialog.get_by_role('button',name='Save Changes',exact=True)).to_be_disabled()
 root.get_by_label('Start time',exact=True).fill('6:05 pm')
 expect(dialog.get_by_role('button',name='Save Changes',exact=True)).to_be_disabled()
 assert [page.request.get(base+'/api/matches?id='+id).json() for id in fixture['ids']]==before
 root.get_by_label('Date',exact=True).fill('2027-12-31')
 dialog.get_by_role('button',name='Save Changes',exact=True).click();expect(dialog).not_to_be_visible()
 after=[page.request.get(base+'/api/matches?id='+id).json() for id in fixture['ids']]
 for old,new in zip(before,after):assert old['notes']==new['notes']=='Original notes' and old['innings']==new['innings'] and old['status']==new['status']
 assert sum(old!=new for old,new in zip(before,after))==1
 print('PASS: overlapping legacy bookings require resolution; existing notes remain editable and preserved; no score/status or neighbor changes',flush=True)
 b.close()
