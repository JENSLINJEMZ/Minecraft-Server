import clsx from 'clsx';
import { METRIC_RANGES } from '@minepulse/shared';

export function RangeSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (range: string) => void;
}): JSX.Element {
  return (
    <div className="inline-flex rounded-lg border border-border bg-surface-muted p-0.5">
      {METRIC_RANGES.map((range) => (
        <button
          key={range}
          type="button"
          onClick={() => onChange(range)}
          className={clsx(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            value === range
              ? 'bg-accent-soft text-accent-hover'
              : 'text-content-muted hover:text-content',
          )}
        >
          {range}
        </button>
      ))}
    </div>
  );
}
