import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { AppWrapper } from "./components/common/PageMeta.tsx";
import { registerServiceWorker } from "./lib/serviceWorker";
import { initBackgroundSyncListener } from "./lib/backgroundSync";
import "./index.css";

Sentry.init({
  dsn: import.meta.env['VITE_SENTRY_DSN'] as string | undefined,
  environment: import.meta.env.MODE,
});

// Register PWA service worker and background sync listener
registerServiceWorker().then(() => {
  initBackgroundSyncListener();
});

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary fallback={<p>အမှားတစ်ခု ဖြစ်သွားပါသည်။ ကျေးဇူးပြု၍ page ကို refresh လုပ်ပါ။</p>}>
    <AppWrapper>
      <App />
    </AppWrapper>
  </Sentry.ErrorBoundary>
);
