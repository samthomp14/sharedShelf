import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { log } from '../lib/log';

interface AuthContextValue {
  session: Session | null;
  initializing: boolean;
  // Signed in from a password-reset link: show the set-new-password screen
  // until they pick one (or skip it).
  recovering: boolean;
  finishRecovery: () => void;
  // A reset link that didn't work (expired or already used), for sign-in to show.
  recoveryError: string | null;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  initializing: true,
  recovering: false,
  finishRecovery: () => {},
  recoveryError: null,
});

// A reset link lands back on the site with the result in the hash:
// #access_token=…&refresh_token=…&type=recovery, or #error=…&error_description=…
// The client has detectSessionInUrl off, so read it here and clear it.
type RecoveryHash =
  | { kind: 'session'; access_token: string; refresh_token: string }
  | { kind: 'error'; message: string };

function takeRecoveryHash(): RecoveryHash | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  const isRecovery = params.get('type') === 'recovery' && access_token && refresh_token;
  const error = params.get('error_description') ?? params.get('error');
  if (!isRecovery && !error) return null;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  if (isRecovery) return { kind: 'session', access_token, refresh_token };
  return { kind: 'error', message: error!.replace(/\+/g, ' ') };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function init() {
      const recovery = takeRecoveryHash();
      if (recovery?.kind === 'session') {
        const { error } = await supabase.auth.setSession({
          access_token: recovery.access_token,
          refresh_token: recovery.refresh_token,
        });
        if (error) {
          log.warn('auth.recovery_session_failed', { error: error.message });
          if (active) setRecoveryError('That reset link didn’t work. Ask for a new one below.');
        } else if (active) {
          setRecovering(true);
        }
      } else if (recovery?.kind === 'error') {
        log.warn('auth.recovery_link_error', { error: recovery.message });
        setRecoveryError('That reset link has expired or was already used. Ask for a new one below.');
      }

      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setSession(data.session);
      setInitializing(false);
    }
    init();

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{ session, initializing, recovering, finishRecovery: () => setRecovering(false), recoveryError }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
