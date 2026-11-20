import type {League,Team} from '../types';
import type {CalendarGame} from './scheduleConflicts';
import {canonicalCage,scheduleDateKey,scheduleDateTimeError} from './scheduleValidation.js';
export interface ResolutionGame extends CalendarGame {
  id:string; league:string; revision:number; kind:'existing'|'import'|'new';
  date:string; startTime:string; endTime:string; location:string;
  notes?:string; lockedReason?:string|null;
}
export interface ResolutionWorkspace { replacements?:Record<string,string>; teamReplacements?:Record<string,string>; importAlreadySaved?:boolean; games:ResolutionGame[]; teams:Team[]; leagues:League[]; rootIds:string[]; }
export const bookingFields=['date','startTime','endTime','location','homeTeamId','awayTeamId','notes'] as const;
export const changedBooking=(a:ResolutionGame,b:ResolutionGame)=>bookingFields.some(key=>(a[key]||'')!==(b[key]||'')) || a.league!==b.league;
export const resolutionGameError=(game:ResolutionGame,teams:Team[])=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(game.date)||!scheduleDateKey(game.date))return 'Enter a valid date.';
  const error=scheduleDateTimeError(game.date,game.startTime,game.endTime);if(error)return error;
  if(!canonicalCage(game.location))return 'Choose Tunnels 5/6 or Tunnels 7/8.';
  if(game.homeTeamId===game.awayTeamId)return 'Choose two different teams.';
  if([game.homeTeamId,game.awayTeamId].some(id=>!teams.some(t=>t.id===id&&t.league===game.league)))return 'Choose two teams from this league.';
  if(game.notes!==undefined&&(typeof game.notes!=='string'||game.notes.length>2000))return 'Notes must be at most 2,000 characters.';
  return null;
};
