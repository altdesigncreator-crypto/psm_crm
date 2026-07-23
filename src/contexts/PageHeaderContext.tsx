import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

interface PageHeaderValue {
  title: string;
  subtitle?: string;
}

interface PageHeaderContextType {
  header: PageHeaderValue | null;
  setHeader: (h: PageHeaderValue | null) => void;
}

const PageHeaderContext = createContext<PageHeaderContextType | undefined>(undefined);

export function PageHeaderProvider({ children }: { children: React.ReactNode }) {
  const [header, setHeaderState] = useState<PageHeaderValue | null>(null);
  // Stable identity so usePageHeader's effect below only re-fires when the
  // calling page's own title/subtitle actually change, not whenever some
  // other page updates the shared header state.
  const setHeader = useCallback((h: PageHeaderValue | null) => setHeaderState(h), []);

  return (
    <PageHeaderContext.Provider value={{ header, setHeader }}>
      {children}
    </PageHeaderContext.Provider>
  );
}

/** Each page calls this once with its title (and optional subtitle) to
 * publish it to the desktop top bar (see AppLayout) — the page's own inline
 * heading should get a `md:hidden` class alongside this call so the title
 * only renders once per breakpoint (top bar at md+, inline on mobile, where
 * the top bar has no room for it). */
export function usePageHeader(title: string, subtitle?: string) {
  const ctx = useContext(PageHeaderContext);
  const setHeader = ctx?.setHeader;
  useEffect(() => {
    setHeader?.({ title, subtitle });
    return () => setHeader?.(null);
  }, [setHeader, title, subtitle]);
}

export function usePageHeaderValue(): PageHeaderValue | null {
  const ctx = useContext(PageHeaderContext);
  return ctx?.header ?? null;
}
