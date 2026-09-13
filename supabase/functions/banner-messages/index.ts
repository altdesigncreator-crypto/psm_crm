import { serve } from 'https://deno.land/std@0.192.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.1';
import webpush from 'npm:web-push@3.6.7';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, X-Client-Info, X-Banner-Token',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

type MessageType = 'info' | 'warning' | 'maintenance' | 'critical';

interface Payload {
  action: 'list' | 'create' | 'update' | 'delete' | 'logout' | 'update_maintenance' | 'send_push';
  id?: string;
  message?: string;
  type?: MessageType;
  is_active?: boolean;
  // update_maintenance only:
  is_enabled?: boolean;
  title?: string;
  // send_push only:
  body?: string;
  url?: string;
}

/**
 * All CRUD for the system-banner announcement board, plus the site-wide
 * maintenance-mode gate (public.maintenance_settings — a separate, blocking
 * takeover page, distinct from the dismissible banner). Every call must
 * carry a valid, unexpired X-Banner-Token issued by banner-login — that
 * token has nothing to do with Supabase Auth, so this is the only path that
 * can ever write to system_messages or maintenance_settings (both tables'
 * RLS only grants reads to the client, no writes at all).
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

    case 'send_push': {
      const title = payload.title?.trim();
      const body = payload.body?.trim();
      if (!title || !body) return json({ error: 'Title and body are required.' }, 400);

      const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
      const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
      const vapidSubject = Deno.env.get('VAPID_SUBJECT');
      if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
        return json({ error: 'Push notifications are not configured on the server.' }, 500);
      }
      webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

      const { data: subs, error: subsErr } = await admin
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth_key');
      if (subsErr) return json({ error: subsErr.message }, 500);
      if (!subs || subs.length === 0) return json({ sent: 0, failed: 0 });

      const payloadStr = JSON.stringify({ title, body, url: payload.url || '/' });
      const staleIds: string[] = [];
      let sent = 0;

      await Promise.all(
        subs.map(async (s) => {
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } },
              payloadStr
            );
            sent++;
          } catch (err: any) {
            if (err?.statusCode === 404 || err?.statusCode === 410) staleIds.push(s.id);
          }
        })
      );

      if (staleIds.length > 0) await admin.from('push_subscriptions').delete().in('id', staleIds);

      return json({ sent, failed: subs.length - sent });
    }

    case 'update_maintenance': {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (payload.is_enabled !== undefined) patch.is_enabled = payload.is_enabled;
      if (payload.title !== undefined) patch.title = payload.title.trim();
      if (payload.message !== undefined) patch.message = payload.message.trim();

      const { data, error } = await admin.from('maintenance_settings').update(patch).eq('id', 1).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ settings: data });
    }

    default:
      return json({ error: 'Unknown action.' }, 400);
  }
});
