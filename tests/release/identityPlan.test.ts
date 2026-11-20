import {it,expect} from 'vitest';
import {identityReleaseSql,type IdentityReleasePlan} from '../../scripts/player-identity-release-plan';
const plan:IdentityReleasePlan={teams:[{id:'a',name:'Team',league:'QC',season:'2026',players:[{id:'roster',name:'One'}],subs:[]}],people:[{id:'00000000-0000-4000-8000-000000000001',name:'One',lastName:''}],links:[{rosterPlayerId:'roster',personId:'00000000-0000-4000-8000-000000000001',resolution:'existing'}]};
it('refuses incomplete or duplicated reviewed mappings before generating SQL',()=>{
 expect(()=>identityReleaseSql({...plan,links:[]},'')).toThrow('cover every roster ID');
 expect(()=>identityReleaseSql({...plan,links:[...plan.links,...plan.links]},'')).toThrow('cover every roster ID');
 expect(()=>identityReleaseSql({...plan,people:[]},'')).toThrow('cover every roster ID');
});
