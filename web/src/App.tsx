import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import { Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { AuthProvider, useAuth } from "./auth/AuthContext";
import { CvRegistryProvider } from "./cv/CvRegistry";
import AppShell from "./components/AppShell";
import CvReadOverlay from "./components/CvReadOverlay";
import AddressPage from "./pages/AddressPage";
import BackupPage from "./pages/BackupPage";
import CallbackPage from "./pages/CallbackPage";
import CvListPage from "./pages/CvListPage";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import SpeedPage from "./pages/SpeedPage";
import VolumePage from "./pages/VolumePage";

function Protected({ children }: { children: ReactNode }) {
  const { ready, token, config } = useAuth();
  const { t } = useTranslation();

  if (!ready) {
    return (
      <AppShell>
        <Box sx={{ display: "flex", justifyContent: "center", py: 10 }}>
          <CircularProgress />
        </Box>
      </AppShell>
    );
  }
  if (config?.loginRequired && !token) {
    return <Navigate to="/login" replace />;
  }
  if (config && !config.enabled) {
    return (
      <AppShell>
        <Alert severity="warning" sx={{ fontSize: "1.1rem" }}>
          <strong>{t("app.disabled")}</strong>
          <div>{t("app.disabledHint")}</div>
        </Alert>
      </AppShell>
    );
  }
  return <>{children}</>;
}

function Router() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<CallbackPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <HomePage />
          </Protected>
        }
      />
      <Route
        path="/cv"
        element={
          <Protected>
            <CvListPage />
          </Protected>
        }
      />
      <Route
        path="/speed"
        element={
          <Protected>
            <SpeedPage />
          </Protected>
        }
      />
      <Route
        path="/address"
        element={
          <Protected>
            <AddressPage />
          </Protected>
        }
      />
      <Route
        path="/volume"
        element={
          <Protected>
            <VolumePage />
          </Protected>
        }
      />
      <Route
        path="/backup"
        element={
          <Protected>
            <BackupPage />
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <CvRegistryProvider>
        <CvReadOverlay />
        <Router />
      </CvRegistryProvider>
    </AuthProvider>
  );
}
