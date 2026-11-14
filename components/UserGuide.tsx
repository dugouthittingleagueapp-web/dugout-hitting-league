
import React, { useEffect } from 'react';

interface UserGuideProps {
  onClose: () => void;
}

export const UserGuide: React.FC<UserGuideProps> = ({ onClose }) => {
  const handlePrint = () => {
    window.print();
  };

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div className="fixed inset-0 z-[3000] flex items-start justify-center bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200 overflow-hidden print:bg-white print:fixed print:inset-0 print:z-[10000] print:block print:overflow-visible">
      {/* Modal Container */}
      <div className="bg-white dark:bg-slate-950 w-full max-w-4xl h-[100dvh] sm:h-[calc(100dvh-2rem)] sm:my-4 sm:rounded-2xl shadow-2xl flex flex-col relative overflow-hidden print:shadow-none print:w-full print:max-w-none print:h-auto print:my-0 print:rounded-none print:text-black print:bg-white print:overflow-visible">
        
        {/* Header (Hidden on print) */}
        <div className="shrink-0 p-6 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-white dark:bg-slate-950 z-10 rounded-t-2xl print:hidden">
          <h2 className="text-2xl font-black uppercase italic text-slate-900 dark:text-white font-sans">Operational Guide</h2>
          <div className="flex gap-3">
             <button onClick={handlePrint} className="px-4 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors shadow-lg shadow-blue-900/20 font-sans flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
                Print / Save PDF
             </button>
             <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
             </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-8 sm:p-12 text-slate-800 dark:text-slate-300 font-sans space-y-8 print:p-0 print:text-black print:space-y-4 print:overflow-visible print:h-auto">
            
            {/* Title for Print */}
            <div className="hidden print:block mb-8 border-b-2 border-black pb-4">
                <h1 className="text-3xl font-black uppercase italic">Dugout Hitting League</h1>
                <p className="text-lg font-bold">Operational Guide</p>
            </div>


            <section className="print:break-inside-avoid">
                <h3 className="text-xl font-black text-blue-600 dark:text-blue-400 uppercase mb-3 print:text-black print:text-lg print:border-b print:border-black">1. Getting Started & Roles</h3>
                <p className="mb-2">Choose a league to see its schedule, scores, and standings. Three access levels are available:</p>
                <ul className="list-disc pl-5 space-y-1 text-sm sm:text-base">
                    <li><strong>Fan:</strong> No login required. Follow live games, browse previous innings, and view completed results, standings, and player statistics. Fan Mode cannot change scores.</li>
                    <li><strong>Umpire:</strong> Log in to start and score games, correct pitches during scoring, and register substitutes. Permanent roster and season administration remain admin-only.</li>
                    <li><strong>Admin:</strong> Log in for umpire capabilities plus league, season, roster, schedule, password, and permitted completed-game corrections.</li>
                </ul>
                <p className="text-xs italic text-slate-500 mt-2 print:text-black">For shared devices, use Log Out when finished. The app checks for inactivity and server sessions are protected.</p>
            </section>

            <section className="print:break-inside-avoid">
                <h3 className="text-xl font-black text-blue-600 dark:text-blue-400 uppercase mb-3 print:text-black print:text-lg print:border-b print:border-black">2. Admin Dashboard & Seasons</h3>
                <ul className="list-disc pl-5 space-y-1 text-sm sm:text-base">
                    <li><strong>Open Admin Dashboard:</strong> Log in as Admin and choose Admin Dashboard from the navigation.</li>
                    <li><strong>League Year Selector:</strong> Click anywhere on the season dropdown, including its arrow, to switch the year you are managing. The starred year is the active season.</li>
                    <li><strong>Browse a year:</strong> Choose Browse [year] in App to inspect that year's games. Browsing an archive does not activate it.</li>
                    <li><strong>Activate a season:</strong> Use Set as Live Active Season or Activate New Season only when you intend to change the season shown to everyone. The app asks for confirmation.</li>
                    <li><strong>Manage divisions and rosters:</strong> Create divisions for the selected season, import rosters or schedules, and manage teams. Previous seasons remain available in the archive.</li>
                    <li><strong>Guide and Exit Admin:</strong> Guide opens these instructions. Close Guide to return here; Exit Admin returns to league selection without logging you out.</li>
                </ul>
            </section>

            <section className="print:break-inside-avoid">
                <h3 className="text-xl font-black text-blue-600 dark:text-blue-400 uppercase mb-3 print:text-black print:text-lg print:border-b print:border-black">3. Starting & Resuming a Game</h3>
                <ol className="list-decimal pl-5 space-y-1 text-sm sm:text-base">
                    <li>Log in as Umpire or Admin and choose the correct league and season.</li>
                    <li>Open a scheduled game, or choose Home and Away teams and select <strong>Next: Set Lineup</strong> to create a game.</li>
                    <li>Check every player's name and batting order. Reorder the lineup or register a substitute if necessary. Resolve any missing or unknown names before scoring.</li>
                    <li>Choose <strong>Start Match</strong>. The app checks which device has scoring control before allowing pitches.</li>
                    <li>To continue later, use <strong>Save &amp; Exit</strong>. Return to the schedule or the active-match banner and resume the same game rather than creating a duplicate.</li>
                </ol>
            </section>

            <section className="print:break-inside-avoid">
                <h3 className="text-xl font-black text-blue-600 dark:text-blue-400 uppercase mb-3 print:text-black print:text-lg print:border-b print:border-black">4. Scoring Pitches & Making Corrections</h3>
                <ul className="list-disc pl-5 space-y-1 text-sm sm:text-base">
                    <li><strong>Score:</strong> Tap a pitch box and select its result from 0 through 4. A zero is a recorded pitch, not an empty box.</li>
                    <li><strong>Correct:</strong> Tap a recorded pitch to change it, or use the scoring panel's undo control where available.</li>
                    <li><strong>Innings:</strong> The scoreboard advances to the live inning as scoring progresses. You can review prior innings without changing their results.</li>
                    <li><strong>Save indicator:</strong> Look for the saved, saving, or offline message. If a score needs attention, stop and ask an admin to review it rather than entering the pitch a second time.</li>
                    <li><strong>Scheduled lineups:</strong> Lineups can be adjusted before any pitches are recorded. Once scoring begins, scoring access and newer-score checks protect the game.</li>
                </ul>
            </section>

            <section className="print:break-inside-avoid">
                <h3 className="text-xl font-black text-blue-600 dark:text-blue-400 uppercase mb-3 print:text-black print:text-lg print:border-b print:border-black">5. Offline Scoring & Recovery</h3>
                <ol className="list-decimal pl-5 space-y-1 text-sm sm:text-base">
                    <li>If Wi-Fi drops during a game, continue scoring on the <strong>same device and browser</strong>. Unsynced changes are kept on that device for retry.</li>
                    <li>Keep the browser's saved data intact. Do not clear website storage, switch devices, or create another game to replace the one in progress.</li>
                    <li>When the connection returns, the app attempts to sync the queued changes. Confirm that it shows <strong>All scores saved</strong> before treating the server copy as up to date.</li>
                    <li>If the app says scores need review or another device has newer scores, <strong>do not re-enter pitches</strong>. Keep the device and contact an admin to resolve the conflict.</li>
                </ol>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 print:text-black">A final game result must be confirmed by the server. If finalization fails offline, reconnect and try again rather than assuming the game finished.</p>
            </section>

            <section className="print:break-inside-avoid">
                <h3 className="text-xl font-black text-blue-600 dark:text-blue-400 uppercase mb-3 print:text-black print:text-lg print:border-b print:border-black">6. Scoring Control & Fan Mode</h3>
                <ul className="list-disc pl-5 space-y-1 text-sm sm:text-base">
                    <li><strong>One scoring device:</strong> Only the device holding the game's scoring control should submit scores. This prevents two umpires from overwriting one another.</li>
                    <li><strong>Game already being scored:</strong> Ask an admin before changing devices. Only an admin can take over scoring control. Never guess or re-enter scores from the other device.</li>
                    <li><strong>Fan Mode:</strong> Fans can watch a game in a separate browser or on another device. Live results refresh automatically; spectators cannot edit pitches.</li>
                    <li><strong>Finished games:</strong> Umpires can view the final result read-only. Corrections to finalized games are reserved for admins.</li>
                </ul>
            </section>

            <section className="print:break-inside-avoid">
                <h3 className="text-xl font-black text-blue-600 dark:text-blue-400 uppercase mb-3 print:text-black print:text-lg print:border-b print:border-black">7. Short-Handed Teams & Ghost Hitter</h3>
                <ul className="list-disc pl-5 space-y-1 text-sm sm:text-base">
                    <li><strong>2 vs. 2:</strong> Each player gets 10 pitches, for 20 team pitches per inning.</li>
                    <li><strong>3 vs. 2:</strong> The two-player team receives 15 pitches per player to match the three-player team's 30 pitches.</li>
                    <li><strong>Ghost hitter:</strong> Pitches 11–15 for each player on the short-handed team count toward the team total, not that player's individual statistics.</li>
                </ul>
            </section>

            <section className="print:break-inside-avoid">
                <h3 className="text-xl font-black text-blue-600 dark:text-blue-400 uppercase mb-3 print:text-black print:text-lg print:border-b print:border-black">8. Ties & Extra Innings</h3>
                <ol className="list-decimal pl-5 space-y-1 text-sm sm:text-base">
                    <li>If the game is tied when you try to finish, choose a player from each team for the tie-breaker.</li>
                    <li>Round one gives each selected player <strong>5 pitches</strong>; round two gives <strong>3 pitches</strong>; later rounds give <strong>1 pitch</strong> each until the tie is resolved.</li>
                    <li>The extra-inning points count toward the game result and appropriate player statistics.</li>
                    <li>From the Exit menu, you may also confirm <strong>Finalize as Tie</strong> when a tied result is intentional.</li>
                </ol>
            </section>

            <section className="print:break-inside-avoid">
                <h3 className="text-xl font-black text-blue-600 dark:text-blue-400 uppercase mb-3 print:text-black print:text-lg print:border-b print:border-black">9. Finishing, Exiting & Practice Games</h3>
                <ul className="list-disc pl-5 space-y-1 text-sm sm:text-base">
                    <li><strong>Save &amp; Exit:</strong> Keeps the game active so it can be resumed later. It does not mark the game final.</li>
                    <li><strong>Exit &amp; Finalize / Confirm &amp; Finalize:</strong> Marks the game complete once the server confirms the save. Verify the final score before confirming.</li>
                    <li><strong>Practice Mode:</strong> Start Practice Match from the dashboard. Practice results stay separate from official standings and leaderboards.</li>
                    <li><strong>Reset practice:</strong> Use Reset Practice Match to clear test pitches while keeping the lineup and rosters. Practice games may be deleted from scoring. Separately, an admin may remove an official scheduled game only before scoring starts, using Admin Dashboard → Manage Individual Games.</li>
                    <li><strong>Official vs. practice:</strong> A game's type is chosen when created and cannot be changed afterward.</li>
                </ul>
            </section>

            <section className="print:break-inside-avoid">
                <h3 className="text-xl font-black text-blue-600 dark:text-blue-400 uppercase mb-3 print:text-black print:text-lg print:border-b print:border-black">10. Other Admin Tools</h3>
                <ul className="list-disc pl-5 space-y-1 text-sm sm:text-base">
                    <li><strong>Move a match:</strong> Use the dashboard's Move option to correct its league assignment.</li>
                    <li><strong>Bulk Move Teams:</strong> Select teams and a destination division in the Admin Dashboard.</li>
                    <li><strong>Schedule importer:</strong> Choose the destination season and division, then upload or drag in a CSV. Review the destination shown above the preview. Invalid rows block the entire import; a failed upload never leaves a partially created schedule. Existing duplicate matchups are skipped safely.</li>
                    <li><strong>Individual schedule corrections:</strong> Choose Manage Individual Games on the Admin Dashboard. Select the division, remove only the incorrect unstarted scheduled game, then create its replacement using two existing teams and the corrected date/time. Started, scored, finalized, and locked games cannot be deleted this way.\n                    <li><strong>Passwords:</strong> Admins can change the Admin and Umpire passwords under Access Control Passwords.</li>
                    <li><strong>Backup:</strong> Export JSON Database downloads league data for safekeeping. It is not the same as restoring the live Neon database.</li>
                    <li><strong>Historical seasons:</strong> Use the season selector to manage archived years without mixing old games into the current standings.</li>
                </ul>
            </section>

             <div className="pt-8 text-center print:hidden">
                 <button onClick={onClose} className="px-6 py-3 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-300 dark:hover:bg-slate-700 font-sans">Close Guide</button>
             </div>
        </div>
      </div>
    </div>
  );
};
