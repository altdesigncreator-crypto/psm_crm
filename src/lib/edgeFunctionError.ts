/** supabase-js's `functions.invoke()` gives you only a generic
 * "Edge Function returned a non-2xx status code" in `error.message` when a
 * function responds with a non-2xx status — it never parses the response
 * body into `data` on failure, even though every edge function in this
 * project deliberately replies with a JSON `{ error: "..." }` body
 * explaining what actually went wrong. That real reason is sitting unread
 * on `error.context` (the raw Response). Call this instead of reading
 * `error.message` directly so the real cause reaches the user. */
export async function getEdgeFunctionErrorMessage(error: unknown, fallback = 'Request failed.'): Promise<string> {
  const err = error as { message?: string; context?: Response } | null | undefined;
  if (!err) return fallback;
  try {
    const body = await err.context?.json();
    if (body?.error) return body.error;
  } catch {
  }
  return err.message || fallback;
}
