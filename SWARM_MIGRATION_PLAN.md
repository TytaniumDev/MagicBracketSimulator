# Docker Swarm Migration Plan
## Magic Bracket Simulator - Distributed Simulation Architecture

**Date:** 2026-02-16
**Goal:** Migrate from single-machine Docker container orchestration to Docker Swarm for distributed simulation processing across multiple machines

---

## Table of Contents
1. [Current Architecture](#current-architecture)
2. [Target Architecture](#target-architecture)
3. [Network Setup Decision](#network-setup-decision)
4. [Implementation Phases](#implementation-phases)
5. [Detailed Implementation Steps](#detailed-implementation-steps)
6. [Testing Strategy](#testing-strategy)
7. [Rollback Plan](#rollback-plan)
8. [Monitoring & Debugging](#monitoring--debugging)

---

## Current Architecture

### How It Works Now (Single Machine)

**Worker Service** (`worker/`):
- Runs as Docker container
- Mounts Docker socket (`/var/run/docker.sock`)
- Orchestrates simulation containers via direct `docker run` commands
- Uses semaphore-based concurrency control
- Spawns simulation containers with `--rm` flag
- Collects logs from `/tmp/forge_sim_*` volumes
- Reports results to API

**Simulation Container** (`simulation/`):
- Standalone Docker image (~750MB)
- Runs exactly 1 game via `run_sim.sh`
- Writes log to `/app/logs/game_<timestamp>.log`
- Exits immediately after game completes

**Key Code:**
- `worker/src/worker.ts` - `processJobWithContainers()` function
- `worker/src/docker-helper.ts` - Container lifecycle management
- Uses `dockerode` npm package for Docker API calls

**Limitations:**
- ❌ All simulations run on one machine
- ❌ Limited by single machine's CPU/RAM
- ❌ No horizontal scaling
- ❌ Single point of failure

---

## Target Architecture

### Docker Swarm Distributed Model

**Manager Node:**
- Runs worker container
- Schedules simulation tasks across swarm
- Collects results from distributed nodes
- Manages swarm state

**Worker Nodes (1-N machines):**
- Join swarm as workers
- Pull simulation image
- Execute assigned simulation tasks
- Return results to manager

**Key Changes:**
1. Replace `docker run` with **Swarm service creation**
2. Use **one-off tasks** (replicated mode, restart: none)
3. Distribute simulations across available nodes
4. Pre-pull images on all nodes
5. Handle result collection from distributed volumes/logs

**Benefits:**
- ✅ Horizontal scaling (add more machines)
- ✅ Automatic load balancing
- ✅ Built-in health checks and retry
- ✅ Resource constraints per task
- ✅ Centralized orchestration

---

## Network Setup Decision

### Decision Point: Choose Network Architecture

#### Option A: Same Local Network (LAN)
**Use if:** All machines are in same office/home network

**Setup:**
```bash
# Manager machine (e.g., 192.168.1.10)
docker swarm init --advertise-addr 192.168.1.10

# Worker machines
docker swarm join --token SWMTKN-... 192.168.1.10:2377
```

**Pros:**
- ✅ Zero configuration
- ✅ Low latency
- ✅ No extra software
- ✅ Most secure (private network)

**Cons:**
- ❌ Requires physical proximity
- ❌ Limited to one location

---

#### Option B: Different Networks with VPN (Tailscale)
**Use if:** Machines are in different locations (home, office, cloud, etc.)

**Setup:**
```bash
# On ALL machines:
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# Check Tailscale IP
tailscale ip -4
# Output: 100.64.0.1 (manager), 100.64.0.2 (worker), etc.

# Manager machine
docker swarm init --advertise-addr 100.64.0.1

# Worker machines
docker swarm join --token SWMTKN-... 100.64.0.1:2377
```

**Pros:**
- ✅ Works across any network
- ✅ No port forwarding needed
- ✅ Encrypted automatically
- ✅ NAT traversal built-in
- ✅ Free for personal use (up to 100 devices)
- ✅ Persistent IPs even if public IP changes

**Cons:**
- Slight latency overhead (usually <50ms)
- Requires Tailscale client

**Recommendation:** Use Tailscale for maximum flexibility. Even if all machines are local now, it allows adding remote machines later with zero reconfiguration.

---

## Implementation Phases

### Phase 1: Setup & Preparation ⏱️ 1-2 hours
- Choose network architecture (LAN vs Tailscale)
- Initialize Docker Swarm
- Pre-pull simulation image on all nodes
- Verify swarm connectivity

### Phase 2: Code Changes ⏱️ 3-4 hours
- Create Swarm service orchestration module
- Replace direct Docker calls with Swarm API
- Handle distributed log collection
- Update configuration for Swarm mode

### Phase 3: Testing ⏱️ 2-3 hours
- Test single simulation on swarm
- Test concurrent simulations across nodes
- Verify result collection
- Test failure scenarios

### Phase 4: Documentation & Deployment ⏱️ 1 hour
- Update README and docs
- Create swarm setup scripts
- Deploy to production

**Total Estimated Time:** 7-10 hours

---

## Detailed Implementation Steps

### Step 1: Network & Swarm Initialization

#### 1.1 Choose Network Setup

**If Using LAN (Same Network):**
```bash
# On manager machine:
# Find your local IP
ip addr show | grep "inet 192.168"

# Initialize swarm with your local IP
docker swarm init --advertise-addr 192.168.1.10

# Output will show join token for workers:
# docker swarm join --token SWMTKN-1-xxx... 192.168.1.10:2377
```

**If Using Tailscale (Different Networks):**
```bash
# On ALL machines (manager + workers):
# Install Tailscale
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# On each machine, verify Tailscale IP
tailscale ip -4
# Manager: 100.64.0.1
# Worker 1: 100.64.0.2
# Worker 2: 100.64.0.3

# On manager machine:
docker swarm init --advertise-addr 100.64.0.1

# On worker machines:
docker swarm join --token SWMTKN-1-xxx... 100.64.0.1:2377
```

#### 1.2 Verify Swarm Status

```bash
# On manager:
docker node ls

# Expected output:
# ID             HOSTNAME   STATUS    AVAILABILITY   MANAGER STATUS
# abc123 *       manager    Ready     Active         Leader
# def456         worker1    Ready     Active
# ghi789         worker2    Ready     Active
```

#### 1.3 Pre-pull Simulation Image on All Nodes

```bash
# On manager, create a service to pull image on all nodes:
docker service create \
  --name image-puller \
  --mode global \
  --restart-condition none \
  magic-bracket-simulation:latest \
  echo "Image pulled"

# Wait for completion
docker service ps image-puller

# Clean up
docker service rm image-puller
```

**Or manually on each node:**
```bash
# SSH to each worker node
docker pull magic-bracket-simulation:latest
```

---

### Step 2: Code Changes

#### 2.1 Create Swarm Orchestrator Module

**New file:** `worker/src/swarm-orchestrator.ts`

```typescript
import Docker from 'dockerode';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

export interface SwarmSimulationConfig {
  jobId: string;
  simulationId: string;
  deck1: string;
  deck2: string;
  logPath: string;
  apiUrl: string;
  apiKey: string;
}

export class SwarmOrchestrator {
  /**
   * Create a one-off Swarm task for a single simulation
   * Returns service ID for tracking
   */
  async createSimulationTask(config: SwarmSimulationConfig): Promise<string> {
    const serviceName = `sim-${config.jobId}-${config.simulationId}`;

    const serviceSpec = {
      Name: serviceName,
      TaskTemplate: {
        ContainerSpec: {
          Image: 'magic-bracket-simulation:latest',
          Args: [config.deck1, config.deck2],
          Env: [
            `API_URL=${config.apiUrl}`,
            `API_KEY=${config.apiKey}`,
            `JOB_ID=${config.jobId}`,
            `SIMULATION_ID=${config.simulationId}`
          ],
          Mounts: [
            {
              Type: 'bind',
              Source: config.logPath,
              Target: '/app/logs'
            }
          ]
        },
        RestartPolicy: {
          Condition: 'none' // One-off task, don't restart
        },
        Resources: {
          Limits: {
            NanoCPUs: 1000000000, // 1 CPU
            MemoryBytes: 2 * 1024 * 1024 * 1024 // 2 GB
          }
        }
      },
      Mode: {
        Replicated: {
          Replicas: 1
        }
      }
    };

    const service = await docker.createService(serviceSpec);
    return service.id;
  }

  /**
   * Wait for a simulation task to complete
   * Returns exit code and log path
   */
  async waitForSimulation(serviceId: string): Promise<{
    exitCode: number;
    logPath: string;
  }> {
    const service = docker.getService(serviceId);

    // Poll task status
    while (true) {
      const tasks = await service.tasks();

      if (tasks.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      const task = tasks[0];
      const state = task.Status.State;

      if (state === 'complete') {
        await service.remove();
        return {
          exitCode: task.Status.ContainerStatus.ExitCode,
          logPath: task.Spec.ContainerSpec.Mounts[0].Source
        };
      }

      if (state === 'failed' || state === 'rejected') {
        const exitCode = task.Status.ContainerStatus?.ExitCode || 1;
        await service.remove();
        return { exitCode, logPath: '' };
      }

      // Still running, wait and check again
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  /**
   * Get active simulation count across the swarm
   */
  async getActiveSimulationCount(): Promise<number> {
    const services = await docker.listServices({
      filters: { name: ['sim-'] }
    });
    return services.length;
  }

  /**
   * Get swarm node count and resources
   */
  async getSwarmCapacity(): Promise<{
    nodeCount: number;
    totalCPUs: number;
    totalMemoryGB: number;
  }> {
    const nodes = await docker.listNodes();

    let totalCPUs = 0;
    let totalMemoryBytes = 0;

    for (const node of nodes) {
      if (node.Status.State === 'ready') {
        totalCPUs += node.Description.Resources.NanoCPUs / 1e9;
        totalMemoryBytes += node.Description.Resources.MemoryBytes;
      }
    }

    return {
      nodeCount: nodes.filter(n => n.Status.State === 'ready').length,
      totalCPUs: Math.floor(totalCPUs),
      totalMemoryGB: Math.floor(totalMemoryBytes / (1024 ** 3))
    };
  }
}
```

#### 2.2 Update Worker to Use Swarm

**Modify:** `worker/src/worker.ts`

```typescript
import { SwarmOrchestrator } from './swarm-orchestrator';

const USE_SWARM = process.env.USE_SWARM === 'true';
const swarmOrchestrator = USE_SWARM ? new SwarmOrchestrator() : null;

async function processJobWithContainers(job: Job) {
  // ... existing code ...

  // Replace dynamic parallelism calculation
  let maxParallelSims: number;

  if (USE_SWARM && swarmOrchestrator) {
    const capacity = await swarmOrchestrator.getSwarmCapacity();
    console.log(`Swarm capacity: ${capacity.nodeCount} nodes, ${capacity.totalCPUs} CPUs, ${capacity.totalMemoryGB}GB RAM`);

    // 1 CPU per sim, leave 1 CPU per node for overhead
    maxParallelSims = Math.max(1, capacity.totalCPUs - capacity.nodeCount);
  } else {
    // Existing single-machine calculation
    maxParallelSims = calculateDynamicParallelism();
  }

  console.log(`Max parallel simulations: ${maxParallelSims}`);

  // ... existing semaphore setup ...

  // Replace container execution logic
  const runSimulation = async (i: number) => {
    const simulationId = `sim-${i + 1}`;

    try {
      if (USE_SWARM && swarmOrchestrator) {
        // Swarm mode
        const serviceId = await swarmOrchestrator.createSimulationTask({
          jobId: job.id,
          simulationId,
          deck1: deckPaths.deck1,
          deck2: deckPaths.deck2,
          logPath: `/tmp/forge_sim_${job.id}_${simulationId}`,
          apiUrl: process.env.API_URL!,
          apiKey: process.env.API_KEY!
        });

        const result = await swarmOrchestrator.waitForSimulation(serviceId);

        if (result.exitCode === 0) {
          await processSimulationLogs(result.logPath, job.id, simulationId);
        } else {
          await updateSimulationStatus(job.id, simulationId, 'FAILED');
        }
      } else {
        // Existing container mode (unchanged)
        await runSimulationContainer(/* ... */);
      }
    } catch (error) {
      console.error(`Simulation ${simulationId} failed:`, error);
      await updateSimulationStatus(job.id, simulationId, 'FAILED');
    }
  };

  // ... rest of function unchanged ...
}
```

#### 2.3 Update Docker Compose for Swarm Mode

**Modify:** `worker/docker-compose.yml`

Add environment variable for Swarm mode:

```yaml
services:
  worker:
    # ... existing config ...
    environment:
      # ... existing env vars ...
      USE_SWARM: "true"  # Set to "false" for single-machine mode
```

#### 2.4 Handle Distributed Log Collection

**Challenge:** Logs are written on different nodes, need to be collected centrally.

**Solution Options:**

**Option A: Shared Volume (NFS)**
- Mount NFS volume on all nodes
- All simulations write to shared `/tmp/forge_logs`
- Worker reads from shared volume

**Option B: Log Shipping to Manager**
- Each simulation POSTs logs to API when complete
- Update `simulation/run_sim.sh` to upload logs
- Worker polls API for log completion

**Option C: Docker Volume Plugin (Recommended)**
- Use local volumes
- After task completes, read logs from task's node via Docker API

**Recommended: Option C (Use Docker Task Logs)**

Update simulation to log to stdout:
```bash
# In simulation/run_sim.sh
# Instead of writing to file, stream to stdout
forge-simulator ... | tee /app/logs/game.log
```

Update worker to read from Docker service logs:
```typescript
async waitForSimulation(serviceId: string) {
  const service = docker.getService(serviceId);
  const tasks = await service.tasks();
  const task = tasks[0];

  // Get task logs via Docker API
  const taskLogs = await docker.getTask(task.ID).logs({
    stdout: true,
    stderr: true
  });

  // Process logs...
}
```

---

### Step 3: Configuration Updates

#### 3.1 Environment Variables

**worker/.env** (add):
```bash
USE_SWARM=true
SWARM_MANAGER_IP=100.64.0.1  # Or 192.168.1.10 for LAN
```

#### 3.2 Update docs/MODE_SETUP.md

Add section on Swarm setup:
```markdown
## Docker Swarm Mode (Optional)

For distributed simulations across multiple machines:

1. **Network Setup:**
   - LAN: Use private IPs (192.168.x.x)
   - WAN: Install Tailscale on all nodes

2. **Initialize Swarm:**
   ```bash
   # Manager:
   docker swarm init --advertise-addr <manager-ip>

   # Workers:
   docker swarm join --token <token> <manager-ip>:2377
   ```

3. **Set Environment:**
   ```bash
   USE_SWARM=true
   ```

4. **Deploy Worker:**
   ```bash
   docker compose up worker
   ```
```

---

### Step 4: Testing Strategy

#### Test 1: Single Simulation on Swarm
```bash
# Trigger 1-game job via API
curl -X POST http://localhost:3000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "deck1": "precon:Cavalry Charge",
    "deck2": "precon:Draconic Domination",
    "numSimulations": 1
  }'

# Verify:
# - Service created on manager
# - Task scheduled to a node
# - Logs collected
# - Results posted to API
# - Service cleaned up
```

#### Test 2: Concurrent Simulations
```bash
# Trigger 10-game job
# Verify:
# - Multiple services created
# - Tasks distributed across nodes
# - All logs collected
# - Results aggregated correctly
```

#### Test 3: Node Failure Handling
```bash
# While simulations running:
docker node update --availability drain <worker-node-id>

# Verify:
# - Running tasks complete
# - New tasks scheduled to other nodes
# - Job completes successfully
```

#### Test 4: Cross-Node Load Balancing
```bash
# Trigger large job (50+ simulations)
# Monitor task distribution:
watch 'docker service ls && docker node ps $(docker node ls -q)'

# Verify:
# - Tasks evenly distributed
# - No single node overloaded
# - All nodes contribute
```

---

## Rollback Plan

### If Swarm Migration Fails:

1. **Disable Swarm Mode:**
   ```bash
   # In worker/.env
   USE_SWARM=false
   ```

2. **Restart Worker:**
   ```bash
   docker compose restart worker
   ```

3. **Leave Swarm (if needed):**
   ```bash
   # On workers:
   docker swarm leave

   # On manager:
   docker swarm leave --force
   ```

4. **Revert Code:**
   - Worker falls back to existing container orchestration
   - No data loss (jobs in API/Firestore unaffected)

---

## Monitoring & Debugging

### Useful Commands

**Check swarm status:**
```bash
docker node ls
docker service ls
docker service ps <service-name>
```

**Monitor task distribution:**
```bash
# See tasks on each node
docker node ps $(docker node ls -q)
```

**View service logs:**
```bash
docker service logs <service-name>
```

**Check node resource usage:**
```bash
docker node inspect <node-id> --format '{{.Description.Resources}}'
```

**Debug failed tasks:**
```bash
docker service ps --no-trunc <service-name>
```

### Logging Strategy

Update worker to log:
- When services are created (with target node info)
- Task state transitions (pending → running → complete)
- Distribution statistics (tasks per node)
- Swarm capacity changes (nodes joining/leaving)

---

## Success Criteria

✅ **Phase 1 Complete When:**
- Swarm initialized with 2+ nodes
- All nodes show "Ready" status
- Simulation image present on all nodes

✅ **Phase 2 Complete When:**
- Worker can create Swarm services
- Worker can wait for task completion
- Worker can collect logs from distributed tasks
- Code supports both Swarm and legacy modes

✅ **Phase 3 Complete When:**
- Single simulation completes successfully
- Concurrent simulations distribute across nodes
- All simulation logs collected and processed
- Job results accurate (all simulations counted)
- Failed simulations handled gracefully

✅ **Phase 4 Complete When:**
- Documentation updated
- Setup scripts created
- Production deployment successful
- Team can add new nodes without code changes

---

## Future Enhancements

### Post-Migration Improvements:

1. **Auto-scaling:**
   - Detect high queue depth
   - Trigger cloud VM provisioning
   - Auto-join new nodes to swarm
   - Scale down when idle

2. **Priority Scheduling:**
   - Use placement constraints for priority jobs
   - Reserve faster nodes for urgent simulations

3. **Heterogeneous Nodes:**
   - Tag nodes by capability (CPU, GPU, memory)
   - Schedule tasks to appropriate nodes

4. **Geographic Distribution:**
   - Run simulations on nodes worldwide
   - Aggregate results from global swarm

5. **Monitoring Dashboard:**
   - Real-time swarm health
   - Per-node task history
   - Resource utilization graphs

---

## Questions to Answer During Implementation

1. **Log Collection:** Which method for distributed logs?
   - [ ] Shared NFS volume
   - [ ] Log shipping to API
   - [ ] Docker task logs (recommended)

2. **Image Distribution:** How to ensure image on all nodes?
   - [ ] Manual pre-pull
   - [ ] Global service pre-puller (recommended)
   - [ ] Registry with image pull policy

3. **Failure Handling:** Retry strategy for failed tasks?
   - [ ] Swarm auto-retry (restart policy)
   - [ ] Worker-level retry (current behavior)

4. **Resource Limits:** CPU/memory per simulation?
   - [ ] 1 CPU, 2GB RAM (current)
   - [ ] Configurable via env vars
   - [ ] Dynamic based on node capacity

5. **Network Mode:** Final decision?
   - [ ] LAN (simple, local only)
   - [ ] Tailscale (flexible, recommended)

---

## References

- Docker Swarm Docs: https://docs.docker.com/engine/swarm/
- Swarm Service API: https://docs.docker.com/engine/api/v1.41/#tag/Service
- Tailscale Setup: https://tailscale.com/kb/1017/install/
- Dockerode (Node.js Docker API): https://github.com/apocas/dockerode

---

## Contact & Questions

If blocked or unsure during implementation:
1. Test in single-machine mode first (USE_SWARM=false)
2. Verify swarm basics work (docker service create hello-world)
3. Check swarm logs (docker service logs <service>)
4. Verify network connectivity between nodes (ping, curl)

**Good luck with the migration! 🚀**
