import clsx from 'clsx';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircle2, Info, TriangleAlert, XCircle, X } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

interface ToastContextValue {
  push: (toast: Omit<Toast, 'id'>) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastKind, ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 text-status-online" />,
  error: <XCircle className="h-4 w-4 text-status-offline" />,
  warning: <TriangleAlert className="h-4 w-4 text-severity-warning" />,
  info: <Info className="h-4 w-4 text-severity-info" />,
};

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = ++counter;
      setToasts((prev) => [...prev, { id, ...toast }]);
      window.setTimeout(() => remove(id), 5000);
    },
    [remove],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      success: (title, description) => push({ kind: 'success', title, description }),
      error: (title, description) => push({ kind: 'error', title, description }),
      info: (title, description) => push({ kind: 'info', title, description }),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={clsx(
              'pointer-events-auto flex items-start gap-3 rounded-lg border border-border bg-surface-raised/95 p-3 shadow-card backdrop-blur',
            )}
            role="status"
          >
            <div className="mt-0.5">{ICONS[toast.kind]}</div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-content">{toast.title}</p>
              {toast.description ? (
                <p className="mt-0.5 text-xs text-content-muted">{toast.description}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => remove(toast.id)}
              className="text-content-faint transition-colors hover:text-content"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
