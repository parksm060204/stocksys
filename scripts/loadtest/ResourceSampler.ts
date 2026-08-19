import * as os from 'os';

export interface ResourceMetrics {
  timestamp: number;
  cpuUsagePercent: number;
  // Node.js 프로세스 메모리
  nodeHeapUsedMb: number;
  nodeHeapTotalMb: number;
  nodeRssMb: number;
  // OS 전체 물리 메모리
  osFreememMb: number;
  osTotalmemMb: number;
  osUsedmemMb: number;
  osMemoryUsagePercent: number;
  // 네트워크 지연 & TPS
  latencyMs: number;
  currentTps: number;
}

export class ResourceSampler {
  private samples: ResourceMetrics[] = [];
  private timer: NodeJS.Timeout | null = null;
  private prevCpuTimes: { user: number; nice: number; sys: number; idle: number; irq: number } | null = null;
  private lastRequestCount: number = 0;
  public totalRequests: number = 0;
  public latencies: number[] = [];

  constructor() {
    this.prevCpuTimes = this.getCpuTimes();
  }

  private getCpuTimes() {
    const cpus = os.cpus();
    let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;
    for (const cpu of cpus) {
      user += cpu.times.user;
      nice += cpu.times.nice;
      sys += cpu.times.sys;
      idle += cpu.times.idle;
      irq += cpu.times.irq;
    }
    return { user, nice, sys, idle, irq };
  }

  private calculateCpuPercent(): number {
    const current = this.getCpuTimes();
    if (!this.prevCpuTimes) {
      this.prevCpuTimes = current;
      return 0;
    }

    const prevTotal = this.prevCpuTimes.user + this.prevCpuTimes.nice + this.prevCpuTimes.sys + this.prevCpuTimes.idle + this.prevCpuTimes.irq;
    const currentTotal = current.user + current.nice + current.sys + current.idle + current.irq;
    const totalDelta = currentTotal - prevTotal;

    const prevIdle = this.prevCpuTimes.idle;
    const currentIdle = current.idle;
    const idleDelta = currentIdle - prevIdle;

    this.prevCpuTimes = current;
    if (totalDelta <= 0) return 0;

    const usedPercent = Math.max(0, Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100));
    return parseFloat(usedPercent.toFixed(1));
  }

  public recordLatency(ms: number): void {
    this.latencies.push(ms);
    this.totalRequests++;
  }

  public start(intervalMs: number = 500): void {
    this.stop();
    this.timer = setInterval(() => {
      const totalMem = Math.round(os.totalmem() / (1024 * 1024));
      const freeMem = Math.round(os.freemem() / (1024 * 1024));
      const usedMem = totalMem - freeMem;
      const memPercent = parseFloat(((usedMem / totalMem) * 100).toFixed(1));

      // Node.js 프로세스 메모리 정밀 측정
      const memUsage = process.memoryUsage();
      const heapUsedMb = parseFloat((memUsage.heapUsed / (1024 * 1024)).toFixed(2));
      const heapTotalMb = parseFloat((memUsage.heapTotal / (1024 * 1024)).toFixed(2));
      const rssMb = parseFloat((memUsage.rss / (1024 * 1024)).toFixed(2));

      const cpuPercent = this.calculateCpuPercent();
      const deltaRequests = this.totalRequests - this.lastRequestCount;
      this.lastRequestCount = this.totalRequests;
      const tps = parseFloat(((deltaRequests / (intervalMs / 1000))).toFixed(1));

      const recentLatencies = this.latencies.slice(-20);
      const avgLatency = recentLatencies.length > 0
        ? parseFloat((recentLatencies.reduce((a, b) => a + b, 0) / recentLatencies.length).toFixed(2))
        : 0;

      this.samples.push({
        timestamp: Date.now(),
        cpuUsagePercent: cpuPercent,
        nodeHeapUsedMb: heapUsedMb,
        nodeHeapTotalMb: heapTotalMb,
        nodeRssMb: rssMb,
        osFreememMb: freeMem,
        osTotalmemMb: totalMem,
        osUsedmemMb: usedMem,
        osMemoryUsagePercent: memPercent,
        latencyMs: avgLatency,
        currentTps: tps,
      });
    }, intervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public getSummary() {
    if (this.samples.length === 0) {
      return {
        avgCpu: 0,
        peakCpu: 0,
        avgHeapUsedMb: 0,
        peakHeapUsedMb: 0,
        avgRssMb: 0,
        peakRssMb: 0,
        avgOsMemPercent: 0,
        peakOsMemPercent: 0,
        avgLatencyMs: 0,
        p95LatencyMs: 0,
        maxLatencyMs: 0,
        peakTps: 0,
        sampleCount: 0,
      };
    }

    const cpus = this.samples.map((s) => s.cpuUsagePercent);
    const heaps = this.samples.map((s) => s.nodeHeapUsedMb);
    const rsses = this.samples.map((s) => s.nodeRssMb);
    const osMems = this.samples.map((s) => s.osMemoryUsagePercent);
    const tpsList = this.samples.map((s) => s.currentTps);

    const sortedLatencies = [...this.latencies].sort((a, b) => a - b);
    const avgLatency = this.latencies.length > 0
      ? this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length
      : 0;
    const p95Idx = Math.floor(sortedLatencies.length * 0.95);
    const p95Latency = sortedLatencies[p95Idx] || 0;
    const maxLatency = sortedLatencies[sortedLatencies.length - 1] || 0;

    return {
      avgCpu: parseFloat((cpus.reduce((a, b) => a + b, 0) / cpus.length).toFixed(1)),
      peakCpu: Math.max(...cpus),
      avgHeapUsedMb: parseFloat((heaps.reduce((a, b) => a + b, 0) / heaps.length).toFixed(1)),
      peakHeapUsedMb: Math.max(...heaps),
      avgRssMb: parseFloat((rsses.reduce((a, b) => a + b, 0) / rsses.length).toFixed(1)),
      peakRssMb: Math.max(...rsses),
      avgOsMemPercent: parseFloat((osMems.reduce((a, b) => a + b, 0) / osMems.length).toFixed(1)),
      peakOsMemPercent: Math.max(...osMems),
      avgLatencyMs: parseFloat(avgLatency.toFixed(2)),
      p95LatencyMs: parseFloat(p95Latency.toFixed(2)),
      maxLatencyMs: parseFloat(maxLatency.toFixed(2)),
      peakTps: Math.max(...tpsList),
      sampleCount: this.samples.length,
    };
  }
}
