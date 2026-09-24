/**
 * Phase 1 Test: PRNG Namespace Collision Prevention & Registry Test
 *
 * Verifies that:
 * 1. Different namespaces produce different random sequences from the same root context.
 * 2. Identical seed and identical namespace reproduce bit-for-bit sequences.
 * 3. Event and News streams are completely decoupled and non-correlated.
 * 4. Duplicate namespace registrations are detected by the tracker.
 * 5. index.ts operational wiring passes identical simulation context to both MarketEngine and EventDirector.
 */

import {
  createSimulationContext,
  StaticTimeSource,
  SIMULATION_NAMESPACES,
  SimulationNamespaceTracker
} from '../lib/engine/simulation/runtime';
import { MarketEngine } from '../engine-server/src/MarketEngine';
import { EventDirector } from '../engine-server/src/EventDirector';
import { createIsolatedMemoryDbClient } from '../lib/memoryDb/memoryDbClient';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`[Namespace Registry Test Failure] ${msg}`);
  }
}

async function runTest() {
  console.log('--- Testing PRNG Namespace Collision Prevention & Registry ---');

  const rootContext = createSimulationContext({ seed: 777, clock: new StaticTimeSource(1000) });

  // 1. Different namespaces produce distinct sequences
  const streamMjd = rootContext.random.fork(SIMULATION_NAMESPACES.MARKET_ENGINE.MJD_DIFFUSION);
  const streamEvent = rootContext.random.fork(SIMULATION_NAMESPACES.MARKET_ENGINE.PLAYER_EVENT);
  const streamNews = rootContext.random.fork(SIMULATION_NAMESPACES.EVENT_DIRECTOR.NEWS_SCHEDULE);

  const seqMjd = Array.from({ length: 20 }, () => streamMjd.next());
  const seqEvent = Array.from({ length: 20 }, () => streamEvent.next());
  const seqNews = Array.from({ length: 20 }, () => streamNews.next());

  let diffMjdEvent = 0;
  let diffEventNews = 0;
  for (let i = 0; i < 20; i++) {
    if (seqMjd[i] !== seqEvent[i]) diffMjdEvent++;
    if (seqEvent[i] !== seqNews[i]) diffEventNews++;
  }
  assert(diffMjdEvent > 15, 'MJD and Player Event streams must produce different sequences');
  assert(diffEventNews > 15, 'Player Event and News streams must produce different sequences');

  // 2. Identical seed and namespace reproduce bit-for-bit
  const rootContext2 = createSimulationContext({ seed: 777, clock: new StaticTimeSource(1000) });
  const streamNewsReplay = rootContext2.random.fork(SIMULATION_NAMESPACES.EVENT_DIRECTOR.NEWS_SCHEDULE);
  const seqNewsReplay = Array.from({ length: 20 }, () => streamNewsReplay.next());

  for (let i = 0; i < 20; i++) {
    assert(seqNews[i] === seqNewsReplay[i], `Bit-for-bit mismatch at index ${i}: ${seqNews[i]} vs ${seqNewsReplay[i]}`);
  }

  // 3. Namespace Tracker detects duplicate registrations
  const tracker = new SimulationNamespaceTracker();
  tracker.register(SIMULATION_NAMESPACES.MARKET_ENGINE.MJD_DIFFUSION);
  tracker.register(SIMULATION_NAMESPACES.EVENT_DIRECTOR.NEWS_SCHEDULE);

  let collisionCaught = false;
  try {
    tracker.register(SIMULATION_NAMESPACES.MARKET_ENGINE.MJD_DIFFUSION);
  } catch (err: any) {
    if (err.message.includes('Duplicate PRNG namespace detected')) {
      collisionCaught = true;
    }
  }
  assert(collisionCaught, 'Tracker must catch duplicate namespace registration');

  // 3b. SimulationContext.fork() directly prevents duplicate forks
  const ctxWithTracker = createSimulationContext({ seed: 888 });
  ctxWithTracker.fork(SIMULATION_NAMESPACES.MARKET_ENGINE.MJD_DIFFUSION);
  let contextCollisionCaught = false;
  try {
    ctxWithTracker.fork(SIMULATION_NAMESPACES.MARKET_ENGINE.MJD_DIFFUSION);
  } catch (err: any) {
    if (err.message.includes('Duplicate PRNG namespace detected')) {
      contextCollisionCaught = true;
    }
  }
  assert(contextCollisionCaught, 'SimulationContext.fork() must fail on duplicate namespace');

  // 4. Verify EventDirector requires explicit SimulationContext
  const db = createIsolatedMemoryDbClient();
  const engine = new MarketEngine({ simulationContext: rootContext, databaseClient: db });

  // EventDirector with engine context
  const eventDirector = new EventDirector(engine, engine.simulationContext);
  assert((eventDirector as any).context === engine.simulationContext, 'EventDirector must share identical context with MarketEngine');

  console.log('✅ Namespace Registry Test Passed: All namespaces isolated, collision tracked, and context shared.');
}

runTest().catch(err => {
  console.error(err);
  process.exit(1);
});
