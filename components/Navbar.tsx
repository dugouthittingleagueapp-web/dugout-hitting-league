import React from 'react';
import { AgeGroup } from '../types';

interface NavbarProps {
  currentLeague: AgeGroup | null;
  onGoHome: () => void;
  onSwitchLeague: () => void;
  onAdmin: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentLeague, onGoHome, onSwitchLeague, onAdmin }) => {
  return (
    <nav className="bg-slate-900 text-white p-4 shadow-lg sticky top-0 z-50">
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        <div className="flex items-center gap-4 cursor-pointer" onClick={onGoHome}>
            <div className="bg-red-600 w-8 h-8 rounded-full flex items-center justify-center font-bold border-2 border-white">SZ</div>
            <h1 className="text-xl font-bold tracking-tight">StrikeZone <span className="font-light opacity-80">Manager</span></h1>
        </div>
        <div className="flex items-center gap-4">
          {currentLeague && (
            <span className="bg-green-600 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">{currentLeague} League</span>
          )}
          <button onClick={onSwitchLeague} className="text-sm text-slate-300 hover:text-white transition-colors">Switch League</button>
          <button onClick={onAdmin} className="text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded transition-colors">Admin</button>
        </div>
      </div>
    </nav>
  );
};