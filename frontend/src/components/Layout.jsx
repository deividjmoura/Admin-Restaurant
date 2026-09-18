import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/** Shell staff/admin — header sticky + nav amber/stone */
export function Shell({ title, children, nav }) {
  const { user, logout, tenant } = useAuth();
  const loc = useLocation();

  return (
    <div className="min-h-screen flex flex-col bg-stone-50">
      <header className="border-b border-stone-200 bg-white/95 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-stone-500 truncate">
              {tenant || 'loja'}
            </p>
            <h1 className="text-lg font-semibold text-stone-900 truncate">{title}</h1>
          </div>
          <div className="flex items-center gap-2 text-sm shrink-0">
            {user && (
              <>
                <span className="hidden sm:inline text-stone-600 truncate max-w-[10rem]">
                  {user.name || user.email}
                </span>
                <button
                  type="button"
                  onClick={() => logout()}
                  className="rounded-lg border border-stone-300 px-3 py-1.5 text-stone-700 hover:bg-stone-100 transition-colors"
                >
                  Sair
                </button>
              </>
            )}
          </div>
        </div>
        {nav && (
          <nav className="mx-auto max-w-5xl px-4 pb-2 flex gap-1 overflow-x-auto text-sm">
            {nav.map((item) => {
              const active = loc.pathname.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={
                    'rounded-full px-3 py-1.5 whitespace-nowrap transition-colors ' +
                    (active
                      ? 'bg-amber-500 text-white shadow-sm'
                      : 'text-stone-600 hover:bg-stone-100')
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}
      </header>
      <main className="flex-1 mx-auto w-full max-w-5xl px-4 py-4">{children}</main>
    </div>
  );
}

export function Card({ children, className = '' }) {
  return (
    <div
      className={
        'rounded-2xl border border-stone-200 bg-white p-4 shadow-sm ' + className
      }
    >
      {children}
    </div>
  );
}

export function Button({
  children,
  variant = 'primary',
  className = '',
  type = 'button',
  ...props
}) {
  const styles =
    variant === 'primary'
      ? 'bg-amber-500 text-white hover:bg-amber-600 shadow-sm'
      : variant === 'danger'
        ? 'bg-red-600 text-white hover:bg-red-700'
        : 'border border-stone-300 bg-white text-stone-800 hover:bg-stone-50';
  return (
    <button
      type={type}
      className={
        'inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none ' +
        styles +
        ' ' +
        className
      }
      {...props}
    >
      {children}
    </button>
  );
}

export function Spinner({ label = 'Carregando…' }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-16 text-stone-500"
      role="status"
      aria-live="polite"
    >
      <div
        className="h-8 w-8 rounded-full border-2 border-stone-200 border-t-amber-500 animate-spin"
        aria-hidden
      />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function ErrorBox({ error, title = 'Algo deu errado' }) {
  if (!error) return null;
  const message = error.message || String(error);
  return (
    <div
      className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800"
      role="alert"
    >
      <p className="font-medium text-red-900">{title}</p>
      <p className="mt-0.5 text-red-800/90">{message}</p>
    </div>
  );
}

/** Empty state legível — use em listas vazias */
export function EmptyState({ title, description, action }) {
  return (
    <Card className="text-center py-8 px-4">
      <p className="text-sm font-medium text-stone-700">{title}</p>
      {description && (
        <p className="text-xs text-stone-500 mt-1.5 max-w-sm mx-auto">{description}</p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </Card>
  );
}

export function SuccessBox({ children }) {
  if (!children) return null;
  return (
    <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
      {children}
    </div>
  );
}
