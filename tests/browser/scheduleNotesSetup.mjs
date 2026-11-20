import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const url=new URL(process.env.DUGOUT_BROWSER_DATABASE_URL||'');
if(url.hostname!=='127.0.0.1'||url.pathname!=='/dugout_test_admin_browser')throw Error('Use the disposable localhost admin test database.');
const db=new pg.Client({connectionString:url.toString(),ssl:false});await db.connect();
const league='Notes Conflict QC '+randomUUID(),home=randomUUID(),away=randomUUID(),ids=[randomUUID(),randomUUID()];
await db.query('INSERT INTO leagues(id,season) VALUES($1,$2)',[league,'2027']);
for(const [id,name] of [[home,'Notes Home'],[away,'Notes Away']])await db.query("INSERT INTO teams(id,name,league,season,players,subs) VALUES($1,$2,$3,'2027','[]','[]')",[id,name,league]);
for(const id of ids)await db.query(`INSERT INTO matches(id,league,season,home_team_id,away_team_id,date,start_time,end_time,location,status,is_complete,innings,notes)
 VALUES($1,$2,'2027',$3,$4,'2027-12-30T18:00:00Z','6:00 pm','7:00 pm','The Dugout: Tunnels 5/6','SCHEDULED',false,'[]','Original notes')`,[id,league,home,away]);
writeFileSync('work/browser/notes-fixture.json',JSON.stringify({league,ids}));await db.end();
