"""Local synthetic fan layout checks. Desktop Firefox is not Android Firefox.

Start tests/browser/vite.config.ts with the isolated fan-scroll database, then:
DUGOUT_BROWSER_BASE_URL=http://127.0.0.1:4000 python3 tests/browser/fanScoreboardWorkflow.py
"""
import json
import os
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

base = os.environ.get('DUGOUT_BROWSER_BASE_URL', 'http://127.0.0.1:4000')
assert urlparse(base).hostname == '127.0.0.1', 'Synthetic localhost tests only'
fixture = json.load(open('work/browser/scoring-fixtures.json'))

with sync_playwright() as p:
    for engine in ['chromium', 'firefox']:
        launch = {'executable_path': '/usr/bin/chromium', 'args': ['--no-sandbox']} if engine == 'chromium' else {}
        browser = getattr(p, engine).launch(headless=True, **launch)
        for size in [16, 20, 24]:
            context = browser.new_context(viewport={'width': 393, 'height': 780}, has_touch=True)
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.route('https://fonts.googleapis.com/**', lambda route: route.abort())
            state = {'view': 'scoring', 'currentLeague': fixture['league'], 'currentMatchId': fixture['ids']['hanging'], 'season': '2026'}
            page.add_init_script("localStorage.setItem('userRole','fan');localStorage.setItem('dugout_app_state',JSON.stringify(" + json.dumps(state) + '));')
            page.goto(base, wait_until='domcontentloaded')
            expect(page.get_by_role('button', name='Inning 1', exact=True)).to_be_visible()
            page.add_style_tag(content=f'html{{font-size:{size}px!important;}}')
            tiles = page.get_by_role('img', name='Pitch 1, Score: None', exact=True)
            expect(tiles).to_have_count(6)
            expect(page.get_by_role('button', name='Pitch 1, Score: None', exact=True)).to_have_count(0)
            # Tapping a fan score must not open an editor or block scrolling.
            tiles.first.tap()
            expect(page.get_by_role('dialog')).to_have_count(0)
            assert page.evaluate("getComputedStyle(document.documentElement).fontSize") == f'{size}px'
            # There must be no unintended vertical scroll container between the
            # horizontally scrollable score table and the App main scroller.
            owners = page.locator('tbody tr').last.evaluate('''row => {
              const result=[];let el=row.closest('table').parentElement.parentElement;
              while(el && el!==document.body){
                const s=getComputedStyle(el);
                if(['auto','scroll','hidden'].includes(s.overflowY)) result.push(el.tagName);
                el=el.parentElement;
              }return result;
            }''')
            assert owners == ['MAIN', 'DIV'], owners  # App main and outer viewport boundary
            if engine == 'chromium':
                # Native touch pan beginning on a score tile, rather than a
                # scripted scrollTop change. Firefox desktop exposes no CDP touch API.
                scroller = page.locator('main').first
                scroller.evaluate('(el)=>{el.scrollTop=0;}')
                candidates = page.get_by_role('img', name='Pitch 1, Score: None', exact=True)
                start = next(b for b in (candidates.nth(i).bounding_box() for i in range(6))
                             if b and 300 < b['y'] < 680)
                x, y = start['x'] + start['width']/2, start['y'] + start['height']/2
                cdp = context.new_cdp_session(page)
                cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
                for step in range(1, 11):
                    cdp.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':x,'y':y-step*20}]})
                    page.wait_for_timeout(20)
                cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
                page.wait_for_timeout(300)
                assert scroller.evaluate('(el)=>el.scrollTop') > 0, 'Swipe over a fan tile must scroll the page'
                cdp.detach()
            page.mouse.move(270, 650)
            page.mouse.wheel(0, 4000)
            page.wait_for_timeout(500)
            row = page.locator('tbody tr').last
            box = row.bounding_box()
            assert box and 0 <= box['y'] and box['y'] + box['height'] <= 780, box
            # Horizontal pitch access must remain possible at every text size.
            horizontal = row.locator('xpath=ancestor::table/parent::div')
            horizontal.evaluate('(el)=>{el.scrollLeft=el.scrollWidth;}')
            assert horizontal.evaluate('(el)=>el.scrollLeft > 0')
            assert row.get_by_role('img', name='Pitch 10, Score: None', exact=True).is_visible()
            page.get_by_role('button', name='Inning 2', exact=True).click()
            assert 'border-blue-600' in page.get_by_role('button', name='Inning 2', exact=True).get_attribute('class')
            expect(page.get_by_role('dialog')).to_have_count(0)
            assert not errors, errors
            page.screenshot(path=f'work/browser/fan-{engine}-{size}.png')
            print(f'PASS: {engine}, {size}px text: six hitters, read-only taps, vertical scrolling, pitch 10, inning navigation', flush=True)
            context.close()
        browser.close()
