import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AdminApp } from "./admin/AdminApp";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/animations.css";
import "./styles/landing.css";
import "./admin/admin.css";

// No router: the admin panel is a fully separate tree, gated by its own login, reached only
// by knowing the URL. It shares nothing with the regular AppProvider/user session.
const isAdminRoute = window.location.pathname.replace(/\/+$/, "") === "/admin";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>{isAdminRoute ? <AdminApp /> : <App />}</ErrorBoundary>
  </StrictMode>
);
