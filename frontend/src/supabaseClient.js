/**
 * Supabase client configuration for MySurfLife
 * Provides authentication and database access
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

// Create singleton instance that survives hot module reloads
let supabaseInstance = null;

if (typeof window !== 'undefined') {
  // Store in window to survive hot reloads
  if (!window.__supabaseClient) {
    console.log('🔧 Creating new Supabase client instance');
    console.log('URL:', supabaseUrl);
    console.log('Key present:', !!supabaseAnonKey);

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('⚠️  Supabase not configured');
    }

    window.__supabaseClient = createClient(
      supabaseUrl || 'https://placeholder.supabase.co',
      supabaseAnonKey || 'placeholder-key',
      {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true
        }
      }
    );
    console.log('✅ Supabase client created');
  } else {
    console.log('♻️ Reusing existing Supabase client instance');
  }
  supabaseInstance = window.__supabaseClient;
}

export const supabase = supabaseInstance;

/**
 * Get authorization headers for API requests
 * @returns {Promise<Object>} Headers object with Authorization if authenticated
 */
export const getAuthHeaders = async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession();

    if (session?.access_token) {
      return {
        'Authorization': `Bearer ${session.access_token}`,
      };
    }

    return {};
  } catch (error) {
    console.error('Error getting auth headers:', error);
    return {};
  }
};
