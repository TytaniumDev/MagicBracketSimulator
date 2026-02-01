import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import JobStatus from './pages/JobStatus';

export default function App() {
  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 antialiased">
      <main className="container mx-auto px-4 py-8">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/jobs/:id" element={<JobStatus />} />
        </Routes>
      </main>
    </div>
  );
}
