import { useMemo } from 'react';
import { COPY, mapLabel, offVisits } from '../lib/copy.js';
import {
  VIEW_H, VIEW_W, focusPoints, groupVisits, inView, makeProjection, outlinePath, visitRadius,
} from '../lib/map.js';

const DIAMOND = (s) => `M0 ${-s}L${s} 0L0 ${s}L${-s} 0Z`;

// Options that share a point are fanned out sideways by a few pixels so every marker and letter stays readable.
export function placeOptions(rows, project) {
  const groups = new Map();
  rows.forEach((row) => {
    const pt = row.option.point;
    if (!Array.isArray(pt)) return;
    const key = pt.join(',');
    groups.set(key, [...(groups.get(key) || []), row]);
  });
  const out = [];
  groups.forEach((list) => {
    list.forEach((row, i) => {
      const [x, y] = project(row.option.point[0], row.option.point[1]);
      out.push({ row, x: x + (i - (list.length - 1) / 2) * 20, y });
    });
  });
  return out;
}

export default function MapView({ history, rows, outline, bounds }) {
  const visits = useMemo(() => groupVisits(history), [history]);
  const focus = useMemo(
    () => focusPoints(rows.map((r) => r.option.point), visits.map((v) => v.point)),
    [visits, rows],
  );
  const project = useMemo(() => makeProjection(focus.fit, bounds, VIEW_W, VIEW_H), [focus, bounds]);
  const offView = useMemo(
    () => visits.filter((v) => !inView(project(v.point[0], v.point[1]))).reduce((s, v) => s + v.count, 0),
    [visits, project],
  );
  const d = useMemo(() => outlinePath(outline, project), [outline, project]);
  const shown = (history || []).filter((h) => Array.isArray(h.point)).length;
  const optionMarks = placeOptions(rows, project);
  const pickMark = optionMarks.find((m) => m.row.state === 'pick');
  const nOptions = rows.filter((r) => Array.isArray(r.option.point)).length;

  return (
    <figure className="map">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label={mapLabel(shown, nOptions)}
        preserveAspectRatio="xMidYMid meet"
      >
        <rect x="0" y="0" width={VIEW_W} height={VIEW_H} className="map-water" />
        {d && <path d={d} className="map-land" />}
        {visits.map((v) => {
          const [x, y] = project(v.point[0], v.point[1]);
          if (!inView([x, y])) return null;
          return <circle key={v.point.join(',')} cx={x} cy={y} r={visitRadius(v.count)} className="map-visit" />;
        })}
        {optionMarks.map(({ row, x, y }) => {
          const fade = row.state === 'excluded' || row.state === 'passed';
          const isPick = row.state === 'pick';
          return (
            <g key={row.option.index} className={fade ? 'map-opt is-faded' : 'map-opt'}>
              {!isPick && (
                <>
                  <path d={DIAMOND(4)} transform={`translate(${x} ${y})`} className="map-diamond" />
                  <text x={x + 7} y={y + 4} className="map-letter">{row.letter}</text>
                </>
              )}
            </g>
          );
        })}
        {pickMark && (
          <g className="map-pick">
            <path d={DIAMOND(5)} transform={`translate(${pickMark.x} ${pickMark.y})`} className="map-diamond-pick" />
            <text x={pickMark.x + 8} y={pickMark.y + 4} className="map-letter">{pickMark.row.letter}</text>
          </g>
        )}
      </svg>
      <div className="legend meta" aria-hidden="true">
        <span><svg width="10" height="10" viewBox="-5 -5 10 10"><circle r="3.5" className="map-visit" /></svg>{COPY.legendVisit}</span>
        <span><svg width="12" height="12" viewBox="-6 -6 12 12"><path d={DIAMOND(4.5)} className="map-diamond" /></svg>{COPY.legendOption}</span>
        <span><svg width="12" height="12" viewBox="-6 -6 12 12"><path d={DIAMOND(5.5)} className="map-diamond-pick" /></svg>{COPY.legendPick}</span>
      </div>
      <figcaption className="meta caption">
        {offView > 0 ? `${offVisits(offView)} ` : ''}{COPY.mapCaption}
      </figcaption>
    </figure>
  );
}
