import { describe, it, expect } from 'vitest';
import { summaryLine, yesKeeps, commonNoun } from './workspace.js';

describe('summary line', () => {
  it('lowercases places, pluralises only above one, leaves "or" phrases alone', () => {
    const line = summaryLine('places', 30, [
      { category: 'Park', count: 2 }, { category: 'Theater', count: 2 }, { category: 'Boat or Ferry', count: 2 }, { category: 'Bar', count: 1 },
    ]);
    expect(line).toBe('Last 30 visits · 2 parks · 2 theaters · 2 boat or ferry');
  });
  it('uses singular when the count is one', () => {
    expect(summaryLine('places', 1, [{ category: 'Park', count: 1 }])).toBe('Last 1 visit · 1 park');
  });
  it('keeps brand case for shopping and does not pluralise', () => {
    expect(summaryLine('shopping', 6, [{ category: 'Nintendo', count: 2 }, { category: 'PlayStation', count: 1 }]))
      .toBe('Last 6 purchases · 2 Nintendo · 1 PlayStation');
  });
  it('keeps cuisines capitalised', () => {
    expect(commonNoun('American Restaurant')).toBe('American restaurant');
  });
});

describe('question line', () => {
  it('reads singular and plural counts', () => {
    expect(yesKeeps(2, 5)).toBe('A yes keeps 2 of these 5 options.');
    expect(yesKeeps(1, 5)).toBe('A yes keeps 1 of these 5 options.');
  });
});
