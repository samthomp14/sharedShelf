// Author names and ids from an Open Library search doc, for seed_catalog's
// author_list and set_work_authors. Shared by seed-catalog.mjs and
// backfill-author-ids.mjs; supabase/functions/enrich-book has a copy (Deno
// can't import this file), keep them in step.
//
// OL's primary author_name is sometimes in the original script (村上春樹) or
// mangled ("Ernesto; Wright, Ann (translator) Guevara"). For single-author
// works we then pick the best Latin-script spelling from
// author_alternative_name (a flat list, so it's ambiguous with several
// authors). The database tidies whatever we send (case, initials, commas).

const LOWERCASE_ON_PURPOSE = new Set(['bell hooks', 'e.e. cummings', 'e. e. cummings']);

const key = (n) => n.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function isGood(n) {
  if (!n || /[;()\d,]/.test(n)) return false;
  if (!/^[\p{Script=Latin}\s.'’-]+$/u.test(n)) return false;
  if (LOWERCASE_ON_PURPOSE.has(n.toLowerCase())) return true;
  return n !== n.toUpperCase() && n !== n.toLowerCase();
}

const capitalized = (n) => n.split(/\s+/).every((w) => /^\p{Lu}\p{Ll}/u.test(w) || /^\p{Lu}\.?$/u.test(w));

function pickName(primary, alternates) {
  if (isGood(primary)) return primary;
  const good = (alternates ?? []).filter((a) => isGood(a) && a.trim().split(/\s+/).length >= 2);
  if (good.length === 0) return primary;

  // "MURAKAMI Haruki" marks the surname; prefer spellings that put it last,
  // the way English-language books credit the author.
  const surnames = new Set();
  for (const a of alternates ?? []) {
    const m = a.match(/^(\p{Lu}{2,}) \p{Lu}\p{Ll}+$/u);
    if (m) surnames.add(m[1].toLowerCase());
  }

  const uses = new Map();
  for (const a of good) uses.set(key(a), (uses.get(key(a)) ?? 0) + 1);
  const score = (a) => {
    const last = a.trim().split(/\s+/).pop().toLowerCase();
    return [surnames.has(last) ? 1 : 0, uses.get(key(a)), capitalized(a) ? 1 : 0];
  };
  return good
    .map((a, i) => ({ a, s: score(a), i }))
    .sort((x, y) => y.s[0] - x.s[0] || y.s[1] - x.s[1] || y.s[2] - x.s[2] || x.i - y.i)[0].a;
}

// [{ name, ol_author_id }] in credit order, or [] when OL has no authors.
export function olAuthorList(doc) {
  const names = doc.author_name ?? [];
  const keys = doc.author_key ?? [];
  const single = names.length === 1;
  return names.slice(0, 4).map((n, i) => ({
    name: single ? pickName(n, doc.author_alternative_name) : n,
    ol_author_id: /^OL\d+A$/.test(keys[i] ?? '') ? keys[i] : null,
  }));
}
