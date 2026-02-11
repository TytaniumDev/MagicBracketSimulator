import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  User,
  signInWithPopup,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  getIdToken,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db, googleProvider, isFirebaseConfigured } from '../firebase';

const ALLOWED_USERS_COLLECTION = 'allowedUsers';

interface AuthContextType {
  user: User | null;
  /** True only when user is signed in AND listed in Firestore allowedUsers. */
  isAllowed: boolean | null;
  loading: boolean;
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Local mode: Firebase is not configured, provide a mock user immediately
    if (!isFirebaseConfigured) {
      setUser(createLocalMockUser());
      setIsAllowed(true);
      setLoading(false);
      return;
    }

    // GCP mode: use real Firebase Auth
    const unsubscribe = onAuthStateChanged(auth!, async (firebaseUser) => {
      setUser(firebaseUser);
      if (!firebaseUser) {
        setIsAllowed(null);
        setLoading(false);
        return;
      }
      try {
        const allowedRef = doc(db!, ALLOWED_USERS_COLLECTION, firebaseUser.uid);
        const snap = await getDoc(allowedRef);
        setIsAllowed(snap.exists());
      } catch (err) {
        console.error('Error checking allowlist:', err);
        setIsAllowed(false);
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
      return null;
    }
  };

  const value: AuthContextType = {
    user,
    isAllowed,
    loading,
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
