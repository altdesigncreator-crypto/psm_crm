import { serve } from 'https://deno.land/std@0.192.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.1';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, X-Banner-Token',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

type MessageType = 'info' | 'warning' | 'maintenance' | 'critical';

interface Payload {
  action: 'list' | 'create' | 'update' | 'delete' | 'logout';
  id?: string;
  message?: string;
  type?: MessageType;
  is_active?: boolean;
}

/**
 * All CRUD for the system-banner announcement board. Every call must carry a
 * valid, unexpired X-Banner-Token issued by banner-login — that token has
 * nothing to do with Supabase Auth, so this is the only path that can ever
 * write to public.system_messages (its RLS only grants SELECT of active rows
 * to the client, no writes at all).
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Server configuration error' }, 500);

  const token = req.headers.get('X-Banner-Token');
  if (!token) return json({ error: 'Missing banner session token.' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: validSession } = await admin.rpc('verify_banner_session', { p_token: token });
  if (!validSession) return json({ error: 'Session expired — please log in again.' }, 401);

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  switch (payload.action) {
    case 'list': {
      const { data, error } = await admin.from('system_messages').select('*').order('created_at', { ascending: false });
      if (error) return json({ error: error.message }, 500);
      return json({ messages: data });
    }

    case 'create': {
      if (!payload.message?.trim()) return json({ error: 'Message text is required.' }, 400);
      const { data, error } = await admin
        .from('system_messages')
        .insert({
          message: payload.message.trim(),
          type: payload.type || 'maintenance',
          is_active: payload.is_active ?? true,
        })
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ message: data });
    }

    case 'update': {
      if (!payload.id) return json({ error: 'id is required.' }, 400);
      const patch: Record<string, unknown> = {};
      if (payload.message !== undefined) patch.message = payload.message.trim();
      if (payload.type !== undefined) patch.type = payload.type;
      if (payload.is_active !== undefined) patch.is_active = payload.is_active;
      const { data, error } = await admin.from('system_messages').update(patch).eq('id', payload.id).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ message: data });
    }

    case 'delete': {
      if (!payload.id) return json({ error: 'id is required.' }, 400);
      const { error } = await admin.from('system_messages').delete().eq('id', payload.id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    case 'logout': {
      await admin.from('banner_sessions').delete().eq('token', token);
      return json({ ok: true });
    }

    default:
      return json({ error: 'Unknown action.' }, 400);
  }
});
