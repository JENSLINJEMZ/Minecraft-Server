import clsx from 'clsx';
import type { ReactNode } from 'react';

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return <div className={clsx('card p-4 sm:p-5', className)}>{children}</div>;
}

export function CardHeader({
  title,
  subtitle,
  action,
  icon,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}): JSX.Element {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        {icon ? <div className="mt-0.5 text-content-muted">{icon}</div> : null}
        <div>
          <h3 className="text-sm font-semibold text-content">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-xs text-content-muted">{subtitle}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

export function Spinner({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      className={clsx('h-4 w-4 animate-spin text-content-muted', className)}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }): JSX.Element {
  return <div className={clsx('skeleton', className)} />;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-12 text-center">
      {icon ? <div className="text-content-faint">{icon}</div> : null}
      <p className="text-sm font-medium text-content">{title}</p>
      {description ? <p className="max-w-md text-xs text-content-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-status-offline/30 bg-status-offline/5 px-6 py-10 text-center">
      <p className="text-sm font-medium text-content">Could not load data</p>
      <p className="max-w-md text-xs text-content-muted">{message ?? 'An unexpected error occurred.'}</p>
      {onRetry ? (
        <button type="button" className="btn-outline mt-2" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

const badgeVariants: Record<string, string> = {
  info: 'bg-severity-info/15 text-severity-info',
  warning: 'bg-severity-warning/15 text-severity-warning',
  critical: 'bg-severity-critical/15 text-severity-critical',
  online: 'bg-status-online/15 text-status-online',
  degraded: 'bg-status-degraded/15 text-status-degraded',
  stale: 'bg-status-stale/15 text-status-stale',
  offline: 'bg-status-offline/15 text-status-offline',
  neutral: 'bg-surface-raised text-content-muted',
  accent: 'bg-accent-soft text-accent-hover',
};

export function Badge({
  children,
  variant = 'neutral',
  className,
}: {
  children: ReactNode;
  variant?: keyof typeof badgeVariants | string;
  className?: string;
}): JSX.Element {
  return (
    <span className={clsx('badge', badgeVariants[variant] ?? badgeVariants.neutral, className)}>
      {children}
    </span>
  );
}
