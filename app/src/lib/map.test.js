import { describe, it, expect } from 'vitest';
import {
  focusPoints, makeProjection, fitBox, inView, clipRing, outlinePath, groupVisits, visitRadius, COS_LAT, VIEW_W, VIEW_H, KM_PER_DEG,
} from './map.js';

const pts = [[40.73, -74.0], [40.75, -73.98], [40.66, -73.94], [40.82, -73.88]];

describe('map projection', () => {
  it('maps every fitted point inside the viewBox', () => {
    const project = makeProjection(pts);
    for (const [lat, lon] of pts) {
      expect(inView(project(lat, lon)), `${lat},${lon}`).toBe(true);
    }
  });

  it('keeps north up and east right', () => {
    const project = makeProjection(pts);
    expect(project(40.8, -73.95)[1]).toBeLessThan(project(40.7, -73.95)[1]);
    expect(project(40.75, -73.9)[0]).toBeGreaterThan(project(40.75, -74.0)[0]);
  });

  it('scales longitude by cos(40.7 degrees) so a degree east is shorter than a degree north', () => {
    const project = makeProjection(pts);
    const dx = project(40.7, -73.9)[0] - project(40.7, -74.9)[0];
    const dy = project(40.7, -73.9)[1] - project(41.7, -73.9)[1];
    expect(dx / dy).toBeCloseTo(COS_LAT, 6);
  });

  it('centres a single point and never fits tighter than about 3 km', () => {
    const project = makeProjection([[40.73, -74.0]]);
    const [x, y] = project(40.73, -74.0);
    expect(x).toBeCloseTo(VIEW_W / 2, 6);
    expect(y).toBeCloseTo(VIEW_H / 2, 6);
    const box = fitBox([[40.73, -74.0]]);
    expect(box.spanY * KM_PER_DEG).toBeGreaterThanOrEqual(2.99);
    // a point 1.2 km away is still inside the view
    expect(inView(project(40.73 + 1.2 / KM_PER_DEG, -74.0))).toBe(true);
  });

  it('pads the fitted box by 25 percent', () => {
    const box = fitBox([[40.6, -74.0], [40.8, -73.9]]);
    expect(box.spanY).toBeCloseTo(0.2 * 1.5, 6);
  });

  it('falls back to the bounds when there are no points', () => {
    const project = makeProjection([], [[40.5, -74.2], [40.9, -73.7]]);
    expect(inView(project(40.7, -73.95))).toBe(true);
  });
});

describe('clipping', () => {
  it('clips a ring that spills past the viewBox to the viewBox', () => {
    const out = clipRing([[-100, -100], [VIEW_W + 100, -100], [VIEW_W + 100, VIEW_H + 100], [-100, VIEW_H + 100]]);
    expect(out.length).toBeGreaterThanOrEqual(4);
    for (const [x, y] of out) {
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(VIEW_W);
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(VIEW_H);
    }
  });

  it('drops a ring that is wholly outside', () => {
    expect(clipRing([[-50, -50], [-10, -50], [-10, -10]])).toEqual([]);
  });

  it('builds path data with only in-view coordinates, and skips far-away rings', () => {
    const project = makeProjection(pts);
    const geo = {
      features: [
        { geometry: { type: 'MultiPolygon', coordinates: [[[[-74.5, 40.4], [-73.5, 40.4], [-73.5, 41.0], [-74.5, 41.0], [-74.5, 40.4]]], [[[-60, 10], [-59, 10], [-59, 11], [-60, 10]]]] } },
      ],
    };
    const d = outlinePath(geo, project);
    expect(d.startsWith('M')).toBe(true);
    expect((d.match(/M/g) || []).length).toBe(1);
    const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
    nums.forEach((n) => { expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(Math.max(VIEW_W, VIEW_H)); });
  });
});

describe('visits', () => {
  it('groups repeats by point and grows the radius by 1.5 per repeat', () => {
    const g = groupVisits([{ point: [1, 2] }, { point: [1, 2] }, { point: [3, 4] }, { point: null }]);
    expect(g).toHaveLength(2);
    expect(g.find((v) => v.point[0] === 1).count).toBe(2);
    expect(visitRadius(1)).toBe(3);
    expect(visitRadius(3)).toBe(6);
  });
});

describe('focus', () => {
  it('keeps the options and nearby visits, and counts the far ones', () => {
    const { fit, off } = focusPoints([[40.73, -74.0], [40.74, -73.99]], [[40.735, -73.995], [40.58, -74.15]]);
    expect(fit).toHaveLength(3);
    expect(off).toBe(1);
  });
});
