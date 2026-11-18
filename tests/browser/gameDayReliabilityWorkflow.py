"""Phase 2: actual UI -> API -> disposable localhost PostgreSQL only."""
from playwright.sync_api import sync_playwright,expect
import json,copy
base='http://127.0.0.1:3700'
f=json.load(open('work/browser/scoring-fixtures.json'))
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 errors=[]
 def open_game(scenario,role='umpire'):
  page=b.new_context(viewport={'width':390,'height':844}).new_page();page.set_default_timeout(12000)
  page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
  token=page.request.get(base+'/test-session?role='+role).json()['token'] if role!='fan' else ''
  data={'token':token,'role':role,'league':f['league'],'id':f['ids'][scenario]}
  page.add_init_script("""(()=>{const x="""+json.dumps(data)+""";localStorage.setItem('dugout_auth_token',x.token);sessionStorage.setItem('dugout_auth_token',x.token);localStorage.setItem('userRole',x.role);localStorage.setItem('lastActivity',String(Date.now()));localStorage.setItem('dugout_current_season','2026');localStorage.setItem('dugout_app_state',JSON.stringify({view:'scoring',currentLeague:x.league,currentMatchId:x.id,season:'2026'}));})();""")
  page.goto(base);expect(page.get_by_role('button',name='Inning 1',exact=True)).to_be_visible()
  if scenario.startswith('extras-'):page.get_by_role('button',name='Extras',exact=True).click()
  return page
 def saved(page,id):return page.request.get(base+'/api/matches?id='+id).json()
 fan=open_game('extras-five','fan');expect(fan.get_by_role('button',name='Next Round',exact=True)).to_have_count(0)
 before=saved(fan,f['ids']['extras-five']);bad={'id':before['id'],'revision':int(before['revision']),'tieBreaker':before['tie_breaker']+[{'roundNumber':2,'pitchLimit':3,'homePlayerId':f['home']['players'][0]['id'],'awayPlayerId':f['away']['players'][0]['id'],'homeScores':[None]*3,'awayScores':[None]*3}]}
 assert fan.request.put(base+'/api/matches',data=bad).status==401
 assert saved(fan,before['id'])==before
 print('PASS P1-03: fan has no Next Round control; anonymous API mutation denied with saved game unchanged',flush=True)
 page=open_game('extras-five');id=f['ids']['extras-five']
 expect(page.get_by_role('button',name='Next Round',exact=True)).to_have_count(0)
 auth=page.evaluate("localStorage.getItem('dugout_auth_token')");lock=page.evaluate("id=>sessionStorage.getItem('dugout_scoring_token_'+id)",id)
 headers={'Authorization':'Bearer '+auth,'X-Scoring-Token':lock}
 r=page.request.put(base+'/api/matches',data=bad,headers=headers);assert r.status==400,(r.status,r.text())
 assert saved(page,id)==before
 print('PASS P1-03: tied incomplete round cannot advance in UI or authenticated API; no partial write',flush=True)
 for expected_limit in [3,1,1]:
  prior=saved(page,id);rounds=copy.deepcopy(prior['tie_breaker'])
  rounds[-1]['homeScores']=[0]*rounds[-1]['pitchLimit'];rounds[-1]['awayScores']=[0]*rounds[-1]['pitchLimit']
  r=page.request.put(base+'/api/matches',data={'id':id,'revision':int(prior['revision']),'tieBreaker':rounds},headers=headers);assert r.status==200,r.text()
  page.reload();page.get_by_role('button',name='Extras',exact=True).click()
  button=page.get_by_role('button',name='Next Round',exact=True);expect(button).to_be_visible()
  with page.expect_response(lambda r:'/api/matches' in r.url and r.request.method=='PUT') as response:button.click()
  assert response.value.status==200,response.value.text()
  state=saved(page,id);assert state['tie_breaker'][:-1]==rounds;assert state['tie_breaker'][-1]['pitchLimit']==expected_limit
  expect(page.get_by_role('button',name='Next Round',exact=True)).to_have_count(0)
 print('PASS P1-03: completed tied rounds advance 5 -> 3 -> 1 -> 1 and preserve earlier scores',flush=True)
 # Another synthetic game: lose only the lock, retain a durable offline pitch.
 page=open_game('hanging');page.get_by_role('button',name='Inning 1',exact=True).click()
 id=f['ids']['hanging'];token=page.evaluate("localStorage.getItem('dugout_auth_token')")
 lock=page.evaluate("id=>sessionStorage.getItem('dugout_scoring_token_'+id)",id)
 assert page.request.post(base+'/api/scoring-lock',data={'matchId':id,'token':lock,'action':'release'},headers={'Authorization':'Bearer '+token}).status==200
 page.get_by_role('button',name='Pitch 1, Score: None',exact=True).first.click();page.get_by_role('button',name='Score 4',exact=True).click()
 expect(page.get_by_role('heading',name='Scores need checking',exact=True)).to_be_visible()
 assert saved(page,id)['revision']=='0'
 calls=[];page.on('request',lambda r:calls.append((r.url,r.post_data_json)) if r.method=='POST' else None)
 page.get_by_role('button',name='Try syncing again',exact=True).click()
 expect(page.get_by_role('button',name='Pitch 1, Score: 4',exact=True).first).to_be_visible()
 expect(page.get_by_text('✓ All scores saved',exact=True)).to_be_visible()
 state=saved(page,id);assert int(state['revision'])==1 and state['innings'][0]['away']['playerScores'][0]['pitches'][0]['points']==4
 assert calls[0][0].endswith('/api/scoring-lock') and calls[0][1]['action']=='acquire'
 assert not any(c[1].get('action')=='takeover' for c in calls)
 print('PASS P1-06: one recovery retry reacquires available access and saves exactly one pitch without takeover',flush=True)
 assert not errors,errors
 b.close()
