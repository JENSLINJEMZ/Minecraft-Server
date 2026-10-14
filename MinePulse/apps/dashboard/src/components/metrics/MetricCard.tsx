import clsx from 'clsx';
import type { ReactNode } from 'react';
import { Skeleton } from '../ui/primitives';

export function MetricCard({
  label,
  value,
  hint,
  icon,
  tone = 'default',
  loading,
  footer,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: 'default' | 'good' | 'warn' | 'bad';
  loading?: boolean;
  footer?: ReactNode;
}): JSX.Element {
  const toneClass = {
    default: 'text-content',
    good: 'text-status-online',
    warn: 'text-status-degraded',
    bad: 'text-status-offline',
  }[tone];

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-content-muted">{label}</p>
        {icon ? <span className="text-content-faint">{icon}</span> : null}
      </div>
      <div className="mt-2">
        {loading ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <p className={clsx('text-xl font-semibold tabular-nums', toneClass)}>{value}</p>
        )}
      </div>
      {hint ? <p className="mt-1 text-xs text-content-faint">{hint}</p> : null}
      {footer ? <div className="mt-2">{footer}</div> : null}
    </div>
  );
}
