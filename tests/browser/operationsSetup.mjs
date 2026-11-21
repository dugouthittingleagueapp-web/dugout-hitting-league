import pg from 'pg';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const connectionString=process.env.DUGOUT_BROWSER_DATABASE_URL || '';
const u=new URL(connectionString);
if(u.hostname!=='127.0.0.1'||u.pathname!=='/dugout_test_operations_browser')throw Error('Use the disposable operations browser database only.');
const db=new pg.Client({connectionString,ssl:false});await db.connect();
await db.query(readFileSync(new URL('../../schema.sql',import.meta.url),'utf8'));
await db.query(readFileSync(new URL('../../migrations/diagnostic-events.sql',import.meta.url),'utf8'));
await db.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS is_forfeit BOOLEAN DEFAULT FALSE,ADD COLUMN IF NOT EXISTS forfeiting_team_id TEXT,
 ADD COLUMN IF NOT EXISTS forfeit_reason TEXT,ADD COLUMN IF NOT EXISTS winning_team_id TEXT;
 CREATE TABLE IF NOT EXISTS scoring_locks(match_id TEXT PRIMARY KEY,token_hash TEXT NOT NULL,updated_at TIMESTAMPTZ DEFAULT NOW());`);
await db.query('TRUNCATE matches,teams,leagues,app_settings,scoring_locks,diagnostic_events,player_identity_links,league_players');
await db.query("INSERT INTO app_settings VALUES ('current_season','2027');INSERT INTO leagues(id,season) VALUES ('Operations QC','2027');");
if(process.env.DUGOUT_OPERATIONS_EMPTY!=='1'){
const teams=Array.from({length:4},(_,n)=>({id:`operations-team-${n}`,name:['Operations Eagles','Operations Panthers','Operations Wolves','Operations Raptors'][n],league:'Operations QC',season:'2027',players:Array.from({length:3},(_,i)=>({id:`operations-player-${n}-${i}`,name:`Synthetic ${n+1}.${i+1}`})),subs:[]}));
for(const t of teams)await db.query('INSERT INTO teams(id,name,league,season,players,subs) VALUES($1,$2,$3,$4,$5,$6)',[t.id,t.name,t.league,t.season,JSON.stringify(t.players),'[]']);
const innings=(h,a,empty=false)=>Array.from({length:6},(_,i)=>({number:i+1,home:{teamId:'home',playerScores:empty?[]:teams[h].players.map(p=>({playerId:p.id,pitches:Array.from({length:10},()=>({points:null}))}))},away:{teamId:'away',playerScores:empty?[]:teams[a].players.map(p=>({playerId:p.id,pitches:Array.from({length:10},()=>({points:null}))}))}}));
for(const [id,h,a,start,end,cage,empty] of [['operations-ready',0,1,'18:00','19:00','The Dugout: Tunnels 5/6',false],['operations-lineup',2,3,'18:00','19:00','The Dugout: Tunnels 7/8',true]])await db.query('INSERT INTO matches(id,league,season,home_team_id,away_team_id,date,start_time,end_time,location,innings) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,'Operations QC','2027',teams[h].id,teams[a].id,'2027-11-01T18:00:00Z',start,end,cage,JSON.stringify(innings(h,a,empty))]);
}
await db.end();mkdirSync('work/browser',{recursive:true});writeFileSync('work/browser/operations-fixture.json',JSON.stringify({season:'2027',date:'2027-11-01',gameId:'operations-ready',league:'Operations QC'}));
console.log('Isolated operations browser fixtures ready.');
