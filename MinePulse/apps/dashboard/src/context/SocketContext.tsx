import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Socket } from 'socket.io-client';
import { createSocket } from '../lib/socket';
import { useAuth } from './AuthContext';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface SocketContextValue {
  socket: Socket | null;
  status: ConnectionStatus;
}

const SocketContext = createContext<SocketContextValue>({ socket: null, status: 'disconnected' });

export function SocketProvider({ children }: { children: ReactNode }): JSX.Element {
  const { user } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');

  useEffect(() => {
    if (!user) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setStatus('disconnected');
      return;
    }

    const socket = createSocket();
    socketRef.current = socket;
    setStatus('connecting');

    socket.on('connect', () => setStatus('connected'));
    socket.on('disconnect', () => setStatus('disconnected'));
    socket.on('connect_error', () => setStatus('disconnected'));

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user]);

  const value = useMemo<SocketContextValue>(
    () => ({ socket: socketRef.current, status }),
    [status, user],
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketContextValue {
  return useContext(SocketContext);
}
