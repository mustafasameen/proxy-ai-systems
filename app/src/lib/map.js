// Hand-drawn map maths. Equirectangular projection with x scaled by cos(40.7 degrees), no map library.

export const LAT0 = 40.7;
export const COS_LAT = Math.cos((LAT0 * Math.PI) / 180);
export const KM_PER_DEG = 111.32;
export const MIN_SPAN_KM = 3;
export const PAD = 0.25;
export const FOCUS_KM = 4;
export const VIEW_W = 440;
export const VIEW_H = 360;
const FALLBACK = [[40.5765, -74.172], [40.887, -73.734]];

// Fit box in degree space (x = lon * cos, y = lat), padded on every side and never narrower than the minimum span.
export function fitBox(points, bounds) {
  const pts = points.filter((p) => Array.isArray(p) && p.length === 2);
  const src = pts.length ? pts : (bounds || FALLBACK);
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const [lat, lon] of src) {
    const x = lon * COS_LAT;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, lat); maxY = Math.max(maxY, lat);
  }
  const minSpan = MIN_SPAN_KM / KM_PER_DEG;
  const spanX = Math.max((maxX - minX) * (1 + 2 * PAD), minSpan);
  const spanY = Math.max((maxY - minY) * (1 + 2 * PAD), minSpan);
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, spanX, spanY };
}

// The view centres on the decision: the options plus the past visits within FOCUS_KM of the options' centre.
// Returns { fit, off } where off counts past-visit points left outside.
export function focusPoints(optionPts, visitPts, focusKm = FOCUS_KM) {
  const opts = optionPts.filter((p) => Array.isArray(p));
  if (!opts.length) return { fit: visitPts, off: 0 };
  const cLat = opts.reduce((s, p) => s + p[0], 0) / opts.length;
  const cLon = opts.reduce((s, p) => s + p[1], 0) / opts.length;
  const km = (p) => Math.hypot((p[0] - cLat) * KM_PER_DEG, (p[1] - cLon) * KM_PER_DEG * COS_LAT);
  const near = visitPts.filter((p) => km(p) <= focusKm);
  return { fit: [...opts, ...near], off: visitPts.length - near.length };
}

// Returns project(lat, lon) -> [x, y] in the SVG viewBox. The box is fitted to the viewBox keeping the aspect ratio.
export function makeProjection(points, bounds, width = VIEW_W, height = VIEW_H) {
  const { cx, cy, spanX, spanY } = fitBox(points, bounds);
  const scale = Math.min(width / spanX, height / spanY);
  const project = (lat, lon) => [
    width / 2 + (lon * COS_LAT - cx) * scale,
    height / 2 - (lat - cy) * scale,
  ];
  project.scale = scale;
  project.width = width;
  project.height = height;
  // Pixels per kilometre, for the scale bar.
  project.pxPerKm = scale / KM_PER_DEG;
  return project;
}

export function inView(xy, width = VIEW_W, height = VIEW_H) {
  return xy[0] >= 0 && xy[0] <= width && xy[1] >= 0 && xy[1] <= height;
}

// Sutherland-Hodgman clip of a closed ring to the viewBox rectangle.
export function clipRing(ring, width = VIEW_W, height = VIEW_H) {
  const edges = [
    [(p) => p[0] >= 0, (a, b) => [0, a[1] + ((b[1] - a[1]) * (0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= width, (a, b) => [width, a[1] + ((b[1] - a[1]) * (width - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= 0, (a, b) => [a[0] + ((b[0] - a[0]) * (0 - a[1])) / (b[1] - a[1]), 0]],
    [(p) => p[1] <= height, (a, b) => [a[0] + ((b[0] - a[0]) * (height - a[1])) / (b[1] - a[1]), height]],
  ];
  let out = ring;
  for (const [inside, cross] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i += 1) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cross(prev, cur));
        out.push(cur);
      } else if (inside(prev)) {
        out.push(cross(prev, cur));
      }
    }
    if (!out.length) return [];
  }
  return out;
}

const r1 = (n) => Math.round(n * 10) / 10;

// SVG path data for a GeoJSON FeatureCollection of (Multi)Polygons, projected and clipped. One path string, or ''.
export function outlinePath(geojson, project) {
  if (!geojson || !Array.isArray(geojson.features)) return '';
  const w = project.width;
  const h = project.height;
  const parts = [];
  for (const f of geojson.features) {
    const g = f && f.geometry;
    if (!g) continue;
    const polys = g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : [];
    for (const poly of polys) {
      for (const ring of poly) {
        const xy = ring.map(([lon, lat]) => project(lat, lon));
        // Skip rings that are wholly on one side of the view.
        if (xy.every((p) => p[0] < 0) || xy.every((p) => p[0] > w) || xy.every((p) => p[1] < 0) || xy.every((p) => p[1] > h)) continue;
        const clipped = clipRing(xy, w, h);
        if (clipped.length < 3) continue;
        parts.push(`M${clipped.map((p) => `${r1(p[0])} ${r1(p[1])}`).join('L')}Z`);
      }
    }
  }
  return parts.join('');
}

// Past visits grouped by point, with the repeat count that sets the circle radius.
export function groupVisits(history) {
  const map = new Map();
  for (const h of history || []) {
    if (!Array.isArray(h.point)) continue;
    const key = h.point.join(',');
    const g = map.get(key) || { point: h.point, count: 0 };
    g.count += 1;
    map.set(key, g);
  }
  return [...map.values()];
}

export const visitRadius = (count) => 3 + 1.5 * (count - 1);
