import {canonicalCage,scheduleDateKey,scheduleTimeMinutes} from './scheduleValidation.js';
export type CalendarGame = {id?: string;date:string;startTime?:string;endTime?:string;location?:string;homeTeamId:string;awayTeamId:string};
export interface ScheduleConflict {
  firstId: string; secondId: string; kind: 'cage' | 'team';
  date: string; start: number; end: number; cage?: string; teamId?: string;
}
/** Every overlapping pair, across all leagues in the supplied season. Adjacent games are allowed. */
export const scheduleConflicts = (games: CalendarGame[], changedIds?: Set<string>): ScheduleConflict[] => {
  const conflicts: ScheduleConflict[]=[];
  const days=new Map<string,CalendarGame[]>();
  for(const game of games){const date=scheduleDateKey(game.date);if(date){const day=days.get(date)||[];day.push(game);days.set(date,day);}}
  for(const [date,day] of days)for(let i=0;i<day.length;i++)for(let j=i+1;j<day.length;j++){
    const a=day[i],b=day[j];
    if(a.id && a.id===b.id || changedIds && !changedIds.has(a.id||'') && !changedIds.has(b.id||''))continue;
    const as=scheduleTimeMinutes(a.startTime||''),ae=scheduleTimeMinutes(a.endTime||''),bs=scheduleTimeMinutes(b.startTime||''),be=scheduleTimeMinutes(b.endTime||'');
    if(as===null||ae===null||bs===null||be===null||ae<=as||be<=bs||as>=be||bs>=ae)continue;
    const base={firstId:a.id||'',secondId:b.id||'',date,start:Math.max(as,bs),end:Math.min(ae,be)};
    const cage=canonicalCage(a.location);
    if(cage&&cage===canonicalCage(b.location))conflicts.push({...base,kind:'cage',cage});
    for(const teamId of new Set([a.homeTeamId,a.awayTeamId]))if(teamId&&(teamId===b.homeTeamId||teamId===b.awayTeamId))conflicts.push({...base,kind:'team',teamId});
  }
  return conflicts;
};
const timeLabel=(minutes:number)=>`${(Math.floor(minutes/60)%12)||12}:${String(minutes%60).padStart(2,'0')} ${minutes<720?'AM':'PM'}`;
export const conflictDescription=(conflict:ScheduleConflict,teamName:(id:string)=>string=()=> 'This team'):string=>
  conflict.kind==='cage'
    ? `Both games are scheduled in ${conflict.cage?.replace('The Dugout: ','')} between ${timeLabel(conflict.start)} and ${timeLabel(conflict.end)} on ${conflict.date}.`
    : `${teamName(conflict.teamId!)} is scheduled in both games between ${timeLabel(conflict.start)} and ${timeLabel(conflict.end)} on ${conflict.date}.`;
/** Compatibility wrapper; every write path uses the same pair validator. */
export const scheduleConflict = (candidate: CalendarGame, existing: CalendarGame[]): string | null => {
  const id=candidate.id||'candidate';
  const conflicts=scheduleConflicts([...existing.filter(g=>g.id!==id),{...candidate,id}],new Set([id]));
  return conflicts.length?conflictDescription(conflicts[0]):null;
};
