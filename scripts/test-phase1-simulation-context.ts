/**
 * Test Suite: Phase 1-A Simulation Context & Deterministic Random Source
 *
 * Verifies:
 * 1. 100-step random sequences match bit-for-bit with identical seed
 * 2. Different seeds produce distinct sequences
 * 3. Forked streams ('retail' vs 'pension') are independent
 * 4. Additional consumption in one namespace has 0 influence on other namespaces
 * 5. Snapshot calls do not mutate PRNG state
 */

import assert from 'assert';
import {
  createSimulationContext,
  DefaultSimulationRandomSource
} from '../lib/engine/simulation/runtime';

function testIdenticalSeedSequence() {
  const ctx1 = createSimulationContext({ seed: 12345 });
  const ctx2 = createSimulationContext({ seed: 12345 });

  const seq1: number[] = [];
  const seq2: number[] = [];

  for (let i = 0; i < 100; i++) {
    seq1.push(ctx1.random.next());
    seq2.push(ctx2.random.next());
  }

  assert.deepStrictEqual(seq1, seq2, 'Identical seed must yield 100% identical 100-step sequence');
}

function testDifferentSeedSequence() {
  const ctx1 = createSimulationContext({ seed: 12345 });
  const ctx2 = createSimulationContext({ seed: 54321 });

  const seq1: number[] = [];
  const seq2: number[] = [];

  for (let i = 0; i < 100; i++) {
    seq1.push(ctx1.random.next());
    seq2.push(ctx2.random.next());
  }

  assert.notDeepStrictEqual(seq1, seq2, 'Different seeds must produce different sequences');
}

function testForkIndependence() {
  const root = new DefaultSimulationRandomSource(999, 'root');
  const retailStream = root.fork('retail');
  const pensionStream = root.fork('pension');

  const retailSeq: number[] = [];
  const pensionSeq: number[] = [];

  for (let i = 0; i < 50; i++) {
    retailSeq.push(retailStream.next());
    pensionSeq.push(pensionStream.next());
  }

  assert.notDeepStrictEqual(retailSeq, pensionSeq, 'Distinct namespaces must produce distinct streams');
}

function testNamespaceCrossPollutionIsolation() {
  // Scenario A: Fork retail, fork pension, then sample pension
  const rootA = new DefaultSimulationRandomSource(777, 'root');
  const _retailA = rootA.fork('retail');
  const pensionA = rootA.fork('pension');

  // Scenario B: Fork retail, CONSUME 1,000 numbers from retail, then sample pension
  const rootB = new DefaultSimulationRandomSource(777, 'root');
  const retailB = rootB.fork('retail');
  for (let i = 0; i < 1000; i++) {
    retailB.next();
    retailB.nextInt(1, 100);
    retailB.normal(0, 1);
  }
  const pensionB = rootB.fork('pension');

  const seqA: number[] = [];
  const seqB: number[] = [];

  for (let i = 0; i < 100; i++) {
    seqA.push(pensionA.next());
    seqB.push(pensionB.next());
  }

  assert.deepStrictEqual(
    seqA,
    seqB,
    'Consuming random numbers in retail must NOT pollute or alter pension stream sequence'
  );
}

function testSnapshotNonDestructive() {
  const stream = new DefaultSimulationRandomSource(8888, 'test');
  
  // Burn 10 numbers
  for (let i = 0; i < 10; i++) {
    stream.next();
  }

  const snap1 = stream.snapshot();
  const snap2 = stream.snapshot();
  assert.deepStrictEqual(snap1, snap2, 'Successive snapshots must be identical');

  // Next value should match whether snapshot was taken or not
  const streamClone = new DefaultSimulationRandomSource(8888, 'test');
  for (let i = 0; i < 10; i++) {
    streamClone.next();
  }
  // Snapshot on stream, but not on clone
  stream.snapshot();

  assert.strictEqual(
    stream.next(),
    streamClone.next(),
    'Taking a snapshot must NOT advance or mutate the PRNG state'
  );
}

function runAll() {
  console.log('Running testIdenticalSeedSequence...');
  testIdenticalSeedSequence();
  console.log('Running testDifferentSeedSequence...');
  testDifferentSeedSequence();
  console.log('Running testForkIndependence...');
  testForkIndependence();
  console.log('Running testNamespaceCrossPollutionIsolation...');
  testNamespaceCrossPollutionIsolation();
  console.log('Running testSnapshotNonDestructive...');
  testSnapshotNonDestructive();
  console.log('✅ All Phase 1 Simulation Context tests passed!');
}

runAll();
