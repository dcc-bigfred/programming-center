import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import { Navigate, Outlet, createBrowserRouter } from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { AuthProvider, useAuth } from "./auth/AuthContext";
import { CvRegistryProvider } from "./cv/CvRegistry";
import AppShell from "./components/AppShell";
import CvReadOverlay from "./components/CvReadOverlay";

const AddressPage = lazy(() => import("./pages/AddressPage"));
const BackupPage = lazy(() => import("./pages/BackupPage"));
const CallbackPage = lazy(() => import("./pages/CallbackPage"));
const CvListPage = lazy(() => import("./pages/CvListPage"));
const HomePage = lazy(() => import("./pages/HomePage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const SpeedPage = lazy(() => import("./pages/SpeedPage"));
const VolumePage = lazy(() => import("./pages/VolumePage"));
const MappingPage = lazy(() => import("./pages/MappingPage"));
const CouplerPage = lazy(() => import("./pages/CouplerPage"));
const TelemetryPage = lazy(() => import("./pages/TelemetryPage"));

function RouteFallback() {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", py: 10 }}>
      <CircularProgress />
    </Box>
  );
}

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

function RootLayout() {
  return (
    <AuthProvider>
      <CvRegistryProvider>
        <CvReadOverlay />
        <Suspense fallback={<RouteFallback />}>
          <Outlet />
        </Suspense>
      </CvRegistryProvider>
    </AuthProvider>
  );
}

export const router = createBrowserRouter(
  [
    {
      element: <RootLayout />,
      children: [
        { path: "/login", element: <LoginPage /> },
        { path: "/auth/callback", element: <CallbackPage /> },
        {
          path: "/",
          element: (
            <Protected>
              <HomePage />
            </Protected>
          ),
        },
        {
          path: "/cv",
          element: (
            <Protected>
              <CvListPage />
            </Protected>
          ),
        },
        {
          path: "/speed",
          element: (
            <Protected>
              <SpeedPage />
            </Protected>
          ),
        },
        {
          path: "/address",
          element: (
            <Protected>
              <AddressPage />
            </Protected>
          ),
        },
        {
          path: "/volume",
          element: (
            <Protected>
              <VolumePage />
            </Protected>
          ),
        },
        {
          path: "/mapping",
          element: (
            <Protected>
              <MappingPage />
            </Protected>
          ),
        },
        {
          path: "/coupler",
          element: (
            <Protected>
              <CouplerPage />
            </Protected>
          ),
        },
        {
          path: "/backup",
          element: (
            <Protected>
              <BackupPage />
            </Protected>
          ),
        },
        {
          path: "/telemetry",
          element: (
            <Protected>
              <TelemetryPage />
            </Protected>
          ),
        },
        { path: "*", element: <Navigate to="/" replace /> },
      ],
    },
  ],
  {
    future: {
      v7_relativeSplatPath: true,
    },
  },
);
