import * as fs from 'fs';
import * as path from 'path';

export interface IStorageAdapter {
  saveSnapshot(data: string): Promise<boolean>;
  loadSnapshot(): Promise<string | null>;
  appendLog(filename: string, logLine: string): Promise<void>;
  acquireWriterLock?(): void;
  releaseWriterLock?(): void;
}

export class StorageWriterLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageWriterLockError';
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // EPERM means process exists but owned by another user
    return err?.code === 'EPERM';
  }
}

/**
 * 로컬 파일 기반 스냅샷 & 로그 스토리지 어댑터
 */
export class FileStorageAdapter implements IStorageAdapter {
  private baseDir: string;
  private snapshotPath: string;
  private lockPath: string;
  private ownsLock: boolean = false;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || process.env.STOCKSYS_DATA_DIR || path.resolve(process.cwd(), '.data');
    this.snapshotPath = path.join(this.baseDir, 'snapshot.json');
    this.lockPath = `${this.snapshotPath}.lock`;
    this.ensureDirectory();
  }

  public getSnapshotPath(): string {
    return this.snapshotPath;
  }

  public getBaseDir(): string {
    return this.baseDir;
  }

  public acquireWriterLock(): void {
    if (this.ownsLock) return;
    this.ensureDirectory();

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = fs.openSync(
          this.lockPath,
          fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR
        );
        const payload = JSON.stringify({ pid: process.pid, acquiredAt: Date.now() });
        fs.writeSync(fd, payload, 0, 'utf-8');
        fs.closeSync(fd);
        this.ownsLock = true;
        return;
      } catch (err: any) {
        if (err?.code !== 'EEXIST') {
          throw new StorageWriterLockError(`저장소 락 파일 생성 실패 (${this.lockPath}): ${err?.message || err}`);
        }
        // 기존 락 소유 프로세스 생존 여부 확인
        let existingPid = 0;
        try {
          const raw = fs.readFileSync(this.lockPath, 'utf-8');
          const parsed = JSON.parse(raw);
          existingPid = Number(parsed?.pid || 0);
        } catch {
          existingPid = 0;
        }

        if (existingPid === process.pid) {
          this.ownsLock = true;
          return;
        }

        if (existingPid > 0 && isProcessAlive(existingPid)) {
          throw new StorageWriterLockError(
            `동일 저장소(${this.baseDir})를 다른 프로세스(PID ${existingPid})가 이미 점유 중입니다.`
          );
        }

        // 죽은 프로세스의 stale 락 제거 후 재시도
        try {
          fs.unlinkSync(this.lockPath);
        } catch {
          // ignore race
        }
      }
    }

    throw new StorageWriterLockError(`저장소 락 획득 실패: ${this.lockPath}`);
  }

  public releaseWriterLock(): void {
    if (!this.ownsLock) return;
    this.ownsLock = false;
    try {
      if (fs.existsSync(this.lockPath)) {
        const raw = fs.readFileSync(this.lockPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Number(parsed?.pid) === process.pid) {
          fs.unlinkSync(this.lockPath);
        }
      }
    } catch {
      // ignore cleanup errors
    }
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  public async saveSnapshot(data: string): Promise<boolean> {
    const tempPath = `${this.snapshotPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    let handle: fs.promises.FileHandle | null = null;
    try {
      this.ensureDirectory();
      handle = await fs.promises.open(tempPath, 'w');
      await handle.writeFile(data, 'utf-8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.promises.rename(tempPath, this.snapshotPath);
      return true;
    } catch (err) {
      console.error('[FileStorageAdapter] Save snapshot error:', err);
      if (handle) {
        await handle.close().catch(() => {});
      }
      await fs.promises.unlink(tempPath).catch(() => {});
      return false;
    }
  }

  public async loadSnapshot(): Promise<string | null> {
    if (!fs.existsSync(this.snapshotPath)) {
      return null;
    }
    return await fs.promises.readFile(this.snapshotPath, 'utf-8');
  }

  public async appendLog(filename: string, logLine: string): Promise<void> {
    try {
      this.ensureDirectory();
      const filePath = path.join(this.baseDir, filename);
      await fs.promises.appendFile(filePath, `${logLine}\n`, 'utf-8');
    } catch (err) {
      console.error(`[FileStorageAdapter] Append log error for ${filename}:`, err);
    }
  }
}

/**
 * 인메모리 테스트용 스토리지 어댑터
 */
export class MemoryOnlyStorageAdapter implements IStorageAdapter {
  private savedSnapshot: string | null = null;
  public logs: Map<string, string[]> = new Map();

  public async saveSnapshot(data: string): Promise<boolean> {
    this.savedSnapshot = data;
    return true;
  }

  public async loadSnapshot(): Promise<string | null> {
    return this.savedSnapshot;
  }

  public async appendLog(filename: string, logLine: string): Promise<void> {
    if (!this.logs.has(filename)) {
      this.logs.set(filename, []);
    }
    this.logs.get(filename)!.push(logLine);
  }
}
