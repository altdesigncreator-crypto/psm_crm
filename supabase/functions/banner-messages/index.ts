import { serve } from 'https://deno.land/std@0.192.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.1';

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
  action: 'list' | 'create' | 'update' | 'delete' | 'logout' | 'update_maintenance';
  id?: string;
  message?: string;
  type?: MessageType;
  is_active?: boolean;
  // update_maintenance only:
  is_enabled?: boolean;
  title?: string;
  // Data URL (e.g. "data:image/png;base64,...."), sent as-is from the
  // client's FileReader — only present when the admin picked a new image.
  image_base64?: string;
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

    case 'update_maintenance': {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (payload.is_enabled !== undefined) patch.is_enabled = payload.is_enabled;
      if (payload.title !== undefined) patch.title = payload.title.trim();
      if (payload.message !== undefined) patch.message = payload.message.trim();

      if (payload.image_base64) {
        const match = payload.image_base64.match(/^data:(.+);base64,(.*)$/);
        if (!match) return json({ error: 'Invalid image data.' }, 400);
        const mime = match[1];
        const ext = mime.split('/')[1] || 'jpg';
        const binaryStr = atob(match[2]);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

        // Fixed filename (upsert) — this is a single-logo singleton, not a
        // gallery, so each new upload replaces the last one rather than
        // accumulating orphaned files in storage.
        const path = `logo.${ext}`;
        const { error: uploadErr } = await admin.storage.from('maintenance').upload(path, bytes, { contentType: mime, upsert: true });
        if (uploadErr) return json({ error: uploadErr.message }, 500);

        // Cache-bust: same path every time, so without this query param
        // browsers/CDNs could keep serving the previous image.
        patch.image_url = `${admin.storage.from('maintenance').getPublicUrl(path).data.publicUrl}?t=${Date.now()}`;
      }

      const { data, error } = await admin.from('maintenance_settings').update(patch).eq('id', 1).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ settings: data });
    }

    default:
      return json({ error: 'Unknown action.' }, 400);
  }
});
