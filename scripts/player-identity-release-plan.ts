/** Generate reviewable SQL only. This script never connects to a database. */
import {readFileSync, writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import type {Team} from '../types';
import type {PlayerIdentityLink} from '../utils/playerIdentity';
export interface IdentityReleasePlan {
  teams: Team[];
  people: {id:string;name:string;lastName:string}[];
  links: PlayerIdentityLink[];
}
const literal = (value: unknown) => "'" + JSON.stringify(value).replace(/'/g,"''") + "'::jsonb";
export function identityReleaseSql(plan: IdentityReleasePlan, ddl: string): string {
  const rosterIds = new Set(plan.teams.flatMap(t=>[...(t.players||[]),...(t.subs||[])].map(p=>p.id)));
  const people = new Set(plan.people.map(p=>p.id));
  const links = new Set(plan.links.map(l=>l.rosterPlayerId));
  if (new Set(plan.teams.map(t=>t.id)).size!==plan.teams.length || people.size!==plan.people.length || links.size!==plan.links.length ||
      links.size!==rosterIds.size || plan.links.some(l=>!rosterIds.has(l.rosterPlayerId)||!people.has(l.personId)||!['existing','confirmed','new','unreviewed'].includes(l.resolution)) ||
      plan.people.some(p=>!plan.links.some(l=>l.personId===p.id))) throw new Error('Identity plan must cover every roster ID exactly once with valid people.');
  const teams=plan.teams.map(t=>({id:t.id,name:t.name,league:t.league,season:t.season,players:t.players||[],subs:t.subs||[]})).sort((a,b)=>a.id.localeCompare(b.id));
  return `-- GENERATED REVIEW ARTIFACT. Approval is required before Production execution.\nBEGIN;\nLOCK TABLE teams IN SHARE ROW EXCLUSIVE MODE;\nDO $guard$ BEGIN\nIF (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name,'league',league,'season',season,'players',COALESCE(players,'[]'::jsonb),'subs',COALESCE(subs,'[]'::jsonb)) ORDER BY id),'[]'::jsonb) FROM teams) IS DISTINCT FROM ${literal(teams)} THEN\nRAISE EXCEPTION 'Roster snapshot changed. Regenerate and review the identity plan before proceeding.';\nEND IF; END $guard$;\n${ddl}\nCREATE TEMP TABLE reviewed_people ON COMMIT DROP AS SELECT * FROM jsonb_to_recordset(${literal(plan.people)}) AS x(id uuid,name text,"lastName" text);\nCREATE TEMP TABLE reviewed_links ON COMMIT DROP AS SELECT * FROM jsonb_to_recordset(${literal(plan.links)}) AS x("rosterPlayerId" text,"personId" uuid,resolution text);\nDO $guard$ BEGIN\nIF EXISTS(SELECT 1 FROM league_players p JOIN reviewed_people r USING(id) WHERE p.name IS DISTINCT FROM r.name OR p.last_name IS DISTINCT FROM r."lastName") OR\nEXISTS(SELECT 1 FROM player_identity_links l JOIN reviewed_links r ON r."rosterPlayerId"=l.roster_player_id WHERE l.player_id<>r."personId" OR l.resolution<>r.resolution) THEN\nRAISE EXCEPTION 'Existing identity differs from reviewed plan. No identities changed.';\nEND IF; END $guard$;\nINSERT INTO league_players(id,name,last_name) SELECT id,name,"lastName" FROM reviewed_people ON CONFLICT(id) DO NOTHING;\nINSERT INTO player_identity_links(roster_player_id,player_id,resolution) SELECT "rosterPlayerId","personId",resolution FROM reviewed_links ON CONFLICT(roster_player_id) DO NOTHING;\nCOMMIT;\n`;
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [input,output]=process.argv.slice(2);
  if (!input||!output) throw new Error('Usage: tsx scripts/player-identity-release-plan.ts reviewed-plan.json output.sql');
  writeFileSync(output,identityReleaseSql(JSON.parse(readFileSync(input,'utf8')),readFileSync(new URL('../migrations/player-identities.sql',import.meta.url),'utf8')),{flag:'wx'});
  console.log('Review SQL generated. No database connection or write was performed.');
}
