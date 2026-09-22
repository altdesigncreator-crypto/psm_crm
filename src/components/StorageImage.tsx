import { useEffect, useState } from 'react';
import { toProxyImageUrl, shouldUseImageProxy, markImageProxyNeeded } from '@/db/supabase';

type StorageImageProps = React.ImgHTMLAttributes<HTMLImageElement> & { src: string };

/** Drop-in replacement for <img> when `src` may be a Supabase Storage URL
 * (avatars, lead/check-in photos). On networks that block the *.supabase.co
 * hostname itself, the direct URL never loads — this retries once through
 * the same /supabase-proxy path src/db/supabase.ts already uses for
 * API/auth calls, since a plain <img> tag doesn't go through that fetch
 * wrapper on its own. */
export default function StorageImage({ src, onError, ...props }: StorageImageProps) {
  const [resolvedSrc, setResolvedSrc] = useState(() => (shouldUseImageProxy() ? toProxyImageUrl(src) : src));

  useEffect(() => {
    setResolvedSrc(shouldUseImageProxy() ? toProxyImageUrl(src) : src);
  }, [src]);

  const handleError: React.ReactEventHandler<HTMLImageElement> = (e) => {
    const proxied = toProxyImageUrl(src);
    if (resolvedSrc !== proxied) {
      markImageProxyNeeded();
      setResolvedSrc(proxied);
    } else {
      onError?.(e);
    }
  };

  return <img src={resolvedSrc} onError={handleError} {...props} />;
}
