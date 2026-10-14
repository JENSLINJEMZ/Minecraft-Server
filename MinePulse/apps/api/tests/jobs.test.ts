import { describe, expect, it } from 'vitest';
import {
  aggregateSamples,
  average,
  floorToHour,
  floorToMinute,
  maxOf,
  rollUpAggregates,
} from '../src/services/aggregation.js';
import { csvEscape, toCsv } from '../src/utils/csv.js';

const sample = (over: Partial<Parameters<typeof aggregateSamples>[0][number]> = {}) => ({
  tps1m: 20,
  tps5m: 20,
  tps15m: 20,
  mspt: 2,
  heapUsedBytes: 1_000n,
  heapMaxBytes: 8_000n,
  cpuUsagePercent: 10,
  ...over,
});

describe('bucket boundaries', () => {
  it('floors to the minute', () => {
    expect(floorToMinute(Date.UTC(2026, 0, 1, 3, 7, 45, 123))).toBe(
      Date.UTC(2026, 0, 1, 3, 7, 0, 0),
    );
  });

  it('floors to the hour', () => {
    expect(floorToHour(Date.UTC(2026, 0, 1, 3, 7, 45))).toBe(Date.UTC(2026, 0, 1, 3, 0, 0));
  });
});

describe('average / maxOf', () => {
  it('ignores nulls and non-finite values', () => {
    expect(average([1, null, 3, undefined, NaN])).toBe(2);
    expect(average([null, undefined])).toBeNull();
    expect(maxOf([1, null, 5, 3])).toBe(5);
    expect(maxOf([])).toBeNull();
  });
});

describe('aggregateSamples', () => {
  it('averages samples and maxes mspt, carrying player counts', () => {
    const bucket = aggregateSamples(
      [
        sample({ tps1m: 20, mspt: 1, cpuUsagePercent: 5 }),
        sample({ tps1m: 18, mspt: 9, cpuUsagePercent: 15 }),
      ],
      [3, 5],
    );
    expect(bucket.tps1mAvg).toBe(19);
    expect(bucket.msptAvg).toBe(5);
    expect(bucket.msptMax).toBe(9);
    expect(bucket.cpuAvg).toBe(10);
    expect(bucket.heapUsedAvg).toBe(1000);
    expect(bucket.playerCountAvg).toBe(4);
    expect(bucket.playerCountMax).toBe(5);
    expect(bucket.sampleCount).toBe(2);
  });

  it('returns nulls (not NaN) for an empty batch', () => {
    const bucket = aggregateSamples([]);
    expect(bucket.tps1mAvg).toBeNull();
    expect(bucket.msptMax).toBeNull();
    expect(bucket.sampleCount).toBe(0);
  });
});

describe('rollUpAggregates', () => {
  it('rolls 1-minute aggregates into an hour, summing sample counts', () => {
    const hour = rollUpAggregates([
      {
        tps1mAvg: 20,
        tps5mAvg: 20,
        tps15mAvg: 20,
        msptAvg: 2,
        msptMax: 4,
        heapUsedAvg: 1000,
        heapMaxAvg: 8000,
        cpuAvg: 10,
        playerCountAvg: 2,
        playerCountMax: 3,
        sampleCount: 6,
      },
      {
        tps1mAvg: 18,
        tps5mAvg: 19,
        tps15mAvg: 19,
        msptAvg: 6,
        msptMax: 12,
        heapUsedAvg: 2000,
        heapMaxAvg: 8000,
        cpuAvg: 30,
        playerCountAvg: 4,
        playerCountMax: 6,
        sampleCount: 5,
      },
    ]);
    expect(hour.tps1mAvg).toBe(19);
    expect(hour.msptMax).toBe(12);
    expect(hour.cpuAvg).toBe(20);
    expect(hour.playerCountMax).toBe(6);
    expect(hour.sampleCount).toBe(11);
  });
});

describe('csv', () => {
  it('escapes quotes, commas and newlines', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
    expect(csvEscape(42)).toBe('42');
  });

  it('serialises objects as JSON', () => {
    expect(csvEscape({ a: 1 })).toBe('"{""a"":1}"');
  });

  it('builds a header row plus CRLF-terminated data rows', () => {
    const csv = toCsv(['a', 'b'], [
      [1, 'x,y'],
      [2, 'z'],
    ]);
    expect(csv).toBe('a,b\r\n1,"x,y"\r\n2,z\r\n');
  });
});
