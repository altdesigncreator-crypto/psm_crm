import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { AppWrapper } from "./components/common/PageMeta.tsx";
import { registerServiceWorker } from "./lib/serviceWorker";
import "./index.css";

// Read variable safely without TS inline keyword type assertion
const sentryDsn = import.meta.env['VITE_SENTRY_DSN'];

Sentry.init({
  dsn: typeof sentryDsn === 'string' ? sentryDsn : undefined,
  environment: import.meta.env.MODE,
});

// Register PWA service worker (static asset caching / installability only —
// there is no offline-first data sync in the Supabase-backed app).
registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary fallback={<p>အမှားတစ်ခု ဖြစ်သွားပါသည်။ ကျေးဇူးပြု၍ page ကို refresh လုပ်ပါ။</p>}>
    <AppWrapper>
      <App />
    </AppWrapper>
  </Sentry.ErrorBoundary>
);