import pg from 'pg';import{randomUUID}from'node:crypto';import{writeFileSync,readFileSync}from'node:fs';
const url=new URL(process.env.DUGOUT_BROWSER_DATABASE_URL || '');
if(url.hostname!=='127.0.0.1' || url.pathname!=='/dugout_test_admin_browser')throw Error('Identity fixtures require the isolated localhost admin test database.');
const c=new pg.Client({connectionString:url.toString(),ssl:false});await c.connect();
const f=JSON.parse(readFileSync('work/browser/roster-fixture.json','utf8'));f.people=[];f.lastName='Identity'+randomUUID().slice(0,6);
for(let i=0;i<2;i++){
 const person=randomUUID(),id=randomUUID(),team=randomUUID();
 await c.query("INSERT INTO league_players(id,name,last_name) VALUES($1,'Alex',$2)",[person,f.lastName]);
 await c.query("INSERT INTO player_identity_links(roster_player_id,player_id,resolution) VALUES($1,$2,'existing')",[id,person]);
 await c.query('INSERT INTO teams(id,name,league,season,players,subs) VALUES($1,$2,$3,$4,$5,$6)',[team,'Alex Previous Team '+(i+1),'Identity History','2026',JSON.stringify([{id,name:'Alex',lastName:f.lastName}]),'[]']);
 await c.query('INSERT INTO matches(id,league,season,home_team_id,away_team_id,date,is_complete,status,innings) VALUES($1,$2,$3,$4,$5,$6,true,$7,$8)',[randomUUID(),'Identity History','2026',team,'opponent','2026-11-01T18:00:00Z','FINAL',JSON.stringify([{number:1,home:{teamId:team,playerScores:[{playerId:id,pitches:[{points:i===0?4:2}]}]},away:{teamId:'opponent',playerScores:[]}}])]);
 f.people.push({person,id,team});
}
writeFileSync('work/browser/identity-fixture.json',JSON.stringify(f));await c.end();
