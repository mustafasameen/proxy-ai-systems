// Small text helpers for place names and counts.

export function isUnnamed(item) {
  return !(item && item.name && item.name.trim());
}

// A place's name, or its category when the venue has no name.
export function placeName(item) {
  return isUnnamed(item) ? item.category : item.name;
}

// Whether the item has a category worth showing on its own line.
// Shopping candidates may have an empty category.
export function hasCategory(item) {
  return Boolean(item && typeof item.category === 'string' && item.category.trim());
}

// Adds "a" or "an" in front of a category name.
export function withArticle(word) {
  const w = (word || '').trim();
  const vowel = /^[aeiou]/i.test(w) && !/^(uni|use|usu|eu|one|ukr)/i.test(w);
  return `${vowel ? 'an' : 'a'} ${w}`;
}

// Number with thousands separators, for example 2502 becomes "2,502".
export function fmtCount(n) {
  return Number(n).toLocaleString('en-US');
}

// Probability as a percent label for a bar row.
export function probLabel(p) {
  const r = Math.round(p * 100);
  if (p > 0 && r === 0) return '<1%';
  return `${r}%`;
}

// Singular or plural word for a count.
export function plural(n, one, many) {
  return n === 1 ? one : many;
}

// First letter in capitals, for example "recent places" becomes "Recent places".
export function capitalizeFirst(s) {
  const t = (s || '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

// The noun a history label counts, for example "places" from "recent places".
export function historyNoun(label) {
  const t = (label || '').trim().replace(/^recent\s+/i, '');
  return t || 'places';
}

// How the developer reveal names the option the person actually chose.
export function chosenName(item) {
  if (!item) return 'an unknown option';
  if (!isUnnamed(item)) return item.name;
  return hasCategory(item) ? `an unnamed ${item.category}` : 'an unnamed option';
}
