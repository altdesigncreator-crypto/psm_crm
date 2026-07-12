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

interface DeleteStaffPayload {
  userId: string;
}

/**
 * Boss/Super Admin permanently delete a staff account (Admin / Manager /
 * Sales only — exec accounts can't be deleted here, and you can't delete
 * yourself). Runs on the service-role key because deleting the auth user is
 * an admin-API operation.
 *
 * Business data referencing the profile has RESTRICT foreign keys, so this
 * cleans up in a deliberate order:
 *  - blocks the delete while the person still OWNS leads (reassign first —
 *    lead records are business data that must survive);
 *  - detaches their name from history rows (created_by / changed_by /
 *    scheduled_by / assigned_by / approved_by / performed_by → null);
 *  - removes their personal rows (check-ins, notifications, warnings on
 *    them, assignment history, warnings they issued);
 *  - finally deletes the auth user, which cascades to the profile row.
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

    const { data: callerProfile, error: profileErr } = await admin
      .from('profiles')
      .select('role')
      .eq('id', callerAuth.user.id)
      .single();

    if (profileErr || !callerProfile || !['boss', 'super_admin'].includes(callerProfile.role)) {
      return json({ error: 'Only Boss/Super Admin can delete staff accounts.' }, 403);
    }

    const payload: DeleteStaffPayload = await req.json();
    if (!payload.userId) return json({ error: 'userId is required.' }, 400);
    if (payload.userId === callerAuth.user.id) {
      return json({ error: 'You cannot delete your own account.' }, 400);
    }

    const { data: target, error: targetErr } = await admin
      .from('profiles')
      .select('id, role, email, name')
      .eq('id', payload.userId)
      .single();

    if (targetErr || !target) return json({ error: 'Staff member not found.' }, 404);
    if (!['admin', 'manager', 'sale'].includes(target.role)) {
      return json({ error: 'Boss/Super Admin accounts cannot be deleted here.' }, 403);
    }

    // Leads are business data — they must be reassigned, never lost.
    const { count: ownedLeads } = await admin
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', target.id);
    if ((ownedLeads ?? 0) > 0) {
      return json({
        error: `${target.name} still owns ${ownedLeads} lead${ownedLeads === 1 ? '' : 's'}. Reassign them to another staff member first.`,
      }, 409);
    }

    const id = target.id;
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
    // Remove their personal rows (NOT NULL FKs).
    await admin.from('lead_assignments').delete().eq('assigned_to', id);
    await admin.from('warnings').delete().or(`issued_to.eq.${id},issued_by.eq.${id}`);
    await admin.from('check_ins').delete().eq('employee_id', id);
    await admin.from('notifications').delete().eq('recipient_id', id);

    // Delete the auth user — cascades to the profile row.
    const { error: deleteErr } = await admin.auth.admin.deleteUser(id);
    if (deleteErr) return json({ error: deleteErr.message || 'Could not delete the account.' }, 400);

    await admin.from('audit_logs').insert({
      action: 'user_deleted',
      target_table: 'profiles',
      target_id: id,
      performed_by: callerAuth.user.id,
      old_value: { email: target.email, name: target.name, role: target.role },
    });

    return json({ ok: true, name: target.name });
  } catch (err: any) {
    return json({ error: err.message || 'Internal error' }, 500);
  }
});
