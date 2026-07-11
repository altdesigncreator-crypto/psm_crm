import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/db/supabase';
import { LEAD_STAGES, type LeadStage } from '@/types';

const DEFAULT_COLORS: Record<LeadStage, string> = {
  new: '#0463CA',
  contacted: '#8FA3BF',
  qualified: '#8B5CF6',
  appointment: '#F59E0B',
  site_visit: '#0EA5E9',
  negotiation: '#EC4899',
  booking: '#22C55E',
  sold: '#10B981',
  lost: '#EF4444',
};

export function useStatusColors() {
  const [colors, setColors] = useState<Record<string, string>>(DEFAULT_COLORS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.from('settings').select('value').eq('key', 'lead_stage_colors').maybeSingle();
      if (!active) return;
      if (data?.value) {
        const stored = data.value as Record<string, string>;
        const merged: Record<string, string> = {};
        for (const s of LEAD_STAGES) merged[s.value] = stored[s.value] || DEFAULT_COLORS[s.value];
        setColors(merged);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  const saveColors = useCallback(async (newColors: Record<string, string>) => {
    await supabase.from('settings').upsert({ key: 'lead_stage_colors', value: newColors });
    setColors(newColors);
  }, []);

  return { colors, loading, saveColors };
}
