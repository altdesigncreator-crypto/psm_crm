export function addWatermark(
  img: HTMLImageElement,
  text: string
): { dataUrl: string; file: File | null } {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return { dataUrl: '', file: null };

  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;

  // Draw image
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const pad = Math.max(12, Math.round(canvas.height * 0.025));
  const fontSize = Math.max(14, Math.round(canvas.height * 0.03));

  // Dark bar at bottom
  const barHeight = fontSize + pad * 2;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(0, canvas.height - barHeight, canvas.width, barHeight);

  // Text
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, canvas.height - barHeight / 2);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

  // Convert to File
  try {
    const arr = dataUrl.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = mimeMatch?.[1] || 'image/jpeg';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    const file = new File([u8arr], `watermarked_${Date.now()}.jpg`, { type: mime });
    return { dataUrl, file };
  } catch {
    return { dataUrl, file: null };
  }
}

export function watermarkFromFile(file: File, agentName: string): Promise<{ dataUrl: string; file: File }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const ts = new Date().toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
      const label = `PSM CRM  |  ${agentName}  |  ${ts}`;
      const result = addWatermark(img, label);
      if (result.file) {
        resolve({ dataUrl: result.dataUrl, file: result.file });
      } else {
        reject(new Error('Watermark conversion failed'));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image load failed'));
    };
    img.src = url;
  });
}
