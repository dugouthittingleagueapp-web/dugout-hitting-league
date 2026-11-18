"""Previous-pitch confirmation against the actual UI/API and synthetic localhost DB."""
from playwright.sync_api import sync_playwright, expect
import json, os
from urllib.parse import urlparse
base=os.environ.get('DUGOUT_BROWSER_BASE_URL','http://127.0.0.1:4000')
assert urlparse(base).hostname=='127.0.0.1', 'Synthetic localhost tests only'
f=json.load(open('work/browser/scoring-fixtures.json'))
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 def open_game(scenario):
  c=b.new_context(viewport={'width':393,'height':780},has_touch=True)
  page=c.new_page();page.set_default_timeout(12000)
  auth=page.request.get(base+'/test-session?role=umpire').json()['token']
  state={'auth':auth,'league':f['league'],'id':f['ids'][scenario]}
  page.add_init_script("(" + """x=>{localStorage.setItem('userRole','umpire');localStorage.setItem('dugout_auth_token',x.auth);sessionStorage.setItem('dugout_auth_token',x.auth);localStorage.setItem('lastActivity',String(Date.now()));localStorage.setItem('dugout_app_state',JSON.stringify({view:'scoring',currentLeague:x.league,currentMatchId:x.id,season:'2026'}));}""" + ")(" + json.dumps(state) + ");")
  page.goto(base);expect(page.get_by_role('button',name='Inning 1',exact=True)).to_be_visible()
  return page
 page=open_game('storage')
 page.get_by_role('button',name='Pitch 1, Score: None',exact=True).first.click()
 expect(page.get_by_text('Previous pitch',exact=False)).to_have_count(0)
 page.get_by_role('button',name='Score 0',exact=True).click()
 expect(page.get_by_text('Previous pitch (#1): 0 points',exact=True)).to_be_visible()
 page.get_by_role('button',name='Undo Previous',exact=True).click()
 expect(page.get_by_text('Previous pitch',exact=False)).to_have_count(0)
 page.get_by_role('button',name='Score 4',exact=True).click()
 expect(page.get_by_text('Previous pitch (#1): 4 points',exact=True)).to_be_visible()
 expect(page.get_by_text('✓ All scores saved',exact=True)).to_be_visible()
 page.get_by_role('button',name='Cancel',exact=True).click();page.reload()
 page.get_by_role('button',name='Pitch 2, Score: None',exact=True).first.click()
 expect(page.get_by_text('Previous pitch (#1): 4 points',exact=True)).to_be_visible()
 # Large accessible text must retain access to the correction controls.
 page.add_style_tag(content='html{font-size:24px!important;}')
 page.get_by_role('button',name='Undo Previous',exact=True).click()
 page.get_by_role('button',name='Score 1',exact=True).click()
 expect(page.get_by_text('Previous pitch (#1): 1 point',exact=True)).to_be_visible()
 page.screenshot(path='work/browser/previous-pitch-large-text.png')
 expect(page.get_by_text('✓ All scores saved',exact=True)).to_be_visible()
 saved=page.request.get(base+'/api/matches?id='+f['ids']['storage']).json()
 assert saved['innings'][0]['away']['playerScores'][0]['pitches'][0]['points']==1
 page.context.close()
 print('PASS: regulation previous pitch, zero, undo/re-entry, refresh, singular point, large-text controls and database result',flush=True)
 page=open_game('two-player')
 row=page.locator('tr').filter(has=page.get_by_text('Alpha',exact=True))
 row.get_by_role('button',name='Pitch 10, Score: None',exact=True).click()
 page.get_by_role('button',name='Score 3',exact=True).click()
 expect(page.get_by_text('Previous pitch (#10): 3 points',exact=True)).to_be_visible()
 page.get_by_role('button',name='Undo Previous',exact=True).click()
 page.get_by_role('button',name='Score 2',exact=True).click()
 expect(page.get_by_text('Previous pitch (#10): 2 points',exact=True)).to_be_visible()
 expect(page.get_by_text('✓ All scores saved',exact=True)).to_be_visible()
 page.context.close()
 print('PASS: two-player ghost-row boundary uses the correct batter and pitch, with undo/re-entry',flush=True)
 for scenario in ['extras-five','extras-three']:
  page=open_game(scenario);page.get_by_role('button',name='Extras',exact=True).click()
  page.get_by_role('button',name='Pitch 1, Score: None',exact=True).last.click()
  page.get_by_role('button',name='Score 2',exact=True).click()
  expect(page.get_by_text('Previous pitch (#1): 2 points',exact=True)).to_be_visible()
  page.get_by_role('button',name='Undo Previous',exact=True).click()
  page.get_by_role('button',name='Score 0',exact=True).click()
  expect(page.get_by_text('Previous pitch (#1): 0 points',exact=True)).to_be_visible()
  expect(page.get_by_text('✓ All scores saved',exact=True)).to_be_visible()
  page.context.close();print('PASS: '+scenario+' previous score and undo/re-entry',flush=True)
 page=open_game('extras-one');page.get_by_role('button',name='Extras',exact=True).click()
 page.get_by_role('button',name='Pitch 1, Score: None',exact=True).last.click()
 expect(page.get_by_text('Previous pitch',exact=False)).to_have_count(0)
 page.context.close();print('PASS: one-pitch extras does not borrow a score from an earlier round',flush=True)
 b.close()
