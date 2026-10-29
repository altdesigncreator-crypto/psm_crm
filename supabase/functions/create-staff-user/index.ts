import { serve } from 'https://deno.land/std@0.192.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.1';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
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

interface CreateStaffPayload {
  email: string;
  password: string;
  name: string;
  phone?: string;
  role: string;
  department?: string | null;
}

/**
 * Staff provisioning is intentionally not self-service (Supabase's normal
 * client-side signUp() would let anyone create an account). Only callers with
 * the staff.manage permission may call this, and only for roles within their
 * own access (no handing out more than you hold) — it uses the service-role key to create the auth
 * user + matching profile row in one step, bypassing RLS (which otherwise
 * has no INSERT policy on profiles at all).
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
      return json({ error: "You don't have permission to create staff accounts." }, 403);
    }

    const payload: CreateStaffPayload = await req.json();
    if (!payload.email || !payload.password || !payload.name || !payload.role) {
      return json({ error: 'email, password, name, and role are required.' }, 400);
    }
    const { data: canAssign, error: assignErr } = await admin.rpc('user_can_assign_role', {
      p_user: callerAuth.user.id, p_role: payload.role,
    });
    if (assignErr) throw assignErr;
    if (!canAssign) {
      return json({ error: "That role doesn't exist, or has more access than your own." }, 403);
    }
    const { data: role } = await admin.from('roles').select('name, requires_department').eq('key', payload.role).single();
    if (role?.requires_department && !payload.department) {
      return json({ error: `${role.name} accounts require a department.` }, 400);
    }
    if (!role?.requires_department) payload.department = null;

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: payload.email.toLowerCase().trim(),
      password: payload.password,
      email_confirm: true,
      user_metadata: { name: payload.name },
    });

    if (createErr || !created.user) {
      return json({ error: createErr?.message || 'Could not create the auth user.' }, 400);
    }

    const { error: insertErr } = await admin.from('profiles').insert({
      id: created.user.id,
      email: payload.email.toLowerCase().trim(),
      name: payload.name,
      phone: payload.phone || null,
      role: payload.role,
      department_code: payload.department || null,
      status: 'active',
    });

    if (insertErr) {
      // Roll back the orphaned auth user so retries don't collide on email.
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: insertErr.message }, 400);
    }

    await admin.from('audit_logs').insert({
      action: 'user_created',
      target_table: 'profiles',
      target_id: created.user.id,
      performed_by: callerAuth.user.id,
      new_value: { email: payload.email, role: payload.role, department: payload.department },
    });

    return json({ id: created.user.id, email: payload.email, name: payload.name });
  } catch (err: any) {
    return json({ error: err.message || 'Internal error' }, 500);
  }
});
