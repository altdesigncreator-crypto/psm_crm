import { useEffect, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import {
  Bell, Check, CheckCircle2, Copy, Download, EllipsisVertical, Loader2, Maximize2, Share, Smartphone, SquarePlus, Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/contexts/TranslationContext';
import { usePwaInstall } from '@/hooks/usePwaInstall';
import { isMobileDevice, isSafariBrowser } from '@/lib/pwaInstall';

function getAppUrl() {
  return `${window.location.origin}/`;
}

function useQrDataUrl(text: string) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    // Rendered at 2x the display size so it stays crisp on high-DPI screens.
    QRCode.toDataURL(text, { width: 320, margin: 1, color: { dark: '#0A2540', light: '#FFFFFF' } })
      .then((url) => { if (!cancelled) setDataUrl(url); })
      .catch(() => { if (!cancelled) setDataUrl(null); });
    return () => { cancelled = true; };
  }, [text]);
  return dataUrl;
}

function Steps({ steps }: { steps: ReactNode[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((step, i) => (
        <li key={i} className="flex items-start gap-3 rounded-xl bg-muted/40 p-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold tabular-nums text-primary">
            {i + 1}
          </span>
          <span className="pt-0.5 text-sm leading-snug text-foreground">{step}</span>
        </li>
      ))}
    </ol>
  );
}

function SuccessRow({ title, body }: { title: string; body: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-start gap-3 rounded-xl border border-success/25 bg-success/[0.07] p-3">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
      <div className="min-w-0">
        <p className="text-sm font-medium leading-snug text-foreground">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function InlineIcon({ Icon }: { Icon: typeof Share }) {
  return <Icon className="mx-0.5 inline h-4 w-4 -translate-y-px text-primary" aria-hidden="true" />;
}

function CopyLinkButton() {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(getAppUrl());
      setCopied(true);
      toast.success(t('install.linkCopied'));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('install.copyFailed'));
    }
  };

  return (
    <Button variant="outline" className="h-11 w-full gap-2" onClick={handleCopy}>
      {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
      {copied ? t('install.linkCopied') : t('install.copyLink')}
    </Button>
  );
}

/** "Scan to open on your phone" — the hand-off when the current device
 * isn't the one the user wants the app on. */
function PhoneHandoff() {
  const { t } = useTranslation();
  const appUrl = getAppUrl();
  const qr = useQrDataUrl(appUrl);

  return (
    <div className="flex items-center gap-4 rounded-xl border border-border/60 p-3">
      <div className="h-[120px] w-[120px] shrink-0 overflow-hidden rounded-lg bg-white p-1.5 ring-1 ring-border/60">
        {qr
          ? <img src={qr} alt={t('install.qrAlt')} width={108} height={108} className="h-full w-full" />
          : <div className="h-full w-full animate-pulse rounded bg-muted" />}
      </div>
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium text-foreground">{t('install.scanTitle')}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{t('install.scanBody')}</p>
        <p className="truncate font-mono text-[11px] text-muted-foreground">{appUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}</p>
      </div>
    </div>
  );
}

/** Settings → About: install PSM CRM to the phone's home screen.
 *
 * There is no single "download" mechanism for a web app — each platform
 * differs, so the card adapts:
 *  - Chromium (Android/desktop): one tap opens the native install dialog.
 *  - iOS/iPadOS: Apple exposes no install API; walk through Share → Add to
 *    Home Screen.
 *  - Other Android browsers: point to the browser menu.
 *  - Desktop without install support: QR code to continue on a phone. */
export default function InstallAppCard() {
  const { t } = useTranslation();
  const { platform, justInstalled, promptInstall } = usePwaInstall();
  const [prompting, setPrompting] = useState(false);
  const onMobile = isMobileDevice();

  const handleInstall = async () => {
    setPrompting(true);
    try {
      const accepted = await promptInstall();
      if (accepted) toast.success(t('install.installedToast'));
    } finally {
      setPrompting(false);
    }
  };

  const body = (() => {
    switch (platform) {
      case 'installed':
        return <SuccessRow title={t('install.installedTitle')} body={t('install.installedBody')} />;

      case 'native':
        return (
          <>
            <ul className="grid grid-cols-3 gap-2">
              {[
                { Icon: Zap, label: t('install.benefitFast') },
                { Icon: Maximize2, label: t('install.benefitFullscreen') },
                { Icon: Bell, label: t('install.benefitNotifications') },
              ].map(({ Icon, label }) => (
                <li key={label} className="flex flex-col items-center gap-1.5 rounded-xl bg-muted/40 px-2 py-3 text-center">
                  <Icon className="h-4 w-4 text-primary" />
                  <span className="text-[11px] leading-tight text-muted-foreground">{label}</span>
                </li>
              ))}
            </ul>
            <Button className="h-11 w-full gap-2" onClick={handleInstall} disabled={prompting}>
              {prompting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {onMobile ? t('install.installButton') : t('install.installOnComputer')}
            </Button>
            {!onMobile && <PhoneHandoff />}
          </>
        );

      case 'ios':
        return (
          <>
            <Steps
              steps={[
                <>{t('install.iosStep1a')} <InlineIcon Icon={Share} /> {t('install.iosStep1b')}</>,
                <>{t('install.iosStep2a')} <InlineIcon Icon={SquarePlus} /> <strong className="font-semibold">{t('install.addToHomeScreen')}</strong></>,
                <>{t('install.iosStep3')}</>,
              ]}
            />
            {!isSafariBrowser() && (
              <>
                <p className="text-xs leading-relaxed text-muted-foreground">{t('install.iosOpenInSafari')}</p>
                <CopyLinkButton />
              </>
            )}
          </>
        );

      case 'android-manual':
        return (
          <>
            <Steps
              steps={[
                <>{t('install.androidStep1a')} <InlineIcon Icon={EllipsisVertical} /> {t('install.androidStep1b')}</>,
                <>{t('install.androidStep2')}</>,
                <>{t('install.androidStep3')}</>,
              ]}
            />
            <p className="text-xs leading-relaxed text-muted-foreground">{t('install.androidChromeHint')}</p>
          </>
        );

      default:
        return (
          <>
            <PhoneHandoff />
            <CopyLinkButton />
          </>
        );
    }
  })();

  return (
    <Card className="shadow-card rounded-xl border-0">
      <CardContent className="p-4 md:p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {platform === 'installed' || justInstalled ? <CheckCircle2 className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{t('install.sectionTitle')}</p>
            <p className="text-xs text-muted-foreground truncate">{t('install.sectionSubtitle')}</p>
          </div>
        </div>
        {justInstalled && platform !== 'installed' ? <SuccessRow title={t('install.justInstalledTitle')} body={t('install.justInstalledBody')} /> : body}
      </CardContent>
    </Card>
  );
}
