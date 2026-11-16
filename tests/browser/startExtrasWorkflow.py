"""Initial Extras popup: eligibility, durable-save ordering, feedback and contrast."""
from playwright.sync_api import sync_playwright,expect
import json,re
base='http://127.0.0.1:3700'
f=json.load(open('work/browser/scoring-fixtures.json'))
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 errors=[]
 def open_game(scenario,dark=True):
  page=b.new_context(viewport={'width':390,'height':844}).new_page();page.set_default_timeout(12000)
  page.route('https://fonts.googleapis.com/**',lambda r:r.abort())
  page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
  token=page.request.get(base+'/test-session?role=umpire').json()['token']
  data={'token':token,'league':f['league'],'id':f['ids'][scenario],'dark':dark}
  page.add_init_script('''(()=>{const x='''+json.dumps(data)+''';localStorage.setItem('dugout_auth_token',x.token);sessionStorage.setItem('dugout_auth_token',x.token);localStorage.setItem('userRole','umpire');localStorage.setItem('dugout_theme',JSON.stringify(x.dark));localStorage.setItem('lastActivity',String(Date.now()));localStorage.setItem('dugout_current_season','2026');localStorage.setItem('dugout_app_state',JSON.stringify({view:'scoring',currentLeague:x.league,currentMatchId:x.id,season:'2026'}));})();''')
  page.goto(base,wait_until='domcontentloaded');expect(page.get_by_role('button',name='Inning 1',exact=True)).to_be_visible();return page
 def saved(page,scenario):return page.request.get(base+'/api/matches?id='+f['ids'][scenario]).json()
 page=open_game('incomplete-extras')
 page.get_by_role('button',name='Inning 6',exact=True).click();page.get_by_role('button',name='Pitch 10, Score: None',exact=True).last.click();page.get_by_role('button',name='Score 0',exact=True).click()
 expect(page.get_by_text('✓ All scores saved',exact=True)).to_be_visible();page.wait_for_timeout(650)
 expect(page.get_by_role('heading',name='Tie Breaker Setup',exact=True)).to_have_count(0)
 page.get_by_title('Exit options: Save & Exit or Exit & Finalize').click();page.get_by_role('button',name=re.compile('Exit & Finalize')).click();page.get_by_role('button',name='Start Extras',exact=True).click()
 dialog=page.get_by_role('dialog',name='Tie Breaker Setup',exact=True)
 expect(dialog).to_be_visible();expect(dialog.get_by_role('button',name='Start Extras',exact=True)).to_be_disabled()
 expect(dialog.get_by_text(re.compile('Record the remaining regulation pitches'))).to_be_visible()
 page.screenshot(path='work/extras-blocked-dark.png')
 dialog.get_by_role('button',name='Back to scoring',exact=True).click();expect(dialog).to_have_count(0)
 assert not saved(page,'incomplete-extras')['tie_breaker']
 print('PASS: skipping to the last pitch does not open a premature popup; explicit early Extras explains the block and allows returning to scoring',flush=True)
 page=open_game('initial-extras');held=[]
 page.route('**/api/scoring',lambda r:held.append(r) if r.request.method=='POST' else r.continue_())
 page.get_by_role('button',name='Inning 6',exact=True).click();page.get_by_role('button',name='Pitch 10, Score: None',exact=True).last.click();page.get_by_role('button',name='Score 0',exact=True).click()
 dialog=page.get_by_role('dialog',name='Tie Breaker Setup',exact=True);expect(dialog).to_be_visible()
 dialog.get_by_label('Home batter',exact=True).select_option(f['home']['players'][2]['id']);dialog.get_by_label('Away batter',exact=True).select_option(f['away']['players'][2]['id'])
 def contrast(dialog):
  colors=dialog.evaluate('''el=>[el.querySelector('h2'),el.querySelector('p'),...el.querySelectorAll('label,select')].map(x=>{let p=x,b=getComputedStyle(p).backgroundColor;while(b==='rgba(0, 0, 0, 0)'&&p.parentElement){p=p.parentElement;b=getComputedStyle(p).backgroundColor;}return {fg:getComputedStyle(x).color,bg:b};})''')
  def lum(c):
   v=[int(x)/255 for x in re.findall(r'\d+',c)[:3]];v=[x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in v];return sum(a*z for a,z in zip(v,[.2126,.7152,.0722]))
  for c in colors:
   a,z=lum(c['fg']),lum(c['bg']);assert (max(a,z)+.05)/(min(a,z)+.05)>=4.5,c
 contrast(dialog);page.screenshot(path='work/extras-ready-dark.png')
 page.evaluate("()=>{localStorage.setItem('dugout_theme','false');document.documentElement.classList.remove('dark');}")
 contrast(dialog);page.screenshot(path='work/extras-ready-light.png')
 dialog.get_by_role('button',name='Start Extras',exact=True).click();expect(dialog.get_by_role('button',name='Starting extras…',exact=True)).to_be_disabled()
 assert len(held)==1
 assert not saved(page,'initial-extras')['tie_breaker']
 held[0].continue_();page.unroute('**/api/scoring')
 expect(dialog).to_have_count(0);expect(page.get_by_role('button',name='Extras',exact=True)).to_be_visible()
 state=saved(page,'initial-extras');assert int(state['revision'])==2
 assert state['tie_breaker']==[{'roundNumber':1,'pitchLimit':5,'homePlayerId':f['home']['players'][2]['id'],'awayPlayerId':f['away']['players'][2]['id'],'homeScores':[None]*5,'awayScores':[None]*5}]
 assert all(v['points']==0 for i in state['innings'] for side in ['home','away'] for p in i[side]['playerScores'] for v in p['pitches'])
 assert not errors,errors
 print('PASS: light/dark popup text and selectors meet 4.5:1 contrast; a completed tied game starts five-pitch extras after its pending final pitch saves, preserving all regulation scores',flush=True)
 b.close()
