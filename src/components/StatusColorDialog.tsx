import React, { useState, useEffect } from 'react';
import { LEAD_STAGES } from '@/types';
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
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs font-medium text-primary hover:bg-primary/10">
          <Palette className="w-3.5 h-3.5" />
          Customize Colors
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-balance">Pipeline Stage Colors</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
          {LEAD_STAGES.map((stage) => (
            <div key={stage.value} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-md border shadow-sm shrink-0" style={{ backgroundColor: draft[stage.value] }} />
                <span className="text-sm font-medium text-foreground leading-tight">{stage.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={draft[stage.value] || '#8FA3BF'}
                  onChange={(e) => setDraft((prev) => ({ ...prev, [stage.value]: e.target.value }))}
                  className="w-10 h-10 p-0 border-0 rounded-lg cursor-pointer bg-transparent"
                  aria-label={`Color for ${stage.label}`}
                />
                <span className="text-xs font-mono text-muted-foreground w-16 text-right">{draft[stage.value]}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSave} className="bg-primary text-primary-foreground">Save Colors</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
