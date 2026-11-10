import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parsePitchChange, applyPitchChange } from './utils/pitchSync';
import { migrateCrushersInDbData } from './utils/crushersMigration';
import { signSessionToken, getAuthFromRequest, setSessionCookie, clearSessionCookie, comparePassword, hashPassword } from './api/auth';

function devApiPlugin(): Plugin {
  const dbFile = path.resolve(process.cwd(), '.data', 'db.json');

  const currentYearStr = String(new Date().getFullYear());
  const defaultData = {
    settings: {
      admin_password: 'admin',
      umpire_password: 'umpire',
      current_season: currentYearStr,
    },
    leagues: [
      { id: '10u', season: currentYearStr, created_at: new Date().toISOString() },
      { id: '12u', season: currentYearStr, created_at: new Date().toISOString() },
      { id: 'Varsity', season: currentYearStr, created_at: new Date().toISOString() },
    ],
    teams: [] as any[],
    matches: [] as any[],
  };

  const getDb = () => {
    try {
      const seedFile = path.resolve(process.cwd(), '.data', 'seedData.json');
      if (!fs.existsSync(dbFile)) {
        fs.mkdirSync(path.dirname(dbFile), { recursive: true });
        if (fs.existsSync(seedFile)) {
          const seedRaw = fs.readFileSync(seedFile, 'utf-8');
          fs.writeFileSync(dbFile, seedRaw, 'utf-8');
          return JSON.parse(seedRaw);
        }
        fs.writeFileSync(dbFile, JSON.stringify(defaultData, null, 2), 'utf-8');
        return defaultData;
      }
      const raw = fs.readFileSync(dbFile, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!parsed.settings) {
        parsed.settings = { ...defaultData.settings };
      }
      if (!parsed.settings.admin_password) parsed.settings.admin_password = 'admin';
      if (!parsed.settings.umpire_password) parsed.settings.umpire_password = 'umpire';
      
      // If teams are empty, automatically seed 2025 archive data
      if ((!parsed.teams || parsed.teams.length === 0) && fs.existsSync(seedFile)) {
        try {
          const seed = JSON.parse(fs.readFileSync(seedFile, 'utf-8'));
          if (seed.teams && seed.teams.length > 0) {
            parsed.teams = seed.teams;
            parsed.matches = seed.matches || [];
            if (seed.leagues) parsed.leagues = seed.leagues;
            saveDb(parsed);
          }
        } catch (e) {}
      }

      // Auto-Repair: ensure any duplicate C-C-Crushers is merged into C-C-Crushers!
      if (parsed.teams && parsed.teams.some((t: any) => t.name?.trim().toLowerCase() === 'c-c-crushers')) {
        const cleanup = migrateCrushersInDbData(parsed);
        if (cleanup.teamsMerged > 0 || cleanup.teamsRenamed > 0 || cleanup.matchesUpdated > 0) {
          saveDb(parsed);
        }
      }

      return parsed;
    } catch (e) {
      return defaultData;
    }
  };

  const saveDb = (data: any) => {
    try {
      fs.mkdirSync(path.dirname(dbFile), { recursive: true });
      fs.writeFileSync(dbFile, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error('[Dev API] Failed to write db.json:', e);
    }
  };

  const readBody = (req: any): Promise<any> => {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk: any) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          resolve({});
        }
      });
    });
  };

  const sendJson = (res: any, status: number, payload: any) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
  };

  return {
    name: 'dev-api-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api')) {
          return next();
        }

        const parsedUrl = new URL(req.url, 'http://localhost:3000');
        const pathname = parsedUrl.pathname;
        const query = Object.fromEntries(parsedUrl.searchParams.entries());
        const method = (req.method || 'GET').toUpperCase();
        const db = getDb();

        try {
          // 1. Settings Endpoint
          if (pathname === '/api/settings') {
            if (method === 'GET') {
              const currentSeason = db.settings?.current_season || '2026';
              const seasonsSet = new Set<string>();
              seasonsSet.add(currentSeason);
              seasonsSet.add('2026');
              seasonsSet.add('2025');
              if (Array.isArray(db.settings?.available_seasons)) {
                db.settings.available_seasons.forEach((s: any) => s && seasonsSet.add(String(s)));
              }
              (db.leagues || []).forEach((l: any) => l.season && seasonsSet.add(l.season));
              (db.teams || []).forEach((t: any) => t.season && seasonsSet.add(t.season));
              (db.matches || []).forEach((m: any) => m.season && seasonsSet.add(m.season));
              const seasons = Array.from(seasonsSet).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
              return sendJson(res, 200, { currentSeason, seasons });
            }
            if (method === 'POST') {
              const body = await readBody(req);
              if (body.action === 'verify') {
                const cleanPw = (body.password || '').trim();
                const adminPw = (db.settings?.admin_password || 'admin').trim();
                const umpirePw = (db.settings?.umpire_password || 'umpire').trim();
                let role: 'admin' | 'umpire' | null = null;
                if (await comparePassword(cleanPw, adminPw)) {
                  role = 'admin';
                } else if (await comparePassword(cleanPw, umpirePw)) {
                  role = 'umpire';
                }
                if (role) {
                  const token = signSessionToken(role);
                  setSessionCookie(res, token);
                  return sendJson(res, 200, { success: true, role, token });
                }
                return sendJson(res, 401, { success: false, error: 'Incorrect password' });
              }
              if (body.action === 'check_auth') {
                const auth = getAuthFromRequest(req);
                return sendJson(res, 200, { authenticated: auth.authenticated, role: auth.role });
              }
              if (body.action === 'logout') {
                clearSessionCookie(res);
                return sendJson(res, 200, { success: true });
              }
              if (body.action === 'update_password') {
                db.settings.admin_password = await hashPassword(body.password.trim());
                saveDb(db);
                return sendJson(res, 200, { success: true });
              }
              if (body.action === 'update_umpire_password') {
                db.settings.umpire_password = await hashPassword(body.password.trim());
                saveDb(db);
                return sendJson(res, 200, { success: true });
              }
              if (body.action === 'update_season') {
                const prevSeason = db.settings.current_season || String(new Date().getFullYear());
                const newSeason = body.season.trim();
                db.settings.current_season = newSeason;
                if (!Array.isArray(db.settings.available_seasons)) {
                  db.settings.available_seasons = [];
                }
                if (!db.settings.available_seasons.includes(prevSeason)) {
                  db.settings.available_seasons.push(prevSeason);
                }
                if (!db.settings.available_seasons.includes(newSeason)) {
                  db.settings.available_seasons.push(newSeason);
                }

                // Automatically rollover previous season's league divisions if new season is empty
                const existingInNewSeason = db.leagues.filter((l: any) => (l.season || prevSeason) === newSeason);
                if (existingInNewSeason.length === 0) {
                  const prevLeagues = db.leagues.filter((l: any) => (l.season || prevSeason) === prevSeason);
                  const source = prevLeagues.length > 0 ? prevLeagues : Array.from(new Set(db.leagues.map((l: any) => l.id))).map(id => ({ id }));
                  source.forEach((pl: any) => {
                    db.leagues.push({
                      id: pl.id,
                      season: newSeason,
                      created_at: new Date().toISOString(),
                    });
                  });
                }

                saveDb(db);
                return sendJson(res, 200, { success: true });
              }
              return sendJson(res, 400, { error: 'Invalid action' });
            }
          }

          // 2. Leagues Endpoint
          if (pathname === '/api/leagues') {
            const activeSeason = db.settings.current_season || String(new Date().getFullYear());
            if (method === 'GET') {
              const season = query.season;
              if (season) {
                const filtered = db.leagues.filter((l: any) => (l.season || activeSeason) === season);
                return sendJson(res, 200, filtered);
              }
              return sendJson(res, 200, db.leagues);
            }
            if (method === 'POST') {
              const body = await readBody(req);
              const cleanId = (body.id || '').trim();
              if (!cleanId) return sendJson(res, 400, { error: 'League ID is required' });
              const season = body.season || query.season || activeSeason;
              const existing = db.leagues.find((l: any) => l.id.toLowerCase() === cleanId.toLowerCase() && (l.season || activeSeason) === season);
              if (existing) {
                return sendJson(res, 200, existing);
              }
              const newLeague = { id: cleanId, season, created_at: new Date().toISOString() };
              db.leagues.push(newLeague);
              saveDb(db);
              return sendJson(res, 201, newLeague);
            }
            if (method === 'DELETE') {
              const id = query.id;
              const season = query.season;
              db.leagues = db.leagues.filter((l: any) => {
                if (season) return !(l.id === id && (l.season || activeSeason) === season);
                return l.id !== id;
              });
              db.teams = db.teams.filter((t: any) => {
                if (season) return !(t.league === id && (t.season || activeSeason) === season);
                return t.league !== id;
              });
              db.matches = db.matches.filter((m: any) => {
                if (season) return !(m.league === id && (m.season || activeSeason) === season);
                return m.league !== id;
              });
              saveDb(db);
              return sendJson(res, 200, { success: true });
            }
          }

          // 3. Teams Endpoint
          if (pathname === '/api/teams') {
            const activeSeason = db.settings.current_season || String(new Date().getFullYear());
            if (method === 'GET') {
              let teams = db.teams || [];
              if (query.league) {
                const targetLeague = query.league.trim().toLowerCase();
                teams = teams.filter((t: any) => t.league && t.league.trim().toLowerCase() === targetLeague);
              }
              if (query.season) {
                teams = teams.filter((t: any) => (t.season || (t.created_at && t.created_at.startsWith('2026') ? '2026' : '2025')) === query.season);
              }
              return sendJson(res, 200, teams);
            }
            if (method === 'POST') {
              const team = await readBody(req);
              const newTeam = {
                id: team.id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                name: team.name,
                league: team.league,
                season: team.season || activeSeason,
                players: team.players || [],
                subs: team.subs || [],
                created_at: new Date().toISOString(),
                row_version: '1',
              };
              db.teams.push(newTeam);
              saveDb(db);
              return sendJson(res, 201, newTeam);
            }
            if (method === 'PUT') {
              const team = await readBody(req);
              const idx = db.teams.findIndex((t: any) => t.id === team.id);
              if (idx !== -1) {
                db.teams[idx] = { ...db.teams[idx], ...team };
                saveDb(db);
                return sendJson(res, 200, db.teams[idx]);
              }
              return sendJson(res, 404, { error: 'Team not found' });
            }
            if (method === 'PATCH') {
              const body = await readBody(req);
              if (body.action === 'move_teams' && Array.isArray(body.teamIds)) {
                db.teams = db.teams.map((t: any) => {
                  if (body.teamIds.includes(t.id)) {
                    return { ...t, league: body.targetLeague };
                  }
                  return t;
                });
                saveDb(db);
                return sendJson(res, 200, { success: true });
              }
              return sendJson(res, 400, { error: 'Invalid action' });
            }
            if (method === 'DELETE') {
              const id = query.id;
              db.teams = db.teams.filter((t: any) => t.id !== id);
              saveDb(db);
              return sendJson(res, 200, { success: true });
            }
          }

          // Atomic scoring endpoint mirrors Vercel's single-pitch CAS behavior.
          if (pathname === '/api/pitch') {
            if (method !== 'PATCH') return sendJson(res, 405, { error: 'Only pitch updates are supported.' });
            const auth = getAuthFromRequest(req);
            if (!auth.authenticated || !['admin', 'umpire'].includes(auth.role || '')) {
              return sendJson(res, 403, { error: 'Sign in as an umpire or admin to save scores.' });
            }
            const change = parsePitchChange(await readBody(req));
            if (!change) return sendJson(res, 400, { error: 'Invalid pitch or score.' });
            const stripped = change.matchId.startsWith('practice-') ? change.matchId.slice(9) : change.matchId;
            const idx = db.matches.findIndex((m: any) => m.id === change.matchId || (m.id === stripped && m.is_practice));
            if (idx < 0) return sendJson(res, 404, { error: 'Game not found.' });
            const original = db.matches[idx];
            if ((original.is_complete || original.isComplete) && auth.role !== 'admin') {
              return sendJson(res, 403, { error: 'The game is final. Ask an admin to reopen it.' });
            }
            const model = {
              ...original,
              id: change.matchId,
              tieBreaker: original.tieBreaker || original.tie_breaker || []
            };
            const current = change.kind === 'regulation'
              ? model.innings?.[change.inningIdx]?.[change.side]?.playerScores?.[change.batterIdx]?.pitches?.[change.pitchIdx]?.points
              : model.tieBreaker?.[change.roundIdx]?.[change.side === 'home' ? 'homeScores' : 'awayScores']?.[change.pitchIdx];
            const recordedId = change.kind === 'regulation'
              ? model.innings?.[change.inningIdx]?.[change.side]?.playerScores?.[change.batterIdx]?.playerId
              : model.tieBreaker?.[change.roundIdx]?.[change.side === 'home' ? 'homePlayerId' : 'awayPlayerId'];
            if (current === undefined || current !== change.expectedPoints || recordedId !== change.playerId) {
              return sendJson(res, 409, { error: 'Another umpire changed this pitch or lineup. Your local score was not overwritten. Compare scores before retrying.' });
            }
            const updated = applyPitchChange(model, change);
            const rowVersion = String(Number(original.row_version || 1) + 1);
            db.matches[idx] = {
              ...original,
              innings: updated.innings,
              tie_breaker: updated.tieBreaker || original.tie_breaker,
              status: (original.is_complete || original.isComplete) ? original.status : 'IN_PROGRESS',
              row_version: rowVersion
            };
            saveDb(db);
            return sendJson(res, 200, { saved: true, rowVersion });
          }

          // 4. Matches Endpoint
          if (pathname === '/api/matches') {
            const activeSeason = db.settings.current_season || String(new Date().getFullYear());
            if (method === 'GET') {
              if (query.id) {
                const match = (db.matches || []).find((m: any) => m.id === query.id);
                if (!match) return sendJson(res, 404, { error: 'Match not found' });
                return sendJson(res, 200, { ...match, row_version: String(match.row_version || 1) });
              }
              let matches = db.matches || [];
              if (query.league) {
                const targetLeague = query.league.trim().toLowerCase();
                matches = matches.filter((m: any) => m.league && m.league.trim().toLowerCase() === targetLeague);
              }
              if (query.season) {
                matches = matches.filter((m: any) => (m.season || (m.date && m.date.startsWith('2026') ? '2026' : '2025')) === query.season);
              }
              if (query.excludePractice === 'true') {
                matches = matches.filter((m: any) => !m.is_practice && !m.isPractice);
              }
              if (query.revisions === 'true') {
                return sendJson(res, 200, matches.map((m: any) => ({
                  id: m.is_practice && !String(m.id).startsWith('practice-') ? `practice-${m.id}` : m.id,
                  revision: createHash('sha256').update(JSON.stringify(m)).digest('hex')
                })));
              }
              return sendJson(res, 200, matches.map((m: any) => ({
                ...m, row_version: String(m.row_version || 1)
              })));
            }
            if (method === 'POST') {
              const match = await readBody(req);
              const newMatch = {
                id: match.id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                league: match.league,
                home_team_id: match.homeTeamId || match.home_team_id,
                away_team_id: match.awayTeamId || match.away_team_id,
                date: match.date || new Date().toISOString(),
                is_complete: match.isComplete ?? match.is_complete ?? false,
                status: match.status || (match.isComplete ? 'FINAL' : 'SCHEDULED'),
                innings: match.innings || [],
                season: match.season || activeSeason,
                tie_breaker: match.tieBreaker || match.tie_breaker,
                location: match.location || null,
                start_time: match.startTime || match.start_time || null,
                end_time: match.endTime || match.end_time || null,
                notes: match.notes || null,
                is_practice: match.isPractice ?? match.is_practice ?? false,
                is_forfeit: match.isForfeit ?? match.is_forfeit ?? false,
                forfeiting_team_id: match.forfeitingTeamId || match.forfeiting_team_id || null,
                winning_team_id: match.winningTeamId || match.winning_team_id || null,
                forfeit_reason: match.forfeitReason || match.forfeit_reason || null,
                created_at: new Date().toISOString(),
              };
              db.matches.unshift(newMatch);
              saveDb(db);
              return sendJson(res, 201, newMatch);
            }
            if (method === 'PUT') {
              const match = await readBody(req);
              const idx = db.matches.findIndex((m: any) => m.id === match.id);
              if (idx !== -1) {
                const currentVersion = String(db.matches[idx].row_version || 1);
                if (typeof match.rowVersion !== 'string' || !/^[0-9]+$/.test(match.rowVersion)) {
                  return sendJson(res, 428, { error: 'Reopen this game to get the latest scores before saving.' });
                }
                if (match.rowVersion !== currentVersion) {
                  return sendJson(res, 409, { error: 'Another umpire updated this game. Nothing was overwritten. Refresh to review the scores.' });
                }
                db.matches[idx] = {
                  ...db.matches[idx],
                  ...match,
                  home_team_id: match.homeTeamId || match.home_team_id || db.matches[idx].home_team_id,
                  away_team_id: match.awayTeamId || match.away_team_id || db.matches[idx].away_team_id,
                  is_complete: match.isComplete !== undefined ? match.isComplete : db.matches[idx].is_complete,
                  status: match.status !== undefined ? match.status : (match.isComplete ? 'FINAL' : db.matches[idx].status),
                  tie_breaker: match.tieBreaker !== undefined ? match.tieBreaker : db.matches[idx].tie_breaker,
                  location: match.location !== undefined ? match.location : db.matches[idx].location,
                  start_time: (match.startTime || match.start_time) !== undefined ? (match.startTime || match.start_time) : db.matches[idx].start_time,
                  end_time: (match.endTime || match.end_time) !== undefined ? (match.endTime || match.end_time) : db.matches[idx].end_time,
                  notes: match.notes !== undefined ? match.notes : db.matches[idx].notes,
                  is_practice: match.isPractice !== undefined ? match.isPractice : (match.is_practice !== undefined ? match.is_practice : db.matches[idx].is_practice),
                  is_forfeit: match.isForfeit !== undefined ? match.isForfeit : (match.is_forfeit !== undefined ? match.is_forfeit : db.matches[idx].is_forfeit),
                  forfeiting_team_id: (match.forfeitingTeamId !== undefined || match.forfeiting_team_id !== undefined) ? (match.forfeitingTeamId || match.forfeiting_team_id) : db.matches[idx].forfeiting_team_id,
                  winning_team_id: (match.winningTeamId !== undefined || match.winning_team_id !== undefined) ? (match.winningTeamId || match.winning_team_id) : db.matches[idx].winning_team_id,
                  forfeit_reason: (match.forfeitReason !== undefined || match.forfeit_reason !== undefined) ? (match.forfeitReason || match.forfeit_reason) : db.matches[idx].forfeit_reason,
                  row_version: String(Number(currentVersion) + 1),
                };
                saveDb(db);
                return sendJson(res, 200, db.matches[idx]);
              }
              return sendJson(res, 404, { error: 'Match not found' });
            }
            if (method === 'DELETE') {
              const auth = getAuthFromRequest(req);
              if (auth.authenticated && auth.role === 'fan') {
                return sendJson(res, 403, { error: 'Forbidden: Insufficient permissions to delete matches.' });
              }
              const id = query.id;
              if (!id) return sendJson(res, 400, { error: 'Missing ID' });
              const rawId = String(id).trim();
              const strippedId = rawId.startsWith('practice-') ? rawId.slice('practice-'.length).trim() : rawId;
              const prefixedId = `practice-${strippedId}`;

              const targetMatch = db.matches.find((m: any) => {
                const mId = String(m.id || '').trim();
                return mId === rawId || mId === strippedId || mId === prefixedId;
              });

              if (!targetMatch) {
                return sendJson(res, 404, { error: 'Match not found' });
              }

              const isPracticeMatch = targetMatch.is_practice === true || targetMatch.isPractice === true;
              if (!isPracticeMatch) {
                console.warn(`[SECURITY WARNING] Attempted unauthorized deletion of official league match ID: ${targetMatch.id}. Rejecting with 403 Forbidden.`);
                return sendJson(res, 403, { 
                  error: 'Forbidden: Official league matches cannot be deleted. Only practice sessions can be removed.' 
                });
              }

              db.matches = db.matches.filter((m: any) => {
                const mId = String(m.id || '').trim();
                return mId !== rawId && mId !== strippedId && mId !== prefixedId;
              });
              saveDb(db);
              return sendJson(res, 200, { success: true });
            }
          }

          // 5. Parse Roster Endpoint (Gemini Multimodal / Text)
          if (pathname === '/api/parse-roster') {
            if (method === 'POST') {
              const body = await readBody(req);
              const parseHandler = (await import('./api/parse-roster.ts')).default;
              return parseHandler(
                { method: 'POST', body, query } as any,
                {
                  status: (code: number) => ({
                    json: (data: any) => sendJson(res, code, data),
                  }),
                } as any
              );
            }
          }

          if (pathname === '/api/admin/fix-crushers' || pathname === '/api/fix-crushers') {
            const cleanupResult = migrateCrushersInDbData(db);
            saveDb(db);
            return sendJson(res, 200, cleanupResult);
          }

          return sendJson(res, 404, { error: 'API route not found' });
        } catch (err: any) {
          console.error('[Dev API] Server error:', err);
          return sendJson(res, 500, { error: err.message });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devApiPlugin()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    strictPort: true,
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
        },
      },
    },
  },
  define: {
    'process.env.API_KEY': JSON.stringify(process.env.API_KEY),
  },
});
