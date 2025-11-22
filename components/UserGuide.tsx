
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
    <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto print:bg-white print:fixed print:inset-0 print:z-[10000] print:block">
      {/* Modal Container */}
      <div className="bg-white dark:bg-slate-950 w-full max-w-4xl min-h-screen sm:min-h-fit sm:my-8 sm:rounded-2xl shadow-2xl flex flex-col relative print:shadow-none print:w-full print:max-w-none print:my-0 print:rounded-none print:text-black print:bg-white">
        
        {/* Header (Hidden on print) */}
        <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center sticky top-0 bg-white dark:bg-slate-950 z-10 rounded-t-2xl print:hidden">
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
        <div className="p-8 sm:p-12 text-slate-800 dark:text-slate-300 font-sans space-y-8 print:p-0 print:text-black print:space-y-4 print:overflow-visible">
            
            {/* Title for Print */}
            <div className="hidden print:block mb-8 border-b-2 border-black pb-4">
                <h1 className="text-3xl font-black uppercase italic">Dugout Hitting League</h1>
                <p className="text-lg font-bold">Operational Guide</p>
            </div>

            <section className="print:break-inside-avoid">
                <h3 className="text-xl font-black text-blue-600 dark:text-blue-400 uppercase mb-3 print:text-black print:text-lg print:border-b print:border-black">1. Getting Started & Roles</h3>
                <p className="mb-2">The app has three levels of access:</p>
                <ul className="list-disc pl-5 space-y-1 text-sm sm:text-base">
                    <li><strong>FAN (Default):</strong> Read-only access. View scores, standings, and live games. No login required.</li>
                    <li><strong>UMPIRE:</strong> Password required. Can start matches, score games, manage rosters, and edit history.</li>
                    <li><strong>ADMIN:</strong> Password required. Full control including creating leagues, resetting seasons, and exporting data.</li>
                </ul>
                <p className="text-xs italic text-slate-500 mt-2 print:text-black">Note: Sessions expire after 3 hours of inactivity.</p>
            </section>

            <section className="print:break-inside-avoid">
                <h3 className="text-xl font-black text-blue-600 dark:text-blue-400 uppercase mb-3 print:text-black print:text-lg print:border-b print:border-black">2. Setting Up (Admin)</h3>
                <ul className="list-disc pl-5 space-y-1 text-sm sm:text-base">
                    <li><strong>Create League:</strong> Use the Admin Dashboard to create categories (e.g., Varsity, 10u).</li>
                    <li><strong>Team Rosters:</strong> Enter First Name (Display) and optional Last Name (Admin tracking).</li>
                    <li><strong>Active Season:</strong> Admin can switch seasons (e.g., 2025 to 2026) to archive old data.</li>
                </ul>
            </section>

            <section className="print:break-inside-avoid">
                <h3 className="text-xl font-black text-blue-600 dark:text-blue-400 uppercase mb-3 print:text-black print:text-lg print:border-b print:border-black">3. Match Workflow</h3>
                <ol className="list-decimal pl-5 space-y-1 text-sm sm:text-base">
                    <li>Log in as Umpire or Admin.</li>
                    <li>Select Home and Away teams on the Dashboard.</li>
                    <li>Click <strong>"Next: Set Lineup"</strong>.</li>
                    <li>Drag to reorder players. Click <strong>"+ Add Sub"</strong> if needed.</li>
                    <li>Click <strong>"Start Match"</strong>.</li>
                </ol>
            </section>

            <section className="print:break-inside-avoid">
                <h3 className="text-xl font-black text-blue-600 dark:text-blue-400 uppercase mb-3 print:text-black print:text-lg print:border-b print:border-black">4. Scoring Rules</h3>
                <ul className="list-disc pl-5 space-y-1 text-sm sm:text-base">
                    <li><strong>Entry:</strong> Tap a pitch box (1-10) and select score (0-4).</li>
                    <li><strong>Auto-Advance:</strong> The inning tabs switch automatically when all pitches are recorded.</li>
                    <li><strong>Undo:</strong> Use the "Undo Previous" button in the scoring modal to correct mistakes.</li>
                    <li><strong>Edit:</strong> Tap any completed score to change it.</li>
                </ul>
            </section>

            <section className="print:break-inside-avoid">
                <h3 className="text-xl font-black text-blue-600 dark:text-blue-400 uppercase mb-3 print:text-black print:text-lg print:border-b print:border-black">5. Short-Handed Teams</h3>
                <div className="space-y-3">
                    <div>
                        <strong className="block mb-1 text-slate-900 dark:text-white print:text-black">2v2 Matches</strong>
                        <p className="text-sm">Standard scoring. 10 pitches per player. 20 Team Pitches total.</p>
                    </div>
                    <div>
                        <strong className="block mb-1 text-slate-900 dark:text-white print:text-black">3v2 Matches (Ghost Mode)</strong>
                        <p className="text-sm">The 2-player team gets 15 pitches each to match the 3-player team's volume.</p>
                        <ul className="list-disc pl-5 mt-1 text-sm">
                            <li>Pitches 1-10 count for the Player.</li>
                            <li>Pitches 11-15 count for the Team (Ghost Player).</li>
                        </ul>
                    </div>
                </div>
            </section>

            <section className="print:break-inside-avoid">
                <h3 className="text-xl font-black text-blue-600 dark:text-blue-400 uppercase mb-3 print:text-black print:text-lg print:border-b print:border-black">6. Tie Breakers</h3>
                <p className="text-sm sm:text-base mb-2">If tied after 6 innings:</p>
                <ol className="list-decimal pl-5 space-y-1 text-sm sm:text-base">
                    <li>Select one shooter from each team.</li>
                    <li>Play Extra Innings (Round 1 = 5 pitches).</li>
                    <li>Scores are added to team total and player stats.</li>
                </ol>
            </section>

            <section className="print:break-inside-avoid">
                <h3 className="text-xl font-black text-blue-600 dark:text-blue-400 uppercase mb-3 print:text-black print:text-lg print:border-b print:border-black">7. Admin Tools</h3>
                <ul className="list-disc pl-5 space-y-1 text-sm sm:text-base">
                    <li><strong>Move Match:</strong> Fix matches scored in the wrong league via the Dashboard "Move" button.</li>
                    <li><strong>Bulk Move Teams:</strong> Move entire rosters and their history to a new league via Admin Dashboard.</li>
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
