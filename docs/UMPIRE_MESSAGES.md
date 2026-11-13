# Umpire-facing messages — writing rules

Primary audience: high-school student umpires who are busy running a game and should not need technical knowledge.

**Always**
- State what happened in a calm, friendly sentence.
- Give just one clear next action. Prefer "Keep this page open," "Check your connection," "Pick another player," or "Ask the person running the league."
- Say a score is kept **on this device** when server saving is not confirmed, never falsely claim it is saved for everyone.
- Use a low-key blue notice for ordinary saving; reserve amber for an issue requiring adult help. Never show raw technical codes or stack traces.
- Do **not** suggest refreshing, closing the tab, clearing storage, logging out or recreating an official game while any scores are saved only locally.
- Do **not** include terms like PostgreSQL, Neon, server revision, synchronization, conflict, HTTP 409, JSON, auth token, or cache in umpire UI.
- Keep technical details in the console/logs for administrators and developers.

**Examples**
- Normal short save: "Saving 1 score… Your scores are kept on this device while they are sent. You can keep scoring."
- Connection lost: "The connection dropped for a moment. Keep this page open while the app tries again."
- Duplicate/stale pitch from second device: "Another score may have been entered for the same pitch. Keep this page open and ask the person running the league to check it with you."
- Lineup change that would delete recorded scores: "This player already has scores in this inning. Keep them in the lineup for now, or make the change at the start of the next inning."
- Finalization while pitch edits pending: "A few scores are still waiting to be sent. Keep this page open and check your internet connection."
- Device storage unavailable: "This score could not be saved on this device. Please stop scoring for a moment and ask the person running the league for help."

**Engineering requirements**
- Use `explainSaveError` or `explainPitchSyncIssue` in components. Never display `err.message`, raw API JSON or an HTTP code directly.
- Do not show a retry control for a confirmed same-pitch conflict; retry without reconciliation cannot help.
- Test for understandable language and no raw technical details, and independently test that actual data-loss risks still block unsafe actions.


## Consolidated review note (2026-11-12)
These guidelines apply to the stable full-match scoring/revision queue. The experimental per-pitch endpoints described in other branches are intentionally not enabled in this release candidate.
