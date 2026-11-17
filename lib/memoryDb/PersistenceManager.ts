import { AsyncLocalStorage } from 'node:async_hooks';
import { IStorageAdapter, FileStorageAdapter } from './StorageAdapter';
import type { MemoryDatabase } from './memoryStore';

export class PersistenceManager {
  private adapter: IStorageAdapter;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private saveTail: Promise<boolean> = Promise.resolve(true);
  private commitTail: Promise<void> = Promise.resolve();
  private commitStorage = new AsyncLocalStorage<symbol>();
  private activeCommitToken: symbol | null = null;

  constructor(adapter?: IStorageAdapter) {
    this.adapter = adapter || new FileStorageAdapter();
  }

  public acquireWriterLock(): void {
    this.adapter.acquireWriterLock?.();
  }

  public releaseWriterLock(): void {
    this.adapter.releaseWriterLock?.();
  }

  /**
   * 인메모리 커밋(상태 변경 + 스냅샷 직렬화 추출 + 영속 저장 + 실패 시 롤백)을
   * 원자적으로 직렬화한다. 동일 async 흐름 내에서는 재진입을 허용한다.
   */
  public async withCommitGate<T>(fn: () => T | Promise<T>): Promise<T> {
    const currentToken = this.commitStorage.getStore();
    if (currentToken && currentToken === this.activeCommitToken) {
      return await fn();
    }

    let release!: () => void;
    const prev = this.commitTail;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.commitTail = prev.then(() => next, () => next);
    await prev;
    const token = Symbol('commitGate');
    this.activeCommitToken = token;
    try {
      return await this.commitStorage.run(token, fn);
    } finally {
      this.activeCommitToken = null;
      release();
    }
  }

  /**
   * 이미 직렬화된 스냅샷 문자열을 디스크에 단일 writer 큐로 영속 저장한다.
   */
  public enqueueSerializedSave(serialized: string): Promise<boolean> {
    const runSave = async (): Promise<boolean> => {
      try {
        this.adapter.acquireWriterLock?.();
        return await this.adapter.saveSnapshot(serialized);
      } catch (err) {
        console.error('[PersistenceManager] Save snapshot failed:', err);
        return false;
      }
    };

    const next = this.saveTail.then(runSave, runSave);
    this.saveTail = next.catch(() => false);
    return next;
  }

  /**
   * 커밋 게이트 하에서 일관된 스냅샷을 추출한 뒤 단일 writer 큐로 저장이 완료될 때까지
   * 커밋 게이트를 유지하여, 다른 트랜잭션의 미확정 상태가 섞이거나 스냅샷 추출과 저장 사이에
   * 경합이 발생하지 않도록 보장한다.
   */
  public async saveSnapshot(db: MemoryDatabase): Promise<boolean> {
    return this.withCommitGate(async () => {
      let serialized: string;
      try {
        const snapshot = db.exportSnapshot();
        serialized = JSON.stringify(snapshot, null, 2);
      } catch (err) {
        console.error('[PersistenceManager] Export/serialize snapshot failed:', err);
        return false;
      }
      return await this.enqueueSerializedSave(serialized);
    });
  }

  /**
   * 특정 db에 바인딩된 영속 저장 콜백 생성 (해당 PersistenceManager의 commitGate에 자동 참여).
   */
  public createPersistHandler(db: MemoryDatabase): () => Promise<boolean> {
    const handler = () => this.saveSnapshot(db);
    (handler as any).__persistenceManager = this;
    return handler;
  }

  /**
   * 스냅샷 복원
   * - 파일이 없으면 false 반환 (신규 DB 초기화)
   * - 파일이 존재하나 손상되었거나 스키마가 유효하지 않으면 예외를 throw하여 조용한 초기화를 방지
   */
  public async loadSnapshot(db: MemoryDatabase): Promise<boolean> {
    this.adapter.acquireWriterLock?.();
    const raw = await this.adapter.loadSnapshot();
    if (raw === null) {
      return false;
    }
    if (!raw.trim()) {
      throw new Error('스냅샷 파일이 비어 있거나 손상되었습니다.');
    }
    const data = JSON.parse(raw);
    db.importSnapshot(data);
    console.log('📦 [PersistenceManager] 인메모리 데이터베이스 스냅샷 복원 완료');
    return true;
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

/**
 * onPersist 콜백이 존재하면 해당 PersistenceManager(또는 기본 싱글톤)의 commitGate 안에서
 * 상태 변경 -> 영속 저장 -> 실패 시 롤백 전체를 원자적으로 실행한다.
 */
export async function runWithCommitGate<T>(
  onPersist: (() => Promise<boolean>) | undefined,
  fn: () => Promise<T>,
  explicitPm?: PersistenceManager
): Promise<T> {
  const pm =
    explicitPm ||
    (onPersist ? ((onPersist as any).__persistenceManager as PersistenceManager | undefined) : undefined) ||
    (onPersist ? persistenceManager : undefined);
  if (!pm) {
    return await fn();
  }
  return await pm.withCommitGate(fn);
}
