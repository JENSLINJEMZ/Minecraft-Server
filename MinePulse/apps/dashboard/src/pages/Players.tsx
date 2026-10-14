import { useState } from 'react';
import { Search, Users } from 'lucide-react';
import clsx from 'clsx';
import { usePlayerSessions, usePlayers } from '../lib/queries';
import { Card, CardHeader, EmptyState, ErrorState, Skeleton } from '../components/ui/primitives';
import { Pagination } from '../components/ui/Pagination';
import { Dialog } from '../components/ui/Dialog';
import { formatAgo, formatDateTime, formatDuration } from '../lib/format';

export function PlayersPage(): JSX.Element {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const players = usePlayers({ page, pageSize: 20, search: search || undefined });

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Players"
          subtitle="Every player seen by the agent, identified by UUID"
          icon={<Users className="h-4 w-4" />}
          action={
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-faint" />
              <input
                className="input w-56 pl-9"
                placeholder="Search username…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          }
        />

        {players.isError ? (
          <ErrorState onRetry={() => void players.refetch()} />
        ) : players.isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : players.data && players.data.items.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-content-faint">
                    <th className="py-2 pr-3 font-medium">Player</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Last seen</th>
                    <th className="py-2 pr-3 font-medium">Playtime</th>
                    <th className="py-2 pr-3 font-medium">Sessions</th>
                  </tr>
                </thead>
                <tbody>
                  {players.data.items.map((p) => (
                    <tr
                      key={p.uuid}
                      className="table-row cursor-pointer"
                      onClick={() => setSelected(p.uuid)}
                    >
                      <td className="py-2.5 pr-3">
                        <div className="font-medium text-content">{p.lastKnownUsername}</div>
                        <div className="font-mono text-[11px] text-content-faint">{p.uuid}</div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span
                          className={clsx(
                            'inline-flex items-center gap-1.5 text-xs',
                            p.online ? 'text-status-online' : 'text-content-faint',
                          )}
                        >
                          <span
                            className={clsx(
                              'h-2 w-2 rounded-full',
                              p.online ? 'bg-status-online' : 'bg-content-faint',
                            )}
                          />
                          {p.online ? 'Online' : 'Offline'}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-content-muted">
                        {p.lastSeenAt ? formatAgo(p.lastSeenAt) : '—'}
                      </td>
                      <td className="py-2.5 pr-3 text-content-muted">
                        {formatDuration(p.totalPlaytimeSeconds)}
                      </td>
                      <td className="py-2.5 pr-3 text-content-muted">{p.sessionCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={players.data.page}
              pageSize={players.data.pageSize}
              total={players.data.total}
              totalPages={players.data.totalPages}
              onPage={setPage}
            />
          </>
        ) : (
          <EmptyState
            title="No players yet"
            description="Players are recorded when the agent reports them in a heartbeat or a join event."
          />
        )}
      </Card>

      <PlayerDetail uuid={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function PlayerDetail({ uuid, onClose }: { uuid: string | null; onClose: () => void }): JSX.Element {
  const [page, setPage] = useState(1);
  const sessions = usePlayerSessions(uuid, page);

  return (
    <Dialog open={Boolean(uuid)} onClose={onClose} title="Player sessions" wide description={uuid ?? undefined}>
      {sessions.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : sessions.data && sessions.data.items.length > 0 ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-content-faint">
                  <th className="py-2 pr-3 font-medium">Joined</th>
                  <th className="py-2 pr-3 font-medium">Left</th>
                  <th className="py-2 pr-3 font-medium">Duration</th>
                  <th className="py-2 pr-3 font-medium">Username</th>
                </tr>
              </thead>
              <tbody>
                {sessions.data.items.map((s) => (
                  <tr key={s.id} className="table-row">
                    <td className="py-2 pr-3 text-content-muted">{formatDateTime(s.joinedAt)}</td>
                    <td className="py-2 pr-3 text-content-muted">
                      {s.leftAt ? formatDateTime(s.leftAt) : <span className="text-status-online">online</span>}
                    </td>
                    <td className="py-2 pr-3 text-content-muted">
                      {s.durationSeconds !== null ? formatDuration(s.durationSeconds) : '—'}
                    </td>
                    <td className="py-2 pr-3 text-content-muted">{s.usernameAtJoin}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={sessions.data.page}
            pageSize={sessions.data.pageSize}
            total={sessions.data.total}
            totalPages={sessions.data.totalPages}
            onPage={setPage}
          />
        </>
      ) : (
        <EmptyState title="No sessions recorded" description="This player has no stored sessions yet." />
      )}
    </Dialog>
  );
}
