
import type { VercelRequest, VercelResponse } from '@vercel/node';
import pool from './db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Ensure table exists with season
    await pool.query(`
      CREATE TABLE IF NOT EXISTS matches (
        id UUID PRIMARY KEY,
        league TEXT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
        home_team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
        away_team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
        date TIMESTAMPTZ NOT NULL,
        is_complete BOOLEAN DEFAULT FALSE,
        innings JSONB NOT NULL,
        season TEXT NOT NULL DEFAULT '2025',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Safe migration for existing tables without 'season'
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='season') THEN 
          ALTER TABLE matches ADD COLUMN season TEXT NOT NULL DEFAULT '2025'; 
        END IF; 
      END $$;
    `);

    if (req.method === 'GET') {
      const { league, id, season } = req.query;
      if (id) {
        const { rows } = await pool.query('SELECT * FROM matches WHERE id = $1', [id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
        return res.status(200).json(rows[0]);
      }

      let query = 'SELECT * FROM matches';
      const params: any[] = [];
      let paramCount = 1;
      
      // Build dynamic where clause
      const conditions = [];
      if (league) {
        conditions.push(`league = $${paramCount++}`);
        params.push(league);
      }
      if (season) {
        conditions.push(`season = $${paramCount++}`);
        params.push(season);
      }
      
      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }
      
      query += ' ORDER BY date DESC';
      const { rows } = await pool.query(query, params);
      return res.status(200).json(rows);
    } 
    else if (req.method === 'POST') {
      const { id, league, homeTeamId, awayTeamId, date, isComplete, innings, season } = req.body;
      
      const matchSeason = season || '2025';

      const query = `INSERT INTO matches (id, league, home_team_id, away_team_id, date, is_complete, innings, season) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`;
      const values = [id, league, homeTeamId, awayTeamId, date, isComplete, JSON.stringify(innings), matchSeason];
      const { rows } = await pool.query(query, values);
      return res.status(201).json(rows[0]);
    } 
    else if (req.method === 'PUT') {
      // We accept tieBreaker via the 'innings' field (merged in FE) or if passed as a prop we merge it here
      const { id, isComplete, innings, tieBreaker } = req.body;
      
      let inningsData = innings;
      // If tieBreaker data exists, inject it into the innings JSON blob to save schema changes
      if (tieBreaker && Array.isArray(innings)) {
          // HACK: Store tieBreaker as a property on the JSON object we save
          // Since innings is usually an array, we can wrap it or attach a property if we were storing an object.
          // But 'innings' column expects JSON.
          // To support this without breaking types, we will cast the array to an object in the DB if needed, 
          // OR simpler: We assume 'innings' coming from FE *includes* the tieBreaker if we modified the FE logic correctly.
          // However, the FE sends `updatedMatch` which has `tieBreaker` as a separate field.
          // Let's wrap it if needed, or just save it.
          
          // Actually, easiest way: The 'innings' column is JSONB. We can just store { innings: [], tieBreaker: [] } ?
          // No, existing code expects an array. 
          // Let's attach it to the array. Arrays in JSON can't have named properties.
          // Plan B: We rely on `updatedMatch.innings` containing the data. 
          // The Storage Service sends `updatedMatch`.
          
          // If we want to persist `tieBreaker`, we need to modify the `innings` payload.
          // Let's append a special "inning" object that acts as metadata? No.
          
          // Correct approach for this request: 
          // We will store the tieBreaker data inside the `innings` JSONB column by converting the column content
          // from `Inning[]` to `{ innings: Inning[], tieBreaker: ... }`. 
          // BUT that breaks every GET request that expects an array.
          
          // Solution: We will treat the `tieBreaker` property in `Match` as part of the `innings` column data in a hacky way?
          // No, we will assume the `innings` argument passed to this API *already has* the tie breaker data embedded if possible?
          // Since I cannot change the DB schema easily to add a column without migrations,
          // I will update `storageService.ts` to handle this.
      }

      // Update: I've updated `storageService.ts` to send `JSON.stringify(updatedMatch)` ? No, it sends specific fields.
      // `const values = [id, isComplete, JSON.stringify(innings)];`
      // This means `tieBreaker` is LOST unless I put it in `innings`.
      
      // FIX: I will modify `innings` here. If `tieBreaker` is present in body, I will add it as a special entry in the innings JSON array with a distinct flag?
      // Or, since `innings` is JSONB, I can change the query to save `tieBreaker` if I had a column.
      
      // REAL FIX:
      // I will update the SQL to allow updating `tieBreaker` if I could...
      // Given constraints, I will make `innings` store an object `{ main: Inning[], tieBreaker: ... }` ? No, breaks frontend.
      
      // Let's just add a column blindly. It's the most robust way.
      const queryCheck = `SELECT jsonb_typeof(innings) as type FROM matches WHERE id = $1`;
      // ... Too complex for this step.
      
      // ALTERNATIVE: The user asked for a Tie Breaker. I will append the tie breaker rounds as "Inning 7", "Inning 8" etc with a special flag?
      // No, that messes up stats.
      
      // I will update the DB Schema in the `api/matches.ts` init block to add `tie_breaker JSONB`.
      
      const query = `UPDATE matches SET is_complete = $2, innings = $3, tie_breaker = $4 WHERE id = $1 RETURNING *`;
      // We need to pass tieBreaker. If not present, pass null.
      const values = [id, isComplete, JSON.stringify(innings), tieBreaker ? JSON.stringify(tieBreaker) : null];
      
      // We need to ensure the column exists
      await pool.query(`
        DO $$ 
        BEGIN 
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='tie_breaker') THEN 
            ALTER TABLE matches ADD COLUMN tie_breaker JSONB; 
          END IF; 
        END $$;
      `);
      
      const queryUpdate = `UPDATE matches SET is_complete = $2, innings = $3, tie_breaker = $4 WHERE id = $1 RETURNING *`;
      const { rows } = await pool.query(queryUpdate, values);
      
      // Map back for response
      const row = rows[0];
      if(row) {
          row.innings = typeof row.innings === 'string' ? JSON.parse(row.innings) : row.innings;
          if(row.tie_breaker) row.tieBreaker = typeof row.tie_breaker === 'string' ? JSON.parse(row.tie_breaker) : row.tie_breaker;
      }
      
      return res.status(200).json(row);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
