import type { VercelRequest, VercelResponse } from '@vercel/node';
import { migrateCrushersInPostgres } from '../scripts/fix-crushers-team-name.js';
import { requireRole } from './auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Administrative operation: strictly require authenticated admin
  const role = requireRole(req, res, ['admin']);
  if (!role) return;

  try {
    const result = await migrateCrushersInPostgres();
    return res.status(200).json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
