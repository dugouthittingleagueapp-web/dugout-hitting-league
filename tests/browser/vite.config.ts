import pg from 'pg';
import pool from '../../api/db';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import settings from '../../api/settings';
import leagues from '../../api/leagues';
import teams from '../../api/teams';
import matches from '../../api/matches';
import schedule from '../../api/schedule-admin';
import delta from '../../api/matches-delta';
import scoringLock from '../../api/scoring-lock';
import scoring from '../../api/scoring';
import { signSessionToken } from '../../api/auth';

const localUrl = process.env.DUGOUT_BROWSER_DATABASE_URL || '';
const local = new URL(localUrl);
if (local.hostname !== '127.0.0.1' || !['/dugout_test_browser', '/dugout_test_admin_browser', '/dugout_test_phase2_browser', '/dugout_test_fan_scroll_browser'].includes(local.pathname)) throw new Error('Browser test server must use the disposable local database.');
// Rebind only this test process to the explicitly chosen local pool. The
// deployed TLS/database selector is never weakened for browser tests.
const testPool = new pg.Pool({connectionString:localUrl,ssl:false});
pool.query = testPool.query.bind(testPool);
pool.connect = testPool.connect.bind(testPool);
process.env.SESSION_SECRET = 'local-only-browser-test-session-secret-not-production';
const handlers: Record<string, any> = { '/api/settings': settings, '/api/leagues': leagues, '/api/teams': teams, '/api/matches': matches, '/api/scoring': scoring, '/api/schedule-admin': schedule, '/api/matches-delta': delta, '/api/scoring-lock': scoringLock };
export default defineConfig({plugins:[react(),{
 name:'local-only-api',
 transformIndexHtml(html) {
  return html.replace('<script src="https://cdn.tailwindcss.com"></script>', '<link rel="stylesheet" href="/work/schedule-browser.css">').replace(/<script>\s*tailwind.config[\s\S]*?<\/script>/, '');
 },
 configureServer(server) {
  server.middlewares.use(async (req,res,next)=>{
   const url = new URL(req.url || '/', 'http://localhost');
   if (url.pathname === '/test-session') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({token:signSessionToken(url.searchParams.get('role') === 'umpire' ? 'umpire' : 'admin')})); return; }
   const handler=handlers[url.pathname]; if(!handler) return next();
   try {
    let raw=''; for await(const chunk of req) raw+=chunk;
    Object.assign(req,{body:raw ? JSON.parse(raw):{}, query:Object.fromEntries(url.searchParams)});
    const response:any=res;
    response.status=(code:number)=>{res.statusCode=code;return response;};
    response.json=(data:unknown)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return response;};
    await handler(req,response);
   } catch(error) { console.error(error);res.statusCode=500;res.end(JSON.stringify({error:'Local test API failed'})); }
  });
 }
}],server:{host:'127.0.0.1',port:Number(process.env.DUGOUT_BROWSER_PORT || 3700),strictPort:true}});
