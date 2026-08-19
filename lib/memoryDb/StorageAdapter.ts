import * as fs from 'fs';
import * as path from 'path';

export interface IStorageAdapter {
  saveSnapshot(data: string): Promise<boolean>;
  loadSnapshot(): Promise<string | null>;
  appendLog(filename: string, logLine: string): Promise<void>;
}

/**
 * 로컬 파일 기반 스냅샷 & 로그 스토리지 어댑터
 */
export class FileStorageAdapter implements IStorageAdapter {
  private baseDir: string;
  private snapshotPath: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || path.resolve(process.cwd(), '.data');
    this.snapshotPath = path.join(this.baseDir, 'snapshot.json');
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    try {
      if (!fs.existsSync(this.baseDir)) {
        fs.mkdirSync(this.baseDir, { recursive: true });
      }
    } catch (err) {
      console.error('[FileStorageAdapter] Directory creation error:', err);
    }
  }

  public async saveSnapshot(data: string): Promise<boolean> {
    try {
      this.ensureDirectory();
      const tempPath = `${this.snapshotPath}.tmp`;
      await fs.promises.writeFile(tempPath, data, 'utf-8');
      await fs.promises.rename(tempPath, this.snapshotPath);
      return true;
    } catch (err) {
      console.error('[FileStorageAdapter] Save snapshot error:', err);
      return false;
    }
  }

  public async loadSnapshot(): Promise<string | null> {
    try {
      if (!fs.existsSync(this.snapshotPath)) {
        return null;
      }
      return await fs.promises.readFile(this.snapshotPath, 'utf-8');
    } catch (err) {
      console.error('[FileStorageAdapter] Load snapshot error:', err);
      return null;
    }
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
