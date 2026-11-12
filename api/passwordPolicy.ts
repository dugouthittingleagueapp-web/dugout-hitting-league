/**
 * Resolve an explicitly configured login credential only.
 * Existing database credentials take precedence over environment recovery
 * credentials. There are deliberately no public/default passwords.
 */
export const configuredLoginCredential = (
  stored: string | null | undefined,
  environment: string | undefined,
): string | null => stored?.trim() || environment?.trim() || null;

/**
 * During first-time database initialization, require a server-provided
 * password rather than silently creating a known default account.
 * Existing database credentials are not changed by this policy.
 */
export const requiredInitialPassword = (
  role: 'admin' | 'umpire',
  environment: string | undefined,
): string => {
  const password = environment?.trim();
  if (!password) {
    const variable = role === 'admin' ? 'ADMIN_PASSWORD' : 'UMPIRE_PASSWORD';
    throw new Error(`${variable} must be configured before initializing a new ${role} account`);
  }
  return password;
};
