import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supportsGooglePopup } from '../utils/browserDetection';

export function LoginButton() {
  const { user, loading, signInWithGoogle, signInWithEmail, signOut } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canUseGoogle = supportsGooglePopup();

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await signInWithEmail(email, password);
    } catch {
      setError('Invalid email or password');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-400">
        <div className="animate-spin h-4 w-4 border-2 border-gray-400 border-t-transparent rounded-full" />
        <span>Loading...</span>
      </div>
    );
  }

  if (user) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          {user.photoURL && (
            <img
              src={user.photoURL}
              alt={user.displayName || 'User'}
              className="h-8 w-8 rounded-full"
            />
          )}
          <span className="text-sm text-gray-300">
            {user.displayName || user.email}
          </span>
        </div>
        <button
          onClick={signOut}
          className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded-md transition-colors"
        >
          Sign Out
        </button>
      </div>
    );
  }

  // Email/password form for embedded browsers (Cursor, etc.)
  if (!canUseGoogle) {
    return (
      <form onSubmit={handleEmailSignIn} className="flex items-center gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="px-3 py-2 text-sm bg-gray-700 text-white rounded-md border border-gray-600 focus:outline-none focus:border-purple-500 w-40"
          disabled={isSubmitting}
          required
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="px-3 py-2 text-sm bg-gray-700 text-white rounded-md border border-gray-600 focus:outline-none focus:border-purple-500 w-32"
          disabled={isSubmitting}
          required
        />
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-700 disabled:bg-purple-800 text-white rounded-md transition-colors font-medium"
        >
          {isSubmitting ? 'Signing in...' : 'Sign In'}
        </button>
        {error && <span className="text-red-400 text-sm">{error}</span>}
      </form>
    );
  }

  // Google sign-in button for regular browsers
  return (
    <button
      onClick={signInWithGoogle}
      className="flex items-center gap-2 px-4 py-2 bg-white text-gray-800 rounded-md hover:bg-gray-100 transition-colors font-medium"
    >
      <svg className="h-5 w-5" viewBox="0 0 24 24">
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        />
      </svg>
      Sign in with Google
    </button>
  );
}
