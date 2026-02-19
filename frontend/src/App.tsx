import { Routes, Route, Link } from 'react-router-dom';
import Browse from './pages/Browse';
import Home from './pages/Home';
import JobStatus from './pages/JobStatus';
import { LoginButton } from './components/LoginButton';
import { useAuth } from './contexts/AuthContext';

function Header() {
  const { user, isAllowed, loading } = useAuth();

  return (
    <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link to="/">
            <span className="text-xl font-bold bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent">
              Magic Bracket Simulator
            </span>
          </Link>
          <a
            href={`https://github.com/TytaniumDev/MagicBracketSimulator/commit/${__COMMIT_HASH__}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-500 hover:text-gray-300 font-mono transition-colors"
            title={__COMMIT_HASH__}
          >
            {__COMMIT_HASH__.slice(0, 7)}
          </a>
        </div>

        <div className="flex items-center gap-3">
          {!loading && user && isAllowed && (
            <Link
              to="/submit"
              className="text-sm text-blue-400 hover:text-blue-300 font-medium transition-colors"
            >
              New Simulation
            </Link>
          )}
          {!loading && user && isAllowed === false && (
            <Link
              to="/submit"
              className="px-3 py-1 text-sm bg-amber-600/80 text-amber-100 rounded-full hover:bg-amber-600 font-medium transition-colors"
            >
              Request Access
            </Link>
          )}
          <LoginButton />
        </div>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 antialiased">
      <Header />

      {/* Main content */}
      <main className="container mx-auto px-4 py-8">
        <Routes>
          <Route path="/" element={<Browse />} />
          <Route path="/submit" element={<Home />} />
          <Route path="/jobs/:id" element={<JobStatus />} />
        </Routes>
      </main>
    </div>
  );
}
