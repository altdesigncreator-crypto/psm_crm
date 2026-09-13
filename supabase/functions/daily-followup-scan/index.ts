import { serve } from 'https://deno.land/std@0.192.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.1';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/**
 * Daily scan for leads whose follow-up is due today or overdue. Notifies
 * the owning sales rep and, if resolvable, their team manager — once per
 * due cycle (tracked via leads.follow_up_notified_at, reset to null by the
 * grade-sync trigger whenever a new next_follow_up_at is set, so a lead is
 * never re-notified every day it sits overdue). Invoked by a scheduled
 * GitHub Actions workflow via a shared secret, not a logged-in user's JWT.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Server configuration error' }, 500);

  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    const endOfToday = new Date();
    endOfToday.setUTCHours(23, 59, 59, 999);

    const { data: candidates, error: leadsErr } = await admin
      .from('leads')
      .select('id, name, owner_id, team_id, next_follow_up_at, follow_up_notified_at')
      .not('status', 'in', '(sold,lost)')
      .eq('follow_up_state', 'active')
      .not('next_follow_up_at', 'is', null)
      .lte('next_follow_up_at', endOfToday.toISOString());
    if (leadsErr) throw leadsErr;

    // Only the leads whose current due date hasn't already been notified on.
    const dueLeads = (candidates || []).filter((l) => {
      if (!l.follow_up_notified_at) return true;
      return new Date(l.follow_up_notified_at) < new Date(l.next_follow_up_at);
    });

    if (dueLeads.length === 0) {
      return json({ leads_processed: 0, notified_reps: 0, notified_managers: 0 });
    }

    // Resolve each owner's manager: team_members -> teams.manager_id first,
    // falling back to the lead's own team_id -> teams.manager_id.
    const ownerIds = [...new Set(dueLeads.map((l) => l.owner_id).filter(Boolean))];
    const { data: memberRows } = ownerIds.length > 0
      ? await admin.from('team_members').select('sale_person_id, team_id').in('sale_person_id', ownerIds)
      : { data: [] as { sale_person_id: string; team_id: string }[] };

    const teamIds = [...new Set([
      ...(memberRows || []).map((m) => m.team_id),
      ...dueLeads.map((l) => l.team_id).filter((id): id is string => !!id),
    ])];
    const { data: teamRows } = teamIds.length > 0
      ? await admin.from('teams').select('id, manager_id').in('id', teamIds)
      : { data: [] as { id: string; manager_id: string | null }[] };

    const teamManagerOf = new Map((teamRows || []).map((t) => [t.id, t.manager_id]));
    const managerOfOwner = new Map<string, string>();
    for (const m of memberRows || []) {
      const mgr = teamManagerOf.get(m.team_id);
      if (mgr) managerOfOwner.set(m.sale_person_id, mgr);
    }

    const notificationRows: Record<string, unknown>[] = [];
    for (const lead of dueLeads) {
      const dueDate = new Date(lead.next_follow_up_at).toLocaleDateString('en-GB');
      if (lead.owner_id) {
        notificationRows.push({
          recipient_id: lead.owner_id,
          type: 'followup_reminder',
          title: 'Follow-up due',
          body: `${lead.name} is due for a follow-up (${dueDate}).`,
          related_lead_id: lead.id,
        });
      }
      const managerId = (lead.owner_id && managerOfOwner.get(lead.owner_id))
        || (lead.team_id ? teamManagerOf.get(lead.team_id) : undefined);
      if (managerId && managerId !== lead.owner_id) {
        notificationRows.push({
          recipient_id: managerId,
          type: 'followup_reminder',
          title: 'Team follow-up due',
          body: `${lead.name} (your team) is due for a follow-up (${dueDate}).`,
          related_lead_id: lead.id,
        });
      }
    }

    if (notificationRows.length > 0) {
      const { error: notifyErr } = await admin.from('notifications').insert(notificationRows);
      if (notifyErr) throw notifyErr;
    }

    const { error: updateErr } = await admin
      .from('leads')
      .update({ follow_up_notified_at: new Date().toISOString() })
      .in('id', dueLeads.map((l) => l.id));
    if (updateErr) throw updateErr;

    const repNotifications = dueLeads.filter((l) => l.owner_id).length;
    return json({
      leads_processed: dueLeads.length,
      notified_reps: repNotifications,
      notified_managers: notificationRows.length - repNotifications,
    });
  } catch (err: any) {
    return json({ error: err.message || 'Internal error' }, 500);
  }
});
