import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { GuestOnly, RequireAdmin, RequireAuth } from "./auth/guards";
import { AppShell } from "./components/AppShell";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { BillDetailPage } from "./pages/BillDetailPage";
import { BillsPage } from "./pages/BillsPage";
import { CreateBillPage } from "./pages/CreateBillPage";
import { DuesPage } from "./pages/DuesPage";
import { LoginPage } from "./pages/LoginPage";

export default function App() {
  return (
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
              <Route element={<RequireAdmin />}>
                <Route path="analytics" element={<AnalyticsPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
