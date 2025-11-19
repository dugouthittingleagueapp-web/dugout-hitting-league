import React, { useState, useEffect } from 'react';
import { AgeGroup } from '../types';

interface NavbarProps {
  currentLeague: AgeGroup | null;
  currentSeason: string;
  onGoHome: () => void;
  onSwitchLeague: () => void;
  onAdmin: () => void;
  onSeasonChange: (season: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentLeague, currentSeason, onGoHome, onSwitchLeague, onAdmin, onSeasonChange }) => {
  const [showSeasonMenu, setShowSeasonMenu] = useState(false);
  
  // Generate a few previous years + next year for the dropdown
  const baseYear = 2025;
  const years = Array.from({length: 5}, (_, i) => (baseYear + i).toString());

  return (
    <nav className="bg-slate-900 text-white p-4 shadow-lg sticky top-0 z-50">
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        <div className="flex items-center gap-4 cursor-pointer" onClick={onGoHome}>
            <div className="bg-red-600 w-8 h-8 rounded-full flex items-center justify-center font-bold border-2 border-white text-xs sm:text-base">DH</div>
            <h1 className="text-xl font-bold tracking-tight hidden sm:block">Dugout Hitting League <span className="font-light opacity-80">Manager</span></h1>
            <h1 className="text-xl font-bold tracking-tight sm:hidden">Dugout</h1>
        </div>
        <div className="flex items-center gap-4">
          {/* Season Selector */}
          <div className="relative">
            <button onClick={() => setShowSeasonMenu(!showSeasonMenu)} className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 px-3 py-1 rounded-lg text-sm font-bold transition-colors border border-slate-700">
                <span className="text-slate-400 font-normal text-xs">Season:</span> {currentSeason}
            </button>
            {showSeasonMenu && (
                <div className="absolute top-full right-0 mt-2 bg-white text-slate-900 rounded-lg shadow-xl py-2 w-32 border border-slate-200 z-[60]" onClick={() => setShowSeasonMenu(false)}>
                    {years.map(year => (
                        <button key={year} onClick={() => onSeasonChange(year)} className={`w-full text-left px-4 py-2 text-sm font-bold hover:bg-slate-100 ${currentSeason === year ? 'text-blue-600 bg-blue-50' : ''}`}>
                            {year}
                        </button>
                    ))}
                </div>
            )}
          </div>
          
          {/* Admin Button */}
          <button onClick={onAdmin} className="text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded transition-colors">Admin</button>
        </div>
      </div>
      
      {/* Sub-nav for active league */}
      {currentLeague && (
        <div className="max-w-7xl mx-auto mt-2 flex items-center gap-3 pb-1">
            <span className="bg-green-600 px-3 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">{currentLeague} League</span>
            <button onClick={onSwitchLeague} className="text-xs text-slate-400 hover:text-white transition-colors underline decoration-slate-600">Switch League</button>
        </div>
      )}
    </nav>
  );
};