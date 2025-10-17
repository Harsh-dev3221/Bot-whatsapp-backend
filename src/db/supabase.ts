// Supabase client configuration

import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

// Client for user-level operations (with RLS)
export const supabase = createClient(
  env.supabase.url,
  env.supabase.anonKey
);

// Admin client for service-level operations (bypasses RLS)
export const supabaseAdmin = createClient(
  env.supabase.url,
  env.supabase.serviceKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

