import { SimulationClock, secondsToMs } from '../lib/engine/simulation/simClock';
import {
  getVisibleMarketEvents,
  sanitizePublicNewsRecord,
  validateMarketEvent,
  MarketEvent,
} from '../lib/engine/simulation/marketEventTypes';
import { SerialExecutionQueue } from '../lib/engine/simulation/executionQueue';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const start = 1_773_500_000_000;
  const clock = new SimulationClock(start, 1);
  const event: MarketEvent = {
    eventId: 'time-test-event',
    publishedAt: start,
    effectiveFrom: start,
    scope: 'market',
    targetStockIds: [],
    eventType: 'RUMOR',
    valuationSignal: 0.2,
    attentionShock: 0.4,
    uncertaintyShock: 0.3,
    confidence: 0.5,
    halfLife: 30,
    isRumorFake: true,
    publisher: 'test',
    title: 'test',
    content: 'test',
  };

  assert(!validateMarketEvent(event), 'A valid event should pass validation');
  assert(getVisibleMarketEvents([event], start + 1_999, 2).length === 0, '2s latency must hide T+1999ms');
  const visible = getVisibleMarketEvents([event], start + secondsToMs(2), 2);
  assert(visible.length === 1, '2s latency must reveal T+2000ms');
  assert(visible[0].isRumorFake === undefined, 'Internal rumor truth must be redacted');

  const publicNews = sanitizePublicNewsRecord({ id: 'n1', is_fake: true, isRumorFake: true, correctedAt: start, title: 'public' });
  assert(!('is_fake' in publicNews) && !('isRumorFake' in publicNews) && !('correctedAt' in publicNews), 'Public news must not contain simulation truth');

  const queue = new SerialExecutionQueue();
  const order: number[] = [];
  await Promise.all([
    queue.run(async () => { await Promise.resolve(); order.push(1); }),
    queue.run(async () => { order.push(2); }),
    queue.run(async () => { order.push(3); }),
  ]);
  assert(order.join(',') === '1,2,3', 'Concurrent simulation mutations must run in submission order');

  await queue.run(async () => { throw new Error('expected test failure'); }).catch(() => undefined);
  await queue.run(async () => { order.push(4); });
  assert(order.join(',') === '1,2,3,4', 'A failed simulation task must not poison the queue');

  console.log('PASS: canonical time boundaries, news redaction, and serial execution queue');
}

main().catch((error) => {
  console.error('FAIL:', error);
  process.exitCode = 1;
});
