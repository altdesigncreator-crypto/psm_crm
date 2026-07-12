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

interface ResetPasswordPayload {
  userId: string;
  newPassword: string;
}

/**
 * Boss/Super Admin reset a staff member's password. Only Admin / Manager /
 * Sales accounts can be targeted — exec passwords cannot be reset here, so
 * a Super Admin can't take over the Boss account (or another exec's).
 * Uses the service-role key because auth.admin.updateUserById is not
 * callable from the client.
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
    // Identify the caller and confirm they're Boss/Super Admin.
    const jwt = authHeader.replace('Bearer ', '');
    const { data: callerAuth, error: callerErr } = await admin.auth.getUser(jwt);
    if (callerErr || !callerAuth.user) return json({ error: 'Invalid session' }, 401);

    const { data: callerProfile, error: profileErr } = await admin
      .from('profiles')
      .select('role')
      .eq('id', callerAuth.user.id)
      .single();

    if (profileErr || !callerProfile || !['boss', 'super_admin'].includes(callerProfile.role)) {
      return json({ error: 'Only Boss/Super Admin can reset staff passwords.' }, 403);
    }

    const payload: ResetPasswordPayload = await req.json();
    if (!payload.userId || !payload.newPassword) {
      return json({ error: 'userId and newPassword are required.' }, 400);
    }
    if (payload.newPassword.length < 6) {
      return json({ error: 'Password must be at least 6 characters.' }, 400);
    }

    // Target must be Admin / Manager / Sales — never another exec.
    const { data: target, error: targetErr } = await admin
      .from('profiles')
      .select('id, role, email, name')
      .eq('id', payload.userId)
      .single();

    if (targetErr || !target) return json({ error: 'Staff member not found.' }, 404);
    if (!['admin', 'manager', 'sale'].includes(target.role)) {
      return json({ error: 'Passwords for Boss/Super Admin accounts cannot be reset here.' }, 403);
    }

    const { error: updateErr } = await admin.auth.admin.updateUserById(payload.userId, {
      password: payload.newPassword,
    });
    if (updateErr) return json({ error: updateErr.message || 'Could not reset the password.' }, 400);

    await admin.from('audit_logs').insert({
      action: 'password_reset',
      target_table: 'profiles',
      target_id: target.id,
      performed_by: callerAuth.user.id,
      new_value: { email: target.email, role: target.role },
    });

    return json({ ok: true, id: target.id, name: target.name });
  } catch (err: any) {
    return json({ error: err.message || 'Internal error' }, 500);
  }
});
