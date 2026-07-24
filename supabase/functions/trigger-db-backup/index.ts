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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Repo isn't sensitive — only the token is (that comes from the
// GITHUB_PAT secret below).
const GITHUB_OWNER = 'altdesigncreator-crypto';
const GITHUB_REPO = 'psm_crm';
const WORKFLOW_FILE = 'db-backup.yml';
const BRANCH = 'main';

// Generous but bounded — the workflow itself (install postgresql-client,
// pg_dump, upload artifact) normally finishes in under a minute, but a busy
// GitHub Actions queue can add delay. If this budget is exceeded we bail
// with a clear message rather than hang past the Edge Function's own
// execution limit.
const MAX_WAIT_MS = 110_000;
const POLL_INTERVAL_MS = 4_000;

function ghFetch(url: string, token: string, init?: RequestInit) {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'psm-crm-backup-function',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
}

/**
 * Boss/Super Admin one-click database backup. Edge Functions can't shell
 * out to pg_dump directly (sandboxed runtime, no subprocess access), so this
 * triggers the real pg_dump GitHub Actions workflow (.github/workflows/
 * db-backup.yml) via the GitHub API, waits for it to finish, then relays the
 * resulting artifact zip straight back to the browser — the download button
 * gets the exact same trustworthy backup the daily scheduled run produces,
 * just on demand.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const githubToken = Deno.env.get('GITHUB_PAT');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Server configuration error' }, 500);
  if (!githubToken) return json({ error: 'Backups are not configured yet (missing GITHUB_PAT secret).' }, 500);

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
      return json({ error: 'Only Boss/Super Admin can download a database backup.' }, 403);
    }

    const startedAt = Date.now();
    const dispatchedAt = new Date();

    const dispatchRes = await ghFetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      githubToken,
      { method: 'POST', body: JSON.stringify({ ref: BRANCH }) }
    );
    if (!dispatchRes.ok) {
      const detail = await dispatchRes.text();
      return json({ error: `Could not start the backup workflow (${dispatchRes.status}). ${detail}` }, 502);
    }

    // The dispatch call is fire-and-forget and doesn't return a run id, so
    // find the run it created by matching on start time.
    let run: any = null;
    while (!run && Date.now() - startedAt < MAX_WAIT_MS) {
      await sleep(POLL_INTERVAL_MS);
      const runsRes = await ghFetch(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=5`,
        githubToken
      );
      const runsData = await runsRes.json();
      run = (runsData.workflow_runs || []).find((r: any) => new Date(r.created_at).getTime() >= dispatchedAt.getTime() - 5000);
    }
    if (!run) {
      return json({ error: 'Timed out waiting for the backup workflow to start. Check the Actions tab on GitHub — it may still be queued.' }, 504);
    }

    while (run.status !== 'completed' && Date.now() - startedAt < MAX_WAIT_MS) {
      await sleep(POLL_INTERVAL_MS);
      const runRes = await ghFetch(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${run.id}`,
        githubToken
      );
      run = await runRes.json();
    }
    if (run.status !== 'completed') {
      return json({ error: 'The backup is taking longer than expected. Check the Actions tab on GitHub — it may still finish there.' }, 504);
    }
    if (run.conclusion !== 'success') {
      return json({ error: `The backup workflow failed (${run.conclusion}). Check the Actions tab on GitHub for details.` }, 500);
    }

    const artifactsRes = await ghFetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${run.id}/artifacts`,
      githubToken
    );
    const artifactsData = await artifactsRes.json();
    const artifact = artifactsData.artifacts?.[0];
    if (!artifact) return json({ error: 'The backup workflow finished but produced no artifact.' }, 500);

    const downloadRes = await ghFetch(artifact.archive_download_url, githubToken);
    if (!downloadRes.ok) return json({ error: `Could not download the backup artifact (${downloadRes.status}).` }, 502);
    const zipBuf = await downloadRes.arrayBuffer();

    return new Response(zipBuf, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${artifact.name}.zip"`,
      },
    });
  } catch (err: any) {
    return json({ error: err.message || 'Internal error' }, 500);
  }
});
