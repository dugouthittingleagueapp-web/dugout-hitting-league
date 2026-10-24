# Automated Test Suite for Core Umpire Scoring Logic

A comprehensive, automated test suite utilizing **Vitest** for continuous testing of core umpire scoring rules, inning progression, 3v2 ghost mode attribution, multi-round tiebreaker mechanics, undo operations, and career batting statistic aggregations.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following decisions were clarified and confirmed with the user in Phase 1:
> - **Test Framework**: Vitest was selected for native, zero-config Vite and TypeScript integration without requiring duplicate Babel/ts-jest build steps.
> - **Test Coverage Scope**: Full coverage of all core rules: standard 3v3 (30 pitches/team), 2v2 (20 pitches/team), asymmetric 3v2 Ghost Mode (15 pitches per player with 11-15 attributed to Ghost), multi-round tiebreakers (5/3/1 pitch limits), cell editing/undo, and career statistics aggregation.
> - **Execution & CI Workflow**: Standard `npm test` script with continuous watch mode (`npm run test:watch`) and coverage reporting (`npm run test:coverage`), allowing seamless local development and automated CI/CD continuous validation.

---

## 1. Overview & Core Concept

### What It Does
1. **Automated Inning & Match Scoring Verification**: Tests pitch validation (0 to 4 point scale), inning totals calculation, match completion triggers, and automatic advance upon completing regulation innings.
2. **Ghost Mode Rule Enforcement**: Formally tests the 3v2 short-handed team dynamics where a 2-player team receives 15 pitches each (30 total), verifying that pitches 1–10 attribute to the individual player while pitches 11–15 attribute to the team's Ghost Player 3.
3. **Tiebreaker Ladder Verification**: Validates extra-inning tiebreaker rounds (Round 1: 5 pitches; Round 2: 3 pitches; Round 3+: sudden-death 1 pitch), player nomination, and point rollups into total team and match scores.
4. **Data Aggregation Integrity**: Ensures `calculateMatchStats`, `getTeamStats`, and `getPlayerCareerSummary` accurately tabulate hits (4s, 3s, 2s, 1s), total points, pitches seen, hit percentages, and points per pitch across single matches and multi-year archives.

### Target Audience & Persona
- **Developers & Maintainers**: Can continuously run `npm test` during development and refactoring with instant feedback.
- **League Umpires & Scorers**: Guaranteed consistent rule enforcement without scoring calculation regressions.

---

## 2. User Experience & Visual Design

### Test Execution & CLI Output Experience

```
 ✓ tests/scoring/inningScoring.test.ts (6 tests)
   ✓ calculates individual player pitch points correctly
   ✓ calculates team inning score from player scores
   ✓ prevents points outside the 0-4 range
   ✓ handles undo on active pitch by reverting to null
   ✓ detects when all regulation innings are complete
   ✓ triggers tiebreaker check on tied regulation score

 ✓ tests/scoring/ghostMode.test.ts (5 tests)
   ✓ generates 15 pitch slots for 2-player team facing 3-player team
   ✓ attributes pitches 1-10 to the active player stats
   ✓ attributes pitches 11-15 to the team Ghost player
   ✓ correctly filters Ghost player out of public individual leaderboards
   ✓ counts Ghost points toward overall team match score

 ✓ tests/scoring/tieBreaker.test.ts (4 tests)
   ✓ creates 5-pitch Round 1 with nominated shooters
   ✓ advances to 3-pitch Round 2 if Round 1 remains tied
   ✓ advances to 1-pitch sudden death for Round 3+
   ✓ incorporates tiebreaker scores into team game total

 ✓ tests/stats/careerAggregation.test.ts (4 tests)
   ✓ aggregates career stats across multi-year seasons
   ✓ computes hit percentage and points per pitch accurately
   ✓ computes Career Totals and Season Averages summary rows

Test Files  4 passed (4)
     Tests  19 passed (19)
  Duration  450ms
```

### Visual & Interactive Integration
- **CLI Clean Output**: Instant Vitest console feedback with green checkmarks, detailed diffs on failure, and execution timing.
- **npm Scripts**:
  - `npm test`: Single-run continuous test execution (ideal for CI/CD and pre-commit checks).
  - `npm run test:watch`: Interactive watch mode that re-runs relevant tests on file edits.

---

## 3. Key Product Decisions & Trade-Offs

### Decision 1: Vitest vs. Jest
- **Chosen Approach**: Vitest (`vitest`).
- **Why**: Since this application is a Vite + TypeScript project, Vitest shares the existing `vite.config.ts`, resolves TypeScript paths effortlessly, requires no separate Babel or ts-jest transformation, and executes in milliseconds.
- **Alternatives Considered**: Jest. Rejected due to heavy configuration requirements and configuration divergence with Vite's modern ESM pipeline.

### Decision 2: Modular Test Suite Structure
- **Chosen Approach**: Group tests by functional domain:
  - `tests/scoring/inningScoring.test.ts`: Pitch recording, inning sums, regulation match flow, undo.
  - `tests/scoring/ghostMode.test.ts`: Asymmetric 3v2 pitch slots, 10 vs 5 pitch cutoff, ghost attribution.
  - `tests/scoring/tieBreaker.test.ts`: Extra innings, pitch limit ladder (5 -> 3 -> 1), shooter scores.
  - `tests/stats/careerAggregation.test.ts`: Cross-season batting cards, hit % and points/pitch math.
- **Why**: Keeps test files compact, readable, and directly mapped to the umpire rulebook sections.

---

## 4. Technical Architecture & Data Strategy

### System Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                        VITEST AUTOMATED TEST SUITE                     │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  [ CLI Command: npm test ]                                             │
│       │                                                                │
│       ▼                                                                │
│  [ vitest.config.ts ] ──> Shared Vite environment (happy-dom / node)   │
│       │                                                                │
│       ├──> [ 1. Inning Scoring Suite ] (tests/scoring/inningScoring)   │
│       │    ├── createEmptyInning (2v2 vs 3v3 pitch allocation)         │
│       │    ├── calculateTeamInningTotal (summation)                   │
│       │    └── regulation completion & tie detection                   │
│       │                                                                │
│       ├──> [ 2. Ghost Mode Suite ] (tests/scoring/ghostMode)           │
│       │    ├── 15-pitch generation for 2-player team                   │
│       │    ├── pitches 1-10 -> player; 11-15 -> ghost                  │
│       │    └── ghost player filtering in stats vs. team totals        │
│       │                                                                │
│       ├──> [ 3. Tiebreaker Suite ] (tests/scoring/tieBreaker)          │
│       │    ├── Round 1 (5 pitches), Round 2 (3), Round 3+ (1)          │
│       │    ├── Shooter pitch recording & score rollups                 │
│       │    └── Match winning condition                                 │
│       │                                                                │
│       └──> [ 4. Career Aggregation Suite ] (tests/stats/career)        │
│            ├── Multi-season normalization (2025 + 2026)                │
│            ├── Points per pitch (PPP) and Hit Percentage (Hit%)        │
│            └── Career Totals & Season Averages computation             │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### Detailed Test Specifications

#### Test Suite 1: Inning & Match Scoring Logic
- **Pitches per Inning**:
  - In 3v3 match: Each team has 3 players receiving 10 pitches (30 pitches/team/inning).
  - In 2v2 match: Each team has 2 players receiving 10 pitches (20 pitches/team/inning).
- **Point Values**:
  - Accept valid values: `0`, `1`, `2`, `3`, `4`.
  - Empty pitches represented as `null`.
- **Inning Totals & Game Totals**:
  - Sum individual pitch points accurately across 6 regulation innings.
- **Undo Operation**:
  - Calling undo on pitch `n` sets pitch `n` to `null` while preserving preceding pitches.

#### Test Suite 2: 3v2 Ghost Mode Mechanics
- **Asymmetric Generation**:
  - When Home has 3 players and Away has 2 players: Away players receive 15 pitches each; Home receives 10 pitches each.
- **Stats Split**:
  - For Away players: pitches 1–10 accumulate to their individual stats (hits and totalPoints).
  - Pitches 11–15 accumulate to `ghost-<awayTeamId>`.
- **Filtering**:
  - Ghost stats are included in team match totals.
  - Ghost stats (`ghost-*`) are strictly excluded from individual player leaderboards.

#### Test Suite 3: Tiebreaker Ladder Logic
- **Round Initiation**:
  - When regulation 6 innings end in a tie, tiebreaker round is initiated.
- **Pitch Limit Step-Down**:
  - Round 1 allocates 5 pitches per shooter.
  - Round 2 allocates 3 pitches per shooter.
  - Round 3+ allocates 1 pitch per shooter.
- **Rollup**:
  - Tiebreaker scores roll up into team game total and player total stats.

#### Test Suite 4: Career Stats & Metric Accuracy
- **Formula Checks**:
  - `Points Per Pitch (PPP)` = `totalPoints / pitchesSeen` rounded to 2 decimals.
  - `Hit Percentage (Hit%)` = `(hits4 + hits3 + hits2 + hits1) / pitchesSeen * 100` rounded to 1 decimal.
- **Cross-Season Linking**:
  - Matches across 2025 and 2026 for the same player name merge into single multi-year summary with accurate Career Totals and Season Averages.

---

## 5. Execution Steps (Post-Approval)

1. **Install Dependencies**:
   - Install `vitest` and `@vitest/coverage-v8` via `install_applet_package`.
2. **Configure Vitest**:
   - Add `test` and `test:watch` scripts to `package.json`.
   - Configure `vitest.config.ts`.
3. **Implement Test Suites**:
   - Create `tests/scoring/inningScoring.test.ts`
   - Create `tests/scoring/ghostMode.test.ts`
   - Create `tests/scoring/tieBreaker.test.ts`
   - Create `tests/stats/careerAggregation.test.ts`
4. **Run & Verify**:
   - Execute `npm test` and verify that all 19+ test cases pass cleanly.
