import React, { useState, useRef, useCallback } from 'react';
import {
  handleDragOverEvent,
  handleDragEnterEvent,
  handleDragLeaveEvent,
  handleDropEvent,
  isDropzoneActivationKey,
} from '../utils/dropzoneHelper';

export interface FileDropzoneProps {
  onFileSelect: (file: File) => void;
  accept?: string;
  title?: string;
  subtitle?: string;
  activeTitle?: string;
  selectedFileName?: string | null;
  disabled?: boolean;
  className?: string;
  icon?: React.ReactNode;
}

export const FileDropzone: React.FC<FileDropzoneProps> = ({
  onFileSelect,
  accept = '.csv,text/csv,text/comma-separated-values,application/csv,application/vnd.ms-excel,text/plain',
  title = 'Click to browse or drag & drop schedule CSV',
  subtitle = 'Supports Date, Start Time, End Time, Location, Group, Home Team, Away Team',
  activeTitle = 'Drop your CSV file here',
  selectedFileName,
  disabled = false,
  className = '',
  icon,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    handleDragEnterEvent(e, dragCounterRef, setIsDragging, disabled);
  }, [disabled]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    handleDragOverEvent(e, { disabled, isDragging, setIsDragging });
  }, [disabled, isDragging]);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    handleDragLeaveEvent(e, dragCounterRef, setIsDragging, disabled);
  }, [disabled]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    handleDropEvent(e, dragCounterRef, setIsDragging, onFileSelect, disabled);
  }, [disabled, onFileSelect]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelect(file);
    }
    // Reset so the user can re-upload or select the same filename after edits
    e.target.value = '';
  }, [onFileSelect]);

  const handleClick = useCallback(() => {
    if (!disabled) {
      inputRef.current?.click();
    }
  }, [disabled]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isDropzoneActivationKey(e.key) && !disabled) {
      e.preventDefault();
      inputRef.current?.click();
    }
  }, [disabled]);

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={title}
      aria-disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative border-2 border-dashed rounded-2xl p-6 sm:p-8 text-center transition-all duration-150 select-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 ${
        isDragging
          ? 'border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-950/40 ring-4 ring-blue-500/20 scale-[1.01]'
          : 'border-slate-300 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-500 bg-slate-50/50 dark:bg-slate-950/50 hover:bg-slate-50/80 dark:hover:bg-slate-900/60'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleInputChange}
        onClick={e => e.stopPropagation()}
        disabled={disabled}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />

      {/* Content wrapper with pointer-events-none to prevent inner child element drag flicker */}
      <div className="pointer-events-none flex flex-col items-center justify-center">
        {isDragging ? (
          <>
            <div className="w-12 h-12 mb-3 text-blue-600 dark:text-blue-400 flex items-center justify-center bg-blue-100 dark:bg-blue-900/50 rounded-full animate-bounce shadow-sm">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </div>
            <p className="text-sm sm:text-base font-black text-blue-600 dark:text-blue-400 font-sans">
              {activeTitle}
            </p>
            <p className="text-xs text-blue-500/80 dark:text-blue-400/80 font-sans mt-0.5">
              Release to parse and preview schedule games
            </p>
          </>
        ) : (
          <>
            <div className="w-12 h-12 mb-3 text-slate-400 dark:text-slate-500 flex items-center justify-center bg-slate-100 dark:bg-slate-800 rounded-full transition-transform group-hover:scale-105">
              {icon || (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              )}
            </div>
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200 font-sans">
              {title}
            </p>
            {subtitle && (
              <p className="text-xs text-slate-500 dark:text-slate-400 font-sans mt-1 max-w-md">
                {subtitle}
              </p>
            )}

            {selectedFileName && (
              <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full text-xs font-bold font-sans">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="truncate max-w-[220px]">{selectedFileName}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
