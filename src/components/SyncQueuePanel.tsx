import React, { useEffect, useState } from 'react';
import { getAllPendingItems, type PendingQueueItem } from '@/lib/backgroundSync';
import { flushStorageQueue } from '@/lib/offlineStorageQueue';
import { getFileQueueCount } from '@/lib/offlineStorageQueue';
import {
  Footprints,
  Users,
  Mic,
  FileUp,
  Clock,
  WifiOff,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';

const collectionLabels: Record<string, string> = {
  checkins: 'Check-In',
  leads: 'Lead',
  audio_notes: 'Voice Note',
  fileQueue: 'File Upload',
};

const collectionIcons: Record<string, React.ReactNode> = {
  checkins: <Footprints className="w-4 h-4" />,
  leads: <Users className="w-4 h-4" />,
  audio_notes: <Mic className="w-4 h-4" />,
  fileQueue: <FileUp className="w-4 h-4" />,
};

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'ယခုပဲ';
  if (minutes < 60) return `${minutes} မိနစ်အကြာက`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} နာရီအကြာက`;
  return `${Math.floor(hours / 24)} ရက်အကြာက`;
}

function getItemTitle(item: PendingQueueItem): string {
  const p = item.payload || {};
  if (item.collection === 'checkins') return p.project || 'Check-In';
  if (item.collection === 'leads') return p.name || p.preferredProject || 'Lead';
  if (item.collection === 'audio_notes') return 'Voice Note';
  return 'Unknown';
}

export default function SyncQueuePanel() {
  const [items, setItems] = useState<PendingQueueItem[]>([]);
  const [fileCount, setFileCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [flushing, setFlushing] = useState(false);

  const loadItems = async () => {
    setLoading(true);
    try {
      const [queueItems, files] = await Promise.all([
        getAllPendingItems(),
        getFileQueueCount(),
      ]);
      setItems(queueItems);
      setFileCount(files);
    } catch {
      setItems([]);
      setFileCount(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
    const interval = setInterval(loadItems, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleFlush = async () => {
    setFlushing(true);
    try {
      await flushStorageQueue();
      await loadItems();
      toast.success('Queue sync လုပ်ပြီးပါပြီ');
    } catch {
      toast.error('Queue sync မအောင်မြင်ပါ');
    } finally {
      setFlushing(false);
    }
  };

  const total = items.length + fileCount;
  if (total === 0) return null;

  const progressPct = flushing ? 30 : 0;

  return (
    <div className="space-y-2">
      {/* Flush button + progress */}
      <button
        type="button"
        onClick={handleFlush}
        disabled={flushing}
        className="w-full flex flex-col gap-1.5 px-4 py-3 rounded-xl bg-primary/10 border border-primary/20 text-primary text-xs font-semibold active:bg-primary/20 transition-colors disabled:opacity-50"
      >
        <div className="flex items-center justify-center gap-2">
          {flushing ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <WifiOff className="w-3.5 h-3.5" />
          )}
          {flushing ? 'Sync လုပ်နေသည်...' : 'အခု Sync လုပ်ရန်'}
        </div>
        {/* Progress bar */}
        {flushing && (
          <div className="w-full h-1.5 bg-primary/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-700 animate-pulse"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
      </button>

      {/* Stats summary */}
      <div className="flex items-center gap-2 px-1">
        <span className="text-[10px] text-white/40 font-medium">{total} ခု စောင့်ဆိုင်းနေ</span>
        {flushing && (
          <span className="text-[10px] text-primary/80 font-medium flex items-center gap-1">
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
            syncing...
          </span>
        )}
      </div>

      {/* Card list */}
      <div className="space-y-1.5 max-h-[240px] overflow-y-auto pr-0.5">
        {loading && items.length === 0 && (
          <div className="flex items-center justify-center py-4 text-white/30 text-xs">
            <RefreshCw className="w-3 h-3 animate-spin mr-1.5" />
            Loading...
          </div>
        )}

        {items.map((item, idx) => (
          <div
            key={`${item.collection}-${item.id}`}
            className="flex items-center gap-2.5 px-3 py-3 min-h-[56px] rounded-xl bg-white/5 border border-white/10 active:bg-white/10 transition-colors"
          >
            <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center shrink-0 text-white/70">
              {collectionIcons[item.collection] || <AlertCircle className="w-4 h-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-white/90 truncate">
                {getItemTitle(item)}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] text-white/50">
                  {collectionLabels[item.collection] || item.collection}
                </span>
                <span className="text-[10px] text-white/30">·</span>
                <span className="text-[10px] text-white/40 flex items-center gap-0.5">
                  <Clock className="w-2.5 h-2.5" />
                  {formatTimeAgo(item.createdAt)}
                </span>
              </div>
            </div>
            {flushing ? (
              <Loader2 className="w-4 h-4 text-primary/60 shrink-0 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-white/20 shrink-0" />
            )}
          </div>
        ))}

        {/* File upload queue */}
        {fileCount > 0 && (
          <div className="flex items-center gap-2.5 px-3 py-3 min-h-[56px] rounded-xl bg-white/5 border border-white/10">
            <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center shrink-0 text-white/70">
              <FileUp className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-white/90 truncate">
                File Upload
              </p>
              <p className="text-[10px] text-white/50">{fileCount} ခု စောင့်ဆိုင်းနေ</p>
            </div>
            {flushing ? (
              <Loader2 className="w-4 h-4 text-primary/60 shrink-0 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-white/20 shrink-0" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
