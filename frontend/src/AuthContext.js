/**
 * Authentication context for MySurfLife
 * Manages user authentication state and admin status
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

const AuthContext = createContext({});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  // Check admin status via backend API (bypasses Supabase client issues)
  const checkAdminStatus = async (userId) => {
    console.log('🔍 Checking admin status for user:', userId);

    if (!userId) {
      console.log('❌ No userId provided');
      setIsAdmin(false);
      return;
    }

    try {
      // Get current session token
      const token = localStorage.getItem('sb-duebzukxycgfkfjezwjq-auth-token');
      if (!token) {
        console.log('❌ No auth token found');
        setIsAdmin(false);
        return;
      }

      const sessionData = JSON.parse(token);
      const accessToken = sessionData.access_token;

      console.log('📡 Checking admin status via backend API...');

      // Call backend to check admin status
      const response = await fetch('/api/auth/check-admin', {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        console.log('❌ Admin check failed:', response.status);
        setIsAdmin(false);
        return;
      }

      const result = await response.json();
      const adminStatus = result.is_admin || false;

      console.log(adminStatus ? '👑 User IS admin' : '👤 User is NOT admin');
      setIsAdmin(adminStatus);
    } catch (error) {
      console.error('❌ Exception checking admin status:', error);
      setIsAdmin(false);
    }
  };

  // Initialize auth state
  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user || null);

      if (session?.user) {
        checkAdminStatus(session.user.id);
      }

      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth state changed:', event);
        setSession(session);
        setUser(session?.user || null);

        if (session?.user) {
          await checkAdminStatus(session.user.id);
        } else {
          setIsAdmin(false);
        }

        setLoading(false);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Sign in with email and password
  const signIn = async (email, password) => {
    console.log('🔐 Attempting sign in...');
    try {
      // Call Supabase auth API directly to bypass Navigator Locks issue
      const response = await fetch(`${process.env.REACT_APP_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.REACT_APP_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        console.error('❌ Sign in error:', data);
        throw new Error(data.error_description || data.message || 'Sign in failed');
      }

      console.log('✅ Sign in successful');

      // Store session in localStorage (Supabase format)
      const storageKey = `sb-${process.env.REACT_APP_SUPABASE_URL.split('//')[1].split('.')[0]}-auth-token`;
      localStorage.setItem(storageKey, JSON.stringify({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_at,
        expires_in: data.expires_in,
        token_type: data.token_type,
        user: data.user,
      }));

      // Reload page to initialize auth state properly
      window.location.href = '/';

      return { data, error: null };
    } catch (error) {
      console.error('❌ Sign in failed:', error);
      return { data: null, error };
    }
  };

  // Sign up with email and password
  const signUp = async (email, password) => {
    console.log('📝 Attempting sign up...');
    try {
      // Add 10 second timeout
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Sign up timeout - check network connection')), 10000)
      );

      const signUpPromise = supabase.auth.signUp({
        email,
        password,
      });

      const { data, error } = await Promise.race([signUpPromise, timeoutPromise]);

      if (error) {
        console.error('❌ Sign up error:', error);
        throw error;
      }

      console.log('✅ Sign up successful');
      return { data, error: null };
    } catch (error) {
      console.error('❌ Sign up failed:', error);
      return { data: null, error };
    }
  };

  // Sign out
  const signOut = async () => {
    console.log('🚪 Signing out...');

    // Clear localStorage manually (Supabase stores session here)
    const keys = Object.keys(localStorage);
    const supabaseKeys = keys.filter(key => key.startsWith('sb-'));
    supabaseKeys.forEach(key => {
      console.log(`Removing ${key} from localStorage`);
      localStorage.removeItem(key);
    });

    console.log('✅ Signed out - reloading page');

    // Force page reload to clear auth state completely
    window.location.href = '/';

    return { error: null };
  };

  const value = {
    user,
    session,
    isAdmin,
    loading,
    signIn,
    signUp,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
