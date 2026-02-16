export interface WorkerInfo {
  workerId: string;
  workerName: string;
  status: 'idle' | 'busy';
  currentJobId?: string;
  capacity: number;
  activeSimulations: number;
  uptimeMs: number;
  lastHeartbeat: string;
  version?: string;
}
