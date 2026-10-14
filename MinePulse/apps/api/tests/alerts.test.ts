import { describe, expect, it } from 'vitest';
import {
  advanceStreak,
  compareValue,
  decideAction,
  type RuleState,
} from '../src/services/alertService.js';
import { discordService, isDiscordConfigured } from '../src/services/discordService.js';

const state = (): RuleState => ({ breachStreak: 0, okStreak: 0 });

describe('compareValue', () => {
  it('evaluates every supported operator', () => {
    expect(compareValue(10, 'lt', 15)).toBe(true);
    expect(compareValue(20, 'lt', 15)).toBe(false);
    expect(compareValue(15, 'lte', 15)).toBe(true);
    expect(compareValue(20, 'gt', 15)).toBe(true);
    expect(compareValue(15, 'gt', 15)).toBe(false);
    expect(compareValue(15, 'gte', 15)).toBe(true);
    expect(compareValue(15, 'eq', 15)).toBe(true);
    expect(compareValue(16, 'eq', 15)).toBe(false);
  });

  it('returns false for an unknown operator', () => {
    expect(compareValue(1, 'nope', 1)).toBe(false);
  });
});

describe('hysteresis (consecutive samples)', () => {
  it('requires two consecutive breaching samples before opening an incident', () => {
    const s = state();
    advanceStreak(s, true);
    expect(decideAction(s, false)).toBe('none'); // 1st breaching sample: not yet
    advanceStreak(s, true);
    expect(decideAction(s, false)).toBe('open'); // 2nd: open
  });

  it('does not open when the breach is broken by a healthy sample', () => {
    const s = state();
    advanceStreak(s, true);
    advanceStreak(s, false);
    expect(decideAction(s, false)).toBe('none');
    advanceStreak(s, true);
    expect(decideAction(s, false)).toBe('none'); // streak restarted
  });

  it('requires two consecutive healthy samples before resolving', () => {
    const s = state();
    s.breachStreak = 5; // simulate an open incident
    advanceStreak(s, false);
    expect(decideAction(s, true)).toBe('none'); // 1st healthy sample
    advanceStreak(s, false);
    expect(decideAction(s, true)).toBe('resolve'); // 2nd
  });

  it('never resolves an incident that is not open', () => {
    const s = state();
    s.okStreak = 10;
    expect(decideAction(s, false)).toBe('none');
  });
});

describe.skipIf(isDiscordConfigured())('discordService (unconfigured)', () => {
  it('reports not configured when no webhook is set', () => {
    expect(isDiscordConfigured()).toBe(false);
  });

  it('returns skipped without attempting a network call', async () => {
    const outcome = await discordService.send({
      title: 'test',
      color: 0,
      fields: [{ name: 'a', value: 'b', inline: true }],
    });
    expect(outcome.status).toBe('skipped');
    expect(outcome.attempts).toBe(0);
    expect(outcome.errorSummary).toBeNull();
  });
});
