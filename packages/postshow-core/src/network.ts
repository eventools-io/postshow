/**
 * Syntactic network-boundary checks shared by model and connector clients.
 *
 * These checks intentionally fail closed for IP literals. Cloud runtimes must
 * still resolve DNS and reject non-public answers immediately before each
 * request, because a hostname can be rebound after this validation.
 */

function normalizedHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '');
}

function parseIpv4(hostname: string): Uint8Array | null {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes[index] = value;
  }
  return bytes;
}

function ipv6Words(part: string): number[] | null {
  if (!part) return [];
  const tokens = part.split(':');
  const words: number[] = [];
  for (const [index, token] of tokens.entries()) {
    if (token.includes('.')) {
      if (index !== tokens.length - 1) return null;
      const ipv4 = parseIpv4(token);
      if (!ipv4) return null;
      words.push((ipv4[0]! << 8) | ipv4[1]!, (ipv4[2]! << 8) | ipv4[3]!);
    } else {
      if (!/^[0-9a-f]{1,4}$/i.test(token)) return null;
      words.push(Number.parseInt(token, 16));
    }
  }
  return words;
}

function parseIpv6(hostname: string): Uint8Array | null {
  if (!hostname.includes(':') || hostname.includes('%')) return null;
  const pieces = hostname.split('::');
  if (pieces.length > 2) return null;
  const head = ipv6Words(pieces[0]!);
  const tail = pieces.length === 2 ? ipv6Words(pieces[1]!) : [];
  if (!head || !tail) return null;

  const omitted = 8 - head.length - tail.length;
  if ((pieces.length === 1 && omitted !== 0) || (pieces.length === 2 && omitted < 1)) return null;
  const words = [...head, ...new Array<number>(omitted).fill(0), ...tail];
  if (words.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (const [index, word] of words.entries()) {
    bytes[index * 2] = word >> 8;
    bytes[index * 2 + 1] = word & 0xff;
  }
  return bytes;
}

function hasPrefix(bytes: Uint8Array, prefix: number[], bits: number): boolean {
  const fullBytes = Math.floor(bits / 8);
  for (let index = 0; index < fullBytes; index += 1) {
    if (bytes[index] !== prefix[index]) return false;
  }
  const remaining = bits % 8;
  if (remaining === 0) return true;
  const mask = (0xff << (8 - remaining)) & 0xff;
  return (bytes[fullBytes]! & mask) === (prefix[fullBytes]! & mask);
}

function isNonPublicIpv4(bytes: Uint8Array): boolean {
  const [a, b] = bytes;
  return (
    a === 0 ||
    a === 10 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 2) ||
    (a === 192 && b === 88 && bytes[2] === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && bytes[2] === 100) ||
    (a === 203 && b === 0 && bytes[2] === 113) ||
    a! >= 224
  );
}

function mappedIpv4(bytes: Uint8Array): Uint8Array | null {
  if (!bytes.slice(0, 10).every((value) => value === 0)) return null;
  if (bytes[10] !== 0xff || bytes[11] !== 0xff) return null;
  return bytes.slice(12);
}

function isNonPublicIpv6(bytes: Uint8Array): boolean {
  const mapped = mappedIpv4(bytes);
  if (mapped) return isNonPublicIpv4(mapped);

  // Permit only global-unicast 2000::/3, then remove IANA special-purpose
  // ranges that sit inside that block (protocol assignments, 6to4, docs).
  if (!hasPrefix(bytes, [0x20], 3)) return true;
  return (
    hasPrefix(bytes, [0x20, 0x01, 0x00, 0x00], 23) ||
    hasPrefix(bytes, [0x20, 0x01, 0x0d, 0xb8], 32) ||
    hasPrefix(bytes, [0x20, 0x02], 16) ||
    hasPrefix(bytes, [0x3f, 0xff, 0x00], 20)
  );
}

/** True when the hostname is a literal IP that is not publicly routable. */
export function isNonPublicIpLiteral(hostname: string): boolean {
  const host = normalizedHostname(hostname);
  const ipv4 = parseIpv4(host);
  if (ipv4) return isNonPublicIpv4(ipv4);
  const ipv6 = parseIpv6(host);
  return ipv6 ? isNonPublicIpv6(ipv6) : false;
}

/** True only for localhost names and literal loopback addresses. */
export function isLoopbackHostname(hostname: string): boolean {
  const host = normalizedHostname(hostname);
  if (host === 'localhost') return true;
  const ipv4 = parseIpv4(host);
  if (ipv4) return ipv4[0] === 127;
  const ipv6 = parseIpv6(host);
  if (!ipv6) return false;
  if (ipv6.slice(0, 15).every((value) => value === 0) && ipv6[15] === 1) return true;
  const mapped = mappedIpv4(ipv6);
  return Boolean(mapped && mapped[0] === 127);
}

/** Reject local-only names and every non-public IP literal. */
export function isUnsafePublicHostname(hostname: string): boolean {
  const host = normalizedHostname(hostname);
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    isNonPublicIpLiteral(host)
  );
}
