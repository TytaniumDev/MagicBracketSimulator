import { Routes, Route, Link } from 'react-router-dom';
import Home from './pages/Home';
import JobStatus from './pages/JobStatus';
import { LoginButton } from './components/LoginButton';
import { useAuth } from './contexts/AuthContext';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin h-8 w-8 border-4 border-purple-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-6">
        <h2 className="text-2xl font-bold text-gray-300">Sign in to continue</h2>
        <p className="text-gray-400 text-center max-w-md">
          You need to sign in with your Google account to use Magic Bracket Simulator.
        </p>
        <LoginButton />
      </div>
    );
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 antialiased">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span className="text-xl font-bold bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent">
              Magic Bracket Simulator
            </span>
          </Link>
          <LoginButton />
        </div>
      </header>

      {/* Main content */}
      <main className="container mx-auto px-4 py-8">
        <Routes>
          <Route path="/" element={
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          } />
          <Route path="/jobs/:id" element={
            <ProtectedRoute>
              <JobStatus />
            </ProtectedRoute>
          } />
        </Routes>
      </main>
    </div>
  );
}
