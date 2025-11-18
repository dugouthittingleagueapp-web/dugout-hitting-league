import React from 'react';

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
  const handleSelect = (score: number) => {
    onChange(score);
  };

  const getValueColor = (v: number) => {
    switch(v) {
      case 0: return 'bg-slate-100 text-slate-400 border-slate-200';
      case 1: return 'bg-blue-50 text-blue-700 border-blue-200';
      case 2: return 'bg-green-50 text-green-700 border-green-200';
      case 3: return 'bg-orange-50 text-orange-700 border-orange-200';
      case 4: return 'bg-red-50 text-red-700 border-red-200';
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
                    <h3 className="text-lg font-bold text-slate-800">Enter Score</h3>
                </div>
                <div className="grid grid-cols-5 gap-2 sm:gap-3">
                    {[0, 1, 2, 3, 4].map((score) => (
                        <button key={score} onClick={() => handleSelect(score)} className={`aspect-square rounded-xl text-xl font-bold flex items-center justify-center transition-all active:scale-95 ${getValueColor(score)} ${value === score ? 'ring-4 ring-offset-2 ring-blue-400 shadow-lg scale-110' : 'hover:brightness-95 shadow-sm'}`}>
                            {score}
                        </button>
                    ))}
                </div>
                <button onClick={onClose} className="mt-6 w-full py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors">Cancel</button>
            </div>
        </div>
      )}
    </>
  );
};