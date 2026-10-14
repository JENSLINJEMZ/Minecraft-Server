import { Menu, PanelLeftClose, PanelLeftOpen, LogOut } from 'lucide-react';
import { ConnectionIndicator } from './ConnectionIndicator';
import { useAuth } from '../../context/AuthContext';

export function Topbar({
  title,
  collapsed,
  onToggleCollapse,
  onOpenMobileNav,
}: {
  title: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenMobileNav: () => void;
}): JSX.Element {
  const { user, logout } = useAuth();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-base/80 px-4 backdrop-blur">
      <button
        type="button"
        className="btn-ghost px-2 lg:hidden"
        onClick={onOpenMobileNav}
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>

      <button
        type="button"
        className="btn-ghost hidden px-2 lg:inline-flex"
        onClick={onToggleCollapse}
        aria-label="Toggle sidebar"
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
      </button>

      <h1 className="truncate text-sm font-semibold text-content">{title}</h1>

      <div className="ml-auto flex items-center gap-3">
        <ConnectionIndicator />
        {user ? (
          <div className="flex items-center gap-2">
            <div className="hidden text-right sm:block">
              <p className="text-xs font-medium leading-none text-content">{user.email}</p>
              <p className="mt-1 text-[11px] leading-none text-content-faint">{user.role}</p>
            </div>
            <button
              type="button"
              className="btn-outline px-2.5"
              onClick={() => void logout()}
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
