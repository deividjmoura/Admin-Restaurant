import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function Shell({ title, children, nav }) {
  const { user, logout, tenant } = useAuth();
  const loc = useLocation();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-stone-200 bg-white sticky top-0 z-20">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-stone-500">
              {tenant}
            </p>
            <h1 className="text-lg font-semibold text-stone-900">{title}</h1>
          </div>
          <div className="flex items-center gap-2 text-sm">
            {user && (
              <>
                <span className="hidden sm:inline text-stone-600">
                  {user.name || user.email}
                </span>
                <button
                  type="button"
                  onClick={() => logout()}
                  className="rounded-lg border border-stone-300 px-3 py-1.5 hover:bg-stone-100"
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
                    'rounded-full px-3 py-1.5 whitespace-nowrap ' +
                    (active
                      ? 'bg-amber-500 text-white'
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

export function Button({ children, variant = 'primary', className = '', ...props }) {
  const styles =
    variant === 'primary'
      ? 'bg-amber-500 text-white hover:bg-amber-600'
      : variant === 'danger'
        ? 'bg-red-600 text-white hover:bg-red-700'
        : 'border border-stone-300 bg-white hover:bg-stone-50';
  return (
    <button
      type="button"
      className={
        'rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50 ' +
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

export function Spinner() {
  return (
    <div className="flex justify-center py-12 text-stone-500 text-sm">
      Carregando…
    </div>
  );
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {error.message || String(error)}
    </div>
  );
}

export function Banner({ tone = 'warning', children }) {
  if (!children) return null;
  const tones = {
    warning: 'border-amber-300 bg-amber-50 text-amber-900',
    error: 'border-red-300 bg-red-50 text-red-800',
    info: 'border-sky-300 bg-sky-50 text-sky-900',
  };
  return (
    <div
      role="status"
      className={
        'rounded-xl border px-3 py-2 text-sm ' + (tones[tone] || tones.warning)
      }
    >
      {children}
    </div>
  );
}

/**
 * Estado vazio padronizado para painéis de operação e admin.
 * Use em fila vazia, lista sem itens, etc.
 */
export function EmptyState({ title, description, icon = '✓' }) {
  return (
    <Card className="text-center py-10">
      <p className="text-3xl mb-2" aria-hidden>
        {icon}
      </p>
      <p className="font-medium text-stone-800">{title}</p>
      {description && (
        <p className="text-sm text-stone-500 mt-1">{description}</p>
      )}
    </Card>
  );
}

/**
 * Estado de conexão dos painéis de operação: nunca falha em silêncio.
 * `offline` (5xx/rede) pede atenção; `rateLimited` explica o 429.
 */
export function ConnectionStatus({ offline, rateLimited, error }) {
  return (
    <div className="space-y-2">
      {offline && (
        <Banner tone="error">
          Conexão com o servidor perdida. Os dados na tela podem estar
          desatualizados — tentando reconectar automaticamente.
        </Banner>
      )}
      {rateLimited && (
        <Banner tone="warning">
          Muitas requisições em pouco tempo. Atualizações automáticas foram
          desaceleradas.
        </Banner>
      )}
      <ErrorBox error={error} />
    </div>
  );
}
