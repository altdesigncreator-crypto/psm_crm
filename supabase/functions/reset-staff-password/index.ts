import { serve } from 'https://deno.land/std@0.192.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.1';

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

/** Does the user hold `permission` at `minScope` or wider (own < team <
 * department < branch < all)? Resolved by public.user_has_permission from
 * their role's grants — no scope arithmetic here. */
async function hasPermission(admin: SupabaseClient, userId: string, permission: string, minScope = 'own'): Promise<boolean> {
  const { data, error } = await admin.rpc('user_has_permission', { p_user: userId, p_permission: permission, p_min_scope: minScope });
  if (error) throw error;
  return data === true;
}

interface ResetPasswordPayload {
  userId: string;
  newPassword: string;
}

/**
 * Callers with staff.manage reset the password of anyone whose role is
 * within their own access — never someone with more access (e.g. a Super
 * Admin can't take over the Boss account). Uses the service-role key because
 * auth.admin.updateUserById is not callable from the client.
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
    // Identify the caller and confirm they can manage staff.
    const jwt = authHeader.replace('Bearer ', '');
    const { data: callerAuth, error: callerErr } = await admin.auth.getUser(jwt);
    if (callerErr || !callerAuth.user) return json({ error: 'Invalid session' }, 401);

    if (!(await hasPermission(admin, callerAuth.user.id, 'staff.manage', 'all'))) {
      return json({ error: "You don't have permission to reset staff passwords." }, 403);
    }

    const payload: ResetPasswordPayload = await req.json();
    if (!payload.userId || !payload.newPassword) {
      return json({ error: 'userId and newPassword are required.' }, 400);
    }
    if (payload.newPassword.length < 6) {
      return json({ error: 'Password must be at least 6 characters.' }, 400);
    }

    const { data: target, error: targetErr } = await admin
      .from('profiles')
      .select('id, role, email, name')
      .eq('id', payload.userId)
      .single();

    if (targetErr || !target) return json({ error: 'Staff member not found.' }, 404);

    const { data: withinMine, error: withinErr } = await admin.rpc('user_can_assign_role', {
      p_user: callerAuth.user.id, p_role: target.role,
    });
    if (withinErr) throw withinErr;
    if (!withinMine) {
      return json({ error: "You can't reset the password of someone with more access than you." }, 403);
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
