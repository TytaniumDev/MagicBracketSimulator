# Product Requirement Document: Forge Simulation Engine

## 1. Overview
The **Forge Simulation Engine** is a headless, dockerized service responsible for simulating games of Magic: The Gathering. It uses the "Forge" rules engine in CLI mode (`sim`) to play 4 decks against each other and output detailed game logs.

## 2. Goals
-   **Reliable Headless Execution**: Must run in a Linux Docker container without a GUI (X11).
-   **Standardized Input**: Accept deck lists in `.dck` format via file volume or API.
-   **Log Output**: Save detailed game logs to a accessible volume for analysis.
-   **Performance**: Minimize boot time and resource usage per game.

## 3. Specifications

### 3.1 Docker Container (`docker-forge-sim`)
-   **Base Image**: `openjdk:17-slim` (or similar lightweight JRE).
-   **Forge Version**: Latest stable or beta with developed CLI support.
-   **Baked-in Assets**:
    -   `/app/res/precons`: A directory containing ~50+ Precon Decklists (.dck) to serve as benchmarks.
-   **Volumes**:
    -   `/app/decks`: Input directory for user decks.
    -   `/app/logs`: Output directory for game logs.

### 3.2 Command Line Interface
The container entrypoint script must accept standard flags to orchestrate the simulation.
**Script**: `run_sim.sh` (Entrypoint)
**Arguments**:
-   `--decks <d1> <d2> <d3> <d4>`: Four deck filenames in `/app/decks`.
-   `--simulations <n>`: Number of games to run (default: 5).
-   `--id <job_id>`: a unique ID to prefix output logs (e.g. `job_123_game_1.log`).

**Example Usage**:
```bash
./run_sim.sh --decks deck_0.dck deck_1.dck deck_2.dck deck_3.dck --simulations 5 --id job_abc
```

### 3.3 Data Contracts
**Input Deck Format (.dck)**:
Standard Forge/MTGO format.
```text
[metadata]
Name=MyDeck
[Main]
1 Sol Ring
99 Mountain
[Commander]
1 Ashling the Pilgrim
```

**Output Log Format**:
-   Must capture "Game Over" state.
-   Must capture per-turn actions.
-   Filename convention: `{job_id}_game_{n}.txt` placed in `/app/logs`.

## 4. Work Plan
1.  **Containerize**: Create `Dockerfile` that downloads Forge and copies in local `precons/` directory.
2.  **Wrapper Script**: Write `entrypoint.sh` (Bash or Python) to parse the defined CLI args and construct the java command.
3.  **Headless Test**: Verify `sim` runs with the new wrapper script inside Docker.
4.  **Optimization**: Strip unnecessary assets (images, sounds) from the Forge build to reduce image size.
