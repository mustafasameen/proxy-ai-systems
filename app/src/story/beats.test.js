import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildBeats, PHASES } from './beats.js';

const data = JSON.parse(readFileSync(fileURLToPath(new URL('../../public/data/stories.json', import.meta.url)), 'utf8'));

describe('story beats', () => {
  it('every story runs through the five phases in order under every policy', () => {
    const order = PHASES.map((p) => p.key);
    for (const s of data.stories) {
      for (const pol of data.policies) {
        const beats = buildBeats(s, pol);
        const seen = beats.map((b) => order.indexOf(b.phase));
        expect(seen.every((v, i) => i === 0 || v >= seen[i - 1])).toBe(true);
        expect(beats[beats.length - 1].phase).toBe('reveal');
      }
    }
  });

  it('the person speaks only when PROXY asked, and the answer is labelled simulated', () => {
    for (const s of data.stories) {
      for (const pol of data.policies) {
        const asked = s.policies[pol].asked;
        const person = buildBeats(s, pol).filter((b) => b.speaker === 'person');
        expect(person.length).toBe(asked ? 1 : 0);
        for (const b of person) expect(b.note).toMatch(/^Simulated/);
      }
    }
  });

  it('Never ask never asks; the reveal names the real choice', () => {
    for (const s of data.stories) {
      expect(s.policies['Never ask'].asked).toBe(false);
      const last = buildBeats(s, 'When unsure').at(-1);
      expect(last.text).toContain(s.options[s.truth].name);
    }
  });

  it('the featured stories show what they promise under the default policy', () => {
    const by = Object.fromEntries(data.stories.map((s) => [s.id, s.policies['When unsure']]));
    expect(by['question-helps'].asked && by['question-helps'].correct).toBe(true);
    expect(data.stories.find((s) => s.id === 'question-helps').policies['Never ask'].correct).toBe(false);
    expect(!by['no-question'].asked && by['no-question'].correct).toBe(true);
    expect(!by['honest-miss'].asked && !by['honest-miss'].correct).toBe(true);
    expect(by.shopping.asked && by.shopping.correct).toBe(true);
  });
});
