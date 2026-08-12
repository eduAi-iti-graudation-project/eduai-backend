export function gmailLocal(firstName: string, lastName?: string): string {
  const normalize = (part: string) =>
    part
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$/g, '')
      .replace(/\.{2,}/g, '.');
  const first = normalize(firstName);
  const last = normalize(lastName ?? '');
  const base = last ? `${first}.${last}` : first;
  return base.length > 0 ? base : 'student';
}

export function gmailCandidate(local: string, suffix = 0): string {
  const numbered = suffix > 0 ? `${local}.${suffix}` : local;
  return `${numbered}@gmail.com`;
}

/**
 * School-domain login identity: `firstname.lastname@<school-domain>`. The
 * domain defaults to the organization's emailDomain (slug + ".org") with a
 * safe fallback so provisioning never hard-fails on a missing config.
 */
export function schoolEmailCandidate(
  local: string,
  domain?: string | null,
): string {
  const cleaned = (domain ?? 'eduai.org').trim().toLowerCase();
  return `${local}@${cleaned}`;
}

export function uniqueEmail(taken: Set<string>, base: string): string | null {
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix <= 100; suffix++) {
    const candidate = `${base}.${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}

const PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

export function generatePassword(length = 10): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let password = '';
  for (let i = 0; i < length; i++) {
    password += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
  }
  return password;
}
