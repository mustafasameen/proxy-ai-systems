// The choice among one decision's ranked options. Pure functions over a plain object:
// { ranking, current, rejected, accepted } where current is a position in ranking, or null when all are rejected.

export function initChoice(ranking) {
  const list = Array.isArray(ranking) ? ranking : [];
  return { ranking: list, current: list.length ? 0 : null, rejected: [], accepted: false };
}

export function currentOption(choice) {
  return choice && choice.current !== null ? choice.ranking[choice.current] : null;
}

export function isExhausted(choice) {
  return Boolean(choice) && choice.current === null && !choice.accepted;
}

// "Not for me": the lowest-ranked-number option still in play takes the main spot.
export function rejectCurrent(choice) {
  if (choice.current === null || choice.accepted) return choice;
  const rejected = [...choice.rejected, choice.current];
  let next = null;
  for (let p = 0; p < choice.ranking.length; p += 1) {
    if (!rejected.includes(p)) {
      next = p;
      break;
    }
  }
  return { ...choice, rejected, current: next };
}

// A row in "See all options" makes that option the pick.
export function selectOption(choice, position) {
  if (choice.accepted) return choice;
  if (position < 0 || position >= choice.ranking.length || choice.rejected.includes(position)) return choice;
  return { ...choice, current: position };
}

export function accept(choice) {
  if (choice.current === null) return choice;
  return { ...choice, accepted: true };
}

// Options other than the pick, in ranked order, with their 1-based rank.
export function otherOptions(choice) {
  return choice.ranking
    .map((option, position) => ({ option, position, rank: position + 1 }))
    .filter((row) => row.position !== choice.current && !choice.rejected.includes(row.position));
}
