import { Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import TableSessionPage from './pages/customer/TableSessionPage';
import MenuPage from './pages/customer/MenuPage';
import CartPage from './pages/customer/CartPage';
import OrderConfirmationPage from './pages/customer/OrderConfirmationPage';
import KitchenPage from './pages/staff/KitchenPage';
import WaiterPage from './pages/staff/WaiterPage';
import CashierPage from './pages/staff/CashierPage';
import DashboardPage from './pages/admin/DashboardPage';
import MenuAdminPage from './pages/admin/MenuAdminPage';
import TablesAdminPage from './pages/admin/TablesAdminPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/m/:token" element={<TableSessionPage />} />
      <Route path="/m/:token/menu" element={<MenuPage />} />
      <Route path="/m/:token/cart" element={<CartPage />} />
      <Route path="/m/:token/order/:orderId" element={<OrderConfirmationPage />} />
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
