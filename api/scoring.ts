import {requireRole} from './auth.js';
import pool from './db.js';
import {captureMutationDiagnostics} from '../server/diagnostics.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import matches from './matches.js';

/** A separate versioned route fails closed against older deployed backends. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if(req.method==='GET' && req.query?.action==='health'){
    if(!requireRole(req,res,['admin']))return;
    res.setHeader('Cache-Control','no-store');
    try{const probe={text:"SELECT m.revision FROM matches m LEFT JOIN scoring_locks locks ON locks.match_id=m.id::text LEFT JOIN app_settings settings ON settings.key='current_season' WHERE FALSE",query_timeout:2000};await pool.query(probe);return res.status(200).json({scoring:'responding',protocol:1,checkedAt:new Date().toISOString(),scope:'Read-only scoring route and required-table check; no test pitches were written.'});}
    catch{return res.status(503).json({scoring:'error',checkedAt:new Date().toISOString()});}
  }
  captureMutationDiagnostics(req,res,'/api/scoring');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = req.body;
  if (!body || body.protocol !== 1 || !body.command ||
      Object.keys(body).some(k => !['protocol', 'id', 'revision', 'writeId', 'command'].includes(k)))
    return res.status(400).json({ code: 'INVALID_SCORING_PROTOCOL', error: 'This scoring save could not be checked. Your saved copy stays on this device. Ask the person running the league for help.' });
  const { protocol: _protocol, ...commandBody } = body;
  return matches({ ...req, headers: req.headers, query: req.query, method: 'PUT', body: commandBody } as VercelRequest, res);
}
