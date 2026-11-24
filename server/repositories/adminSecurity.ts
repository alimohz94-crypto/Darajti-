import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '../supabase.ts';

export interface AdminSessionRecord {
  token_hash: string;
  username: string;
  role: string;
  csrf_token: string;
  last_activity_at: number;
  expires_at: number;
  ip_address?: string;
  user_agent?: string;
  created_at?: string;
}

export interface AdminAuthRateLimitRecord {
  client_key: string;
  fail_count: number;
  lock_level: number;
  first_fail_at: number;
  locked_until: number;
  updated_at: number;
}

export interface AdminAuthFailureResult extends AdminAuthRateLimitRecord {
  attempt: number;
}

function throwRepositoryError(operation: string, error: { message: string; code?: string }): never {
  throw new Error(`Failed to ${operation}: ${error.message}`);
}

export async function getAdminSessionRecord(
  tokenHash: string,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<AdminSessionRecord | null> {
  const { data, error } = await client
    .from('admin_sessions')
    .select('token_hash, username, role, csrf_token, last_activity_at, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error) throwRepositoryError('load admin session', error);
  return data as AdminSessionRecord | null;
}

export async function createAdminSession(
  session: AdminSessionRecord,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<void> {
  const { error } = await client.from('admin_sessions').insert(session);
  if (error) throwRepositoryError('create admin session', error);
}

export async function touchAdminSession(
  tokenHash: string,
  now: number,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<void> {
  const { error } = await client
    .from('admin_sessions')
    .update({ last_activity_at: now })
    .eq('token_hash', tokenHash);
  if (error) throwRepositoryError('touch admin session', error);
}

export async function deleteAdminSession(
  tokenHash: string,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<void> {
  const { error } = await client.from('admin_sessions').delete().eq('token_hash', tokenHash);
  if (error) throwRepositoryError('delete admin session', error);
}

export async function deleteExpiredAdminSessions(
  now: number,
  idleTimeoutMs: number,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<void> {
  const { error } = await client
    .from('admin_sessions')
    .delete()
    .or(`expires_at.lt.${now},last_activity_at.lt.${now - idleTimeoutMs}`);
  if (error) throwRepositoryError('delete expired admin sessions', error);
}

export async function deleteAllAdminSessions(
  client: SupabaseClient = getSupabaseServerClient()
): Promise<void> {
  const { error } = await client.from('admin_sessions').delete().neq('token_hash', '');
  if (error) throwRepositoryError('invalidate admin sessions', error);
}

export async function getAdminPinHash(
  client: SupabaseClient = getSupabaseServerClient()
): Promise<string | null> {
  const { data, error } = await client
    .from('admin_settings')
    .select('value')
    .eq('key', 'admin_pin_hash')
    .maybeSingle();
  if (error) throwRepositoryError('load admin PIN hash', error);
  return typeof data?.value === 'string' ? data.value : null;
}

export async function saveAdminPinHash(
  value: string,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<void> {
  const { error } = await client
    .from('admin_settings')
    .upsert(
      { key: 'admin_pin_hash', value, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
  if (error) throwRepositoryError('save admin PIN hash', error);
}

export async function getAdminAuthRateLimit(
  clientKey: string,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<AdminAuthRateLimitRecord | null> {
  const { data, error } = await client
    .from('admin_auth_rate_limits')
    .select('client_key, fail_count, lock_level, first_fail_at, locked_until, updated_at')
    .eq('client_key', clientKey)
    .maybeSingle();
  if (error) throwRepositoryError('load admin authentication limit', error);
  return data as AdminAuthRateLimitRecord | null;
}

export async function recordAdminAuthFailure(
  values: {
    clientKey: string;
    now: number;
    windowMs: number;
    maxAttempts: number;
    maxLockLevel: number;
    baseLockMinutes: number;
    maxLockMinutes: number;
  },
  client: SupabaseClient = getSupabaseServerClient()
): Promise<AdminAuthFailureResult> {
  const { data, error } = await client.rpc('record_admin_auth_failure', {
    p_client_key: values.clientKey,
    p_now: values.now,
    p_window_ms: values.windowMs,
    p_max_attempts: values.maxAttempts,
    p_max_lock_level: values.maxLockLevel,
    p_base_lock_minutes: values.baseLockMinutes,
    p_max_lock_minutes: values.maxLockMinutes,
  });
  if (error) throwRepositoryError('record admin authentication failure', error);
  const result = Array.isArray(data) ? data[0] : data;
  if (!result) throw new Error('Supabase returned no authentication-limit result.');
  return result as AdminAuthFailureResult;
}

export async function clearAdminAuthRateLimit(
  clientKey: string,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<void> {
  const { error } = await client
    .from('admin_auth_rate_limits')
    .delete()
    .eq('client_key', clientKey);
  if (error) throwRepositoryError('clear admin authentication limit', error);
}

export async function recordSiteVisitOnce(
  sessionId: string,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<boolean> {
  const { data, error } = await client
    .from('site_visits')
    .upsert({ session_id: sessionId }, { onConflict: 'session_id', ignoreDuplicates: true })
    .select('session_id')
    .maybeSingle();
  if (error) throwRepositoryError('record site visit', error);
  return Boolean(data);
}

export async function countSiteVisits(
  client: SupabaseClient = getSupabaseServerClient()
): Promise<number> {
  const { count, error } = await client
    .from('site_visits')
    .select('id', { count: 'exact', head: true });
  if (error) throwRepositoryError('count site visits', error);
  if (typeof count !== 'number') throw new Error('Supabase returned no site-visit count.');
  return count;
}
