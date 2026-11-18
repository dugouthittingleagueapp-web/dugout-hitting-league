import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {writeFileSync,mkdirSync} from 'node:fs';
const url=new URL(process.env.DUGOUT_BROWSER_DATABASE_URL||'');
if(url.hostname!=='127.0.0.1'||url.pathname!=='/dugout_test_admin_browser')throw Error('Roster fixtures require the disposable local admin test database');
const c=new pg.Client({connectionString:url.toString(),ssl:false});await c.connect();
const league='Roster QC '+randomUUID(), otherLeague='Other Roster QC '+randomUUID();
for(const id of [league,otherLeague])await c.query('INSERT INTO leagues(id,season) VALUES($1,$2)',[id,'2027']);
const home={id:randomUUID(),name:'Roster Home Test',players:['Cody','Dane'].map(name=>({id:randomUUID(),name,lastName:'Test'})),subs:[{id:randomUUID(),name:'Sub Test',lastName:''}]};
const away={id:randomUUID(),name:'Roster Away Test',players:['Delta','Echo','Foxtrot'].map(name=>({id:randomUUID(),name,lastName:'Test'})),subs:[]};
const other={id:randomUUID(),name:'Other League Test',players:away.players.map(p=>({...p,id:randomUUID()})),subs:[]};
for(const [team,l] of [[home,league],[away,league],[other,otherLeague]])await c.query('INSERT INTO teams(id,name,league,season,players,subs) VALUES($1,$2,$3,$4,$5,$6)',[team.id,team.name,l,'2027',JSON.stringify(team.players),JSON.stringify(team.subs)]);
const ids={};
for(const complete of [false,true]){
 const id=randomUUID();ids[complete?'final':'scheduled']=id;
 const innings=Array.from({length:6},(_,i)=>({number:i+1,...Object.fromEntries([['home',home],['away',away]].map(([side,t])=>[side,{teamId:t.id,playerScores:t.players.map(p=>({playerId:p.id,pitches:Array.from({length:10},()=>({points:complete?1:null}))}))}]))}));
 await c.query('INSERT INTO matches(id,league,season,home_team_id,away_team_id,date,status,is_complete,innings,location) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,league,'2027',home.id,away.id,'2027-12-01T18:00:00Z',complete?'FINAL':'SCHEDULED',complete,JSON.stringify(innings),'The Dugout: Tunnels 5/6']);
}
mkdirSync('work/browser',{recursive:true});writeFileSync('work/browser/roster-fixture.json',JSON.stringify({league,otherLeague,home,away,other,ids}));await c.end();
