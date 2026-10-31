import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import App, { Shell } from './App.jsx';
import { about, people, summary } from './testing/fixtures.js';

const decode = (s) =>
  s
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
const text = (html) =>
  decode(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

const places = { about, summary, reference: [], people };
const shopping = { about: { ...about, domain: 'shopping', history_label: 'recent purchases' }, summary, reference: [], people };

describe('App', () => {
  it('shows a plain loading line before the data arrives', () => {
    expect(text(renderToStaticMarkup(h(App)))).toBe('Loading');
  });
});

describe('Shell, the default view', () => {
  it('puts the top bar, the start prompt and the settings sheet together', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = renderToStaticMarkup(h(Shell, { datasets: { places, shopping: null } }));
    const t = text(html);
    expect(t).toContain('PROXY');
    expect(t).toContain('Demo account: Person 1');
    expect(t).toContain('Want me to find somewhere new?');
    expect(t).toContain('Find me somewhere new');
    expect(t).toContain("I'll check with you when I'm unsure. Change");
    expect(t).toContain('When should PROXY check with you?');
    expect(t).toContain('Real, anonymized histories. Pick one to try PROXY as that person.');
    // Shopping is hidden when its file did not load, with no message about it.
    expect(t).not.toContain('Shopping');
    expect(t).not.toMatch(/coming soon/i);
    // The developer view and the evaluation are off by default.
    expect(t).not.toContain('Detailed evaluation');
    expect(t).not.toContain('Reveal what this person actually chose');
    expect(t).not.toContain('This person so far');
    // The third check-in option is the one selected.
    const radios = [...html.matchAll(/<input type="radio"[^>]*>/g)].map((m) => /checked/.test(m[0]));
    expect(radios).toEqual([false, false, true, false, false]);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('shows the Places and Shopping switch when shopping loaded', () => {
    const html = renderToStaticMarkup(h(Shell, { datasets: { places, shopping } }));
    expect(text(html)).toContain('Places Shopping');
    expect(html).toContain('class="domain"');
  });
});
