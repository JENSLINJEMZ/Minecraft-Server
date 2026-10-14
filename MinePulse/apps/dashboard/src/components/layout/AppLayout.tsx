import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { Sidebar, NAV_ITEMS } from './Sidebar';
import { Topbar } from './Topbar';

function titleForPath(pathname: string): string {
  const match = NAV_ITEMS.find((item) =>
    item.end ? pathname === item.to : pathname.startsWith(item.to),
  );
  return match?.label ?? 'MinePulse';
}

export function AppLayout(): JSX.Element {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <div
        className={clsx(
          'hidden shrink-0 border-r border-border transition-[width] duration-200 lg:block',
          collapsed ? 'w-[72px] overflow-hidden' : 'w-60',
        )}
      >
        <Sidebar collapsed={collapsed} />
      </div>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <div className="absolute left-0 top-0 h-full w-64 border-r border-border bg-surface">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          title={titleForPath(location.pathname)}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          onOpenMobileNav={() => setMobileOpen(true)}
        />
        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          <div className="mx-auto w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
