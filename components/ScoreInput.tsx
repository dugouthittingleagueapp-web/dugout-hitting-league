import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { triggerHaptic } from '../utils/feedback';
import type { ScoringSaveState } from '../services/storageService';

interface ScoreInputProps {
  pitchNumber: number;
  value: number | null;
  pitchesRemaining?: number;
  saveState?: ScoringSaveState;
  onRetrySync?: () => void;
  onChange: (val: number) => void;
  onUndo?: () => void; 
  readOnly?: boolean;
  isEditing: boolean;
  onOpen: () => void;
  onClose: () => void;
}

export const ScoreInput: React.FC<ScoreInputProps> = ({ 
  pitchNumber, 
  value, 
  pitchesRemaining,
  saveState,
  onRetrySync,
  onChange, 
  onUndo, 
  readOnly = false, 
  isEditing, 
  onOpen, 
  onClose
}) => {
  const [localValue, setLocalValue] = useState<number | null>(value);

  useEffect(() => {
    if (isEditing) {
      setLocalValue(value);
    }
  }, [isEditing, value]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isEditing) {
      document.body.style.overflow = 'hidden';
      
      const preventScroll = (e: Event) => {
          e.preventDefault();
      };
      
      document.body.addEventListener('touchmove', preventScroll, { passive: false });
      
      return () => {
        document.body.style.overflow = '';
        document.body.removeEventListener('touchmove', preventScroll);
      };
    }
  }, [isEditing]);

  const handleSelect = (score: number) => {
    triggerHaptic('score');
    if (value !== null) {
      setLocalValue(score);
    } else {
      onChange(score);
    }
  };

  const handleEnter = () => {
    if (localValue !== null) {
      triggerHaptic('score');
      onChange(localValue);
    } else {
      onClose();
    }
  };

  const handleUndoClick = () => {
    if (onUndo) {
      triggerHaptic('undo');
      onUndo();
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
      <div className="flex flex-col items-center gap-0.5 min-w-[28px] sm:min-w-[40px]">
        <div className="bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[8px] sm:text-[10px] font-bold px-1.5 rounded-full select-none font-sans">
            {pitchNumber}
        </div>
        
        <button
          disabled={readOnly}
          onClick={() => {
            if (!readOnly) {
              triggerHaptic('tap');
              onOpen();
            }
          }}
          aria-label={`Pitch ${pitchNumber}, Score: ${value !== null ? value : 'None'}`}
          className={`w-7 h-9 sm:w-14 sm:h-20 rounded sm:rounded-lg flex items-center justify-center text-sm sm:text-3xl font-bold shadow-sm border-2 transition-all duration-150 font-sans cursor-pointer ${value !== null ? getValueColor(value) : 'border-dashed border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 bg-slate-50 dark:bg-slate-900/50 text-slate-300 dark:text-slate-600'}`}
        >
          {value !== null ? value : '-'}
        </button>
      </div>
      
      {isEditing && createPortal(
        <div 
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200 p-4 touch-none" 
            onClick={onClose} 
            role="dialog" 
            aria-modal="true" 
            aria-labelledby="modal-title"
            onTouchMove={(e) => { if(e.target === e.currentTarget) e.preventDefault(); }}
        >
            <div 
                className="bg-white dark:bg-slate-900 p-4 sm:p-6 rounded-2xl shadow-2xl w-full max-w-sm sm:max-w-md transform scale-100 animate-in zoom-in-95 duration-200 font-sans border border-slate-200 dark:border-slate-800" 
                onClick={e => e.stopPropagation()}
                onTouchMove={e => e.stopPropagation()}
            >
                <div className="mb-4 sm:mb-6">
                    <div className="flex justify-between items-center gap-2 mb-2">
                         <div className="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs sm:text-sm font-bold px-3 py-1 rounded-full font-sans">
                           Pitch #{pitchNumber}
                         </div>
                         {saveState && (
                           <div role="status" aria-live="polite" className="flex min-w-0 items-center gap-1 text-[11px] sm:text-xs font-semibold text-slate-500 dark:text-slate-300">
                             {saveState === 'saving' && <span>Saving…</span>}
                             {saveState === 'saved' && <span className="text-emerald-600 dark:text-emerald-400">✓ Saved</span>}
                             {saveState === 'offline' && (
                               <>
                                 <span className="text-amber-600 dark:text-amber-400">Waiting to sync</span>
                                 {onRetrySync && <button type="button" onClick={onRetrySync} className="underline underline-offset-2">Retry</button>}
                               </>
                             )}
                             {saveState === 'attention' && <span className="text-amber-600 dark:text-amber-400">Check saved scores</span>}
                           </div>
                         )}
                    </div>

                    <div className="text-center">
                      <h3 id="modal-title" className="text-xl sm:text-3xl font-bold text-slate-800 dark:text-white mb-1 font-sans">{value !== null ? 'Edit Score' : 'Enter Score'}</h3>
                      {pitchesRemaining !== undefined && (
                          <p className="text-slate-500 dark:text-slate-400 font-bold text-sm sm:text-base font-sans">{pitchesRemaining} Pitches Left</p>
                      )}
                    </div>
                </div>
                
                <div className="grid grid-cols-5 gap-2 sm:gap-3 mb-6">
                    {[0, 1, 2, 3, 4].map((score) => {
                        const isSelected = value !== null ? localValue === score : value === score;
                        return (
                          <button 
                            key={score} 
                            type="button"
                            
                            onClick={() => handleSelect(score)} 
                            aria-label={`Score ${score}`}
                            aria-pressed={isSelected} 
                            className={`h-20 sm:h-32 w-full rounded-xl text-3xl sm:text-4xl font-bold flex items-center justify-center transition-all active:scale-95 font-sans cursor-pointer ${getValueColor(score)} ${isSelected ? 'ring-4 ring-offset-2 ring-blue-400 dark:ring-offset-slate-900 shadow-lg scale-105' : 'hover:brightness-95 shadow-sm'}`}
                          >
                              {score}
                          </button>
                        );
                    })}
                </div>
                
                <div className="flex flex-col sm:flex-row gap-3">
                    {onUndo && value === null && (
                         <button 
                           onClick={handleUndoClick} 
                           className="flex-1 py-3 sm:py-3.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-bold rounded-xl hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors text-base sm:text-lg font-sans flex items-center justify-center gap-2 cursor-pointer"
                         >
                             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
                             Undo Previous
                         </button>
                    )}
                    
                    {value !== null ? (
                       <button onClick={handleEnter} className="flex-[2] py-3 sm:py-3.5 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 dark:shadow-none transition-colors text-lg font-sans cursor-pointer">Update</button>
                    ) : (
                       <button onClick={onClose} className="flex-1 py-3 sm:py-3.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-lg font-sans cursor-pointer">Cancel</button>
                    )}
                </div>
            </div>
        </div>,
        document.body
      )}
    </>
  );
};