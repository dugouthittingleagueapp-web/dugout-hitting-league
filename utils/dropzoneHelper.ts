/**
 * Cross-browser & cross-device drag-and-drop file helper utilities.
 */

export interface DragEventLike {
  preventDefault: () => void;
  stopPropagation: () => void;
  dataTransfer?: {
    dropEffect?: string;
    items?: { length: number; [index: number]: any } | null;
    files?: { length: number; [index: number]: any } | null;
  } | null;
}

/**
 * Handles onDragOver: explicitly prevents browser defaults and sets dropEffect to 'copy'.
 * Required by Chrome, Safari, Edge, and Firefox to allow file dropping without opening the file.
 */
export const handleDragOverEvent = (
  e: DragEventLike,
  options?: { disabled?: boolean; isDragging?: boolean; setIsDragging?: (val: boolean) => void }
): void => {
  e.preventDefault();
  e.stopPropagation();

  if (options?.disabled) return;

  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'copy';
  }

  if (options?.setIsDragging && !options.isDragging) {
    options.setIsDragging(true);
  }
};

/**
 * Handles onDragEnter: tracks drag depth across nested children to avoid flicker.
 */
export const handleDragEnterEvent = (
  e: DragEventLike,
  counterRef: { current: number },
  setIsDragging: (val: boolean) => void,
  disabled?: boolean
): void => {
  e.preventDefault();
  e.stopPropagation();

  if (disabled) return;

  counterRef.current += 1;
  // Safari and some Firefox drag sources may not populate dataTransfer.items
  // until drop. The drag-enter event itself is sufficient to show feedback.
  setIsDragging(true);
};

/**
 * Handles onDragLeave: decrements drag counter and clears active state when exiting dropzone.
 */
export const handleDragLeaveEvent = (
  e: DragEventLike,
  counterRef: { current: number },
  setIsDragging: (val: boolean) => void,
  disabled?: boolean
): void => {
  e.preventDefault();
  e.stopPropagation();

  if (disabled) return;

  counterRef.current -= 1;
  if (counterRef.current <= 0) {
    counterRef.current = 0;
    setIsDragging(false);
  }
};

/**
 * Handles onDrop: prevents browser navigation, extracts the dropped file, and forwards to callback.
 */
export const handleDropEvent = (
  e: DragEventLike,
  counterRef: { current: number },
  setIsDragging: (val: boolean) => void,
  onFileSelect: (file: File) => void,
  disabled?: boolean
): void => {
  e.preventDefault();
  e.stopPropagation();

  counterRef.current = 0;
  setIsDragging(false);

  if (disabled) return;

  const rawFiles = e.dataTransfer?.files;
  if (rawFiles && rawFiles.length > 0) {
    const file = rawFiles[0];
    onFileSelect(file as File);
  }
};

/**
 * Keyboard trigger check for accessible dropzones (Enter or Space).
 */
export const isDropzoneActivationKey = (key: string): boolean => {
  return key === 'Enter' || key === ' ';
};
