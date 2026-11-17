import { describe, it, expect } from 'vitest';
import { summaryLine, yesKeeps } from './workspace.js';
import {
  allCopyStrings, askRateText, errorMessage, numberWord, confidenceLine, noRateLine, displayName, startHint, evidenceLine, allRejected, endOfDecisions, COPY, pct, workspaceTitle,
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
    expect(allRejected(5, 5)).toBe("That's all five options.");
    expect(allRejected(5, 1)).toBe('That was the only option left.');
    expect(allRejected(5, 3)).toBe("That's all three options left.");
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
    expect(errorMessage('gateway_auth')).toBe('PROXY is not set up correctly.');
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
  it('confidenceLine is null without confidence, and reads as a past track record', () => {
    expect(confidenceLine(null)).toBeNull();
    const c = confidenceLine({ label: 'Moderate confidence', matched_out_of_10: 6, similar_picks: 40 });
    expect(c).toBe('In past tests, similar picks matched the real choice about 6 in 10 times (moderate confidence).');
    expect(c).not.toMatch(/40/);
  });
  it('confidenceLine says when the record used simulated answers', () => {
    expect(confidenceLine({ label: 'Lower confidence', matched_out_of_10: 3 }, true)).toContain('answers simulated from the real choice');
  });
  it('every pick state has a line: a rate or the reason there is none', () => {
    expect(noRateLine({ later: true })).toMatch(/first pick only/);
    expect(noRateLine({ answered: true, single: true })).toMatch(/left only one option/);
    expect(noRateLine({})).toMatch(/Too few similar picks/);
  });
  it('shows a masked home by a plain name', () => {
    expect(displayName({ name: 'Home', category: 'private' })).toBe('A private place (name hidden)');
    expect(displayName({ name: 'Home Sweet Home', category: 'Nightclub' })).toBe('Home Sweet Home');
  });
  it('the idle hint follows the ask setting', () => {
    expect(startHint('Never ask')).toBe('PROXY will not ask a question.');
    expect(startHint('When unsure')).toMatch(/asks one question first if it could help/);
    expect(startHint('Always ask')).toMatch(/whenever it has one/);
  });
});

describe('smaller pilot fixes', () => {
  it('evidence line has no article before a generic kind', () => {
    expect(evidenceLine('places', { count: 0, total: 30, category: 'Health care' })).toBe('Of their last 30 places, 0 were health care.');
    expect(evidenceLine('places', { count: 3, total: 30, category: 'Cocktail Bar' })).toBe('Of their last 30 places, 3 were a cocktail bar.');
  });
  it('the person menu is named Person', () => {
    expect(COPY.personSwitcherLabel).toBe('Person');
  });
});
