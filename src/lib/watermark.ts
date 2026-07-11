export interface WatermarkInfo {
  name: string;
  department?: string | null;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** Defaults to now() if omitted. */
  date?: Date;
}

function wrapLine(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Renders a "GPS camera app" style watermark: a rounded card in the bottom
 * left corner listing employee name, department, location and timestamp —
 * with a small map-pin marker, similar to apps like GPS Map Camera / Marki
 * Photo rather than a single line of text.
 */
export function addWatermark(
  img: HTMLImageElement,
  info: WatermarkInfo
): { dataUrl: string; file: File | null } {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return { dataUrl: '', file: null };

  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const date = info.date || new Date();
  const dateStr = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const coordsStr = info.latitude != null && info.longitude != null
    ? `${info.latitude.toFixed(5)}, ${info.longitude.toFixed(5)}`
    : null;

  const scale = canvas.width / 1080;
  const pad = Math.max(14, Math.round(24 * scale));
  const gap = Math.max(3, Math.round(6 * scale));
  const pinSize = Math.max(16, Math.round(26 * scale));
  const maxCardWidth = Math.min(canvas.width - pad * 2, Math.round(canvas.width * 0.72));
  const textX = pad + pinSize + gap * 2;
  const textMaxWidth = maxCardWidth - pinSize - gap * 2 - pad;

  const nameSize = Math.max(15, Math.round(22 * scale));
  const rowSize = Math.max(12, Math.round(16 * scale));
  const lineGap = Math.max(4, Math.round(6 * scale));

  // Build the list of rows shown under the bold name line.
  const rows: string[] = [];
  if (info.department) rows.push(info.department);
  if (info.location) rows.push(info.location);
  const metaRow = [coordsStr, `${dateStr} · ${timeStr}`].filter(Boolean).join('   ·   ');
  if (metaRow) rows.push(metaRow);

  // Measure wrapped row lines up front so we can size the card.
  ctx.font = `500 ${rowSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  const wrappedRows = rows.flatMap((row) => wrapLine(ctx, row, textMaxWidth));

  ctx.font = `700 ${nameSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  const nameLines = wrapLine(ctx, info.name, textMaxWidth);

  const contentHeight =
    nameLines.length * (nameSize + lineGap) +
    wrappedRows.length * (rowSize + lineGap) +
    gap;
  const cardHeight = contentHeight + pad * 1.4;
  const cardWidth = maxCardWidth;
  const cardX = pad / 1.4;
  const cardY = canvas.height - cardHeight - pad / 1.4;
  const radius = Math.max(8, Math.round(14 * scale));

  // Card background — soft dark gradient so it reads on any photo.
  const gradient = ctx.createLinearGradient(cardX, cardY, cardX, cardY + cardHeight);
  gradient.addColorStop(0, 'rgba(10, 15, 25, 0.72)');
  gradient.addColorStop(1, 'rgba(10, 15, 25, 0.58)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardWidth, cardHeight, radius);
  ctx.fill();

  // Accent stripe on the left edge of the card.
  ctx.fillStyle = '#0463CA';
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, Math.max(4, Math.round(5 * scale)), cardHeight, [radius, 0, 0, radius]);
  ctx.fill();

  // Map-pin marker.
  const pinCx = cardX + gap * 2 + pinSize / 2 + Math.round(4 * scale);
  const pinCy = cardY + cardHeight / 2;
  ctx.fillStyle = '#F8FAFC';
  ctx.beginPath();
  ctx.arc(pinCx, pinCy - pinSize * 0.12, pinSize * 0.32, 0, Math.PI * 2);
  ctx.moveTo(pinCx - pinSize * 0.28, pinCy);
  ctx.quadraticCurveTo(pinCx, pinCy + pinSize * 0.55, pinCx + pinSize * 0.28, pinCy);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#0463CA';
  ctx.beginPath();
  ctx.arc(pinCx, pinCy - pinSize * 0.12, pinSize * 0.14, 0, Math.PI * 2);
  ctx.fill();

  // Text rows.
  let ty = cardY + pad * 0.7 + nameSize * 0.5;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 ${nameSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  for (const line of nameLines) {
    ctx.fillText(line, textX, ty);
    ty += nameSize + lineGap;
  }

  ty += gap * 0.5;
  ctx.font = `500 ${rowSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
  for (const line of wrappedRows) {
    ctx.fillText(line, textX, ty);
    ty += rowSize + lineGap;
  }

  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

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

export function watermarkFromFile(file: File, info: WatermarkInfo): Promise<{ dataUrl: string; file: File }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const result = addWatermark(img, info);
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
