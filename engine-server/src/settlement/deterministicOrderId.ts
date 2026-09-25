/**
 * Deterministic Order ID Builder for STOCKSYS
 *
 * Requirements:
 * - Guarantees unique, deterministic order IDs across:
 *   - simulationRunId
 *   - tickSequence
 *   - stockId
 *   - participantId
 *   - side ('buy' | 'sell')
 *   - perTickOrderSequence
 *   - strategyId / parentOrderId (optional)
 * - Safe canonical encoding to prevent delimiter collisions
 * - Independence from in-memory order book array length
 */

export interface DeterministicOrderIdParams {
  readonly simulationRunId: string;
  readonly tickSequence: number;
  readonly stockId: string;
  readonly participantId: string;
  readonly side: 'buy' | 'sell';
  readonly perTickOrderSequence: number;
  readonly strategyId?: string | undefined;
  readonly parentOrderId?: string | undefined;
}

function sanitizeIdentifier(value: string): string {
  // Strip characters that could conflict with delimiter '_'
  return encodeURIComponent(value).replace(/_/g, '%5F');
}

/**
 * Builds a deterministic, collision-proof order identifier.
 */
export function buildDeterministicOrderId(params: DeterministicOrderIdParams): string {
  const {
    simulationRunId,
    tickSequence,
    stockId,
    participantId,
    side,
    perTickOrderSequence,
    strategyId,
    parentOrderId,
  } = params;

  if (!simulationRunId) {
    throw new RangeError('[buildDeterministicOrderId] simulationRunId must be a non-empty string');
  }
  if (!stockId) {
    throw new RangeError('[buildDeterministicOrderId] stockId must be a non-empty string');
  }
  if (!participantId) {
    throw new RangeError('[buildDeterministicOrderId] participantId must be a non-empty string');
  }
  if (typeof tickSequence !== 'number' || !Number.isInteger(tickSequence) || tickSequence < 0) {
    throw new RangeError(`[buildDeterministicOrderId] tickSequence must be non-negative integer: ${tickSequence}`);
  }
  if (typeof perTickOrderSequence !== 'number' || !Number.isInteger(perTickOrderSequence) || perTickOrderSequence < 0) {
    throw new RangeError(`[buildDeterministicOrderId] perTickOrderSequence must be non-negative integer: ${perTickOrderSequence}`);
  }
  if (side !== 'buy' && side !== 'sell') {
    throw new RangeError(`[buildDeterministicOrderId] side must be 'buy' or 'sell': ${side}`);
  }

  const sRun = sanitizeIdentifier(simulationRunId);
  const sStock = sanitizeIdentifier(stockId);
  const sPart = sanitizeIdentifier(participantId);
  const sideAbbr = side === 'buy' ? 'b' : 's';

  let id = `ord_${sRun}_t${tickSequence}_stk${sStock}_p${sPart}_${sideAbbr}_seq${perTickOrderSequence}`;
  if (strategyId) {
    id += `_strat${sanitizeIdentifier(strategyId)}`;
  }
  if (parentOrderId) {
    id += `_par${sanitizeIdentifier(parentOrderId)}`;
  }
  return id;
}
