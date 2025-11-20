
import React, { useState, useEffect } from 'react';
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
  onSeasonChange 
}) => {
  const [showSeasonMenu, setShowSeasonMenu] = useState(false);
  const [showLeagueMenu, setShowLeagueMenu] = useState(false);
  
  // Generate a few previous years + next year for the dropdown
  const baseYear = 2025;
  const years = Array.from({length: 5}, (_, i) => (baseYear + i).toString());

  // Sort leagues for dropdown
  const sortedLeagues = [...leagues].sort((a, b) => 
      a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' })
  );

  // Determine if we are on the "Home Screen" (League Selection)
  const isHomeScreen = !currentLeague;

  return (
    <nav className={`bg-slate-900 text-white shadow-lg sticky top-0 z-50 transition-all duration-300 ${isHomeScreen ? 'py-10' : 'p-2 sm:p-4'}`}>
      <div className={`max-w-7xl mx-auto flex ${isHomeScreen ? 'flex-col items-center gap-8' : 'justify-between items-center'}`}>
        
        <div className={`flex items-center gap-4 cursor-pointer ${isHomeScreen ? 'flex-col' : ''}`} onClick={onGoHome}>
            {/* Logo Image - 5x larger on home screen (w-60/15rem vs w-12/3rem) */}
            <img 
                src="https://i.imgur.com/EeBXx6d.png" 
                alt="Dugout Hitting League" 
                className={`${isHomeScreen ? 'w-60' : 'w-12 h-12'} object-contain shrink-0 transition-all duration-500`}
            />
            {!isHomeScreen && (
                <div className="hidden lg:block">
                    <h1 className="text-xl font-bold tracking-tight font-sans">Dugout Hitting League</h1>
                    <span className="font-light opacity-80 text-sm font-sans">Manager</span>
                </div>
            )}
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          {/* League Home - Only show if configured and we are in a league */}
          {currentLeague && showLeagueHomeButton && (
            <button onClick={onSwitchLeague} className="bg-slate-800 hover:bg-slate-700 text-white border border-slate-600 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-colors font-sans whitespace-nowrap">
               League Home
            </button>
          )}

          {/* Season Selector */}
          <div className="relative">
            <button onClick={() => setShowSeasonMenu(!showSeasonMenu)} className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-colors border border-slate-700 font-sans whitespace-nowrap">
                <span className="text-slate-400 font-normal hidden sm:inline">Season:</span> {currentSeason}
            </button>
            {showSeasonMenu && (
                <div className="absolute top-full right-0 mt-2 bg-white text-slate-900 rounded-lg shadow-xl py-2 w-32 border border-slate-200 z-[60]" onClick={() => setShowSeasonMenu(false)}>
                    {years.map(year => (
                        <button key={year} onClick={() => onSeasonChange(year)} className={`w-full text-left px-4 py-2 text-sm font-bold hover:bg-slate-100 font-sans ${currentSeason === year ? 'text-blue-600 bg-blue-50' : ''}`}>
                            {year}
                        </button>
                    ))}
                </div>
            )}
          </div>
          
          {/* Auth Actions */}
          {userRole === 'fan' && (
            <button onClick={onLogin} className="text-xs sm:text-sm bg-blue-600 hover:bg-blue-500 px-3 sm:px-4 py-1.5 rounded font-bold transition-colors shadow-sm font-sans whitespace-nowrap">
                Log In
            </button>
          )}

          {userRole === 'umpire' && (
            <div className="flex items-center gap-2">
                <span className="bg-amber-500/20 text-amber-400 text-[10px] font-bold uppercase px-2 py-1 rounded border border-amber-500/30 hidden md:block font-sans">Umpire</span>
                <button onClick={onLogout} className="text-xs sm:text-sm text-slate-300 hover:text-white underline decoration-slate-500 font-sans whitespace-nowrap">Log Out</button>
            </div>
          )}

          {userRole === 'admin' && (
            <div className="flex items-center gap-3">
                <button onClick={onAdminDashboard} className="text-xs sm:text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded transition-colors border border-slate-600 font-sans">
                    Admin
                </button>
                <button onClick={onLogout} className="text-xs sm:text-sm text-slate-300 hover:text-white underline decoration-slate-500 font-sans whitespace-nowrap">
                    Log Out
                </button>
            </div>
          )}
        </div>
      </div>
      
      {/* Sub-nav for active league */}
      {currentLeague && (
        <div className="max-w-7xl mx-auto mt-2 flex items-center gap-3 pb-1">
            <span className="bg-green-600 px-3 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider font-sans">{currentLeague} League</span>
            
            <div className="relative">
                <button onClick={() => setShowLeagueMenu(!showLeagueMenu)} className="text-xs text-slate-400 hover:text-white transition-colors underline decoration-slate-600 flex items-center gap-1 font-sans">
                   Quick Switch
                   <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                </button>
                
                {showLeagueMenu && (
                    <div className="absolute top-full left-0 mt-2 bg-white text-slate-900 rounded-lg shadow-xl py-2 w-40 border border-slate-200 z-[60]" onClick={() => setShowLeagueMenu(false)}>
                        <div className="px-4 py-2 text-[10px] uppercase font-bold text-slate-400 border-b border-slate-100 mb-1 font-sans">Switch To...</div>
                        {sortedLeagues.map(l => (
                            <button key={l.id} onClick={() => onSelectLeague(l.id)} className={`w-full text-left px-4 py-2 text-sm font-bold hover:bg-slate-100 font-sans ${currentLeague === l.id ? 'text-blue-600 bg-blue-50' : ''}`}>
                                {l.id}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
      )}
    </nav>
  );
};
