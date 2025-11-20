
import React, { useState } from 'react';
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
  
  const baseYear = 2025;
  const years = Array.from({length: 5}, (_, i) => (baseYear + i).toString());
  const sortedLeagues = [...leagues].sort((a, b) => 
      a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' })
  );

  const isHomeScreen = !currentLeague;

  return (
    <nav className={`bg-slate-950 text-white shadow-2xl sticky top-0 z-50 transition-all duration-500 ease-in-out border-b border-slate-800 ${isHomeScreen ? 'py-10 sm:py-16 border-b-0' : 'py-4'}`}>
      <div className={`max-w-7xl mx-auto w-full px-4 sm:px-6 flex ${isHomeScreen ? 'flex-col items-center gap-10' : 'justify-between items-center'}`}>
        
        <div 
            className={`flex items-center gap-4 cursor-pointer group ${isHomeScreen ? 'flex-col transform hover:scale-105 transition-transform duration-500' : ''}`} 
            onClick={onGoHome}
        >
            <img 
                src="https://i.imgur.com/SqDq8L3.png" 
                alt="Dugout Hitting League" 
                className={`${isHomeScreen ? 'w-56 sm:w-80 drop-shadow-[0_0_40px_rgba(59,130,246,0.3)]' : 'w-32 sm:w-40 drop-shadow-[0_0_15px_rgba(59,130,246,0.2)]'} object-contain shrink-0 transition-all duration-500`}
            />
            {!isHomeScreen && (
                <div className="hidden md:block pt-1 pl-4 border-l border-slate-700 ml-2">
                    <h1 className="text-xl font-black tracking-tighter italic uppercase leading-none text-white">Dugout</h1>
                    <span className="font-bold text-blue-400 text-[10px] tracking-[0.25em] uppercase block leading-none mt-0.5">Hitting League</span>
                </div>
            )}
        </div>

        <div className={`flex items-center gap-3 sm:gap-4 transition-opacity duration-500 ${isHomeScreen ? 'opacity-100' : 'opacity-100'}`}>
          {currentLeague && showLeagueHomeButton && (
            <button onClick={onSwitchLeague} className="hidden sm:flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/50 px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:text-white hover:border-slate-600">
               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
               Leagues
            </button>
          )}

          <div className="relative">
            <button 
                onClick={() => setShowSeasonMenu(!showSeasonMenu)} 
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-colors border font-sans
                ${isHomeScreen 
                    ? 'bg-slate-900 text-slate-200 border-slate-800 hover:bg-slate-800' 
                    : 'bg-slate-900 text-slate-200 border-slate-800 hover:bg-slate-800'
                }`}
            >
                <span className="text-slate-500 font-medium uppercase text-[10px] tracking-wider hidden sm:inline">Season</span>
                <span className="text-white">{currentSeason}</span>
                <svg className={`w-3 h-3 text-slate-500 transition-transform ${showSeasonMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>
            
            {showSeasonMenu && (
                <div className="absolute top-full right-0 mt-2 bg-slate-900 text-white rounded-xl shadow-xl py-2 w-32 border border-slate-800 z-[60] overflow-hidden animate-in slide-in-from-top-2 fade-in duration-200">
                    {years.map(year => (
                        <button key={year} onClick={() => { onSeasonChange(year); setShowSeasonMenu(false); }} className={`w-full text-left px-4 py-2 text-sm font-bold hover:bg-slate-800 transition-colors font-sans ${currentSeason === year ? 'text-blue-400 bg-blue-900/20' : 'text-slate-400'}`}>
                            {year}
                        </button>
                    ))}
                </div>
            )}
          </div>
          
          {userRole === 'fan' && (
            <button onClick={onLogin} className="text-xs sm:text-sm bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-lg font-bold transition-all shadow-lg shadow-blue-900/20 hover:shadow-blue-600/40 font-sans whitespace-nowrap">
                Log In
            </button>
          )}

          {userRole === 'umpire' && (
            <div className="flex items-center gap-3 pl-2 border-l border-slate-800">
                <div className="flex flex-col items-end leading-none hidden md:flex">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Umpire Mode</span>
                    <button onClick={onLogout} className="text-xs text-red-400 hover:text-red-300 transition-colors">Log Out</button>
                </div>
                <button onClick={onLogout} className="md:hidden text-xs text-red-400 hover:text-red-300">Log Out</button>
            </div>
          )}

          {userRole === 'admin' && (
            <div className="flex items-center gap-3 pl-2 border-l border-slate-800">
                 <div className="flex items-center gap-2">
                    <button onClick={onAdminDashboard} className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg transition-colors font-bold border border-slate-700">
                        Admin
                    </button>
                    <button onClick={onLogout} className="text-xs text-slate-400 hover:text-white transition-colors">Log Out</button>
                </div>
            </div>
          )}
        </div>
      </div>
      
      {currentLeague && (
        <div className="max-w-7xl mx-auto mt-3 flex items-center gap-3 px-4 sm:px-6 pt-2 border-t border-slate-800/50">
            <div className="flex items-center gap-2 bg-slate-800/50 px-2 py-1 rounded-md border border-slate-700/50">
                <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">{currentLeague} League</span>
            </div>
            
            <div className="relative ml-auto">
                <button onClick={() => setShowLeagueMenu(!showLeagueMenu)} className="text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1">
                   Switch League
                   <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                </button>
                
                {showLeagueMenu && (
                    <div className="absolute top-full right-0 mt-2 bg-slate-900 text-white rounded-xl shadow-xl py-2 w-48 border border-slate-800 z-[60] overflow-hidden animate-in slide-in-from-top-2 fade-in duration-200">
                        <div className="px-4 py-2 text-[10px] uppercase font-black text-slate-500 border-b border-slate-800 mb-1 tracking-wider">Select League</div>
                        {sortedLeagues.map(l => (
                            <button key={l.id} onClick={() => { onSelectLeague(l.id); setShowLeagueMenu(false); }} className={`w-full text-left px-4 py-3 text-sm font-bold hover:bg-slate-800 transition-colors font-sans flex justify-between items-center ${currentLeague === l.id ? 'text-blue-400 bg-blue-900/20' : 'text-slate-300'}`}>
                                {l.id}
                                {currentLeague === l.id && <span className="text-blue-400">●</span>}
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
