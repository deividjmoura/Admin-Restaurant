import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { entryContext } from './context/entry-context';
import LandingPage, { AccessPage } from './pages/LandingPage';
import PlatformPage from './pages/platform/PlatformPage';
const DevHome = import.meta.env.DEV
  ? lazy(() => import('./pages/HomePage'))
  : null;
import LoginPage from './pages/LoginPage';
import TableSessionPage from './pages/customer/TableSessionPage';
import MenuPage from './pages/customer/MenuPage';
import CartPage from './pages/customer/CartPage';
import KitchenPage from './pages/staff/KitchenPage';
import WaiterPage from './pages/staff/WaiterPage';
import CashierPage from './pages/staff/CashierPage';
import DashboardPage from './pages/admin/DashboardPage';
import MenuAdminPage from './pages/admin/MenuAdminPage';
import TablesAdminPage from './pages/admin/TablesAdminPage';

export default function App() {
  if (entryContext.type === 'marketing')
    return (
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/contato" element={<LandingPage />} />
        <Route path="/login" element={<AccessPage />} />
        {DevHome && (
          <Route
            path="/dev"
            element={
              <Suspense>
                <DevHome />
              </Suspense>
            }
          />
        )}
        <Route path="*" element={<NotFound />} />
      </Routes>
    );
  if (entryContext.type === 'platform')
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/platform/login" element={<LoginPage />} />
        <Route path="/" element={<Navigate to="/platform/stores" replace />} />
        <Route path="/platform/stores" element={<PlatformPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    );
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      {DevHome && (
        <Route
          path="/dev"
          element={
            <Suspense>
              <DevHome />
            </Suspense>
          }
        />
      )}
      <Route path="*" element={<NotFound />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/m/:token" element={<TableSessionPage />} />
      <Route path="/m/:token/menu" element={<MenuPage />} />
      <Route path="/m/:token/cart" element={<CartPage />} />
      <Route path="/kitchen" element={<KitchenPage station="KITCHEN" />} />
      <Route path="/bar" element={<KitchenPage station="BAR" />} />
      <Route path="/waiter" element={<WaiterPage />} />
      <Route path="/cashier" element={<CashierPage />} />
      <Route path="/admin" element={<DashboardPage />} />
      <Route path="/admin/menu" element={<MenuAdminPage />} />
      <Route path="/admin/tables" element={<TablesAdminPage />} />
    </Routes>
  );
}

function NotFound() {
  return (
    <main className="mx-auto max-w-xl p-12">
      <h1 className="text-2xl font-bold">Página não encontrada</h1>
      <p className="mt-3">Este endereço não está disponível neste site.</p>
      <a className="underline" href="/">
        Voltar ao início
      </a>
    </main>
  );
}
