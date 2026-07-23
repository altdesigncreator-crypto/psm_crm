import React, { useCallback, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Loader2, ZoomIn } from 'lucide-react';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener('load', () => resolve(img));
    img.addEventListener('error', reject);
    img.src = src;
  });
}

/** Renders just the circular-crop area onto a canvas at its native pixel
 * size — the file we upload is still a plain square JPEG; every avatar
 * display already rounds it with CSS (`rounded-full`), so there's no need
 * to bake transparency into the image itself. */
async function getCroppedImageBlob(imageSrc: string, area: Area): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement('canvas');
  canvas.width = area.width;
  canvas.height = area.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');
  ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not crop the image'))), 'image/jpeg', 0.92);
  });
}

interface AvatarCropDialogProps {
  imageSrc: string | null;
  onCancel: () => void;
  onCropped: (blob: Blob) => void | Promise<void>;
}

/** Circular crop-and-zoom step shown between picking a photo and uploading
 * it as a profile picture (see Settings.tsx). */
export default function AvatarCropDialog({ imageSrc, onCancel, onCropped }: AvatarCropDialogProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedArea(areaPixels);
  }, []);

  const handleReset = () => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedArea(null);
  };

  const handleSave = async () => {
    if (!imageSrc || !croppedArea) return;
    setSaving(true);
    try {
      const blob = await getCroppedImageBlob(imageSrc, croppedArea);
      await onCropped(blob);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!imageSrc} onOpenChange={(open) => !open && !saving && onCancel()}>
      <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md rounded-xl p-6 border border-border/60 shadow-xl bg-card gap-0">
        <DialogHeader className="pb-4 border-b border-border/60">
          <DialogTitle className="text-base font-semibold">Adjust Your Photo</DialogTitle>
        </DialogHeader>

        {imageSrc && (
          <>
            <div className="relative w-full h-72 mt-5 rounded-xl overflow-hidden bg-muted">
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            </div>

            <div className="flex items-center gap-3 mt-4">
              <ZoomIn className="w-4 h-4 text-muted-foreground shrink-0" />
              <Slider value={[zoom]} min={1} max={3} step={0.05} onValueChange={([v]) => setZoom(v)} className="flex-1" />
            </div>

            <div className="flex gap-3 pt-5 mt-3 border-t border-border/60">
              <Button type="button" variant="outline" className="flex-1 h-11" onClick={handleReset} disabled={saving}>
                Reset
              </Button>
              <Button type="button" variant="outline" className="flex-1 h-11" onClick={onCancel} disabled={saving}>
                Cancel
              </Button>
              <Button type="button" className="flex-1 h-11 gradient-primary text-white font-medium" onClick={handleSave} disabled={saving || !croppedArea}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
