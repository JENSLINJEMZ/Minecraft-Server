import type { ServerEvent } from '@minepulse/shared';
import { Badge } from '../ui/primitives';
import { titleCase, formatDateTime } from '../../lib/format';

export function EventList({ events, dense }: { events: ServerEvent[]; dense?: boolean }): JSX.Element {
  return (
    <ul className="divide-y divide-border-muted/60">
      {events.map((event) => (
        <li key={event.id} className="flex items-start gap-3 py-2.5">
          <Badge variant={event.severity} className="mt-0.5 shrink-0">
            {event.severity}
          </Badge>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-content">{event.summary}</p>
            <p className="mt-0.5 text-xs text-content-faint">
              {titleCase(event.eventType)}
              {!dense ? ` · ${formatDateTime(event.occurredAt)}` : ''}
            </p>
          </div>
          {dense ? (
            <span className="mt-0.5 shrink-0 text-xs text-content-faint">
              {formatDateTime(event.occurredAt)}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
