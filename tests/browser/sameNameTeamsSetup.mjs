import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const url=new URL(process.env.DUGOUT_BROWSER_DATABASE_URL||'');
if(url.hostname!=='127.0.0.1'||url.pathname!=='/dugout_test_admin_browser')throw Error('Use only the disposable localhost admin database.');
const db=new pg.Client({connectionString:url.toString(),ssl:false});await db.connect();
const lastName='History'+randomUUID().slice(0,6),people=[];
for(const league of ['9U','11U']){
 const person=randomUUID(),member=randomUUID(),team=randomUUID();
 await db.query("INSERT INTO league_players(id,name,last_name) VALUES($1,'Alex',$2)",[person,lastName]);
 await db.query("INSERT INTO player_identity_links(roster_player_id,player_id,resolution) VALUES($1,$2,'existing')",[member,person]);
 await db.query("INSERT INTO teams(id,name,league,season,players,subs) VALUES($1,'Eagles',$2,'2026',$3,'[]')",[team,league,JSON.stringify([{id:member,name:'Alex',lastName}])]);
 people.push({person,member,team,league});
}
writeFileSync('work/browser/same-name-fixture.json',JSON.stringify({lastName,people}));await db.end();
