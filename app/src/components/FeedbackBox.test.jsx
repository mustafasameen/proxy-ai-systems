import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import FeedbackBox, { feedbackError } from './FeedbackBox.jsx';
import { ApiError } from '../lib/api.js';

describe('feedback box', () => {
  it('starts with the question and two choices, and no note field', () => {
    const html = renderToStaticMarkup(<FeedbackBox where="story" item="honest-miss" />);
    expect(html).toContain('Was this easy to follow?');
    expect(html).toContain('Not really');
    expect(html).not.toContain('<textarea');
  });

  it('explains a failed send in plain words', () => {
    expect(feedbackError(new ApiError('network', 'Network error.'))).toBe("Couldn't send: the PROXY API is not running.");
    expect(feedbackError(new ApiError('rate_limited', ''))).toContain('Too many requests');
    expect(feedbackError(new ApiError('invalid_request', 'The request was not accepted: note: too long'))).toContain('not accepted');
  });
});
