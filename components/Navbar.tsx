import React, { useState } from 'react';
import { AgeGroup, League } from '../types';
import { UserGuide } from './UserGuide';

export interface NavbarProps {
  currentLeague: AgeGroup | null;
  currentSeason: string;
  leagues: League[];
  userRole: 'fan' | 'umpire' | 'admin';
  onGoHome: () => void;
  onSwitchLeague: () => void;
  onSelectLeague: (leagueId: string) => void;
  onLogin: () => void;
  onLogout: () => void;
  onAdminDashboard: () => void;
  onSeasonChange: (season: string) => void;
  isDarkMode: boolean;
  toggleTheme: () => void;
  isMenuOpen: boolean;
  setMenuOpen: (isOpen: boolean) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentLeague,
  currentSeason,
  leagues,
  userRole,
  onGoHome,
  onSwitchLeague,
  onSelectLeague,
  onLogin,
  onLogout,
  onAdminDashboard,
  onSeasonChange,
  isDarkMode,
  toggleTheme,
  isMenuOpen,
  setMenuOpen
}) => {
  const [showGuide, setShowGuide] = useState(false);

  return (
    <>
      <nav className="sticky top-0 z-[100] w-full border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-black/80 backdrop-blur-xl transition-colors duration-300">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            
            {/* Left Side: Logo & Context */}
            <div className="flex items-center gap-4">
              <div 
                className="flex items-center gap-2 cursor-pointer group" 
                onClick={onGoHome}
              >
                <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 shadow-lg shadow-blue-500/20 transition-transform group-hover:scale-110">
                  <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white font-sans leading-none">
                    Dugout
                  </span>
                  <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 font-sans leading-none">
                    Hitting League
                  </span>
                </div>
              </div>

              {currentLeague && (
                <div className="hidden md:flex items-center gap-2 ml-4 pl-4 border-l border-slate-200 dark:border-slate-800">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold uppercase text-slate-400">Current League</span>
                    <select 
                        value={currentLeague} 
                        onChange={(e) => onSelectLeague(e.target.value)}
                        className="bg-transparent text-sm font-bold text-slate-800 dark:text-slate-200 outline-none cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors font-sans py-0"
                    >
                        {leagues.map(l => <option key={l.id} value={l.id}>{l.id}</option>)}
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Right Side: Desktop Menu */}
            <div className="hidden md:flex items-center gap-4">
               {/* Season Badge (Admin can change implicitly via dashboard, viewed here) */}
               <span className="px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-900 text-xs font-bold text-slate-500 border border-slate-200 dark:border-slate-800 font-sans">
                  Season {currentSeason}
               </span>

               <button 
                onClick={() => setShowGuide(true)}
                className="text-sm font-bold text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors font-sans flex items-center gap-1"
               >
                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                 Guide
               </button>

               {userRole === 'admin' && (
                 <button 
                    onClick={onAdminDashboard}
                    className="text-sm font-bold text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors font-sans"
                 >
                    Admin
                 </button>
               )}

               <button 
                 onClick={toggleTheme}
                 className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                 title="Toggle Theme"
               >
                 {isDarkMode ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
                 ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>
                 )}
               </button>

               {userRole === 'fan' ? (
                 <button 
                   onClick={onLogin}
                   className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-bold hover:opacity-90 transition-opacity font-sans"
                 >
                   Log In
                 </button>
               ) : (
                 <div className="flex items-center gap-3 pl-3 border-l border-slate-200 dark:border-slate-800">
                    <span className="text-xs font-bold uppercase text-blue-600 dark:text-blue-400 font-sans">{userRole}</span>
                    <button 
                        onClick={onLogout}
                        className="text-sm font-bold text-slate-500 hover:text-red-500 transition-colors font-sans"
                    >
                        Log Out
                    </button>
                 </div>
               )}
            </div>

            {/* Mobile Menu Button */}
            <div className="flex md:hidden items-center gap-4">
                 <button 
                    onClick={toggleTheme}
                    className="p-2 text-slate-400"
                 >
                    {isDarkMode ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
                    ) : (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>
                    )}
                </button>
                <button 
                  onClick={() => setMenuOpen(!isMenuOpen)}
                  className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  {isMenuOpen ? (
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  ) : (
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  )}
                </button>
            </div>
          </div>
        </div>

        {/* Mobile Menu */}
        {isMenuOpen && (
          <div className="md:hidden border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-black p-4 space-y-4 animate-in slide-in-from-top-2 duration-200">
             {currentLeague && (
                <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-4">
                    <span className="text-xs font-bold uppercase text-slate-400 block mb-2">Switch League</span>
                    <div className="grid grid-cols-2 gap-2">
                        {leagues.map(l => (
                            <button 
                                key={l.id} 
                                onClick={() => { onSelectLeague(l.id); setMenuOpen(false); }}
                                className={`px-3 py-2 rounded-lg text-sm font-bold border transition-colors ${currentLeague === l.id ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'}`}
                            >
                                {l.id}
                            </button>
                        ))}
                    </div>
                </div>
             )}

             <div className="space-y-2">
                 <button onClick={() => { onSwitchLeague(); setMenuOpen(false); }} className="w-full text-left px-4 py-3 rounded-xl font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors font-sans">
                     Home / Leagues
                 </button>
                 <button onClick={() => { setShowGuide(true); setMenuOpen(false); }} className="w-full text-left px-4 py-3 rounded-xl font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors font-sans">
                     User Guide
                 </button>
                 {userRole === 'admin' && (
                     <button onClick={() => { onAdminDashboard(); setMenuOpen(false); }} className="w-full text-left px-4 py-3 rounded-xl font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors font-sans">
                        Admin Dashboard
                     </button>
                 )}
             </div>

             <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                 {userRole === 'fan' ? (
                     <button onClick={() => { onLogin(); setMenuOpen(false); }} className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-900/20 font-sans">
                         Log In (Umpire/Admin)
                     </button>
                 ) : (
                     <button onClick={() => { onLogout(); setMenuOpen(false); }} className="w-full py-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 font-bold rounded-xl font-sans">
                         Log Out ({userRole})
                     </button>
                 )}
             </div>
          </div>
        )}
      </nav>

      {showGuide && <UserGuide onClose={() => setShowGuide(false)} />}
    </>
  );
};
