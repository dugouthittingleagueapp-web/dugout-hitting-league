import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from '@google/genai';
import { requireRole } from './auth.js';

const promptInstructions = `You are a youth baseball hitting league assistant. 
Your job is to parse player rosters from either an image (such as a paper signup sheet, clipboard photo, or screenshot) or unformatted text (copied from an email, notepad, or messages).

RULES:
1. Extract every player's first name and last name.
2. Group players into teams (each team usually has 2-4 players, ideally 3 active players).
3. If team names are written, use them. If no team names are given, group into "Team 1", "Team 2", etc.
4. If someone is explicitly labeled as a sub/substitute/alternate, put them in subs. Otherwise, place in players.
5. Capitalize names neatly and trim whitespace.
6. Return only structured JSON matching the schema.`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Roster photos contain children's names and use a paid AI service.
  // Only league administrators may submit a roster for extraction.
  if (!requireRole(req, res, ['admin'])) return;

  const { text, imageBase64, mimeType, defaultLeague = '12U' } = req.body || {};
  if ((text !== undefined && typeof text !== 'string') ||
      (imageBase64 !== undefined && typeof imageBase64 !== 'string') ||
      typeof defaultLeague !== 'string' || defaultLeague.length > 100 ||
      (mimeType !== undefined && typeof mimeType !== 'string')) {
    return res.status(400).json({ error: 'The roster file could not be read. Please choose a text file or photo and try again.' });
  }
  if ((text?.length || 0) > 100_000 || (imageBase64?.length || 0) > 5_000_000) {
    return res.status(413).json({ error: 'This roster is too large. Please use a smaller photo or split the text into shorter sections.' });
  }
  if (imageBase64 && mimeType && !['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(mimeType.toLowerCase())) {
    return res.status(400).json({ error: 'Please use a JPG, PNG, WEBP, or supported phone photo.' });
  }

  if (!text && !imageBase64) {
    return res.status(400).json({ error: 'Either text or imageBase64 must be provided' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (!apiKey) {
      // Fallback parser if API key is not yet configured: provide intelligent text parsing
      if (text) {
        const teams = fallbackParseText(text, defaultLeague);
        return res.status(200).json({ teams, source: 'local-fallback' });
      }
      return res.status(500).json({ error: 'Gemini API key is not configured' });
    }

    const ai = new GoogleGenAI({ apiKey });

    const contents: any[] = [];
    if (imageBase64) {
      const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
      contents.push({
        inlineData: {
          mimeType: mimeType || 'image/jpeg',
          data: cleanBase64
        }
      });
    }

    if (text) {
      contents.push({ text: `Raw Text Input:\n${text}` });
    }

    contents.push({
      text: `Extract all teams and players. League assignment if unspecified is "${defaultLeague}".`
    });

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents,
      config: {
        systemInstruction: promptInstructions,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            teams: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  league: { type: Type.STRING },
                  players: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        name: { type: Type.STRING },
                        lastName: { type: Type.STRING }
                      },
                      required: ['name']
                    }
                  },
                  subs: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        name: { type: Type.STRING },
                        lastName: { type: Type.STRING }
                      },
                      required: ['name']
                    }
                  }
                },
                required: ['name', 'players']
              }
            }
          },
          required: ['teams']
        }
      }
    });

    const outputText = response.text || '{}';
    const parsed = JSON.parse(outputText);
    return res.status(200).json(parsed);
  } catch (error: any) {
    console.error('Error parsing roster with Gemini:', error);
    // If text was provided, use fallback text parsing so user is never blocked
    if (text) {
      const teams = fallbackParseText(text, defaultLeague);
      return res.status(200).json({ teams, fallback: true });
    }
    return res.status(500).json({ error: error.message || 'Failed to parse roster' });
  }
}

// Local regex-based fallback parser for raw text lists when offline or API is unavailable
function fallbackParseText(rawText: string, defaultLeague: string) {
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const teams: any[] = [];
  let currentTeam: any = null;
  let teamCount = 1;

  for (const line of lines) {
    // Check if line indicates a team header (e.g. "Team Alpha:", "Tigers", "Tigers - 12U")
    if (line.toLowerCase().startsWith('team') || line.endsWith(':') || line.includes(' - ')) {
      const cleanTeamName = line.replace(/[:]/g, '').trim();
      currentTeam = {
        name: cleanTeamName || `Team ${teamCount++}`,
        league: defaultLeague,
        players: [],
        subs: []
      };
      teams.push(currentTeam);
      continue;
    }

    if (!currentTeam) {
      currentTeam = {
        name: `Team ${teamCount++}`,
        league: defaultLeague,
        players: [],
        subs: []
      };
      teams.push(currentTeam);
    }

    // Split line by commas or semicolons if multiple players are on one line
    const playerTokens = line.split(/[,;]/).map(t => t.trim()).filter(Boolean);
    for (const token of playerTokens) {
      const isSub = token.toLowerCase().includes('(sub)') || token.toLowerCase().includes('sub:');
      const cleanToken = token.replace(/\(sub\)/gi, '').replace(/sub:/gi, '').trim();
      
      const parts = cleanToken.split(/\s+/);
      const firstName = parts[0] || 'Player';
      const lastName = parts.slice(1).join(' ') || '';

      const playerObj = { name: firstName, lastName: lastName || undefined };
      if (isSub) {
        currentTeam.subs.push(playerObj);
      } else {
        currentTeam.players.push(playerObj);
      }
    }
  }

  return teams.length > 0 ? teams : [{
    name: 'New Team',
    league: defaultLeague,
    players: [],
    subs: []
  }];
}
