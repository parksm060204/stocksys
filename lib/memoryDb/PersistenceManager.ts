import { IStorageAdapter, FileStorageAdapter } from './StorageAdapter';
import type { MemoryDatabase } from './memoryStore';

export class PersistenceManager {
  private adapter: IStorageAdapter;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private isSaving: boolean = false;

  constructor(adapter?: IStorageAdapter) {
    this.adapter = adapter || new FileStorageAdapter();
  }

  /**
   * 스냅샷 직렬화 및 저장 (비동기, 스냅샷 시점 복사본 분리)
   */
  public async saveSnapshot(db: MemoryDatabase): Promise<boolean> {
    if (this.isSaving) return false;
    this.isSaving = true;

    try {
      // 스냅샷 시점의 데이터 복사본 추출 (구조적 얕은 클론)
      const snapshot = db.exportSnapshot();
      const serialized = JSON.stringify(snapshot, null, 2);
      const success = await this.adapter.saveSnapshot(serialized);
      return success;
    } catch (err) {
      console.error('[PersistenceManager] Save snapshot failed:', err);
      return false;
    } finally {
      this.isSaving = false;
    }
  }

  /**
   * 스냅샷 복원
   */
  public async loadSnapshot(db: MemoryDatabase): Promise<boolean> {
    try {
      const raw = await this.adapter.loadSnapshot();
      if (!raw) {
        return false;
      }
      const data = JSON.parse(raw);
      db.importSnapshot(data);
      console.log('📦 [PersistenceManager] 인메모리 데이터베이스 스냅샷 복원 완료');
      return true;
    } catch (err) {
      console.error('[PersistenceManager] Restore snapshot failed:', err);
      return false;
    }
  }

  /**
   * 주기적 자동 저장 시작 (기본 30초)
   */
  public startAutoSave(db: MemoryDatabase, intervalMs: number = 30000): void {
    this.stopAutoSave();
    this.autoSaveTimer = setInterval(() => {
      this.saveSnapshot(db).catch((err) => {
        console.error('[PersistenceManager] Auto-save error:', err);
      });
    }, intervalMs);
  }

  public stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }
}

export const persistenceManager = new PersistenceManager();
