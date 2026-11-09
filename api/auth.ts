import crypto from 'crypto';
import bcrypt from 'bcryptjs';

export type UserRole = 'admin' | 'umpire' | 'fan';

export interface AuthSession {
  role: 'admin' | 'umpire';
  exp: number;
}

const SESSION_COOKIE_NAME = 'dugout_session';
const SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60; // 7 days

// Secure server secret for HMAC session signing
function getSessionSecret(): string {
  return process.env.SESSION_SECRET || process.env.ADMIN_SECRET || 'dugout-hitting-league-hardened-session-secret-2026';
}

/**
 * Hashes a plaintext password using bcrypt with 10 salt rounds.
 */
export async function hashPassword(plainText: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plainText.trim(), salt);
}

/**
 * Compares plaintext password against a stored bcrypt hash or legacy plaintext.
 * Safely handles historical plaintext during migration and returns match status.
 */
export async function comparePassword(plainText: string, storedHashOrPlain: string): Promise<boolean> {
  if (!plainText || !storedHashOrPlain) return false;
  const cleanPlain = plainText.trim();
  const cleanStored = storedHashOrPlain.trim();

  // If stored value is a bcrypt hash (starts with $2a$, $2b$, or $2y$)
  if (/^\$2[aby]\$\d{2}\$/.test(cleanStored)) {
    try {
      return await bcrypt.compare(cleanPlain, cleanStored);
    } catch (e) {
      return false;
    }
  }

  // Legacy plaintext fallback for safe zero-lockout migration
  return cleanPlain.toLowerCase() === cleanStored.toLowerCase();
}

/**
 * Creates a cryptographically signed session token: payload.signature
 */
export function signSessionToken(role: 'admin' | 'umpire'): string {
  const secret = getSessionSecret();
  const payload: AuthSession = {
    role,
    exp: Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

/**
 * Verifies the cryptographically signed session token.
 */
export function verifySessionToken(token: string): { valid: boolean; role?: 'admin' | 'umpire' } {
  if (!token || typeof token !== 'string') return { valid: false };
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false };

  const [encodedPayload, providedSignature] = parts;
  const secret = getSessionSecret();
  const expectedSignature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');

  try {
    const a = Buffer.from(providedSignature);
    const b = Buffer.from(expectedSignature);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { valid: false };
    }

    const payload: AuthSession = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf-8'));
    if (!payload.role || !payload.exp) return { valid: false };
    if (Math.floor(Date.now() / 1000) > payload.exp) {
      return { valid: false }; // Expired
    }

    return { valid: true, role: payload.role };
  } catch (e) {
    return { valid: false };
  }
}

/**
 * Parses cookies from request header.
 */
function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  cookieHeader.split(';').forEach(c => {
    const [k, v] = c.split('=');
    if (k && v) {
      cookies[k.trim()] = decodeURIComponent(v.trim());
    }
  });
  return cookies;
}

/**
 * Extracts authenticated role from HTTP Request (Cookie or Authorization Bearer header).
 */
export function getAuthFromRequest(req: any): { authenticated: boolean; role: UserRole } {
  const cookieHeader = req.headers?.cookie || req.headers?.['cookie'];
  const cookies = parseCookies(cookieHeader);
  let token = cookies[SESSION_COOKIE_NAME];

  if (!token) {
    const authHeader = req.headers?.authorization || req.headers?.['authorization'];
    if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    }
  }

  if (token) {
    const verified = verifySessionToken(token);
    if (verified.valid && verified.role) {
      return { authenticated: true, role: verified.role };
    }
  }

  return { authenticated: false, role: 'fan' };
}

/**
 * Sets HttpOnly, SameSite session cookie on the response.
 */
export function setSessionCookie(res: any, token: string): void {
  const isProd = process.env.NODE_ENV === 'production';
  const cookieVal = `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DURATION_SECONDS}${isProd ? '; Secure' : ''}`;
  
  if (typeof res.setHeader === 'function') {
    const existing = res.getHeader('Set-Cookie');
    if (existing) {
      const arr = Array.isArray(existing) ? existing : [String(existing)];
      res.setHeader('Set-Cookie', [...arr, cookieVal]);
    } else {
      res.setHeader('Set-Cookie', cookieVal);
    }
  }
}

/**
 * Clears the session cookie on the response.
 */
export function clearSessionCookie(res: any): void {
  const isProd = process.env.NODE_ENV === 'production';
  const cookieVal = `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProd ? '; Secure' : ''}`;
  if (typeof res.setHeader === 'function') {
    res.setHeader('Set-Cookie', cookieVal);
  }
}

/**
 * Enforces role authorization in API route handlers.
 * Sends 401 or 403 response if unauthorized.
 */
export function requireRole(req: any, res: any, allowedRoles: ('admin' | 'umpire')[]): 'admin' | 'umpire' | null {
  const auth = getAuthFromRequest(req);
  if (!auth.authenticated) {
    res.status(401).json({ error: 'Unauthorized: Authentication required.' });
    return null;
  }

  if (!allowedRoles.includes(auth.role as 'admin' | 'umpire')) {
    res.status(403).json({ error: `Forbidden: Access restricted to ${allowedRoles.join(' or ')}.` });
    return null;
  }

  return auth.role as 'admin' | 'umpire';
}
