import clsx from 'clsx';
import { Wifi, WifiOff, Loader2 } from 'lucide-react';
import { useSocket } from '../../context/SocketContext';

export function ConnectionIndicator(): JSX.Element {
  const { status } = useSocket();

  const config = {
    connected: {
      label: 'Live',
      className: 'text-status-online',
      icon: <Wifi className="h-3.5 w-3.5" />,
    },
    connecting: {
      label: 'Connecting',
      className: 'text-severity-warning',
      icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
    },
    disconnected: {
      label: 'Offline',
      className: 'text-status-offline',
      icon: <WifiOff className="h-3.5 w-3.5" />,
    },
  }[status];

  return (
    <span
      className={clsx('badge border border-border bg-surface-raised/70', config.className)}
      title="Realtime connection to the API"
    >
      {config.icon}
      {config.label}
    </span>
  );
}
