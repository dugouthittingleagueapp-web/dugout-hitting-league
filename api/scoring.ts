import {captureMutationDiagnostics} from '../server/diagnostics.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import matches from './matches.js';

/** A separate versioned route fails closed against older deployed backends. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  captureMutationDiagnostics(req,res,'/api/scoring');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = req.body;
  if (!body || body.protocol !== 1 || !body.command ||
      Object.keys(body).some(k => !['protocol', 'id', 'revision', 'writeId', 'command'].includes(k)))
    return res.status(400).json({ code: 'INVALID_SCORING_PROTOCOL', error: 'This scoring save could not be checked. Your saved copy stays on this device. Ask the person running the league for help.' });
  const { protocol: _protocol, ...commandBody } = body;
  return matches({ ...req, headers: req.headers, query: req.query, method: 'PUT', body: commandBody } as VercelRequest, res);
}
