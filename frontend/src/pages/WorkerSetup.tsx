const RELEASES_URL = 'https://github.com/TytaniumDev/MagicBracketSimulator/releases/latest';

const DOWNLOADS = [
  {
    platform: 'macOS',
    href: `${RELEASES_URL}/download/MagicBracketWorker-macos.zip`,
    note: 'Signed and notarized. Unzip and move the app to Applications.',
  },
  {
    platform: 'Windows',
    href: `${RELEASES_URL}/download/MagicBracketWorker-Installer.exe`,
    note: 'SmartScreen may warn the first time: choose More info, then Run anyway.',
  },
];

export default function WorkerSetup() {
  return (
    <div className="max-w-3xl mx-auto py-8">
      <h1 className="text-2xl font-bold mb-2">Worker Setup</h1>
      <p className="text-gray-400 mb-8">
        Run simulations on your own computer with the desktop worker. It installs Forge
        itself and updates automatically.
      </p>

      <div className="space-y-6">
        <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-5">
          <h2 className="text-lg font-semibold text-gray-100 mb-3">1. Download the app</h2>
          <ul className="space-y-3">
            {DOWNLOADS.map(({ platform, href, note }) => (
              <li key={platform} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                <a
                  href={href}
                  className="inline-block w-fit px-4 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg transition-colors"
                >
                  Download for {platform}
                </a>
                <span className="text-sm text-gray-400">{note}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-500 mt-3">
            All builds are on the{' '}
            <a href={RELEASES_URL} className="text-blue-400 hover:text-blue-300">
              latest release
            </a>
            .
          </p>
        </div>

        <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-5">
          <h2 className="text-lg font-semibold text-gray-100 mb-3">2. Sign in</h2>
          <p className="text-sm text-gray-300">
            Open the app and sign in with the same Google account you use here. Once your
            account has access, the worker picks up queued simulations and shows up as
            online on the home page.
          </p>
        </div>
      </div>
    </div>
  );
}
