import { serve } from 'https://deno.land/std@0.192.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.1';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, X-Client-Info',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/**
 * Login for the system-banner announcement board — deliberately NOT part of
 * Supabase Auth / staff accounts (see database/crm.sql section 16). Verifies
 * username/password against public.banner_admins with pgcrypto's crypt(),
 * then issues an opaque session token in public.banner_sessions. Both those
 * tables have no client-facing RLS policy at all, so this service-role
 * function is the only thing that can ever read or write them.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Server configuration error' }, 500);

  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { username, password } = await req.json();
    if (!username || !password) return json({ error: 'Username and password are required.' }, 400);

    const { data: match, error: matchErr } = await admin
      .rpc('verify_banner_admin', { p_username: String(username).trim(), p_password: String(password) })
      .single();

    if (matchErr || !match) return json({ error: 'Invalid username or password.' }, 401);

    const adminId = (match as { id: string }).id;

    const { data: session, error: sessionErr } = await admin
      .from('banner_sessions')
      .insert({ admin_id: adminId })
      .select('token, expires_at')
      .single();

    if (sessionErr || !session) return json({ error: 'Could not start a session.' }, 500);

    return json({ token: session.token, expires_at: session.expires_at });
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }
});
