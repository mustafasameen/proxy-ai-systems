import { describe, it, expect } from 'vitest';
import {
  initChoice, currentOption, rejectCurrent, selectOption, accept, otherOptions, isExhausted,
} from './flow.js';

const ranking = ['A', 'B', 'C'].map((name, index) => ({ index, name, category: 'Cafe', reason: 'r' }));

describe('choice flow', () => {
  it('starts on the top option', () => {
    expect(currentOption(initChoice(ranking)).name).toBe('A');
  });

  it('"Not for me" promotes the next option', () => {
    const c = rejectCurrent(initChoice(ranking));
    expect(currentOption(c).name).toBe('B');
    expect(otherOptions(c).map((r) => r.option.name)).toEqual(['C']);
  });

  it('ends in the all-rejected state after rejecting every option', () => {
    let c = initChoice(ranking);
    c = rejectCurrent(c);
    c = rejectCurrent(c);
    c = rejectCurrent(c);
    expect(currentOption(c)).toBeNull();
    expect(isExhausted(c)).toBe(true);
    expect(rejectCurrent(c)).toBe(c);
  });

  it('a row in the list becomes the pick and keeps its rank', () => {
    const c = selectOption(initChoice(ranking), 2);
    expect(currentOption(c).name).toBe('C');
    expect(otherOptions(c).map((r) => r.rank)).toEqual([1, 2]);
  });

  it('cannot select a rejected option', () => {
    const c = rejectCurrent(initChoice(ranking));
    expect(selectOption(c, 0)).toBe(c);
  });

  it('accepting locks the choice', () => {
    const c = accept(initChoice(ranking));
    expect(c.accepted).toBe(true);
    expect(rejectCurrent(c)).toBe(c);
    expect(isExhausted(c)).toBe(false);
  });

  it('handles an empty ranking', () => {
    expect(currentOption(initChoice([]))).toBeNull();
  });
});
