import {canonicalCage,scheduleDateKey,scheduleTimeMinutes} from './scheduleValidation.js';
export type CalendarGame = {id?: string;date:string;startTime?:string;endTime?:string;location?:string;homeTeamId:string;awayTeamId:string};
/** A CSV revision is not permission to replace an existing matchup. */
export const scheduleConflict = (candidate: CalendarGame, existing: CalendarGame[]): string | null => {
 const date=scheduleDateKey(candidate.date),start=scheduleTimeMinutes(candidate.startTime || ''),end=scheduleTimeMinutes(candidate.endTime || '');
 if(!date || start===null || end===null)return null;
 for(const game of existing){
  if(candidate.id && game.id===candidate.id || scheduleDateKey(game.date)!==date)continue;
  const otherStart=scheduleTimeMinutes(game.startTime || ''),otherEnd=scheduleTimeMinutes(game.endTime || '');
  if(otherStart===null || otherEnd===null || start>=otherEnd || otherStart>=end)continue;
  const cage=canonicalCage(candidate.location),otherCage=canonicalCage(game.location);
  if(cage && cage===otherCage)return `${date} ${candidate.startTime}: this cage already has a game. To change its teams, use Schedule → Edit instead of importing a replacement row.`;
  if([candidate.homeTeamId,candidate.awayTeamId].some(id=>id===game.homeTeamId || id===game.awayTeamId))return `${date} ${candidate.startTime}: one of these teams already has an overlapping game.`;
 }
 return null;
};
