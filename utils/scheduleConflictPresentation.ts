import type {ScheduleConflict} from './scheduleConflicts';
import {scheduleTimeMinutes} from './scheduleValidation';
export const displayScheduleTime=(minutes:number)=>`${Math.floor(minutes/60)%12||12}:${String(minutes%60).padStart(2,'0')} ${minutes<720?'AM':'PM'}`;
export const displayBookingTime=(value:string)=>{const minutes=scheduleTimeMinutes(value);return minutes===null?'Time needed':displayScheduleTime(minutes);};
export const displayScheduleDate=(value:string)=>{
 const date=new Date(value.slice(0,10)+'T12:00:00Z');
 return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(date):'Date needed';
};
export const conflictPairCount=(conflicts:ScheduleConflict[])=>new Set(conflicts.map(c=>JSON.stringify([c.firstId,c.secondId].sort()))).size;
export interface ConflictWarning {title:string;detail:string;otherIds:Set<string>}
/** Combine identical reasons without losing the identities of the other games. */
export const conflictWarnings=(conflicts:ScheduleConflict[],teamName:(id:string)=>string)=>{
 const result=new Map<string,Map<string,ConflictWarning>>();
 for(const conflict of conflicts){
  const title=conflict.kind==='cage'?`${conflict.cage?.replace('The Dugout: ','')} is booked twice`:`${teamName(conflict.teamId!)} is playing in two games at once`;
  const detail=`${displayScheduleDate(conflict.date)} · ${displayScheduleTime(conflict.start)}–${displayScheduleTime(conflict.end)}`;
  const key=JSON.stringify([title,detail]);
  for(const [id,otherId] of [[conflict.firstId,conflict.secondId],[conflict.secondId,conflict.firstId]]){
   const warnings=result.get(id)||new Map<string,ConflictWarning>();result.set(id,warnings);
   const warning=warnings.get(key)||{title,detail,otherIds:new Set<string>()};warning.otherIds.add(otherId);warnings.set(key,warning);
  }
 }
 return new Map([...result].map(([id,warnings])=>[id,[...warnings.values()]]));
};
