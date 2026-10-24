// Seed script to generate complete 2025 archive data with teams, rosters, and completed matches
import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('.data/db.json');

// Helper to generate deterministic unique ID
let idCounter = 1000;
const genId = (prefix) => `${prefix}-${idCounter++}-${Math.random().toString(36).substring(2, 6)}`;

function createInning(num, homePids, awayPids, pHome, pAway) {
  const getPitches = (prob) => {
    // 10 pitches per player
    return Array.from({ length: 10 }, () => {
      const rand = Math.random();
      let pts = 0;
      if (rand < prob.four) pts = 4;
      else if (rand < prob.four + prob.three) pts = 3;
      else if (rand < prob.four + prob.three + prob.two) pts = 2;
      else if (rand < prob.four + prob.three + prob.two + prob.one) pts = 1;
      return { points: pts };
    });
  };

  return {
    number: num,
    home: {
      teamId: 'home',
      playerScores: homePids.map(pid => ({
        playerId: pid,
        pitches: getPitches(pHome)
      }))
    },
    away: {
      teamId: 'away',
      playerScores: awayPids.map(pid => ({
        playerId: pid,
        pitches: getPitches(pAway)
      }))
    }
  };
}

function createMatch(league, homeTeam, awayTeam, dateStr, homeProb, awayProb) {
  const homePids = homeTeam.players.slice(0, 3).map(p => p.id);
  const awayPids = awayTeam.players.slice(0, 3).map(p => p.id);

  const innings = [1, 2, 3, 4, 5, 6].map(num => 
    createInning(num, homePids, awayPids, homeProb, awayProb)
  );

  return {
    id: genId('match'),
    league,
    season: '2025',
    home_team_id: homeTeam.id,
    away_team_id: awayTeam.id,
    date: dateStr,
    is_complete: true,
    innings,
    created_at: dateStr
  };
}

// 1. Teams Definition
const teams10u = [
  {
    id: 'team-10u-1',
    name: 'Iron Pigs',
    league: '10u',
    season: '2025',
    players: [
      { id: 'p-10u-1', name: 'Liam', lastName: 'Davis' },
      { id: 'p-10u-2', name: 'Noah', lastName: 'Martinez' },
      { id: 'p-10u-3', name: 'Lucas', lastName: 'Wilson' }
    ],
    subs: [{ id: 'p-10u-4', name: 'Mason', lastName: 'Taylor' }]
  },
  {
    id: 'team-10u-2',
    name: 'Mudcats',
    league: '10u',
    season: '2025',
    players: [
      { id: 'p-10u-5', name: 'Ethan', lastName: 'Miller' },
      { id: 'p-10u-6', name: 'Oliver', lastName: 'Anderson' },
      { id: 'p-10u-7', name: 'Elijah', lastName: 'Thomas' }
    ],
    subs: [{ id: 'p-10u-8', name: 'Logan', lastName: 'White' }]
  },
  {
    id: 'team-10u-3',
    name: 'River Bandits',
    league: '10u',
    season: '2025',
    players: [
      { id: 'p-10u-9', name: 'Aiden', lastName: 'Jackson' },
      { id: 'p-10u-10', name: 'Jackson', lastName: 'Harris' },
      { id: 'p-10u-11', name: 'Carter', lastName: 'Martin' }
    ],
    subs: []
  },
  {
    id: 'team-10u-4',
    name: 'Grasshoppers',
    league: '10u',
    season: '2025',
    players: [
      { id: 'p-10u-12', name: 'Benjamin', lastName: 'Clark' },
      { id: 'p-10u-13', name: 'James', lastName: 'Lewis' },
      { id: 'p-10u-14', name: 'Alexander', lastName: 'Robinson' }
    ],
    subs: []
  }
];

const teams12u = [
  {
    id: 'team-12u-1',
    name: 'Sluggers',
    league: '12u',
    season: '2025',
    players: [
      { id: 'p-12u-1', name: 'Jake', lastName: 'Thompson' },
      { id: 'p-12u-2', name: 'Ryan', lastName: 'Cooper' },
      { id: 'p-12u-3', name: 'Sam', lastName: 'Miller' }
    ],
    subs: [{ id: 'p-12u-4', name: 'Tyler', lastName: 'Brooks' }]
  },
  {
    id: 'team-12u-2',
    name: 'Sandlot Kings',
    league: '12u',
    season: '2025',
    players: [
      { id: 'p-12u-5', name: 'Cole', lastName: 'Davis' },
      { id: 'p-12u-6', name: 'Dylan', lastName: 'Reed' },
      { id: 'p-12u-7', name: 'Max', lastName: 'Johnson' }
    ],
    subs: []
  },
  {
    id: 'team-12u-3',
    name: 'Diamondbacks',
    league: '12u',
    season: '2025',
    players: [
      { id: 'p-12u-8', name: 'Austin', lastName: 'Hayes' },
      { id: 'p-12u-9', name: 'Luke', lastName: 'Phillips' },
      { id: 'p-12u-10', name: 'Chase', lastName: 'Bennett' }
    ],
    subs: []
  },
  {
    id: 'team-12u-4',
    name: 'Blue Jays',
    league: '12u',
    season: '2025',
    players: [
      { id: 'p-12u-11', name: 'Owen', lastName: 'Parker' },
      { id: 'p-12u-12', name: 'Wyatt', lastName: 'Evans' },
      { id: 'p-12u-13', name: 'Caleb', lastName: 'Morris' }
    ],
    subs: []
  }
];

const teamsVarsity = [
  {
    id: 'team-var-1',
    name: 'Thunder',
    league: 'Varsity',
    season: '2025',
    players: [
      { id: 'p-var-1', name: 'Marcus', lastName: 'Vance' },
      { id: 'p-var-2', name: 'Derek', lastName: 'Cole' },
      { id: 'p-var-3', name: 'Travis', lastName: 'Young' }
    ],
    subs: [{ id: 'p-var-4', name: 'Nathan', lastName: 'Cross' }]
  },
  {
    id: 'team-var-2',
    name: 'Knights',
    league: 'Varsity',
    season: '2025',
    players: [
      { id: 'p-var-5', name: 'Justin', lastName: 'Ward' },
      { id: 'p-var-6', name: 'Brandon', lastName: 'Lee' },
      { id: 'p-var-7', name: 'Kyle', lastName: 'Sanchez' }
    ],
    subs: []
  },
  {
    id: 'team-var-3',
    name: 'Vipers',
    league: 'Varsity',
    season: '2025',
    players: [
      { id: 'p-var-8', name: 'Brett', lastName: 'Peterson' },
      { id: 'p-var-9', name: 'Trevor', lastName: 'Hall' },
      { id: 'p-var-10', name: 'Garrett', lastName: 'Diaz' }
    ],
    subs: []
  },
  {
    id: 'team-var-4',
    name: 'Outlaws',
    league: 'Varsity',
    season: '2025',
    players: [
      { id: 'p-var-11', name: 'Colin', lastName: 'Foster' },
      { id: 'p-var-12', name: 'Hunter', lastName: 'Kelly' },
      { id: 'p-var-13', name: 'Zach', lastName: 'Simmons' }
    ],
    subs: []
  }
];

const all2025Teams = [...teams10u, [...teams12u], [...teamsVarsity]].flat();

// Match generation for each division
const dates2025 = [
  '2025-10-06T18:00:00.000Z', // Week 1
  '2025-10-13T18:00:00.000Z', // Week 2
  '2025-10-20T18:00:00.000Z', // Week 3
  '2025-10-27T18:00:00.000Z', // Week 4
  '2025-11-03T18:00:00.000Z', // Week 5
  '2025-11-10T18:00:00.000Z'  // Week 6
];

const probs = {
  high: { four: 0.15, three: 0.22, two: 0.28, one: 0.18 }, // ~65% hit rate
  mid: { four: 0.10, three: 0.18, two: 0.25, one: 0.20 },  // ~55% hit rate
  low: { four: 0.06, three: 0.14, two: 0.22, one: 0.22 }   // ~45% hit rate
};

function generateDivisionMatches(divName, teams) {
  return [
    createMatch(divName, teams[0], teams[1], dates2025[0], probs.high, probs.mid),
    createMatch(divName, teams[2], teams[3], dates2025[0], probs.mid, probs.low),
    createMatch(divName, teams[0], teams[2], dates2025[1], probs.high, probs.low),
    createMatch(divName, teams[1], teams[3], dates2025[1], probs.mid, probs.mid),
    createMatch(divName, teams[0], teams[3], dates2025[2], probs.high, probs.mid),
    createMatch(divName, teams[1], teams[2], dates2025[2], probs.high, probs.low)
  ];
}

const all2025Matches = [
  ...generateDivisionMatches('10u', teams10u),
  ...generateDivisionMatches('12u', teams12u),
  ...generateDivisionMatches('Varsity', teamsVarsity)
];

// Read existing DB
let existingDb = {
  settings: {
    admin_password: 'admin',
    umpire_password: 'umpire',
    current_season: '2026',
    available_seasons: ['2026', '2025']
  },
  leagues: [
    { id: '10u', season: '2025', created_at: '2025-01-01T00:00:00.000Z' },
    { id: '12u', season: '2025', created_at: '2025-01-01T00:00:00.000Z' },
    { id: 'Varsity', season: '2025', created_at: '2025-01-01T00:00:00.000Z' },
    { id: '10u', season: '2026', created_at: '2026-10-19T16:19:00.000Z' },
    { id: '12u', season: '2026', created_at: '2026-10-19T16:19:00.000Z' },
    { id: 'Varsity', season: '2026', created_at: '2026-10-19T16:19:00.000Z' }
  ],
  teams: [],
  matches: []
};

try {
  if (fs.existsSync(dbPath)) {
    existingDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  }
} catch (e) {}

// Retain any existing 2026 teams/matches if user created them, replace/seed 2025
const teams2026 = (existingDb.teams || []).filter(t => t.season === '2026');
const matches2026 = (existingDb.matches || []).filter(m => m.season === '2026');

existingDb.teams = [...all2025Teams, ...teams2026];
existingDb.matches = [...all2025Matches, ...matches2026];

// Ensure 2025 and 2026 divisions exist
const existingLeagues = existingDb.leagues || [];
['2025', '2026'].forEach(s => {
  ['10u', '12u', 'Varsity'].forEach(id => {
    if (!existingLeagues.some(l => l.id.toLowerCase() === id.toLowerCase() && l.season === s)) {
      existingLeagues.push({ id, season: s, created_at: `${s}-01-01T00:00:00.000Z` });
    }
  });
});
existingDb.leagues = existingLeagues;

// Ensure settings
existingDb.settings = {
  ...existingDb.settings,
  current_season: existingDb.settings?.current_season || '2026',
  available_seasons: Array.from(new Set([...(existingDb.settings?.available_seasons || []), '2026', '2025'])).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
};

fs.writeFileSync(dbPath, JSON.stringify(existingDb, null, 2), 'utf8');
console.log(`Successfully seeded ${all2025Teams.length} 2025 teams and ${all2025Matches.length} 2025 matches!`);
