import React, { useState, useEffect } from 'react';

interface ScoreInputProps {
  pitchNumber: number;
  value: number | null;
  onChange: (val: number) => void;
  readOnly?: boolean;
  isEditing: boolean;
  onOpen: () => void;
  onClose: () => void;
}

export const ScoreInput: React.FC<ScoreInputProps> = ({ pitchNumber, value, onChange, readOnly = false, isEditing, onOpen, onClose }) => {
  // Local state to track selection BEFORE confirming (only used when editing existing scores)
  const [localValue, setLocalValue] = useState<number | null>(value);

  // Sync local state when the modal opens or the prop changes
  useEffect(() => {
    if (isEditing) {
      setLocalValue(value);
    }
  }, [isEditing, value]);

  const handleSelect = (score: number) => {
    if (value !== null) {
      // Edit Mode: Update visual selection only, wait for Enter
      setLocalValue(score);
    } else {
      // New Entry Mode: Commit immediately for speed
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
      case 0: return 'bg-slate-200 text-slate-500 border-slate-300'; // Darker grey
      case 1: return 'bg-cyan-100 text-cyan-800 border-cyan-200';   // Distinct Cyan/Blue
      case 2: return 'bg-green-100 text-green-800 border-green-200'; // Green
      case 3: return 'bg-amber-100 text-amber-800 border-amber-300'; // Gold/Orange
      case 4: return 'bg-rose-100 text-rose-800 border-rose-300';    // Red/Rose
      default: return 'bg-white border-slate-200';
    }
  };

  return (
    <>
      <div className="flex flex-col items-center gap-1 min-w-[40px]">
        <div className="bg-slate-200 text-slate-500 text-[10px] font-bold px-1.5 rounded-full select-none">{pitchNumber}</div>
        <button
          disabled={readOnly}
          onClick={() => !readOnly && onOpen()}
          className={`w-10 h-12 rounded-lg flex items-center justify-center text-lg font-bold shadow-sm border-2 transition-all duration-150 ${value !== null ? getValueColor(value) : 'border-dashed border-slate-300 hover:border-slate-400 bg-slate-50 text-slate-300'}`}
        >
          {value !== null ? value : '-'}
        </button>
      </div>
      {isEditing && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
            <div className="bg-white p-6 rounded-2xl shadow-2xl w-[90%] max-w-xs transform scale-100 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                <div className="text-center mb-6">
                    <div className="inline-block bg-blue-100 text-blue-700 text-xs font-bold px-2 py-1 rounded-full mb-2">Pitch #{pitchNumber}</div>
                    <h3 className="text-lg font-bold text-slate-800">{value !== null ? 'Edit Score' : 'Enter Score'}</h3>
                </div>
                <div className="grid grid-cols-5 gap-2 sm:gap-3">
                    {[0, 1, 2, 3, 4].map((score) => {
                        // In edit mode, highlight based on localValue. In new mode, highlight matches nothing (until click).
                        const isSelected = value !== null ? localValue === score : value === score;
                        return (
                          <button key={score} onClick={() => handleSelect(score)} className={`aspect-square rounded-xl text-xl font-bold flex items-center justify-center transition-all active:scale-95 ${getValueColor(score)} ${isSelected ? 'ring-4 ring-offset-2 ring-blue-400 shadow-lg scale-110' : 'hover:brightness-95 shadow-sm'}`}>
                              {score}
                          </button>
                        );
                    })}
                </div>
                {value !== null ? (
                   <button onClick={handleEnter} className="mt-6 w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 transition-colors">Enter</button>
                ) : (
                   <button onClick={onClose} className="mt-6 w-full py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors">Cancel</button>
                )}
            </div>
        </div>
      )}
    </>
  );
};