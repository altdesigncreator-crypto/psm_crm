import { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { STATUSES } from '@/types';

const DEFAULT_COLORS: Record<string, string> = {
  'New': '#0463CA',
  'Contacted': '#8FA3BF',
  'Follow Up': '#8B5CF6',
  'Success': '#10B981',
};

export function useStatusColors() {
  const [colors, setColors] = useState<Record<string, string>>(DEFAULT_COLORS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadColors = async () => {
      try {
        const snap = await getDoc(doc(db, 'settings', 'chartColors'));
        if (snap.exists()) {
          const data = snap.data() as Record<string, string>;
          const merged: Record<string, string> = {};
          for (const s of STATUSES) {
            merged[s] = data[s] || DEFAULT_COLORS[s];
          }
          setColors(merged);
        }
      } catch {
        // Fallback to defaults on error
      } finally {
        setLoading(false);
      }
    };
    loadColors();
  }, []);

  const saveColors = useCallback(async (newColors: Record<string, string>) => {
    await setDoc(doc(db, 'settings', 'chartColors'), newColors, { merge: true });
    setColors(newColors);
  }, []);

  return { colors, loading, saveColors };
}
