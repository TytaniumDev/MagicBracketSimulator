import { Routes, Route, Link } from 'react-router-dom';
import Browse from './pages/Browse';
import Home from './pages/Home';
import JobStatus from './pages/JobStatus';
import WorkerSetup from './pages/WorkerSetup';
import Leaderboard from './pages/Leaderboard';
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
          <Link
            to="/leaderboard"
            className="text-sm text-gray-400 hover:text-gray-300 font-medium transition-colors"
          >
            Rankings
          </Link>
          {!loading && user && isAllowed && (
            <>
              <Link
                to="/submit"
                className="text-sm text-blue-400 hover:text-blue-300 font-medium transition-colors"
              >
                New Simulation
              </Link>
              <Link
                to="/worker-setup"
                className="text-sm text-gray-400 hover:text-gray-300 font-medium transition-colors"
              >
                Worker Setup
              </Link>
            </>
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
  const { user, loading } = useAuth();

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 antialiased">
      {loading ? (
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin h-8 w-8 border-4 border-purple-500 border-t-transparent rounded-full" />
        </div>
      ) : !user ? (
        <div className="flex flex-col items-center justify-center min-h-screen gap-6 px-4">
          <span className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent">
            Magic Bracket Simulator
          </span>
          <p className="text-gray-400 text-center max-w-md">
            Evaluate Magic: The Gathering Commander deck performance through automated Forge simulations, tracking win rates and game statistics.
          </p>
          <LoginButton />
        </div>
      ) : (
        <>
          <Header />
          <main className="container mx-auto px-4 py-8">
            <Routes>
              <Route path="/" element={<Browse />} />
              <Route path="/submit" element={<Home />} />
              <Route path="/jobs/:id" element={<JobStatus />} />
              <Route path="/worker-setup" element={<WorkerSetup />} />
              <Route path="/leaderboard" element={<Leaderboard />} />
            </Routes>
          </main>
        </>
      )}
    </div>
  );
}
