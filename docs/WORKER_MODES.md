# Worker Modes

**Just want to run simulations?** Download the desktop worker for your platform from the [latest release](https://github.com/TytaniumDev/MagicBracketSimulator/releases/latest) and double-click. macOS builds are Developer-ID signed + notarized; Windows builds will trip SmartScreen the first time — click *More info → Run anyway*. The worker self-updates from then on.

The worker has two modes:
- **Cloud:** signs in with Google, picks up jobs from the shared Firestore queue. Results show on the [web leaderboard](https://magic-bracket-simulator.web.app).
- **Offline:** picks 4 bundled Commander precons, runs the bracket locally, keeps results on your machine.
