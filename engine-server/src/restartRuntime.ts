import { createSimulationContext, SimulationContext } from '../../lib/engine/simulation/runtime';
import { MemoryDatabase } from '../../lib/memoryDb/memoryStore';
import { PersistenceManager } from '../../lib/memoryDb/PersistenceManager';

export interface PreparedEngineRestartRuntime {
  readonly epoch: number;
  readonly seed: number;
  readonly runId: string;
  readonly initialTickCount: number;
  readonly initialPartialFillSequence: number;
  readonly context: SimulationContext;
  readonly restoredFromSnapshot: boolean;
}

/**
 * 별도 engine-server 기동 시 스냅샷을 복원하고,
 * 이전 실행의 주문/체결 ID와 절대 충돌하지 않도록 영속 에포크를 증가·저장한 뒤
 * 실행 문맥과 카운터 초기값을 구성한다.
 */
export async function prepareEngineRestartRuntime(
  memoryDb: MemoryDatabase,
  persistence: PersistenceManager,
  options?: { seed?: number; runId?: string }
): Promise<PreparedEngineRestartRuntime> {
  const restoredFromSnapshot = await persistence.loadSnapshot(memoryDb);

  const epoch = memoryDb.engineNextEpoch;
  memoryDb.engineNextEpoch = epoch + 1;

  const envSeed = process.env.ENGINE_SIMULATION_SEED
    ? parseInt(process.env.ENGINE_SIMULATION_SEED, 10)
    : undefined;
  const seed =
    options?.seed !== undefined
      ? options.seed
      : envSeed !== undefined && !Number.isNaN(envSeed)
      ? envSeed
      : 42;

  const runId =
    options?.runId ||
    process.env.ENGINE_SIMULATION_RUN_ID ||
    `run_seed_${seed}_e${epoch}`;

  const initialTickCount = memoryDb.engineTickCount;
  const initialPartialFillSequence = memoryDb.enginePartialFillSequence;

  // 크래시 후 재시작하더라도 동일 에포크가 재사용되지 않도록 기동 전 새 에포크를 즉시 저장한다.
  const epochSaved = await persistence.saveSnapshot(memoryDb);
  if (!epochSaved) {
    throw new Error('엔진 재시작 에포크 영속 저장에 실패하여 안전 기동을 중단합니다.');
  }

  const context = createSimulationContext({ seed, runId });

  return {
    epoch,
    seed,
    runId,
    initialTickCount,
    initialPartialFillSequence,
    context,
    restoredFromSnapshot,
  };
}
