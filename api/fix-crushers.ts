import type { VercelRequest, VercelResponse } from '@vercel/node';
import { migrateCrushersInPostgres } from '../scripts/fix-crushers-team-name.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const result = await migrateCrushersInPostgres();
    return res.status(200).json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
