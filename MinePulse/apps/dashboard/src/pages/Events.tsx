import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Download, Search, ScrollText } from 'lucide-react';
import clsx from 'clsx';
import { EVENT_CATEGORIES } from '@minepulse/shared';
import { useEvents } from '../lib/queries';
import { ApiError, buildQuery, downloadFile } from '../lib/api';
import { Card, CardHeader, EmptyState, ErrorState, Skeleton } from '../components/ui/primitives';
import { Pagination } from '../components/ui/Pagination';
import { useToast } from '../components/ui/Toast';
import { formatDateTime, titleCase } from '../lib/format';

export function EventsPage(): JSX.Element {
  const [page, setPage] = useState(1);
  const [severity, setSeverity] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const toast = useToast();

  const events = useEvents({
    page,
    pageSize: 25,
    severity: severity || undefined,
    category: category || undefined,
    search: search || undefined,
  });

  const items = useMemo(() => events.data?.items ?? [], [events.data]);

  /** Server-side export of every event matching the current filters. */
  async function exportCsv(): Promise<void> {
    const qs = buildQuery({
      severity: severity || undefined,
      category: category || undefined,
      search: search || undefined,
    });
    try {
      await downloadFile(`/export/events${qs}`, 'minepulse-events.csv');
      toast.success('Export started', 'Downloading all filtered events as CSV.');
    } catch (err) {
      toast.error('Export failed', err instanceof ApiError ? err.message : undefined);
    }
  }

  async function copyId(id: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(id);
      toast.success('Event id copied');
    } catch {
      toast.error('Could not copy');
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Events & Logs"
          subtitle="Structured monitoring events, searchable and filterable"
          icon={<ScrollText className="h-4 w-4" />}
          action={
            <button type="button" className="btn-outline text-xs" onClick={() => void exportCsv()}>
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
          }
        />

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-faint" />
            <input
              className="input w-56 pl-9"
              placeholder="Search summary…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <select
            className="input w-36"
            value={severity}
            onChange={(e) => {
              setSeverity(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All severities</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
          <select
            className="input w-48"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All categories</option>
            {EVENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {titleCase(c)}
              </option>
            ))}
          </select>
        </div>

        {events.isError ? (
          <ErrorState onRetry={() => void events.refetch()} />
        ) : events.isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : items.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-content-faint">
                    <th className="w-8 py-2" />
                    <th className="py-2 pr-3 font-medium">When</th>
                    <th className="py-2 pr-3 font-medium">Severity</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium">Summary</th>
                    <th className="py-2 pr-3 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((e) => (
                    <Fragment key={e.id}>
                      <tr
                        className="table-row cursor-pointer"
                        onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                      >
                        <td className="py-2.5">
                          {expanded === e.id ? (
                            <ChevronDown className="h-4 w-4 text-content-faint" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-content-faint" />
                          )}
                        </td>
                        <td className="py-2.5 pr-3 whitespace-nowrap text-content-muted">
                          {formatDateTime(e.occurredAt)}
                        </td>
                        <td className="py-2.5 pr-3">
                          <span
                            className={clsx(
                              'badge',
                              e.severity === 'critical'
                                ? 'bg-severity-critical/15 text-severity-critical'
                                : e.severity === 'warning'
                                  ? 'bg-severity-warning/15 text-severity-warning'
                                  : 'bg-severity-info/15 text-severity-info',
                            )}
                          >
                            {e.severity}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 text-content-muted">{titleCase(e.eventType)}</td>
                        <td className="py-2.5 pr-3 text-content">{e.summary}</td>
                        <td className="py-2.5 pr-3">
                          <button
                            type="button"
                            className="btn-ghost px-2 py-1"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              void copyId(e.id);
                            }}
                            title="Copy event id"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                      {expanded === e.id ? (
                        <tr className="bg-surface-muted/40">
                          <td />
                          <td colSpan={5} className="py-3 pr-3">
                            <div className="space-y-2 text-xs">
                              <div className="flex flex-wrap gap-x-6 gap-y-1 text-content-faint">
                                <span>
                                  id: <span className="font-mono text-content-muted">{e.id}</span>
                                </span>
                                <span>
                                  requestId:{' '}
                                  <span className="font-mono text-content-muted">{e.requestId ?? '—'}</span>
                                </span>
                                <span>
                                  received: {formatDateTime(e.receivedAt)}
                                </span>
                              </div>
                              {e.details ? (
                                <pre className="max-h-60 overflow-auto rounded-lg border border-border bg-base/60 p-3 font-mono text-[11px] text-content-muted">
                                  {JSON.stringify(e.details, null, 2)}
                                </pre>
                              ) : (
                                <p className="text-content-faint">No additional details.</p>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={events.data!.page}
              pageSize={events.data!.pageSize}
              total={events.data!.total}
              totalPages={events.data!.totalPages}
              onPage={setPage}
            />
          </>
        ) : (
          <EmptyState title="No events found" description="Adjust the filters or wait for the agent to report." />
        )}
      </Card>
    </div>
  );
}
