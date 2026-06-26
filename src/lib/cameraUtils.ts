export async function getCameraStream(
  facingMode: 'environment' | 'user' = 'environment'
): Promise<MediaStream> {
  const constraints: MediaStreamConstraints = {
    video: {
      facingMode,
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: false,
  };
  return navigator.mediaDevices.getUserMedia(constraints);
}

export function captureFromStream(
  video: HTMLVideoElement,
  width: number,
  height: number
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(video, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.92);
}

export function dataURLtoFile(dataUrl: string, fileName: string): File | null {
  try {
    const arr = dataUrl.split(',');
    if (arr.length < 2) return null;
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = mimeMatch?.[1] || 'image/jpeg';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], fileName, { type: mime });
  } catch {
    return null;
  }
}

export function fixImageOrientation(
  img: HTMLImageElement,
  orientation: number
): string {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const w = img.naturalWidth;
  const h = img.naturalHeight;

  if (orientation >= 5 && orientation <= 8) {
    canvas.width = h;
    canvas.height = w;
  } else {
    canvas.width = w;
    canvas.height = h;
  }

  ctx.save();
  switch (orientation) {
    case 2: // horizontal flip
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      break;
    case 3: // 180°
      ctx.translate(w, h);
      ctx.rotate(Math.PI);
      break;
    case 4: // vertical flip
      ctx.translate(0, h);
      ctx.scale(1, -1);
      break;
    case 5: // horizontal flip + 90° CW
      ctx.translate(h, 0);
      ctx.rotate(Math.PI / 2);
      ctx.scale(-1, 1);
      break;
    case 6: // 90° CW
      ctx.translate(h, 0);
      ctx.rotate(Math.PI / 2);
      break;
    case 7: // vertical flip + 90° CW
      ctx.translate(h, 0);
      ctx.rotate(Math.PI / 2);
      ctx.scale(1, -1);
      break;
    case 8: // 90° CCW
      ctx.translate(0, w);
      ctx.rotate(-Math.PI / 2);
      break;
    default:
      break;
  }

  ctx.drawImage(img, 0, 0);
  ctx.restore();
  return canvas.toDataURL('image/jpeg', 0.92);
}

function readExifOrientation(file: File): Promise<number> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const view = new DataView(reader.result as ArrayBuffer);
      if (view.getUint16(0, false) !== 0xFFD8) {
        resolve(1);
        return;
      }
      const length = view.byteLength;
      let offset = 2;
      while (offset < length) {
        if (view.getUint16(offset, false) === 0xFFE1) {
          const segLength = view.getUint16(offset + 2, false);
          const tiffOffset = offset + 10;
          const endian = view.getUint16(tiffOffset, false);
          const little = endian === 0x4949;
          const ifdOffset = view.getUint32(tiffOffset + 4, little);
          const firstIfd = tiffOffset + ifdOffset;
          const entries = view.getUint16(firstIfd, little);
          for (let i = 0; i < entries; i++) {
            const entry = firstIfd + 2 + i * 12;
            const tag = view.getUint16(entry, little);
            if (tag === 0x0112) {
              resolve(view.getUint16(entry + 8, little));
              return;
            }
          }
          break;
        } else if (view.getUint16(offset, false) === 0xFFD9) {
          break;
        }
        offset += 2 + view.getUint16(offset + 2, false);
      }
      resolve(1);
    };
    reader.onerror = () => resolve(1);
    reader.readAsArrayBuffer(file.slice(0, 65536));
  });
}

export async function processCapturedImage(file: File): Promise<{ previewUrl: string; correctedFile: File }> {
  const orientation = await readExifOrientation(file);
  const url = URL.createObjectURL(file);

  if (orientation === 1) {
    return { previewUrl: url, correctedFile: file };
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const correctedDataUrl = fixImageOrientation(img, orientation);
      URL.revokeObjectURL(url);
      const correctedFile = dataURLtoFile(correctedDataUrl, file.name) ?? file;
      resolve({ previewUrl: correctedDataUrl, correctedFile });
    };
    img.src = url;
  });
}
