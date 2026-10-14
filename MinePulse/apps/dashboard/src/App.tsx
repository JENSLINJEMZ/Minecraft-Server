import { Link, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { ProtectedRoute } from './routes/ProtectedRoute';
import { LoginPage } from './pages/Login';
import { OverviewPage } from './pages/Overview';
import { PerformancePage } from './pages/Performance';
import { PlayersPage } from './pages/Players';
import { PluginsPage } from './pages/Plugins';
import { EventsPage } from './pages/Events';
import { AlertsPage } from './pages/Alerts';
import { SettingsPage } from './pages/Settings';

function NotFoundPage(): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <p className="text-3xl font-semibold text-content">404</p>
      <p className="text-sm text-content-muted">This page does not exist.</p>
      <Link to="/" className="btn-primary">
        Back to Overview
      </Link>
    </div>
  );
}

export function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="performance" element={<PerformancePage />} />
          <Route path="players" element={<PlayersPage />} />
          <Route path="plugins" element={<PluginsPage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="alerts" element={<AlertsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
