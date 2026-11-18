"""Simplified schedule editor preserves stored notes and rejects conflicting reschedules."""
from playwright.sync_api import sync_playwright,expect
import json
base='http://127.0.0.1:4100';fixture=json.load(open('work/browser/notes-fixture.json'))
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':393,'height':852});page.set_default_timeout(12000)
 token=page.request.get(base+'/test-session').json()['token']
 page.add_init_script('('+'''x=>{localStorage.setItem('userRole','admin');localStorage.setItem('dugout_auth_token',x);sessionStorage.setItem('dugout_auth_token',x);localStorage.setItem('lastActivity',String(Date.now()));localStorage.setItem('dugout_current_season','2027');localStorage.setItem('dugout_app_state',JSON.stringify({view:'admin',season:'2027'}));}'''+')('+json.dumps(token)+');')
 page.goto(base);page.get_by_role('button',name='Schedule',exact=True).click();page.get_by_label('Filter by league',exact=True).select_option(fixture['league'])
 before=[page.request.get(base+'/api/matches?id='+id).json() for id in fixture['ids']]
 page.get_by_role('button',name='Edit',exact=True).first.click();dialog=page.get_by_role('dialog',name='Edit scheduled game',exact=True)
 expect(dialog.get_by_role('textbox',name='Notes',exact=True)).to_have_count(0); dialog.get_by_role('button',name='Save changes',exact=True).click();expect(dialog).not_to_be_visible()
 expect(page.get_by_text('Saved. This game still overlaps another game. Adjust its schedule to resolve the conflict.',exact=True)).to_be_visible()
 after=[page.request.get(base+'/api/matches?id='+id).json() for id in fixture['ids']]
 edited=next(row for row in after if row!=next(old for old in before if old['id']==row['id']));original=next(row for row in before if row['id']==edited['id'])
 assert edited=={**original,'revision':str(int(original['revision'])+1)}
 page.get_by_role('button',name='Edit',exact=True).first.click();dialog.get_by_role('textbox',name='Start time',exact=True).fill('6:05 pm')
 dialog.get_by_role('button',name='Save changes',exact=True).click();expect(dialog.get_by_text('this cage already has a game',exact=False)).to_be_visible()
 assert [page.request.get(base+'/api/matches?id='+id).json() for id in fixture['ids']]==after
 print('PASS: mobile editor has no Notes field and preserves stored notes/bookings/pitches; conflicting time change remains rejected',flush=True)
 b.close()
