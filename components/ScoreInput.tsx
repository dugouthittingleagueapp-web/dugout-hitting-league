import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { triggerHaptic } from '../hooks/useVoiceScoring';

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
  voiceEnabled?: boolean;
  onToggleVoice?: () => void;
  lastHeard?: string | null;
}

export const ScoreInput: React.FC<ScoreInputProps> = ({ 
  pitchNumber, 
  value, 
  pitchesRemaining, 
  onChange, 
  onUndo, 
  readOnly = false, 
  isEditing, 
  onOpen, 
  onClose,
  voiceEnabled = false,
  onToggleVoice,
  lastHeard
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
    triggerHaptic(score === 4 ? 'homerun' : 'score');
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

                         {/* Mic toggle directly inside scoring modal */}
                         {onToggleVoice && !readOnly && (
                           <button
                             type="button"
                             onClick={() => {
                               triggerHaptic('toggle');
                               onToggleVoice();
                             }}
                             className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-bold text-xs font-sans transition-all cursor-pointer shadow-sm ${
                               voiceEnabled
                                 ? 'bg-emerald-600 hover:bg-emerald-500 border-emerald-400 text-white shadow-emerald-500/20 ring-2 ring-emerald-400/50'
                                 : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                             }`}
                             title="Toggle Voice Scoring ON/OFF"
                           >
                             <svg className={`w-4 h-4 shrink-0 ${voiceEnabled ? 'text-white animate-pulse' : 'text-slate-500 dark:text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                             </svg>
                             <span>Voice: <strong className="uppercase">{voiceEnabled ? 'ON' : 'OFF'}</strong></span>
                           </button>
                         )}
                    </div>

                    <div className="text-center">
                      <h3 id="modal-title" className="text-xl sm:text-3xl font-bold text-slate-800 dark:text-white mb-1 font-sans">{value !== null ? 'Edit Score' : 'Enter Score'}</h3>
                      {pitchesRemaining !== undefined && (
                          <p className="text-slate-500 dark:text-slate-400 font-bold text-sm sm:text-base font-sans">{pitchesRemaining} Pitches Left</p>
                      )}
                    </div>

                    {/* In-modal Voice feedback indicator */}
                    {voiceEnabled && (
                      <div className="mt-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800/80 rounded-xl px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-2 shadow-inner">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping shrink-0" />
                          <span className="truncate">Speak score (<strong>0–4</strong>) or <strong>"Undo"</strong></span>
                        </div>
                        {lastHeard && (
                          <span className="bg-emerald-600 text-white px-2 py-0.5 rounded-md font-black text-xs shrink-0 shadow-sm animate-bounce">
                            🎙️ {lastHeard}
                          </span>
                        )}
                      </div>
                    )}
                </div>
                
                <div className="grid grid-cols-5 gap-2 sm:gap-3 mb-6">
                    {[0, 1, 2, 3, 4].map((score) => {
                        const isSelected = value !== null ? localValue === score : value === score;
                        return (
                          <button 
                            key={score} 
                            onClick={() => handleSelect(score)} 
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