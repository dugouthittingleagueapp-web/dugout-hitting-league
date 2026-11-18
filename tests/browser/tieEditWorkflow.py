"""Takeover -> edit recorded scores to a tie -> Extras prompt and explicit entry."""
from playwright.sync_api import sync_playwright,expect
import json,os,uuid
base=os.environ.get('DUGOUT_TIE_EDIT_BASE','http://127.0.0.1:3700')
assert base in ['http://127.0.0.1:3700','http://127.0.0.1:3900']
f=json.load(open('work/browser/scoring-fixtures.json'));id=f['ids']['edit-tie']
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox']);errors=[]
 page=b.new_context(viewport={'width':390,'height':844}).new_page();page.set_default_timeout(12000)
 page.route('https://fonts.googleapis.com/**',lambda r:r.abort());page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
 auth=page.request.get(base+'/test-session?role=admin').json()['token']
 prior=str(uuid.uuid4());assert page.request.post(base+'/api/scoring-lock',data={'matchId':id,'token':prior,'action':'acquire'},headers={'Authorization':'Bearer '+auth}).status==200
 data={'auth':auth,'league':f['league'],'id':id}
 page.add_init_script('''(()=>{const x='''+json.dumps(data)+''';localStorage.setItem('dugout_auth_token',x.auth);sessionStorage.setItem('dugout_auth_token',x.auth);localStorage.setItem('userRole','admin');localStorage.setItem('lastActivity',String(Date.now()));localStorage.setItem('dugout_current_season','2026');localStorage.setItem('dugout_app_state',JSON.stringify({view:'scoring',currentLeague:x.league,currentMatchId:x.id,season:'2026'}));})();''')
 page.goto(base,wait_until='domcontentloaded');page.get_by_role('button',name='Admin: Take over',exact=True).click()
 expect(page.get_by_role('button',name='Inning 1',exact=True)).to_be_visible()
 def saved():return page.request.get(base+'/api/matches?id='+id).json()
 def edit_pitch(side):
  pitch=page.get_by_role('button',name='Pitch 1, Score: 0',exact=True)
  (pitch.last if side=='home' else pitch.first).click();page.get_by_role('button',name='Score 1',exact=True).click();page.get_by_role('button',name='Update',exact=True).click()
 edit_pitch('home');expect(page.get_by_text('✓ All scores saved',exact=True)).to_be_visible()
 expect(page.get_by_role('dialog',name='Tie Breaker Setup',exact=True)).to_have_count(0)
 edit_pitch('away');dialog=page.get_by_role('dialog',name='Tie Breaker Setup',exact=True);expect(dialog).to_be_visible()
 expect(page.get_by_text('✓ All scores saved',exact=True)).to_be_visible()
 state=saved();assert state['innings'][0]['home']['playerScores'][2]['pitches'][0]['points']==1
 assert state['innings'][0]['away']['playerScores'][0]['pitches'][0]['points']==1
 assert not state['is_complete'] and not state['tie_breaker']
 print('PASS: admin takeover followed by editing recorded regulation scores to 1-1 opens Extras setup without interrupting the first correction',flush=True)
 dialog.get_by_role('button',name='Back to scoring',exact=True).click();page.reload()
 expect(page.get_by_role('button',name='Start Extras',exact=True)).to_be_visible();page.get_by_role('button',name='Start Extras',exact=True).click()
 expect(dialog).to_be_visible();dialog.get_by_role('button',name='Start Extras',exact=True).click()
 expect(dialog).to_have_count(0)
 state=saved();assert len(state['tie_breaker'])==1 and state['tie_breaker'][0]['pitchLimit']==5
 print('PASS: a completed tie after refresh keeps a visible Start Extras action and creates the five-pitch round',flush=True)
 # Fill the current extra round with tied zeros, then edit its recorded scores.
 lock=page.evaluate("id=>sessionStorage.getItem('dugout_scoring_token_'+id)",id)
 rounds=state['tie_breaker'];rounds[0]['homeScores']=[0]*5;rounds[0]['awayScores']=[0]*5
 r=page.request.put(base+'/api/matches',data={'id':id,'revision':int(state['revision']),'tieBreaker':rounds},headers={'Authorization':'Bearer '+auth,'X-Scoring-Token':lock});assert r.status==200,r.text()
 page.reload();page.get_by_role('button',name='Extras',exact=True).click()
 edit_pitch('home');expect(page.get_by_text('✓ All scores saved',exact=True)).to_be_visible();expect(dialog).to_have_count(0)
 edit_pitch('away');expect(dialog).to_be_visible();expect(dialog.get_by_text('The next extra round has 3 pitches',exact=False)).to_be_visible()
 dialog.get_by_role('button',name='Start Extras',exact=True).click();expect(dialog).to_have_count(0)
 state=saved();assert len(state['tie_breaker'])==2 and state['tie_breaker'][1]['pitchLimit']==3
 assert state['tie_breaker'][0]['homeScores'][0]==1 and state['tie_breaker'][0]['awayScores'][0]==1
 assert state['innings'][0]['home']['playerScores'][2]['pitches'][0]['points']==1
 assert state['innings'][0]['away']['playerScores'][0]['pitches'][0]['points']==1
 assert not errors,errors
 print('PASS: edits tying a completed extra round open setup for the next three-pitch round and preserve all earlier scores',flush=True)
 b.close()
