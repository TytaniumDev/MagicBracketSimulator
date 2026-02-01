export default function Home() {
  return (
    <div className="max-w-xl mx-auto mt-16 p-6 text-center text-gray-300">
      <h1 className="text-2xl font-bold mb-4">
        Magic Bracket Simulator API
      </h1>
      <p className="mb-6">
        This service provides the API and worker. Use the frontend app for the
        web UI.
      </p>
      <a
        href="http://localhost:5173"
        className="text-blue-400 hover:underline"
      >
        Open frontend (http://localhost:5173)
      </a>
    </div>
  );
}
