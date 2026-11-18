import type { VercelRequest, VercelResponse } from '@vercel/node';
import pool from './db.js';
import { readIdentityLinks } from '../server/playerIdentities.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({error:'Method not allowed'});
  try { res.setHeader('Cache-Control','no-store'); return res.status(200).json(await readIdentityLinks(pool)); }
  catch { return res.status(503).json({error:'Player history is unavailable. Please try again.'}); }
}
