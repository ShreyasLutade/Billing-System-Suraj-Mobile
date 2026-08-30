import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { GuestOnly, RequireAdmin, RequireAuth } from "./auth/guards";
import { AppShell } from "./components/AppShell";
import { ThemeProvider } from "./theme/ThemeContext";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { AnalyticsPaymentsPage } from "./pages/AnalyticsPaymentsPage";
import { AnalyticsExchangesPage } from "./pages/AnalyticsExchangesPage";
import { AddStockPage } from "./pages/AddStockPage";
import { BillDetailPage } from "./pages/BillDetailPage";
import { BillsPage } from "./pages/BillsPage";
import { CreateBillPage } from "./pages/CreateBillPage";
import { DuesPage } from "./pages/DuesPage";
import { LoginPage } from "./pages/LoginPage";
import { StockPage } from "./pages/StockPage";
import { SupplierDetailPage } from "./pages/SupplierDetailPage";
import { PurchaseDetailPage } from "./pages/PurchaseDetailPage";
import { SuppliersPage } from "./pages/SuppliersPage";

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<GuestOnly />}>
              <Route path="login" element={<LoginPage />} />
            </Route>

            <Route element={<RequireAuth />}>
              <Route element={<AppShell />}>
                <Route index element={<CreateBillPage key="new-bill" />} />
                <Route path="bills" element={<BillsPage />} />
                <Route
                  path="bills/:id/edit"
                  element={<CreateBillPage key="edit-bill" />}
                />
                <Route path="bills/:id" element={<BillDetailPage />} />
                <Route path="dues" element={<DuesPage />} />
                <Route path="stock" element={<StockPage />} />
                <Route path="stock/add" element={<AddStockPage />} />
                <Route path="suppliers" element={<SuppliersPage />} />
                <Route
                  path="suppliers/:id/purchases/:purchaseId"
                  element={<PurchaseDetailPage />}
                />
                <Route path="suppliers/:id" element={<SupplierDetailPage />} />
                <Route element={<RequireAdmin />}>
                  <Route path="analytics" element={<AnalyticsPage />} />
                  <Route
                    path="analytics/payments"
                    element={<AnalyticsPaymentsPage />}
                  />
                  <Route
                    path="analytics/exchanges"
                    element={<AnalyticsExchangesPage />}
                  />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
