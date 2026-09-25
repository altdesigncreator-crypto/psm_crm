import { serve } from 'https://deno.land/std@0.192.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.1';
import webpush from 'npm:web-push@3.6.7';

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

interface Payload {
  user_id: string;
  title: string;
  body: string;
  url?: string;
}

/**
 * Sends a real Web Push notification to one specific user's subscribed
 * devices — the System Banner Admin's send_push (banner-messages/index.ts)
 * broadcasts to every subscription with no targeting, which doesn't fit a
 * per-person event like an Enquiry assignment. Pushing to someone else
 * requires Admin or above (matching who's allowed to assign enquiries —
 * see canAssignEnquiry in src/lib/permissions.ts); any authenticated user
 * may always push-test *themselves* (Settings' "Send test notification"),
 * since that carries no privilege-escalation risk. Best-effort: a user with
 * no push subscription (never granted permission) just gets `sent: 0`, not
 * an error — the in-app notifications row is the reliable fallback for them.
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

  const jwt = authHeader.replace('Bearer ', '');
  const { data: callerAuth, error: callerErr } = await admin.auth.getUser(jwt);
  if (callerErr || !callerAuth.user) return json({ error: 'Invalid session' }, 401);

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  if (!payload.user_id || !payload.title?.trim() || !payload.body?.trim()) {
    return json({ error: 'user_id, title, and body are required.' }, 400);
  }

  if (payload.user_id !== callerAuth.user.id) {
    const { data: callerProfile, error: profileErr } = await admin
      .from('profiles')
      .select('role')
      .eq('id', callerAuth.user.id)
      .single();
    if (profileErr || !callerProfile || !['boss', 'super_admin', 'admin'].includes(callerProfile.role)) {
      return json({ error: 'Not authorized' }, 403);
    }
  }

  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT');
  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return json({ error: 'Push notifications are not configured on the server.' }, 500);
  }
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const { data: subs, error: subsErr } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth_key')
    .eq('user_id', payload.user_id);
  if (subsErr) return json({ error: subsErr.message }, 500);
  if (!subs || subs.length === 0) return json({ sent: 0, failed: 0 });

  const payloadStr = JSON.stringify({ title: payload.title.trim(), body: payload.body.trim(), url: payload.url || '/' });
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
});
