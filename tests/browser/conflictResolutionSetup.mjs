import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {writeFileSync,mkdirSync} from 'node:fs';
const url=new URL(process.env.DUGOUT_BROWSER_DATABASE_URL||'');
if(url.hostname!=='127.0.0.1'||url.pathname!=='/dugout_test_admin_browser')throw Error('Disposable localhost Admin database only');
const db=new pg.Client({connectionString:url.href,ssl:false});await db.connect();
const league='Conflict Test '+randomUUID(),otherLeague='Other Conflict League '+randomUUID();
for(const name of [league,otherLeague])await db.query('INSERT INTO leagues(id,season) VALUES($1,$2)',[name,'2027']);
const teams=[];
for(const name of ['Eagles','Panthers','Wolves','Raptors','Storm','Mavericks','Final Home','Final Away','Other Home','Other Away']){
 const team={id:randomUUID(),name,league:name.startsWith('Other ')?otherLeague:league,players:Array.from({length:3},(_,i)=>({id:randomUUID(),name:name+' Player '+(i+1)})),subs:[]};teams.push(team);
 await db.query("INSERT INTO teams(id,name,league,season,players,subs) VALUES($1,$2,$3,'2027',$4,'[]')",[team.id,name,team.league,JSON.stringify(team.players)]);
}
const ids={};
for(const [key,index,start,end,cage,date,final] of [['a',0,'18:10','19:00','5/6','2027-11-01',false],['b',2,'19:00','20:00','5/6','2027-11-01',false],['c',4,'20:00','21:00','5/6','2027-11-01',false],['protected',6,'18:00','19:00','7/8','2027-11-01',true],['other',8,'18:30','19:30','5/6','2027-11-02',false]]){
 const id=randomUUID();ids[key]=id;
 const innings=Array.from({length:6},(_,i)=>({number:i+1,home:{playerScores:teams[index].players.map(p=>({playerId:p.id,pitches:Array.from({length:10},()=>({points:final?0:null}))}))},away:{playerScores:teams[index+1].players.map(p=>({playerId:p.id,pitches:Array.from({length:10},()=>({points:final?0:null}))}))}}));
 await db.query("INSERT INTO matches(id,league,season,home_team_id,away_team_id,date,start_time,end_time,location,status,is_complete,innings) VALUES($1,$2,'2027',$3,$4,$5,$6,$7,$8,$9,$10,$11)",[id,teams[index].league,teams[index].id,teams[index+1].id,date+'T12:00:00Z',start,end,'The Dugout: Tunnels '+cage,final?'FINAL':'SCHEDULED',final,JSON.stringify(innings)]);
}
mkdirSync('work/browser',{recursive:true});writeFileSync('work/browser/conflict-fixtures.json',JSON.stringify({league,otherLeague,teams,ids}));await db.end();console.log('Synthetic conflict calendar prepared locally only.');
