import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
const url=new URL(process.env.DUGOUT_BROWSER_DATABASE_URL||'');
if(url.hostname!=='127.0.0.1'||url.pathname!=='/dugout_test_admin_browser')throw Error('Disposable localhost Admin fixtures only.');
const db=new pg.Client({connectionString:url.href,ssl:false});await db.connect();
const fixture=JSON.parse(readFileSync('work/browser/conflict-fixtures.json','utf8'));
if(process.argv[2]==='protected'){
 const id=randomUUID();
 await db.query(`INSERT INTO matches(id,league,season,home_team_id,away_team_id,date,start_time,end_time,location,status,is_complete,innings)
 SELECT $1,league,season,home_team_id,away_team_id,date,start_time,end_time,location,status,is_complete,innings FROM matches WHERE id=$2`,[id,fixture.ids.protected]);
 fixture.ids.protectedOverlap=id;writeFileSync('work/browser/conflict-fixtures.json',JSON.stringify(fixture));
}else await db.query("UPDATE matches SET start_time='18:30',end_time='19:30' WHERE id=$1",[fixture.ids.b]);
await db.end();console.log('Synthetic schedule alert fixtures updated locally only.');
