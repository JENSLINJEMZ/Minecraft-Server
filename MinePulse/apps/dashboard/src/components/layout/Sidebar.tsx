import clsx from 'clsx';
import { NavLink } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Bell,
  Boxes,
  Cpu,
  ScrollText,
  Settings as SettingsIcon,
  Users,
} from 'lucide-react';
import type { ComponentType } from 'react';

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  end?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Overview', icon: Activity, end: true },
  { to: '/performance', label: 'Performance', icon: BarChart3 },
  { to: '/players', label: 'Players', icon: Users },
  { to: '/plugins', label: 'Plugins', icon: Boxes },
  { to: '/events', label: 'Events & Logs', icon: ScrollText },
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

export function Sidebar({
  collapsed = false,
  onNavigate,
  className,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
  className?: string;
}): JSX.Element {
  return (
    <aside className={clsx('flex h-full flex-col gap-1 bg-surface-muted/60 p-3', className)}>
      <div className={clsx('mb-3 flex items-center gap-2.5', collapsed ? 'justify-center px-0 py-2' : 'px-2 py-2')}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-hover">
          <Cpu className="h-5 w-5" />
        </div>
        {!collapsed ? (
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-none text-content">MinePulse</p>
            <p className="mt-1 text-[11px] leading-none text-content-faint">Server Monitor</p>
          </div>
        ) : null}
      </div>

      <nav className="flex flex-1 flex-col gap-0.5">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 rounded-lg py-2 text-sm transition-colors',
                collapsed ? 'justify-center px-2' : 'px-3',
                isActive
                  ? 'bg-accent-soft text-content'
                  : 'text-content-muted hover:bg-surface-hover hover:text-content',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={clsx('h-4 w-4 shrink-0', isActive ? 'text-accent-hover' : 'text-content-faint')}
                />
                {!collapsed ? label : null}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {!collapsed ? (
        <div className="rounded-lg border border-border-muted bg-surface/50 p-3 text-[11px] text-content-faint">
          Paper 26.3 · v0.1.0
        </div>
      ) : null}
    </aside>
  );
}
