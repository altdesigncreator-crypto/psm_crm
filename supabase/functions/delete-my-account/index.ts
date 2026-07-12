import { serve } from 'https://deno.land/std@0.192.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.1';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/**
 * A staff member permanently deletes their OWN account (self-service, from
 * Settings). Boss/Super Admin cannot self-delete — that guards against the
 * system losing its global accounts; those are removed via User Management
 * by the other exec if ever needed.
 *
 * The client verifies the password (signInWithPassword) before calling;
 * this function only ever deletes the authenticated caller, so a stolen
 * session can at worst delete itself.
 *
 * Cleanup mirrors delete-staff-user: owned leads block deletion (reassign
 * first); history rows are detached; personal rows are removed; then the
 * auth user is deleted (cascades to the profile).
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Server configuration error' }, 500);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    const jwt = authHeader.replace('Bearer ', '');
    const { data: callerAuth, error: callerErr } = await admin.auth.getUser(jwt);
    if (callerErr || !callerAuth.user) return json({ error: 'Invalid session' }, 401);

    const id = callerAuth.user.id;

    const { data: me, error: meErr } = await admin
      .from('profiles')
      .select('id, role, email, name')
      .eq('id', id)
      .single();

    if (meErr || !me) return json({ error: 'Profile not found.' }, 404);
    if (['boss', 'super_admin'].includes(me.role)) {
      return json({ error: 'Boss/Super Admin accounts cannot be self-deleted. Ask the other executive to remove the account via Staff management.' }, 403);
    }

    // Leads are business data — they must be reassigned, never lost.
    const { count: ownedLeads } = await admin
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', id);
    if ((ownedLeads ?? 0) > 0) {
      return json({
        error: `You still own ${ownedLeads} lead${ownedLeads === 1 ? '' : 's'}. Ask your manager to reassign them before deleting your account.`,
      }, 409);
    }

    // Detach from history rows (nullable FKs).
    await admin.from('leads').update({ created_by: null }).eq('created_by', id);
    await admin.from('follow_ups').update({ created_by: null }).eq('created_by', id);
    await admin.from('pipeline_history').update({ changed_by: null }).eq('changed_by', id);
    await admin.from('appointments').update({ scheduled_by: null }).eq('scheduled_by', id);
    await admin.from('site_visits').update({ scheduled_by: null }).eq('scheduled_by', id);
    await admin.from('lead_assignments').update({ assigned_by: null }).eq('assigned_by', id);
    await admin.from('check_ins').update({ approved_by: null }).eq('approved_by', id);
    await admin.from('audit_logs').update({ performed_by: null }).eq('performed_by', id);
    await admin.from('attendance_settings').update({ updated_by: null }).eq('updated_by', id);
    await admin.from('settings').update({ updated_by: null }).eq('updated_by', id);
    // Remove personal rows (NOT NULL FKs).
    await admin.from('lead_assignments').delete().eq('assigned_to', id);
    await admin.from('warnings').delete().or(`issued_to.eq.${id},issued_by.eq.${id}`);
    await admin.from('check_ins').delete().eq('employee_id', id);
    await admin.from('notifications').delete().eq('recipient_id', id);

    // Log BEFORE deleting so performed_by still resolves.
    await admin.from('audit_logs').insert({
      action: 'account_self_deleted',
      target_table: 'profiles',
      target_id: id,
      performed_by: null,
      old_value: { email: me.email, name: me.name, role: me.role },
    });

    const { error: deleteErr } = await admin.auth.admin.deleteUser(id);
    if (deleteErr) return json({ error: deleteErr.message || 'Could not delete the account.' }, 400);

    return json({ ok: true });
  } catch (err: any) {
    return json({ error: err.message || 'Internal error' }, 500);
  }
});
