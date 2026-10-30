import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  User,
  signInWithPopup,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  getIdToken,
} from 'firebase/auth';
import { auth, googleProvider, isFirebaseConfigured } from '../firebase';
import { getApiBase, fetchWithAuth } from '../api';
import { reportHandledError } from '../errorReporting';

/** What `GET /api/me` says about the signed-in user's access. */
interface MeResponse {
  isAllowed: boolean;
  isAdmin: boolean;
  hasRequestedAccess: boolean;
}

async function fetchMe(): Promise<MeResponse> {
  const res = await fetchWithAuth(`${getApiBase()}/api/me`);
  if (!res.ok) throw new Error(`GET /api/me failed: ${res.status}`);
  const data = (await res.json()) as Partial<MeResponse>;
  return {
    isAllowed: data.isAllowed === true,
    isAdmin: data.isAdmin === true,
    hasRequestedAccess: data.hasRequestedAccess === true,
  };
}

interface AuthContextType {
  user: User | null;
  /** True only when user is signed in AND has been given access. */
  isAllowed: boolean | null;
  /** True if the current user is an admin */
  isAdmin: boolean;
  loading: boolean;
  /** Whether the user has a pending access request */
  hasRequestedAccess: boolean;
  /** Refresh access request status */
  refreshAccessRequestStatus: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

interface AuthProviderProps {
  children: ReactNode;
}

/**
 * Create a mock User object for local mode (when Firebase is not configured).
 * Satisfies the parts of the User interface consumed by the app.
 */
function createLocalMockUser(): User {
  return {
    uid: 'local-user',
    email: 'local@dev',
    displayName: 'Local User',
    photoURL: null,
    emailVerified: true,
    isAnonymous: false,
    phoneNumber: null,
    providerId: 'local',
    metadata: {} as User['metadata'],
    providerData: [],
    refreshToken: '',
    tenantId: null,
    delete: () => Promise.resolve(),
    getIdToken: () => Promise.resolve('local-mock-token'),
    getIdTokenResult: () => Promise.resolve({} as Awaited<ReturnType<User['getIdTokenResult']>>),
    reload: () => Promise.resolve(),
    toJSON: () => ({}),
  } as User;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isAllowed, setIsAllowed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasRequestedAccess, setHasRequestedAccess] = useState(false);

  const applyMe = (me: MeResponse) => {
    setIsAllowed(me.isAllowed);
    setIsAdmin(me.isAdmin);
    setHasRequestedAccess(me.hasRequestedAccess);
  };

  const refreshAccessRequestStatus = async () => {
    try {
      applyMe(await fetchMe());
    } catch (err) {
      // Non-fatal: the access request state just stays as it was.
      reportHandledError(err, { action: 'checkAccessRequestStatus' });
    }
  };

  useEffect(() => {
    // Local mode: Firebase is not configured, provide a mock user immediately
    if (!isFirebaseConfigured) {
      setUser(createLocalMockUser());
      setIsAllowed(true);
      setIsAdmin(true);
      setLoading(false);
      return;
    }

    // GCP mode: use real Firebase Auth
    const unsubscribe = onAuthStateChanged(auth!, async (firebaseUser) => {
      setUser(firebaseUser);
      if (!firebaseUser) {
        setIsAllowed(null);
        setIsAdmin(false);
        setHasRequestedAccess(false);
        setLoading(false);
        return;
      }
      try {
        applyMe(await fetchMe());
      } catch (err) {
        console.error('Error checking access:', err);
        reportHandledError(err, { action: 'checkAllowlist' });
        setIsAllowed(false);
        setIsAdmin(false);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    if (!isFirebaseConfigured) return;
    try {
      await signInWithPopup(auth!, googleProvider!);
    } catch (error) {
      console.error('Error signing in with Google:', error);
      throw error;
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    if (!isFirebaseConfigured) return;
    try {
      await signInWithEmailAndPassword(auth!, email, password);
    } catch (error) {
      console.error('Error signing in with email/password:', error);
      throw error;
    }
  };

  const signOut = async () => {
    if (!isFirebaseConfigured) return;
    try {
      await firebaseSignOut(auth!);
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  };

  const getToken = async (): Promise<string | null> => {
    if (!isFirebaseConfigured) return 'local-mock-token';
    if (!user) return null;
    try {
      return await getIdToken(user);
    } catch (error) {
      console.error('Error getting ID token:', error);
      reportHandledError(error, { action: 'getIdToken' });
      return null;
    }
  };

  const value: AuthContextType = {
    user,
    isAllowed,
    isAdmin,
    loading,
    hasRequestedAccess,
    refreshAccessRequestStatus,
    signInWithGoogle,
    signInWithEmail,
    signOut,
    getIdToken: getToken,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
