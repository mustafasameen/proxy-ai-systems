// Small text helpers for place names and counts.

export function isUnnamed(item) {
  return !(item && item.name && item.name.trim());
}

// A place's name, or its category when the venue has no name.
export function placeName(item) {
  return isUnnamed(item) ? item.category : item.name;
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
