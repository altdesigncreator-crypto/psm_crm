/** Client-side free-text search for lists already loaded in memory.
 *
 * - Every word typed must match somewhere (AND), in any order and across
 *   any field — "orchard 2br" finds a message mentioning both.
 * - Case, curly quotes, full-width characters and runs of whitespace are
 *   ignored; Burmese text compares as typed.
 * - Words that look like phone numbers also match ignoring formatting, so
 *   "0912345678" finds "09-123 456 78".
 *
 * Build one haystack per row up front (`buildHaystack`), then filter with
 * `matchesQuery` on every keystroke — normalization runs once per row,
 * not once per row per keystroke. */

export interface Haystack {
  text: string;
  digits: string;
}

export interface SearchQuery {
  terms: string[];
}

export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

const digitsOf = (value: string) => value.replace(/\D+/g, '');

export function buildHaystack(fields: (string | null | undefined)[]): Haystack {
  const present = fields.filter((f): f is string => !!f);
  return {
    // A separator no query term can contain, so a term never matches
    // across the boundary between two fields.
    text: present.map(normalizeForSearch).join('\u0000'),
    digits: present.map(digitsOf).join('\u0000'),
  };
}

export function parseQuery(query: string): SearchQuery {
  const normalized = normalizeForSearch(query);
  return { terms: normalized ? Array.from(new Set(normalized.split(' '))) : [] };
}

/** Phone-like: mostly digits, at least 3 of them. */
const isPhoneLike = (term: string) => /^[\d+\-().\s]+$/.test(term) && digitsOf(term).length >= 3;

export function matchesQuery(h: Haystack, q: SearchQuery): boolean {
  return q.terms.every((term) => h.text.includes(term) || (isPhoneLike(term) && h.digits.includes(digitsOf(term))));
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Regex matching any query term inside *original* (un-normalized) text,
 * for highlighting. Null when there's nothing to highlight. */
export function highlightPattern(q: SearchQuery): RegExp | null {
  if (q.terms.length === 0) return null;
  // Longest first, so "orchard condo" highlights whole rather than "or".
  const alternatives = [...q.terms].sort((a, b) => b.length - a.length).map(escapeRegExp);
  return new RegExp(`(${alternatives.join('|')})`, 'giu');
}

/** A window of `text` around its first match, so a hit deep inside a long
 * message is visible instead of hidden past a line clamp. Returns the
 * text unchanged when it's short or doesn't match. */
export function snippetAround(text: string, pattern: RegExp | null, radius = 70): string {
  if (!pattern || text.length <= radius * 2) return text;
  pattern.lastIndex = 0;
  const m = pattern.exec(text);
  pattern.lastIndex = 0;
  if (!m) return text;
  const start = Math.max(0, m.index - radius);
  const end = Math.min(text.length, m.index + m[0].length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}
