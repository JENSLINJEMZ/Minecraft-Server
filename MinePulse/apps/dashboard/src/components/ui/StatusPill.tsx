import clsx from 'clsx';
import type { ServerStatus } from '@minepulse/shared';

type State = ServerStatus['state'];

const STATE_STYLES: Record<State, { dot: string; text: string; label: string }> = {
  online: { dot: 'bg-status-online', text: 'text-status-online', label: 'Online' },
  degraded: { dot: 'bg-status-degraded', text: 'text-status-degraded', label: 'Degraded' },
  stale: { dot: 'bg-status-stale', text: 'text-status-stale', label: 'Stale' },
  offline: { dot: 'bg-status-offline', text: 'text-status-offline', label: 'Offline' },
};

export function StatusPill({ state, className }: { state: State; className?: string }): JSX.Element {
  const s = STATE_STYLES[state];
  return (
    <span
      className={clsx(
        'badge border border-current/20 bg-surface-raised/60',
        s.text,
        className,
      )}
      title={`Server state: ${s.label}`}
    >
      <span className="relative flex h-2 w-2">
        {state === 'online' ? (
          <span className={clsx('absolute inline-flex h-full w-full rounded-full animate-pulse-ring', s.dot)} />
        ) : null}
        <span className={clsx('relative inline-flex h-2 w-2 rounded-full', s.dot)} />
      </span>
      {s.label}
    </span>
  );
}

export function stateLabel(state: State): string {
  return STATE_STYLES[state].label;
}
