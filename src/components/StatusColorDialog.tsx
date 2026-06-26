import React, { useState, useEffect } from 'react';
import { STATUSES } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Palette } from 'lucide-react';

interface StatusColorDialogProps {
  colors: Record<string, string>;
  onSave: (colors: Record<string, string>) => void;
}

const STATUS_LABELS_EN: Record<string, string> = {
  'New': 'New',
  'Contacted': 'Contacted',
  'Follow Up': 'Follow Up',
  'Success': 'Success',
};

export default function StatusColorDialog({ colors, onSave }: StatusColorDialogProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>(colors);

  useEffect(() => {
    setDraft(colors);
  }, [colors, open]);

  const handleSave = () => {
    onSave(draft);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs font-medium text-primary hover:bg-primary/10"
        >
          <Palette className="w-3.5 h-3.5" />
          Customize Colors
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-balance">Chart Bar Colors</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {STATUSES.map((status) => (
            <div key={status} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-5 h-5 rounded-md border shadow-sm shrink-0"
                  style={{ backgroundColor: draft[status] }}
                />
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-foreground leading-tight">
                    {STATUS_LABELS_EN[status]}
                  </span>
                  <span className="text-xs text-muted-foreground leading-tight">{status}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={draft[status]}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, [status]: e.target.value }))
                  }
                  className="w-10 h-10 p-0 border-0 rounded-lg cursor-pointer bg-transparent"
                  aria-label={`Color for ${status}`}
                />
                <span className="text-xs font-mono text-muted-foreground w-16 text-right">
                  {draft[status]}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} className="bg-primary text-primary-foreground">
            Save Colors
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
