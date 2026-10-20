"""Distances between a candidate venue and a person's history, and the prompt line that states them.

The distance is the great-circle (haversine) distance in kilometers on a sphere of radius 6371.0088 km. A candidate's
distance to a history is the distance to the nearest located place in it. A place without coordinates (a private home in
Massive-STEPS carries none) has no distance: the function returns None, never 0 and never a guess. A candidate has a
distance exactly when it has coordinates and the history holds at least one located place.

The distance cue adds one bracketed phrase to each of the five option lines of a prompt and changes nothing else.
"""
from __future__ import annotations

import math
import re

EARTH_R_KM = 6371.0088
LETTERS = "ABCDE"
HEADER_LINE = "They are about to go somewhere they have NOT been before. Which of these will they choose?"
CUE_KNOWN = " [{d} km from the nearest place in their history]"
CUE_UNKNOWN = " [distance unknown]"
CUE_RE = re.compile(r" \[(?:\d+\.\d km from the nearest place in their history|distance unknown)\]$")


def _ok(x):
    return x is not None and not (isinstance(x, float) and math.isnan(x))


def haversine_km(lat1, lon1, lat2, lon2):
    """Great-circle distance in km between two points in degrees, or None if any coordinate is missing."""
    if not all(_ok(v) for v in (lat1, lon1, lat2, lon2)):
        return None
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R_KM * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))   # atan2 stays accurate near the antipode


def coordinate_table(events):
    """{venue: (lat, lon)}, the first event with coordinates of each venue, in the order of `events`."""
    table = {}
    for e in events:
        if e.item not in table and _ok(e.lat) and _ok(e.lon):
            table[e.item] = (e.lat, e.lon)
    return table


def nearest_km(candidate_xy, history_xy):
    """Distance in km from one point to the nearest of `history_xy` (a list of (lat, lon), entries may be None).
    None when the candidate or every history place is unlocated."""
    if candidate_xy is None:
        return None
    ds = [haversine_km(candidate_xy[0], candidate_xy[1], h[0], h[1]) for h in dict.fromkeys(history_xy) if h is not None]
    ds = [d for d in ds if d is not None]
    return min(ds) if ds else None


def candidate_distances(candidates, history, coords):
    """One nearest-history distance (km, or None) per candidate venue id. `history` is every earlier place of the user."""
    hxy = [coords.get(h) for h in history]
    return [nearest_km(coords.get(c), hxy) for c in candidates]


def cue_text(d):
    """The phrase added to one option line. d is km or None."""
    return CUE_UNKNOWN if d is None else CUE_KNOWN.format(d=format(d, ".1f"))


def _option_block(lines, k):
    """Index of the first option line. Raises when the prompt does not end with the expected block: the header line, k lettered
    lines, a blank line and the answer line."""
    try:
        i = lines.index(HEADER_LINE)
    except ValueError:
        raise ValueError("prompt has no header line before the options") from None
    ok = (len(lines) == i + k + 3 and all(lines[i + 1 + j].startswith(f"  {LETTERS[j]}. ") for j in range(k))
          and lines[i + k + 1] == "" and lines[i + k + 2].startswith("Answer with one letter"))
    if not ok:
        raise ValueError("prompt does not end with the expected option block")
    return i + 1


def add_cue(prompt, dists):
    """The prompt with the distance phrase appended to each option line. dists has one entry (km or None) per option."""
    lines = prompt.split("\n")
    s = _option_block(lines, len(dists))
    for j, d in enumerate(dists):
        if CUE_RE.search(lines[s + j]):
            raise ValueError(f"option {LETTERS[j]} already carries a distance phrase")
        lines[s + j] += cue_text(d)
    return "\n".join(lines)


def strip_cue(prompt, k=5):
    """The inverse of add_cue: the prompt without the distance phrases."""
    lines = prompt.split("\n")
    s = _option_block(lines, k)
    for j in range(k):
        m = CUE_RE.search(lines[s + j])
        if m is None:
            raise ValueError(f"option {LETTERS[j]} has no distance phrase")
        lines[s + j] = lines[s + j][:m.start()]
    return "\n".join(lines)
