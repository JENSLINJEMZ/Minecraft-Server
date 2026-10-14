import { useMemo, useState } from 'react';
import { Boxes, Search } from 'lucide-react';
import clsx from 'clsx';
import { usePlugins } from '../lib/queries';
import { Card, CardHeader, EmptyState, Skeleton } from '../components/ui/primitives';
import { formatAgo } from '../lib/format';

export function PluginsPage(): JSX.Element {
  const plugins = usePlugins();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const list = plugins.data?.plugins ?? [];
    if (!search) return list;
    const q = search.toLowerCase();
    return list.filter((p) => p.pluginName.toLowerCase().includes(q));
  }, [plugins.data, search]);

  const enabledCount = plugins.data?.plugins.filter((p) => p.enabled).length ?? 0;
  const disabledCount = plugins.data?.plugins.filter((p) => !p.enabled).length ?? 0;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Installed plugins"
          subtitle={
            plugins.data
              ? `${plugins.data.pluginCount} plugins · collected ${formatAgo(plugins.data.collectedAt)}`
              : 'Latest inventory snapshot from the agent'
          }
          icon={<Boxes className="h-4 w-4" />}
          action={
            <div className="flex items-center gap-3">
              <span className="hidden text-xs text-content-muted sm:inline">
                {enabledCount} enabled · {disabledCount} disabled
              </span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-faint" />
                <input
                  className="input w-56 pl-9"
                  placeholder="Filter plugins…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          }
        />

        {plugins.isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : filtered.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-content-faint">
                  <th className="py-2 pr-3 font-medium">Plugin</th>
                  <th className="py-2 pr-3 font-medium">Version</th>
                  <th className="py-2 pr-3 font-medium">API</th>
                  <th className="py-2 pr-3 font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.pluginName} className="table-row">
                    <td className="py-2.5 pr-3 font-medium text-content">{p.pluginName}</td>
                    <td className="py-2.5 pr-3 font-mono text-xs text-content-muted">{p.version}</td>
                    <td className="py-2.5 pr-3 font-mono text-xs text-content-muted">
                      {p.apiVersion ?? '—'}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={clsx(
                          'inline-flex items-center gap-1.5 text-xs',
                          p.enabled ? 'text-status-online' : 'text-content-faint',
                        )}
                      >
                        <span
                          className={clsx(
                            'h-2 w-2 rounded-full',
                            p.enabled ? 'bg-status-online' : 'bg-content-faint',
                          )}
                        />
                        {p.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={plugins.data ? 'No plugins match your filter' : 'No plugin snapshot yet'}
            description={
              plugins.data
                ? 'Try a different search term.'
                : 'The agent sends a plugin inventory shortly after it connects.'
            }
          />
        )}
      </Card>
    </div>
  );
}
