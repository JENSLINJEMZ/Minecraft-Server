import { describe, expect, it } from 'vitest';
import {
  EMPTY_FORM,
  conditionText,
  deliveryVariant,
  formFromRule,
  parseForm,
  severityVariant,
  type FormState,
} from './alerts';

describe('conditionText', () => {
  it('renders a readable condition using metric + operator labels', () => {
    expect(conditionText({ metric: 'tps', operator: 'lt', threshold: 15 })).toBe('TPS < 15');
    expect(conditionText({ metric: 'heap_percent', operator: 'gte', threshold: 90 })).toBe('heap ≥ 90');
  });

  it('falls back to the raw metric/operator when unknown', () => {
    const weird = { metric: 'mystery', operator: 'zz', threshold: 1 } as unknown as Parameters<
      typeof conditionText
    >[0];
    expect(conditionText(weird)).toBe('mystery zz 1');
  });
});

describe('badge variants', () => {
  it('maps severity to a badge variant', () => {
    expect(severityVariant('critical')).toBe('critical');
    expect(severityVariant('warning')).toBe('warning');
    expect(severityVariant('info')).toBe('info');
    expect(severityVariant('other')).toBe('info');
  });

  it('maps delivery status to a badge variant', () => {
    expect(deliveryVariant('delivered')).toBe('online');
    expect(deliveryVariant('failed')).toBe('offline');
    expect(deliveryVariant('skipped')).toBe('stale');
    expect(deliveryVariant('none')).toBe('neutral');
  });
});

describe('parseForm', () => {
  it('accepts a valid form and coerces numbers', () => {
    const result = parseForm({ ...EMPTY_FORM, name: '  TPS low  ', threshold: '12.5' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe('TPS low');
      expect(result.value.threshold).toBe(12.5);
      expect(result.value.evaluationWindowSeconds).toBe(60);
    }
  });

  it('rejects a blank name', () => {
    const result = parseForm({ ...EMPTY_FORM, name: '   ' });
    expect(result).toEqual({ ok: false, error: 'Name is required.' });
  });

  it('rejects a non-numeric threshold', () => {
    const result = parseForm({ ...EMPTY_FORM, name: 'x', threshold: 'abc' });
    expect(result.ok).toBe(false);
  });

  it('rejects an out-of-range evaluation window', () => {
    const form: FormState = { ...EMPTY_FORM, name: 'x', evaluationWindowSeconds: '5' };
    expect(parseForm(form).ok).toBe(false);
  });

  it('rejects a negative cooldown', () => {
    const form: FormState = { ...EMPTY_FORM, name: 'x', cooldownSeconds: '-1' };
    expect(parseForm(form).ok).toBe(false);
  });
});

describe('formFromRule', () => {
  it('round-trips a rule into editable strings', () => {
    const form = formFromRule({
      id: 'r1',
      serverId: 's1',
      name: 'Low TPS',
      metric: 'tps',
      operator: 'lt',
      threshold: 18,
      evaluationWindowSeconds: 120,
      severity: 'critical',
      cooldownSeconds: 300,
      enabled: false,
      lastTriggeredAt: null,
      lastDeliveryStatus: 'none',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(form).toMatchObject({
      name: 'Low TPS',
      metric: 'tps',
      threshold: '18',
      evaluationWindowSeconds: '120',
      enabled: false,
    });
  });
});
