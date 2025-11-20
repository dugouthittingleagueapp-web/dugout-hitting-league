import React, { useState, useEffect } from 'react';

interface ScoreInputProps {
  pitchNumber: number;
  value: number | null;
  pitchesRemaining?: number;
  onChange: (val: number) => void;
  onUndo?: () => void; 
  readOnly?: boolean;
  isEditing: boolean;
  onOpen: () => void;
  onClose: () => void;
}

export const ScoreInput: React.FC<ScoreInputProps> = ({ pitchNumber, value, pitchesRemaining, onChange, onUndo, readOnly = false, isEditing, onOpen, onClose }) => {
  const [localValue, setLocalValue] = useState<number | null>(value);

  useEffect(() => {
    if (isEditing) {
      setLocalValue(value);
    }
  }, [isEditing, value]);

  const handleSelect = (score: number) => {
    if (value !== null) {
      setLocalValue(score);
    } else {
      onChange(score);
    }
  };

  const handleEnter = () => {
    if (localValue !== null) {
      onChange(localValue);
    } else {
      onClose();
    }
  };

  const getValueColor = (v: number) => {
    switch(v) {
      case 0: return 'bg-slate-200 text-slate-500 border-slate-300';
      case 1: return 'bg-cyan-100 text-cyan-800 border-cyan-200';
      case 2: return 'bg-green-100 text-green-800 border-green-200';
      case 3: return 'bg-amber-100 text-amber-800 border-amber-300';
      case 4: return 'bg-rose-100 text-rose-800 border-rose-300';
      default: return 'bg-white border-slate-200';
    }
  };

  return (
    <>
      <div className="flex flex-col items-center gap-1 min-w-[36px] sm:min-w-[40px]">
        <div className="bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[9px] sm:text-[10px] font-bold px-1.5 rounded-full select-none font-sans">
            {pitchNumber}
        </div>
        
        <button
          disabled={readOnly}
          onClick={() => !readOnly && onOpen()}
          className={`w-10 h-14 sm:w-14 sm:h-20 rounded-lg flex items-center justify-center text-xl sm:text-3xl font-bold shadow-sm border-2 transition-all duration-150 font-sans ${value !== null ? getValueColor(value) : 'border-dashed border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 bg-slate-50 dark:bg-slate-900/50 text-slate-300 dark:text-slate-600'}`}
        >
          {value !== null ? value : '-'}
        </button>
      </div>
      
      {isEditing && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200 p-4" onClick={onClose}>
            <div className="bg-white dark:bg-slate-900 p-5 sm:p-6 rounded-2xl shadow-2xl w-full max-w-sm transform scale-100 animate-in zoom-in-95 duration-200 font-sans border border-slate-200 dark:border-slate-800" onClick={e => e.stopPropagation()}>
                <div className="text-center mb-4 sm:mb-6">
                    <div className="flex justify-center items-center gap-2 mb-2">
                         <div className="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-sm sm:text-base font-bold px-3 py-1 rounded-full font-sans">Pitch #{pitchNumber}</div>
                    </div>
                    <h3 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white mb-1 font-sans">{value !== null ? 'Edit Score' : 'Enter Score'}</h3>
                    {pitchesRemaining !== undefined && (
                        <p className="text-slate-500 dark:text-slate-400 font-bold text-lg sm:text-xl font-sans">{pitchesRemaining} Pitches Left</p>
                    )}
                </div>
                
                <div className="grid grid-cols-5 gap-2 sm:gap-3 mb-6">
                    {[0, 1, 2, 3, 4].map((score) => {
                        const isSelected = value !== null ? localValue === score : value === score;
                        return (
                          <button key={score} onClick={() => handleSelect(score)} className={`aspect-square rounded-xl text-2xl sm:text-3xl font-bold flex items-center justify-center transition-all active:scale-95 font-sans ${getValueColor(score)} ${isSelected ? 'ring-4 ring-offset-2 ring-blue-400 dark:ring-offset-slate-900 shadow-lg scale-110' : 'hover:brightness-95 shadow-sm'}`}>
                              {score}
                          </button>
                        );
                    })}
                </div>
                
                <div className="flex gap-3">
                    {onUndo && (
                         <button onClick={onUndo} className="flex-1 py-3.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-bold rounded-xl hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors text-sm sm:text-base font-sans flex items-center justify-center gap-2">
                             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
                             Undo
                         </button>
                    )}
                    
                    {value !== null ? (
                       <button onClick={handleEnter} className="flex-[2] py-3.5 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 dark:shadow-none transition-colors text-lg font-sans">Update</button>
                    ) : (
                       <button onClick={onClose} className="flex-1 py-3.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-lg font-sans">Cancel</button>
                    )}
                </div>
            </div>
        </div>
      )}
    </>
  );
};