import {describe,it,expect} from 'vitest';
import {careerRosterIds,possibleSameName,planPlayerIdentities} from '../../utils/playerIdentity';
import type {Team} from '../../types';
const team=(id:string,season:string,pid:string,name:string,lastName=''):Team=>({id,name:id,league:'QC',season,players:[{id:pid,name,lastName}],subs:[]});
describe('Permanent player identities',()=>{
 it('uses explicit identity links despite changed names and team memberships',()=>{
  expect([...careerRosterIds('new-season',[{rosterPlayerId:'old-season',personId:'person',resolution:'existing'},{rosterPlayerId:'new-season',personId:'person',resolution:'confirmed'},{rosterPlayerId:'same-name-other',personId:'other',resolution:'new'}])].sort()).toEqual(['new-season','old-season']);
 });
 it('keeps an unmapped roster ID separate rather than guessing from names',()=>{expect([...careerRosterIds('unknown',[])]).toEqual(['unknown']);});
 it('matches names only as suggestions, including initials and case',()=>{
  expect(possibleSameName({name:'Cody',lastName:'M.'},{name:'CODY',lastName:'Matthews'})).toBe(true);
  expect(possibleSameName({name:'Alex',lastName:'Jones'},{name:'Alex',lastName:'Smith'})).toBe(false);
  expect(possibleSameName({name:'Mike',lastName:'Smith'},{name:'Michael',lastName:'Smith'})).toBe(true);
  expect(possibleSameName({name:'Mike',lastName:'Smith'},{name:'Michael',lastName:'Jones'})).toBe(false);
 });
 it('preserves clear previous-season name matches in the initial plan',()=>{
  const plan=planPlayerIdentities([team('a','2025','old','Cody','M.'),team('b','2026','new','Cody','Matthews')],()=>crypto.randomUUID());
  expect(plan.people).toHaveLength(1);expect(new Set(plan.links.map(l=>l.personId)).size).toBe(1);expect(plan.links.every(l=>l.resolution==='existing')).toBe(true);
 });
 it('never combines same-name players within the same season',()=>{
  const plan=planPlayerIdentities([team('a','2026','one','Alex','Jones'),team('b','2026','two','Alex','Jones')],()=>crypto.randomUUID());
  expect(plan.people).toHaveLength(2);expect(plan.links.every(l=>l.resolution==='unreviewed')).toBe(true);
 });
 it.each([false,true])('does not let a first-name-only record bridge two people, reversed=%s',reversed=>{
  const teams=[team('a','2025','unknown','Alex'),team('b','2026','jones','Alex','Jones'),team('c','2027','smith','Alex','Smith')];
  const plan=planPlayerIdentities(reversed?teams.reverse():teams,()=>crypto.randomUUID());
  expect(new Set(plan.links.map(l=>l.personId)).size).toBe(3);
 });
});
