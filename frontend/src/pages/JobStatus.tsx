import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getApiBase } from '../api';

type JobStatusValue = 'QUEUED' | 'RUNNING' | 'ANALYZING' | 'COMPLETED' | 'FAILED';

interface AnalysisResult {
  bracket: number;
  confidence: string;
  reasoning: string;
  weaknesses?: string;
}

interface Job {
  id: string;
  deckName: string;
  status: JobStatusValue;
  simulations: number;
  opponents: string[];
  createdAt: string;
  errorMessage?: string;
  resultJson?: AnalysisResult;
}

export default function JobStatusPage() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const apiBase = getApiBase();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    const fetchJob = () => {
      fetch(`${apiBase}/api/jobs/${id}`, { signal: controller.signal })
        .then((res) => {
          if (!res.ok) {
            if (res.status === 404) throw new Error('Job not found');
            throw new Error('Failed to load job');
          }
          return res.json();
        })
        .then((data) => {
          setJob(data);
          if (data.status === 'COMPLETED' || data.status === 'FAILED') {
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
          }
        })
        .catch((err) => {
          if (err.name !== 'AbortError') setError(err.message);
        });
    };
    fetchJob();
    intervalRef.current = setInterval(fetchJob, 2000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      controller.abort();
    };
  }, [id, apiBase]);

  if (error) {
    return (
      <div className="max-w-2xl mx-auto text-center">
        <p className="text-red-400 mb-4">{error}</p>
        <Link to="/" className="text-blue-400 hover:underline">
          Back to home
        </Link>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="max-w-2xl mx-auto text-center text-gray-400">
        Loading job...
      </div>
    );
  }

  const statusLabel =
    job.status === 'QUEUED'
      ? 'Queued'
      : job.status === 'RUNNING'
        ? 'Running'
        : job.status === 'ANALYZING'
          ? 'Analyzing results...'
          : job.status === 'COMPLETED'
            ? 'Completed'
            : 'Failed';

  const result = job.resultJson;

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Job: {job.deckName || job.id}</h1>
      <p className="text-gray-400 text-sm mb-6">ID: {job.id}</p>

      <div className="bg-gray-800 rounded-lg p-6 space-y-4">
        <div>
          <span className="text-gray-400">Status: </span>
          <span
            className={
              job.status === 'COMPLETED'
                ? 'text-green-400'
                : job.status === 'FAILED'
                  ? 'text-red-400'
                  : 'text-yellow-400'
            }
          >
            {statusLabel}
          </span>
        </div>
        <div>
          <span className="text-gray-400">Simulations: </span>
          <span>{job.simulations}</span>
        </div>
        {job.opponents?.length > 0 && (
          <div>
            <span className="text-gray-400">Opponents: </span>
            <span>{job.opponents.join(', ')}</span>
          </div>
        )}
        {job.status === 'FAILED' && job.errorMessage && (
          <div className="bg-red-900/30 border border-red-600 rounded p-3 text-red-200">
            {job.errorMessage}
          </div>
        )}
        {job.status === 'COMPLETED' && result != null && (
          <div className="space-y-4">
            <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
              <h2 className="text-lg font-semibold text-gray-200 mb-2">Result</h2>
              <div className="text-2xl font-bold text-green-400 mb-1">
                Bracket {result.bracket}
              </div>
              {result.confidence && (
                <p className="text-sm text-gray-300 mb-2">
                  <span className="text-gray-400">Confidence: </span>
                  {result.confidence}
                </p>
              )}
            </div>
            {result.reasoning && (
              <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
                <h3 className="text-sm font-semibold text-gray-400 mb-2">Reasoning</h3>
                <p className="text-gray-300 text-sm whitespace-pre-wrap">
                  {result.reasoning}
                </p>
              </div>
            )}
            {result.weaknesses && (
              <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
                <h3 className="text-sm font-semibold text-gray-400 mb-2">Weaknesses</h3>
                <p className="text-gray-300 text-sm whitespace-pre-wrap">
                  {result.weaknesses}
                </p>
              </div>
            )}
            <div>
              <button
                type="button"
                onClick={() => setShowRawJson((v) => !v)}
                className="text-sm text-gray-500 hover:text-gray-400"
              >
                {showRawJson ? 'Hide' : 'Show'} raw JSON
              </button>
              {showRawJson && (
                <pre className="mt-2 text-xs overflow-auto max-h-64 p-3 bg-gray-900 rounded whitespace-pre-wrap text-gray-400">
                  {JSON.stringify(result, null, 2)}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="mt-6">
        <Link to="/" className="text-blue-400 hover:underline">
          Submit another deck
        </Link>
      </div>
    </div>
  );
}
