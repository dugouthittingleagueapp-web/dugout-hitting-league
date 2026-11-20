import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {requestScheduleResolution} from '../../services/storageService';
const payload={action:'resolve_schedule',requestId:'fixed-review-request',changes:[]};
beforeEach(()=>{vi.stubGlobal('fetch',vi.fn());});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it.each(['{}','null','not JSON'])('does not acknowledge an invalid save response %s',async body=>{
 vi.mocked(fetch).mockResolvedValue(new Response(body));await expect(requestScheduleResolution('2027',payload)).rejects.toThrow();
});
it('preserves a server conflict workspace and status for continued editing',async()=>{
 const resolution={games:[],teams:[],leagues:[],rootIds:[]};vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({error:'Another administrator changed a game',resolution}),{status:409}));
 await expect(requestScheduleResolution('2027',payload)).rejects.toMatchObject({message:'Another administrator changed a game',resolution,status:409});
});
it('bounds a hanging save and retries exactly the same request identifier',async()=>{
 vi.useFakeTimers();vi.mocked(fetch).mockImplementationOnce(()=>new Promise(()=>{})).mockResolvedValueOnce(new Response('{"saved":true}'));
 const first=expect(requestScheduleResolution('2027',payload)).rejects.toThrow('time');await vi.advanceTimersByTimeAsync(15000);await first;
 expect(await requestScheduleResolution('2027',payload)).toMatchObject({saved:true});
 const bodies=vi.mocked(fetch).mock.calls.map(([,init])=>JSON.parse(init!.body as string));expect(bodies[0]).toEqual(bodies[1]);
});
it('does not render an incomplete season workspace as a successful refresh',async()=>{
 vi.mocked(fetch).mockResolvedValue(new Response('{"games":[]}'));await expect(requestScheduleResolution('2027',{action:'preview_resolution'})).rejects.toThrow('full schedule');
});
