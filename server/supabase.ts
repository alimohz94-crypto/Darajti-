import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseServerEnvironment {
  [key: string]: string | undefined;
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export interface SupabaseServerConfig {
  url: string;
  secretKey: string;
}

export function readSupabaseServerConfig(
  env: SupabaseServerEnvironment = process.env
): SupabaseServerConfig {
  const url = env.SUPABASE_URL?.trim();
  const secretKey =
    env.SUPABASE_SECRET_KEY?.trim() ||
    env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !secretKey) {
    throw new Error(
      'Supabase server configuration is missing. Set SUPABASE_URL and SUPABASE_SECRET_KEY.'
    );
  }

  return { url, secretKey };
}

export function createSupabaseServerClient(
  env: SupabaseServerEnvironment = process.env
): SupabaseClient {
  const { url, secretKey } = readSupabaseServerConfig(env);

  return createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

let serverClient: SupabaseClient | undefined;

export function getSupabaseServerClient(): SupabaseClient {
  if (!serverClient) {
    serverClient = createSupabaseServerClient();
  }
  return serverClient;
}
