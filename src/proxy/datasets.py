"""Unified loaders for the delegation-fidelity datasets.

All datasets are read from one data root: the folder named by the PROXY_DATA_ROOT environment
variable, or `data/` at the repository root when the variable is not set. Each dataset sits at a
fixed path below that root (see DATASET_PATHS). Nothing here copies or downloads data. `resolve()`
raises with the path it looked for, so a missing dataset fails loudly when it is first used
instead of producing a silently empty table.

Every loader returns the same schema, so downstream code does not depend on the dataset:
    user (str) | ts (datetime) | item (str) | cat (str|None) | lat (float|None) | lon (float|None)
`item` is whatever the person chose (a venue, a grid cell): the thing a delegated agent would have
to get right.
"""
from __future__ import annotations

import csv
import gzip
import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

# The data root is PROXY_DATA_ROOT if set, otherwise <repository root>/data. Every path in DATASET_PATHS
# is relative to it.
DATA_ROOT = Path(os.environ.get("PROXY_DATA_ROOT", Path(__file__).resolve().parents[2] / "data"))

DATASET_PATHS = {
    "fsq_nyc":   DATA_ROOT / "foursquare/dataset_tsmc2014/dataset_TSMC2014_NYC.txt",
    "fsq_tky":   DATA_ROOT / "foursquare/dataset_tsmc2014/dataset_TSMC2014_TKY.txt",
    "gowalla":   DATA_ROOT / "gowalla/loc-gowalla_totalCheckins.txt.gz",
    "brightkite": DATA_ROOT / "brightkite/loc-brightkite_totalCheckins.txt.gz",
    "steps_new_york": DATA_ROOT / "massive_steps/new_york/new_york_checkins.csv",
    "steps_tokyo":    DATA_ROOT / "massive_steps/tokyo/tokyo_checkins.csv",
    "steps_jakarta":  DATA_ROOT / "massive_steps/jakarta/jakarta_checkins.csv",
    "steps_istanbul": DATA_ROOT / "massive_steps/istanbul/istanbul_checkins.csv",
    "steps_moscow":   DATA_ROOT / "massive_steps/moscow/moscow_checkins.csv",
    "steps_sao_paulo": DATA_ROOT / "massive_steps/sao_paulo/sao_paulo_checkins.csv",
    "steps_sydney":   DATA_ROOT / "massive_steps/sydney/sydney_checkins.csv",
    "steps_melbourne": DATA_ROOT / "massive_steps/melbourne/melbourne_checkins.csv",
    "steps_beijing":  DATA_ROOT / "massive_steps/beijing/beijing_checkins.csv",
    "steps_shanghai": DATA_ROOT / "massive_steps/shanghai/shanghai_checkins.csv",
    "steps_kuwait_city": DATA_ROOT / "massive_steps/kuwait_city/kuwait_city_checkins.csv",
    "steps_petaling_jaya": DATA_ROOT / "massive_steps/petaling_jaya/petaling_jaya_checkins.csv",
}


@dataclass
class Event:
    user: str
    ts: datetime
    item: str
    cat: str | None = None
    lat: float | None = None
    lon: float | None = None
    name: str | None = None      # venue name where the release carries one (Massive-STEPS only)


def resolve(name: str) -> Path:
    if name not in DATASET_PATHS:
        raise KeyError(f"unknown dataset {name!r}; known: {sorted(DATASET_PATHS)}")
    p = DATASET_PATHS[name]
    if not p.exists():
        raise FileNotFoundError(f"{name} not found at {p} ; set PROXY_DATA_ROOT to the folder that holds the datasets")
    return p


def _open(p: Path):
    return gzip.open(p, "rt", encoding="utf-8", errors="replace") if p.suffix == ".gz" \
        else open(p, "r", encoding="utf-8", errors="replace")


def load(name: str, limit: int | None = None):
    """Yield Events. `limit` caps rows read (for quick profiling, not for analysis)."""
    p = resolve(name)
    if name.startswith("fsq_"):
        # userId \t venueId \t catId \t catName \t lat \t lon \t tzOffset \t utcTime
        with _open(p) as f:
            for i, line in enumerate(f):
                if limit and i >= limit:
                    break
                c = line.rstrip("\n").split("\t")
                if len(c) < 8:
                    continue
                try:
                    ts = datetime.strptime(c[7], "%a %b %d %H:%M:%S %z %Y")
                except ValueError:
                    continue
                yield Event(c[0], ts, c[1], c[3], float(c[4]), float(c[5]))
    elif name in ("gowalla", "brightkite"):
        # user \t ISO-time \t lat \t lon \t locationId
        with _open(p) as f:
            for i, line in enumerate(f):
                if limit and i >= limit:
                    break
                c = line.rstrip("\n").split("\t")
                if len(c) < 5:
                    continue
                try:
                    ts = datetime.strptime(c[1], "%Y-%m-%dT%H:%M:%SZ")
                except ValueError:
                    continue
                yield Event(c[0], ts, c[4], None,
                            float(c[2]) if c[2] else None, float(c[3]) if c[3] else None)
    elif name.startswith("steps_"):
        with _open(p) as f:
            for i, row in enumerate(csv.DictReader(f)):
                if limit and i >= limit:
                    break
                try:
                    ts = datetime.strptime(row["timestamp"][:19], "%Y-%m-%d %H:%M:%S")
                except (ValueError, KeyError):
                    continue
                yield Event(row["user_id"], ts, row["venue_id"], row.get("venue_category"),
                            float(row["latitude"]) if row.get("latitude") else None,
                            float(row["longitude"]) if row.get("longitude") else None,
                            row.get("name") or None)
    # YJMob100K loader. DATASET_PATHS has no yjmob entry in this repository, so resolve() rejects the
    # name before this branch is reached unless an entry is added.
    elif name.startswith("yjmob"):
        # uid,d,t,x,y: d = day index, t = 30-min slot; synthesize an ordering timestamp
        from datetime import timedelta
        base = datetime(2000, 1, 1)
        with _open(p) as f:
            rdr = csv.DictReader(f)
            for i, row in enumerate(rdr):
                if limit and i >= limit:
                    break
                try:
                    ts = base + timedelta(days=int(row["d"]), minutes=30 * int(row["t"]))
                except (ValueError, KeyError):
                    continue
                yield Event(row["uid"], ts, f'{row["x"]}_{row["y"]}', None, None, None)
    else:
        raise NotImplementedError(f"no loader for {name}")
