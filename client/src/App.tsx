import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { GuestOnly, RequireAccessories, RequireAdmin, RequireAuth } from "./auth/guards";
import { AppShell } from "./components/AppShell";
import { SectionGate } from "./components/SectionGate";
import { ThemeProvider } from "./theme/ThemeContext";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { AnalyticsPaymentsPage } from "./pages/AnalyticsPaymentsPage";
import { AnalyticsExchangesPage } from "./pages/AnalyticsExchangesPage";
import { AnalyticsPurchasesPage } from "./pages/AnalyticsPurchasesPage";
import { AnalyticsPendingItemsPage } from "./pages/AnalyticsPendingItemsPage";
import { BackupPage } from "./pages/BackupPage";
import { RecycleBinPage } from "./pages/RecycleBinPage";
import { ManageUsersPage } from "./pages/ManageUsersPage";
import { AddAccessoriesPage } from "./pages/AddAccessoriesPage";
import { AddStockPage } from "./pages/AddStockPage";
import { BillDetailPage } from "./pages/BillDetailPage";
import { BillsPage } from "./pages/BillsPage";
import { CreateBillPage } from "./pages/CreateBillPage";
import { DuesPage } from "./pages/DuesPage";
import { LoginPage } from "./pages/LoginPage";
import { StockPage } from "./pages/StockPage";
import { SupplierDetailPage } from "./pages/SupplierDetailPage";
import { PurchaseDetailPage } from "./pages/PurchaseDetailPage";
import { ReplaceProductPage } from "./pages/ReplaceProductPage";
import { RepairAnalyticsPage } from "./pages/RepairAnalyticsPage";
import { RepairHistoryPage } from "./pages/RepairHistoryPage";
import { RepairHomePage } from "./pages/RepairHomePage";
import { RepairJobPage } from "./pages/RepairJobPage";
import { SuppliersPage } from "./pages/SuppliersPage";
import { AccLayout } from "./acc/shared";
import { AccCounterPage } from "./acc/AccCounterPage";
import { AccWholesalePage } from "./acc/AccWholesalePage";
import { AccStockPage } from "./acc/AccStockPage";
import { AccProductFormPage } from "./acc/AccProductFormPage";
import { AccSuppliersPage, AccStockInPage } from "./acc/AccSuppliersPage";
import { AccSalesPage } from "./acc/AccSalesPage";
import { AccDuesPage, AccCustomerPage } from "./acc/AccDuesPage";
import { AccAnalyticsPage } from "./acc/AccAnalyticsPage";

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
              <Route element={<SectionGate />}>
                {/* Repair desk: same layout as the shop, its own links and data. */}
                <Route path="repair" element={<AppShell section="repair" />}>
                  <Route index element={<RepairHomePage key="new-repair" />} />
                  <Route path="history" element={<RepairHistoryPage />} />
                  <Route element={<RequireAdmin />}>
                    <Route path="analytics" element={<RepairAnalyticsPage />} />
                  </Route>
                  <Route path=":id/edit" element={<RepairHomePage key="edit-repair" />} />
                  <Route path=":id" element={<RepairJobPage />} />
                </Route>

                {/* Accessories shop: separate counter, one tester login for now. */}
                <Route path="acc" element={<RequireAccessories />}>
                  <Route element={<AppShell section="acc" />}>
                    <Route element={<AccLayout />}>
                      <Route index element={<AccCounterPage />} />
                      <Route path="wholesale" element={<AccWholesalePage />} />
                      <Route path="sales" element={<AccSalesPage />} />
                      <Route path="stock" element={<AccStockPage />} />
                      <Route path="stock/new" element={<AccProductFormPage key="new-product" />} />
                      <Route path="stock/in" element={<AccStockInPage />} />
                      <Route path="stock/:id/edit" element={<AccProductFormPage key="edit-product" />} />
                      <Route path="suppliers" element={<AccSuppliersPage />} />
                      <Route path="dues" element={<AccDuesPage />} />
                      <Route path="dues/:id" element={<AccCustomerPage />} />
                      <Route element={<RequireAdmin />}>
                        <Route path="analytics" element={<AccAnalyticsPage />} />
                      </Route>
                      <Route path="*" element={<Navigate to="/acc" replace />} />
                    </Route>
                  </Route>
                </Route>

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
                  <Route
                    path="stock/accessories/add"
                    element={<AddAccessoriesPage />}
                  />
                  <Route path="suppliers" element={<SuppliersPage />} />
                  <Route
                    path="suppliers/:id/purchases/:purchaseId"
                    element={<PurchaseDetailPage />}
                  />
                  <Route path="suppliers/:id" element={<SupplierDetailPage />} />
                  <Route element={<RequireAdmin />}>
                    <Route path="bills/replace" element={<ReplaceProductPage />} />
                    <Route path="analytics" element={<AnalyticsPage />} />
                    <Route
                      path="analytics/payments"
                      element={<AnalyticsPaymentsPage />}
                    />
                    <Route
                      path="analytics/exchanges"
                      element={<AnalyticsExchangesPage />}
                    />
                    <Route
                      path="analytics/purchases"
                      element={<AnalyticsPurchasesPage />}
                    />
                    <Route
                      path="analytics/pending-items"
                      element={<AnalyticsPendingItemsPage />}
                    />
                    <Route path="backup" element={<BackupPage />} />
                    <Route path="recycle-bin" element={<RecycleBinPage />} />
                    <Route path="users" element={<ManageUsersPage />} />
                  </Route>
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
