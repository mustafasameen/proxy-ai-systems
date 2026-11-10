import { describe, it, expect } from 'vitest';
import { summaryLine, yesKeeps } from './workspace.js';
import {
  allCopyStrings, askRateText, errorMessage, numberWord, confidenceParts, allRejected, endOfDecisions, COPY, pct, workspaceTitle,
} from './copy.js';

describe('copy rules', () => {
  it('uses no em or en dashes, exclamation marks or semicolons', () => {
    const strings = [
      ...allCopyStrings(),
      summaryLine('places', 30, [{ category: 'Park', count: 2 }, { category: 'Theater', count: 2 }, { category: 'Boat or Ferry', count: 2 }]),
      summaryLine('shopping', 6, [{ category: 'Nintendo', count: 2 }, { category: 'PlayStation', count: 1 }]),
      yesKeeps(2, 5), yesKeeps(1, 5),
    ];
    expect(strings.length).toBeGreaterThan(40);
    for (const s of strings) {
      expect(s, s).not.toMatch(/[—–!;]/);
    }
  });

  it('matches the spec copy for key lines', () => {
    expect(workspaceTitle('places', '2')).toBe('Where should Person 2 go next?');
    expect(workspaceTitle('shopping', '2')).toBe('What will Person 2 buy next?');
    expect(COPY.startButton).toBe('Let PROXY choose');
    expect(COPY.notForYou).toBe("Not for you. Here's the next option.");
    expect(allRejected(5)).toBe("That's all five options.");
    expect(endOfDecisions('1')).toBe("That's all the decisions for Person 1.");
  });
});

describe('errorMessage', () => {
  it('maps each code to its copy', () => {
    expect(errorMessage('network')).toBe("Couldn't reach the model.");
    expect(errorMessage('model_unavailable')).toBe("Couldn't reach the model.");
    expect(errorMessage('busy')).toBe('The model is busy. Try again in a moment.');
    expect(errorMessage('timeout')).toBe("PROXY couldn't finish this request.");
    expect(errorMessage('no_options')).toBe('No recommendation was returned.');
    expect(errorMessage('rate_limited')).toBe('Too many requests. Wait a minute and try again.');
  });
  it('falls back to the server message, then a generic line', () => {
    expect(errorMessage('weird', 'Server says hi.')).toBe('Server says hi.');
    expect(errorMessage('weird')).toBe("PROXY couldn't finish this request.");
  });
});

describe('number helpers', () => {
  it('askRateText reads the API ask rate', () => {
    expect(askRateText(0.3)).toBe('Asks about 3 in 10 times');
    expect(askRateText(0)).toBe('Picks without asking');
    expect(askRateText(1)).toBe('Asks before every pick');
  });
  it('numberWord and pct', () => {
    expect(numberWord(5)).toBe('five');
    expect(numberWord(12)).toBe('12');
    expect(pct(0.584)).toBe('58%');
  });
  it('confidenceParts is null without confidence', () => {
    expect(confidenceParts(null)).toBeNull();
    const c = confidenceParts({ label: 'Moderate confidence', matched_out_of_10: 6, similar_picks: 40 });
    expect(c.label).toBe('Moderate confidence');
    expect(c.rest).toBe(' · Similar picks matched the real choice about 6 in 10 times.');
    expect(c.rest).not.toMatch(/40/);
  });
});
