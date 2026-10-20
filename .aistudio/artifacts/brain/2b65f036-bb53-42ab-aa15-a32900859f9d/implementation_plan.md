# Implementation Plan: Hands-Free Voice Scoring & Admin Roster Import

Integrate **hands-free voice scoring** for umpires (operating simultaneously alongside standard touch buttons) and a **multi-option roster import** (paste raw text, upload CSV spreadsheet, or upload a photo/screenshot) for the league admin.

---

## User Review Required

> [!IMPORTANT]
> **Voice Scoring Rules:**
> - Strictly constrained to numbers (`0`, `1`, `2`, `3`, `4`) and `Undo`.
> - Controlled by a visible **Mic On / Mic Off** toggle switch on the scoreboard.
> - Both voice scoring and touch buttons will remain active at the same time—the umpire can speak or tap interchangeably.
> - Soft audio/haptic confirmation chime so the umpire knows a pitch registered without having to stare at the screen.

> [!IMPORTANT]
> **Admin Roster Import:**
> - Supports **Paste Text** (unstructured names or lists from email/notes), **Upload CSV/Excel file**, and **Upload Photo/Screenshot** (scanned paper signup sheets or images).
> - Includes an **interactive preview table** before saving so the admin can verify, edit, or adjust names and league assignments before committing to the database.

---

## Proposed Changes

### 1. Permissions & AI SDK (`metadata.json`, `package.json`)
- Add `"microphone"` permission to `requestFramePermissions` in `metadata.json` for in-iframe browser speech recognition.
- Add `"MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API"` to `majorCapabilities` in `metadata.json`.
- Install `@google/genai` for backend multimodal photo/image roster parsing.

### 2. Hands-Free Voice Scoring Hook (`hooks/useVoiceScoring.ts`)
- Implement a browser `SpeechRecognition` hook with automatic reconnect handling when active.
- Speech grammar mapping:
  - `"0"`, `"zero"`, `"miss"`, `"out"` &rarr; `0`
  - `"1"`, `"one"`, `"single"` &rarr; `1`
  - `"2"`, `"two"`, `"double"` &rarr; `2`
  - `"3"`, `"three"`, `"triple"` &rarr; `3`
  - `"4"`, `"four"`, `"home run"` &rarr; `4`
  - `"undo"`, `"back"` &rarr; triggers Undo on the active cell
- Provide subtle Web Audio API tick/chime confirmation for recognized inputs.

### 3. Scoreboard Integration (`components/Scoreboard.tsx`)
- Add a mic toggle button (`Voice Scoring: ON / OFF`) in the umpire toolbar.
- When enabled, spoken numbers automatically trigger `handleScoreUpdate` on the active pitch cell and auto-advance to the next pitch, while standard touch scoring remains fully functional.
- Spoken `"undo"` immediately triggers `handleUndo`.

### 4. Server-Side Multimodal Roster Parser (`api/parse-roster.ts`)
- Serverless API route using Gemini 2.5 Flash with structured JSON output.
- Accepts base64 image data or unformatted text paste and returns parsed teams and player rosters:
  ```json
  [
    {
      "teamName": "Thunderbirds",
      "league": "12U",
      "players": [
        { "name": "Tommy", "lastName": "Davis" },
        { "name": "Jackson", "lastName": "Lee" },
        { "name": "Chris", "lastName": "Ray" }
      ],
      "subs": []
    }
  ]
  ```

### 5. Multi-Option Roster Import Modal (`components/RosterImportModal.tsx`)
- Tabbed interface accessible by Admin in the Teams view:
  1. **Paste Text**: Quick text area supporting lists, emails, or comma-separated player names.
  2. **CSV File**: File dropzone for spreadsheets.
  3. **Photo / Screenshot**: File upload for camera photos of paper sheets or phone screenshots.
- **Review & Confirm Screen**: Shows parsed teams and players in editable rows before saving, allowing the admin to tweak any misspelled name or reassign teams before batch insertion.

### 6. App Integration (`App.tsx`, `services/storageService.ts`)
- Add batch team creation helper `createTeamsBatch` in `storageService.ts`.
- Add "Import Rosters" button in the Admin Teams dashboard.

---

## Verification Plan

### Automated & Build Verification
- Compile applet with `compile_applet`.
- Verify TypeScript types and build assets.

### Manual Feature Walkthrough
1. **Voice Scoring:**
   - Open any match as an umpire.
   - Toggle microphone ON.
   - Speak numbers `"0"`, `"2"`, `"3"`, `"1"`; verify scores fill and auto-advance immediately.
   - Speak `"undo"`; verify last pitch score clears and rewinds cell focus.
   - Tap buttons while voice is ON; verify touch and voice work simultaneously without conflict.
2. **Roster Import:**
   - Log in as admin, go to Teams tab, click "Import Roster".
   - Test **Paste Text**: Paste raw player list and confirm preview parsing.
   - Test **CSV Upload**: Upload a sample CSV and verify columns map correctly.
   - Test **Photo Upload**: Upload a sample roster screenshot and verify Gemini extracts names cleanly.
   - Click "Save All" and confirm teams appear in the selected league and season.
