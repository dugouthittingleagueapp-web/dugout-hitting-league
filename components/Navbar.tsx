
import React, { useState, useRef, useEffect } from 'react';
import { AgeGroup, League } from '../types';

interface NavbarProps {
  currentLeague: AgeGroup | null;
  currentSeason: string;
  leagues: League[];
  userRole: 'fan' | 'umpire' | 'admin';
  showLeagueHomeButton?: boolean;
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
  setMenuOpen: (open: boolean) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ 
  currentLeague, 
  currentSeason, 
  leagues, 
  userRole,
  showLeagueHomeButton = true,
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
  setMenuOpen,
}) => {
  const [showSeasonMenu, setShowSeasonMenu] = useState(false);
  const [showLeagueMenu, setShowLeagueMenu] = useState(false);
  const leagueMenuRef = useRef<HTMLDivElement>(null);
  const seasonMenuRef = useRef<HTMLDivElement>(null);

  // Click-outside listener for dropdowns
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (leagueMenuRef.current && !leagueMenuRef.current.contains(target)) {
        setShowLeagueMenu(false);
      }
      if (seasonMenuRef.current && !seasonMenuRef.current.contains(target)) {
        setShowSeasonMenu(false);
      }
    };
    if (showLeagueMenu || showSeasonMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [showLeagueMenu, showSeasonMenu]);
  
  const sortedLeagues = [...leagues].sort((a, b) => 
      a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' })
  );

  const isHomeScreen = !currentLeague;

  return (
    <>
        <nav className={`bg-slate-100/90 dark:bg-slate-950/90 backdrop-blur-md text-slate-900 dark:text-white shadow-lg relative z-[999] transition-all duration-500 ease-in-out border-b border-slate-200 dark:border-slate-800 ${isHomeScreen ? 'py-6 sm:py-10 border-b-0' : 'pt-2 pb-0'}`}>
        <div className="max-w-7xl mx-auto w-full px-2 sm:px-6 relative">
            
            {isHomeScreen ? (
                // --- HOME SCREEN LAYOUT (Vertical Stack) ---
                <div className="flex flex-col items-center gap-6 w-full">
                    {/* Absolute Hamburger (Top Left) */}
                    <div className="absolute top-0 left-4 sm:left-6 flex gap-2">
                        <button onClick={() => setMenuOpen(true)} className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
                            <svg className="w-8 h-8 text-slate-700 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path>
                            </svg>
                        </button>
                    </div>

                    {/* Centered Logo */}
                    <div 
                        className="flex flex-col items-center gap-4 cursor-pointer group transform hover:scale-105 transition-transform duration-500 mt-8" 
                        onClick={onGoHome}
                    >
                        <img 
                            src="https://imgur.com/SqDq8L3.png" 
                            alt="Dugout Hitting League" 
                            className="w-56 sm:w-80 drop-shadow-[0_0_40px_rgba(59,130,246,0.3)] object-contain shrink-0 transition-all duration-500"
                        />
                    </div>
                </div>
            ) : (
                // --- DASHBOARD LAYOUT (Fixed Horizontal Bar) ---
                // Reduced min-height for mobile to save space
                <div className="flex items-center justify-between relative min-h-[3rem] sm:min-h-[6rem] md:min-h-[8rem] pb-1 sm:pb-2">
                    
                    {/* Left: Hamburger */}
                    <div className="z-30 flex-shrink-0 self-center">
                        <button onClick={() => setMenuOpen(true)} className="p-1 sm:p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
                            <svg className="w-6 h-6 sm:w-8 sm:h-8 text-slate-700 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path>
                            </svg>
                        </button>
                    </div>

                    {/* Center: Logo (Mobile Only - Absolute Center) */}
                    <div className="md:hidden absolute inset-0 flex items-center justify-center pointer-events-none z-20">
                        <div className="pointer-events-auto flex items-center justify-center cursor-pointer h-full" onClick={onGoHome}>
                            <img 
                                src="https://imgur.com/SqDq8L3.png" 
                                alt="Dugout Hitting League" 
                                className="h-8 sm:h-20 drop-shadow-[0_0_10px_rgba(59,130,246,0.3)] object-contain"
                            />
                        </div>
                    </div>

                    {/* Right: Desktop Layout (Logo Right Justified) */}
                    <div className="hidden md:flex items-center ml-auto z-30 h-full gap-4">
                        <div className="flex items-center cursor-pointer group h-full" onClick={onGoHome}>
                             {/* Dugout Text Logo (Left of Image) */}
                             <div className="flex flex-col items-end pr-6 justify-center h-full">
                                <h1 className="text-xl md:text-3xl font-black tracking-tighter italic uppercase leading-none text-slate-900 dark:text-white transform skew-x-[-10deg]">Dugout Hitting League</h1>
                            </div>
                            
                            {/* Vertical Separator Line */}
                            <div className="h-10 md:h-16 w-px bg-slate-300 dark:bg-slate-700 mx-2"></div>

                            {/* League Logo Image (Far Right) */}
                            <img 
                                src="https://imgur.com/SqDq8L3.png" 
                                alt="Dugout Hitting League" 
                                className="h-16 md:h-28 drop-shadow-[0_0_15px_rgba(59,130,246,0.2)] object-contain shrink-0 pl-6"
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
        
        {currentLeague && (
            <div className="w-full border-t border-slate-200 dark:border-slate-800/50">
                <div className="max-w-7xl mx-auto flex items-center gap-3 px-2 sm:px-6 py-2 sm:py-3 relative z-[900]">
                    {/* League Indicator & Switcher (Left) */}
                    <div className="relative" ref={leagueMenuRef}>
                        <button 
                            onClick={() => setShowLeagueMenu(!showLeagueMenu)}
                            className="flex items-center gap-2 bg-white/50 dark:bg-slate-800/50 hover:bg-white dark:hover:bg-slate-800 px-2 sm:px-3 py-1 sm:py-1.5 rounded-md border border-slate-200 dark:border-slate-700/50 shrink-0 transition-colors group cursor-pointer"
                        >
                            <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
                            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 group-hover:text-blue-600 dark:group-hover:text-blue-400">{currentLeague} League</span>
                            <svg className="w-3 h-3 text-slate-400 group-hover:text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                        </button>
                        
                        {showLeagueMenu && (
                            <div className="absolute top-full left-0 mt-2 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl shadow-xl py-2 w-48 border border-slate-200 dark:border-slate-800 z-[1001] overflow-hidden animate-in slide-in-from-top-2 fade-in duration-200">
                                <div className="px-4 py-2 text-[10px] uppercase font-black text-slate-400 dark:text-slate-500 border-b border-slate-200 dark:border-slate-800 mb-1 tracking-wider">Switch League</div>
                                {sortedLeagues.map(l => (
                                    <button key={l.id} onClick={() => { onSelectLeague(l.id); setShowLeagueMenu(false); }} className={`w-full text-left px-4 py-3 text-sm font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors font-sans flex justify-between items-center ${currentLeague === l.id ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'text-slate-700 dark:text-slate-300'}`}>
                                        {l.id}
                                        {currentLeague === l.id && <span className="text-blue-600 dark:text-blue-400">●</span>}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Controls (Right) - Season Only (Admin can switch between active and archive) */}
                    <div className="ml-auto flex items-center gap-4 sm:gap-6 relative z-[1000]">
                        {userRole === 'admin' ? (
                            <div className="relative" ref={seasonMenuRef}>
                                <button onClick={() => setShowSeasonMenu(!showSeasonMenu)} className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-slate-500 hover:text-slate-800 dark:hover:text-slate-300 transition-colors flex items-center gap-1.5">
                                    Season: <span className="text-slate-900 dark:text-white font-extrabold">{currentSeason}</span>
                                    {currentSeason === '2025' && <span className="bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 text-[9px] px-1.5 py-0.2 rounded font-bold">Archive</span>}
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                                </button>
                                {showSeasonMenu && (
                                    <div className="absolute top-full right-0 mt-2 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl shadow-xl py-2 w-36 border border-slate-200 dark:border-slate-800 z-[1001] overflow-hidden animate-in slide-in-from-top-2 fade-in duration-200">
                                        <button onClick={() => { onSeasonChange('2026'); setShowSeasonMenu(false); }} className={`w-full text-left px-3 py-2 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors font-sans flex items-center justify-between ${currentSeason === '2026' ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'text-slate-700 dark:text-slate-300'}`}>
                                            <span>2026</span>
                                            <span className="text-[9px] text-green-600 dark:text-green-400 font-bold uppercase">Active</span>
                                        </button>
                                        <button onClick={() => { onSeasonChange('2025'); setShowSeasonMenu(false); }} className={`w-full text-left px-3 py-2 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors font-sans flex items-center justify-between ${currentSeason === '2025' ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20' : 'text-slate-700 dark:text-slate-300'}`}>
                                            <span>2025</span>
                                            <span className="text-[9px] text-amber-600 dark:text-amber-400 font-bold uppercase">Archive</span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-slate-500">
                                Season: <span className="text-slate-900 dark:text-white font-extrabold">{currentSeason}</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}
        </nav>

        {/* Slide-out Menu Drawer */}
        {isMenuOpen && (
            <div className="fixed inset-0 z-[2000] flex">
                {/* Backdrop */}
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setMenuOpen(false)}></div>
                
                {/* Drawer Content */}
                <div className="relative bg-white dark:bg-slate-950 w-[80%] max-w-xs h-full shadow-2xl border-r border-slate-200 dark:border-slate-800 flex flex-col animate-in slide-in-from-left duration-300">
                    <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
                        <h2 className="text-xl font-black italic uppercase text-slate-900 dark:text-white tracking-tight">Menu</h2>
                        <button onClick={() => setMenuOpen(false)} className="text-slate-400 hover:text-slate-800 dark:hover:text-white">
                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    </div>
                    
                    <div className="p-6 flex-1 overflow-y-auto space-y-8">
                        
                        {/* Theme Toggle in Drawer (Removed from main nav per request) */}
                        <div>
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Appearance</h3>
                            <button onClick={toggleTheme} className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors">
                                <span className="font-bold text-slate-700 dark:text-slate-300">{isDarkMode ? 'Dark Mode' : 'Light Mode'}</span>
                                {isDarkMode ? (
                                    <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
                                ) : (
                                    <svg className="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>
                                )}
                            </button>
                        </div>

                        {/* Season Selector in Drawer */}
                        <div>
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Season</h3>
                            {userRole === 'admin' ? (
                                <div className="grid grid-cols-2 gap-2">
                                    <button 
                                        onClick={() => { onSeasonChange('2026'); setMenuOpen(false); }} 
                                        className={`py-2 px-3 rounded-lg text-xs font-bold flex flex-col items-center gap-0.5 transition-colors ${currentSeason === '2026' ? 'bg-blue-600 text-white shadow-md shadow-blue-900/30' : 'bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'}`}
                                    >
                                        <span>2026</span>
                                        <span className="text-[9px] uppercase font-bold opacity-80">Active</span>
                                    </button>
                                    <button 
                                        onClick={() => { onSeasonChange('2025'); setMenuOpen(false); }} 
                                        className={`py-2 px-3 rounded-lg text-xs font-bold flex flex-col items-center gap-0.5 transition-colors ${currentSeason === '2025' ? 'bg-amber-600 text-white shadow-md shadow-amber-900/30' : 'bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'}`}
                                    >
                                        <span>2025</span>
                                        <span className="text-[9px] uppercase font-bold opacity-80">Archive</span>
                                    </button>
                                </div>
                            ) : (
                                <div className="p-3 bg-slate-100 dark:bg-slate-900 rounded-xl flex items-center justify-between">
                                    <span className="font-bold text-sm text-slate-800 dark:text-white">2026</span>
                                    <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">Active</span>
                                </div>
                            )}
                        </div>

                        {/* Leagues */}
                        <div>
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Leagues</h3>
                            <div className="space-y-2">
                                {sortedLeagues.map(l => (
                                    <button 
                                        key={l.id} 
                                        onClick={() => { onSelectLeague(l.id); setMenuOpen(false); }} 
                                        className={`w-full text-left p-3 rounded-xl font-bold flex justify-between items-center transition-colors ${currentLeague === l.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'}`}
                                    >
                                        {l.id}
                                        {currentLeague === l.id && <span className="text-white">●</span>}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Admin Actions */}
                         <div>
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Account</h3>
                            {userRole === 'fan' ? (
                                <button onClick={onLogin} className="w-full py-3 bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-white rounded-xl font-bold hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors">Log In</button>
                            ) : (
                                <div className="space-y-2">
                                    {userRole === 'admin' && <button onClick={onAdminDashboard} className="w-full py-3 bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-white rounded-xl font-bold hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors">Admin Dashboard</button>}
                                    <button onClick={onLogout} className="w-full py-3 border border-red-200 dark:border-red-900/30 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-xl font-bold transition-colors">Log Out</button>
                                </div>
                            )}
                        </div>

                    </div>
                </div>
            </div>
        )}
    </>
  );
};
