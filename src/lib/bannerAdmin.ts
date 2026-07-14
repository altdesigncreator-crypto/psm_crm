import { supabase } from '@/db/supabase';
import type { SystemMessage, SystemMessageType } from '@/types';

const TOKEN_KEY = 'psm_banner_admin_token';

/**
 * Client for the system-banner announcement board's edge functions
 * (banner-login, banner-messages). This is intentionally NOT part of
 * AuthContext/Supabase Auth — see database/crm.sql section 16 — it manages
 * its own opaque session token in localStorage, separate from any CRM
 * staff login.
 */
export function getBannerToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function setBannerToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function bannerLogin(username: string, password: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('banner-login', { body: { username, password } });
  if (error || data?.error) throw new Error(data?.error || error?.message || 'Login failed.');
  setBannerToken(data.token);
}

export async function bannerLogout(): Promise<void> {
  const token = getBannerToken();
  if (token) {
    await supabase.functions.invoke('banner-messages', { body: { action: 'logout' }, headers: { 'X-Banner-Token': token } }).catch(() => {});
  }
  setBannerToken(null);
}

async function callMessages(body: Record<string, unknown>) {
  const token = getBannerToken();
  if (!token) throw new Error('Not logged in.');
  const { data, error } = await supabase.functions.invoke('banner-messages', { body, headers: { 'X-Banner-Token': token } });
  if (error || data?.error) {
    if (data?.error === 'Session expired — please log in again.') setBannerToken(null);
    throw new Error(data?.error || error?.message || 'Request failed.');
  }
  return data;
}

export async function listMessages(): Promise<SystemMessage[]> {
  const data = await callMessages({ action: 'list' });
  return data.messages as SystemMessage[];
}

export async function createMessage(message: string, type: SystemMessageType, isActive: boolean): Promise<SystemMessage> {
  const data = await callMessages({ action: 'create', message, type, is_active: isActive });
  return data.message as SystemMessage;
}

export async function updateMessage(id: string, patch: Partial<Pick<SystemMessage, 'message' | 'type' | 'is_active'>>): Promise<SystemMessage> {
  const data = await callMessages({ action: 'update', id, ...patch });
  return data.message as SystemMessage;
}

export async function deleteMessage(id: string): Promise<void> {
  await callMessages({ action: 'delete', id });
}
