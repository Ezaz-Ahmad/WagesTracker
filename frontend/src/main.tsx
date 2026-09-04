import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Capacitor } from "@capacitor/core";
import { configureTokenStorage, initializeTokenStorage } from "./platform/tokenStorage";
import { configurePdfDelivery } from "./platform/pdfDelivery";
import { configureConnectivityAdapter } from "./platform/connectivity";
import { configureAppLifecycleAdapter } from "./platform/appLifecycle";
import { configureBiometricAuth } from "./platform/biometricAuth";
import { configureActiveShiftActivity } from "./platform/activeShiftActivity";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/animations.css";
import "./styles/shell.css";
import "./styles/landing.css";
import "./styles/settings.css";
import "./styles/public-pages.css";
import "./styles/spending.css";
import "./styles/customization.css";
import "./styles/home-insights.css";

// Last-resort net for a stray rejected promise nothing else catches (every
// data-changing action already goes through AppContext's try/catch, and
// generateReportPdf's callers now catch via usePdfDownload — this is only
// for something a future change forgets). Browsers don't crash a tab over
// an unhandled rejection on their own, but left alone it prints a scary
// "Uncaught (in promise)" trace and the failure is otherwise invisible.
// Logging it here means it's never silent, without needing every call site
// to guess how to surface it.
window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection:", event.reason);
});

// No router: the admin panel is a fully separate tree, gated by its own login, reached only
// by knowing the URL. It shares nothing with the regular AppProvider/user session.
const path = window.location.pathname.replace(/\/+$/, "") || "/";

// Native secure-storage adapters hydrate their in-memory token cache here,
// before any API request or authentication state is evaluated. The web
// adapter is a no-op and preserves the existing synchronous startup path.
if (__NATIVE_CONSUMER_BUILD__ && Capacitor.isNativePlatform()) {
  const [storage, pdf, connectivity, lifecycle, biometrics, activeShift] = await Promise.all([
    import("./platform/nativeSecureTokenStorage"),
    import("./platform/nativePdfDelivery"),
    import("./platform/nativeConnectivity"),
    import("./platform/nativeAppLifecycle"),
    import("./platform/nativeBiometricAuth"),
    import("./platform/nativeActiveShiftActivity"),
  ]);
  const { NativeSecureTokenStorageAdapter } = storage;
  configureTokenStorage(new NativeSecureTokenStorageAdapter());
  configurePdfDelivery(new pdf.IosPdfDeliveryAdapter());
  configureConnectivityAdapter(new connectivity.NativeConnectivityAdapter());
  configureAppLifecycleAdapter(new lifecycle.NativeAppLifecycleAdapter());
  configureBiometricAuth(new biometrics.NativeBiometricAuthAdapter());
  configureActiveShiftActivity(new activeShift.NativeActiveShiftActivityAdapter());
  const { startDeepLinkListener } = await import("./platform/deepLinks");
  void startDeepLinkListener();
}
await initializeTokenStorage();

async function route() {
  if (!__NATIVE_CONSUMER_BUILD__ && path === "/admin") {
    const { AdminApp } = await import("./admin/AdminApp");
    return <AdminApp />;
  }
  if (path === "/reset-password") {
    const { ResetPasswordPage } = await import("./screens/ResetPasswordPage");
    return <ResetPasswordPage />;
  }
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>{await route()}</ErrorBoundary>
  </StrictMode>
);
