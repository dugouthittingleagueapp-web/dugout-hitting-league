# Multi-Year Player Career Stats & Clean Season Rollover

A complete, production-grade system to aggregate and display multi-year player career batting statistics across all league seasons—modeled after traditional Baseball Reference / MLB career cards—while ensuring new season activation starts with fresh, empty rosters and zeroed match records without contaminating historical archives.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following decisions were clarified and confirmed with the user in Phase 1:
> - **Clickable Player Triggers**: Everywhere player names appear (leaderboards, box scores, match scorecards, and roster tables) will be clickable to open the player's multi-year career batting card.
> - **Career Batting Table Metrics**: Modeled directly after the user's uploaded reference image (without team logos), featuring columns for **Season, Division, Team, GP (Matches Played), Total Points, 4s, 3s, 2s, 1s, Pitches Seen, Pts/Pitch (efficiency), and Hit %**, completed with bold **Career Totals** and **Season Averages** summary rows.
> - **Clean Season Rollovers**: Activating a new season creates fresh blank division brackets with zero teams and zero matches. All past team rosters, match logs, and division standings remain strictly sealed inside their respective historical archives.

---

## 1. Overview & Core Concept

### What It Does
1. **Multi-Year Career Batting Card**: When a fan, umpire, or administrator clicks or taps any player's name anywhere in the application, a sleek modal opens displaying their comprehensive career batting history broken down year-by-year, followed by lifetime Career Totals and Season Averages.
2. **Cross-Season Player Normalization**: Automatically aggregates a player's statistics across all years they have competed, matching by player name across teams, divisions, and seasons.
3. **Pristine Season Rollover**: When an administrator activates a new season in the Admin Dashboard, the new season initializes with clean division brackets and zero teams/matches, ensuring no previous season data bleeds into the new year.

### Target Audience & Persona
- **Players & Parents**: Can see their development and lifetime performance year-over-year.
- **League Umpires & Scorers**: Can inspect historical performance directly from the scoreboard or lineup.
- **League Administrators**: Can advance the league into future years with one click without manually wiping teams or contaminating past archives.

---

## 2. User Experience & Visual Design

### Key User Flows

```
[ Leaderboard / Scoreboard / Team Roster ]
                   │
                   ▼ (Tap on any Player Name)
     [ Player Career Batting Modal ]
     ┌─────────────────────────────────────────────────────────┐
     │ ⚾ John Doe                         [Close ×]           │
     │ Career Batting Summary · Dugout Hitting League          │
     │ ─────────────────────────────────────────────────────── │
     │ Quick KPI Cards: [Career Pts: 480] [Pitches: 320] [Hit%: 74.2%]
     │                                                         │
     │ CAREER BATTING                                          │
     │ ┌──────┬──────────┬───────────┬────┬─────┬───┬───┬───┬...
     │ │SEASON│ DIVISION │ TEAM      │ GP │ PTS │ 4s│ 3s│ 2s│...
     │ ├──────┼──────────┼───────────┼────┼─────┼───┼───┼───┼...
     │ │ 2025 │ 12u      │ Sluggers  │ 6  │ 210 │ 12│ 24│ 30│...
     │ │ 2026 │ Varsity  │ Thunder   │ 8  │ 270 │ 18│ 32│ 38│...
     │ ├──────┼──────────┼───────────┼────┼─────┼───┼───┼───┼...
     │ │Career│          │ 2 Seasons │ 14 │ 480 │ 30│ 56│ 68│...
     │ │Season Averages  │           │ 7  │ 240 │ 15│ 28│ 34│...
     │ └──────┴──────────┴───────────┴────┴─────┴───┴───┴───┴...
     └─────────────────────────────────────────────────────────┘
```

### Visual Identity & Theme
- **Baseball Reference Inspiration**: Clear, clean horizontal tabular data with subtle zebra striping, sticky header, and distinct summary footer rows.
- **No Logo Clutter**: Following user guidance, team and division names are displayed as crisp, high-contrast typography rather than external logos or heavy graphics.
- **Responsive Layout**: Designed mobile-first with smooth horizontal scrolling on phone screens (`overflow-x-auto`) and a sticky first column (`sticky left-0 bg-white dark:bg-slate-900`) so the player's year and team are always visible while swiping right.
- **Typography & Numeral Math**: All numerical columns use `tabular-nums font-mono text-right` for vertical alignment. Display headers use `Plus Jakarta Sans` with bold weights.

---

## 3. Key Product Decisions & Trade-Offs

### Decision 1: Player Identity Resolution Across Seasons
- **Chosen Approach**: Resolve career identity using normalized player names (`firstName + lastName` trimmed and case-insensitive).
- **Why**: Players may be assigned different UUIDs if rosters are re-entered or imported from text in different years. Name-based aggregation ensures an athlete who played in 2025 as a 12u player and in 2026 as a Varsity player has their full multi-year record seamlessly linked.
- **Alternative Considered**: UUID-only matching. Rejected because each annual roster creation generates new unique player IDs, which would fragment career records.

### Decision 2: Clean Season Rollover Semantics
- **Chosen Approach**: When `update_season` is called with a new year:
  - Copy division categories (e.g. `10u`, `12u`, `Varsity`) to the new season so the league structure is instantly ready.
  - Do NOT copy teams, players, or matches into the new season.
  - The new season starts completely fresh with 0 teams and 0 matches.
  - The Admin can then add or import fresh teams for the new season.
- **Why**: Teams change rosters and players age up into higher divisions every year. Carrying over old teams with 0 stats created stale placeholders. A clean slate respects the natural lifecycle of annual youth sports leagues.

---

## 4. Technical Architecture & Data Strategy

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         DUGOUT HITTING LEAGUE                            │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  [ UI Views & Triggers ]                                                 │
│    ├── Leaderboard Table (Player name links)                             │
│    ├── Match Box Score / Scoreboard (Lineup name links)                  │
│    └── Team Management / Roster List (Roster name links)                 │
│              │                                                           │
│              ▼                                                           │
│  [ Player Career Stats Aggregator ] (storageService.ts)                  │
│    ├── Fetches all teams across all seasons (`getAllTeams`)              │
│    ├── Fetches all matches across all seasons (`getAllMatches`)          │
│    ├── Filters matches where player participated (main roster or sub)    │
│    ├── Groups statistics by season & team & division                     │
│    └── Computes: GP, Total Pts, 4s, 3s, 2s, 1s, Pitches, Pts/Pit, Hit%   │
│              │                                                           │
│              ▼                                                           │
│  [ PlayerCareerModal Component ]                                         │
│    ├── Header: Player Name, Career Summary Pill, Year Span               │
│    ├── Table: Multi-Year Breakdown (2025, 2026, etc.)                    │
│    └── Summary Rows: Career Totals & Season Averages                     │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Data Structures

```typescript
export interface PlayerSeasonStatRow {
  season: string;
  leagueId: string;
  teamName: string;
  gamesPlayed: number;
  totalPoints: number;
  hits4: number;
  hits3: number;
  hits2: number;
  hits1: number;
  pitchesSeen: number;
  pointsPerPitch: number; // totalPoints / pitchesSeen
  hitPercentage: number;   // (hits4 + hits3 + hits2 + hits1) / pitchesSeen * 100
}

export interface PlayerCareerSummary {
  playerName: string;
  seasons: PlayerSeasonStatRow[];
  careerTotals: {
    seasonsCount: number;
    gamesPlayed: number;
    totalPoints: number;
    hits4: number;
    hits3: number;
    hits2: number;
    hits1: number;
    pitchesSeen: number;
    pointsPerPitch: number;
    hitPercentage: number;
  };
  seasonAverages: {
    gamesPlayed: number;
    totalPoints: number;
    hits4: number;
    hits3: number;
    hits2: number;
    hits1: number;
    pitchesSeen: number;
  };
}
```

### Implementation Steps

1. **Season Rollover Logic (`vite.config.ts` & `api/settings.ts`)**:
   - Update `update_season` action: ensure that when a new season is created, only league division definitions are populated. Do NOT duplicate teams or matches into the new season.
   - When moving teams between divisions in `update_teams`: ensure changes only affect the target team in its specific season, without altering past archived records.

2. **Career Statistics Service Method (`services/storageService.ts`)**:
   - Implement `getPlayerCareerStats(playerName: string): Promise<PlayerCareerSummary>`.
   - Normalizes names with `name + (lastName ? ' ' + lastName : '')`.
   - Iterates through all matches across all seasons where `isComplete` is true.
   - Calculates hit totals, pitch counts (with ghost mode isolation), games played, and averages.

3. **Career Batting Modal Component (`components/PlayerCareerModal.tsx`)**:
   - Dedicated modal component rendering the user's requested Baseball Reference style table.
   - Includes quick overview KPI summary, season-by-season rows, Career totals row, and Season Averages row.
   - Mobile responsive with horizontal scroll and sticky year column.

4. **Integration Across App Views (`App.tsx`, `Scoreboard.tsx`, `TeamManagement.tsx`)**:
   - Add `selectedCareerPlayer` state in `App.tsx`.
   - Wrap player names in clickable buttons with hover underlines across:
     - Dashboard season leaderboard table
     - Weekly leaderboard
     - Scoreboard box score and lineup table
     - Team management player rosters
   - Mount `PlayerCareerModal` via React Portal for seamless overlay on all screen sizes.
