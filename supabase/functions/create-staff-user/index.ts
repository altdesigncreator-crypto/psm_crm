import { serve } from 'https://deno.land/std@0.192.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.1';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

interface CreateStaffPayload {
  email: string;
  password: string;
  name: string;
  phone?: string;
  role: 'boss' | 'super_admin' | 'admin' | 'manager' | 'sale';
  department?: 'house' | 'condo' | 'project' | null;
}

/**
 * Staff provisioning is intentionally not self-service (Supabase's normal
 * client-side signUp() would let anyone create an account). Only Boss/Super
 * Admin may call this — it uses the service-role key to create the auth
 * user + matching profile row in one step, bypassing RLS (which otherwise
 * has no INSERT policy on profiles at all).
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
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
      return json({ error: 'Only Boss/Super Admin can create staff accounts.' }, 403);
    }

    const payload: CreateStaffPayload = await req.json();
    if (!payload.email || !payload.password || !payload.name || !payload.role) {
      return json({ error: 'email, password, name, and role are required.' }, 400);
    }
    if (payload.role !== 'boss' && payload.role !== 'super_admin' && payload.role !== 'admin' && !payload.department) {
      return json({ error: 'Manager/Sales accounts require a department.' }, 400);
    }

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
