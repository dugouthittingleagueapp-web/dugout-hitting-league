# Removal of Voice Scoring

## Overview
All voice recognition logic, Web Speech API hooks, mic UI controls, and voice test suites have been completely removed. The live scoreboard and pitch score entry modals now rely solely on standard, instantaneous manual tap/click controls (0, 1, 2, 3, 4, and Undo) with tactile vibration haptics preserved.

## Changes Made
- **Removed voice recognition hook & parser**: Deleted `hooks/useVoiceScoring.ts` and pruned the empty `hooks/` directory.
- **Removed voice test suite**: Deleted `tests/scoring/voiceRecognition.test.ts`.
- **Created dedicated feedback utility**: Created `utils/feedback.ts` preserving mobile vibration haptic feedback (`triggerHaptic`) for responsive manual scoring without speech overhead or microphone permissions.
- **Cleaned `ScoreInput` modal**:
  - Removed voice props (`voiceEnabled`, `onToggleVoice`, `lastHeard`).
  - Removed the microphone toggle button and voice status banner from inside the modal.
  - Kept tactile buttons for 0, 1, 2, 3, 4, Undo, Cancel, and Update.
- **Cleaned `Scoreboard` component**:
  - Removed `useVoiceScoring` hook, permissions error banner, and live Voice HUD banner.
  - Removed microphone toggle from the scoreboard header.
  - Removed automated target navigation logic that was only used by speech input.
- **Verification**:
  - All test suites passing (`npm test`).
  - TypeScript check passing (`tsc --noEmit`).
  - App compiled successfully (`npm run build`).
