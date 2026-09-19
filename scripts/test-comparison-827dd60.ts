/**
 * scripts/test-comparison-827dd60.ts
 *
 * 827dd6079a11f58cdb2746668cbab7290752b8f4 원본 전략 소스와
 * 현재 수정 코드(lib/engine/simulation/strategies/trendStrategy.ts)의
 * 효과 OFF 환경 순수 전략 함수(evaluateTrendStrategy) 동등성 검증 스위트.
 *
 * [검증 범위 명시]
 * 본 테스트는 효과 OFF 환경에서 두 버전의 `evaluateTrendStrategy` 함수가
 * 동일한 MarketObservation, AgentAccount, TrendStrategyConfig 입력을 받았을 때
 * 경제적 의사결정(action, price, size, orderType)을 100% 동일하게 내리는지 검증하는
 * "전략 함수 단위 동등성 테스트"입니다.
 * 전체 거래 엔진 시뮬레이션(체결, 계좌 잔고, PRNG 난수열)의 동일성을 보증하는 것으로
 * 확대 보고하지 않습니다.
 */

import { execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { evaluateTrendStrategy as currentEvaluateTrendStrategy } from '../lib/engine/simulation/strategies/trendStrategy';
import { evaluateTrendStrategy as baselineEvaluateTrendStrategy } from './fixtures/baseline-827dd60-trendStrategy';
import { MarketObservation } from '../lib/engine/simulation/marketObservation';
import { AgentAccount, TrendStrategyConfig } from '../lib/engine/simulation/agentTypes';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`\n❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

// ─────────────────────────────────────────────────────────────────
// [1] 기준 코드 진본성 및 출처 해시 검증
// ─────────────────────────────────────────────────────────────────
const BASELINE_COMMIT = '827dd6079a11f58cdb2746668cbab7290752b8f4';
const BASELINE_PATH = 'lib/engine/simulation/strategies/trendStrategy.ts';
const EXPECTED_BLOB_HASH = '743aa3b7a66102bcb6d6bf0756b9d4b9becb21f4';
const EXPECTED_SHA256 = 'eb968afdb2f73ad4ed140ec02865c1a1c28424fa3dd12334760c76046da6d596';

function verifyBaselineAuthenticity(): void {
  console.log('================================================================');
  console.log('  [1] 827dd60 기준 전략 소스 진본성 및 콘텐츠 해시 검증');
  console.log('================================================================');

  let rawGitContent: string;
  let actualBlobHash: string;
  try {
    actualBlobHash = execSync(
      `git rev-parse ${BASELINE_COMMIT}:${BASELINE_PATH}`,
      { encoding: 'utf8' }
    ).trim();
    rawGitContent = execSync(
      `git show ${BASELINE_COMMIT}:${BASELINE_PATH}`,
      { encoding: 'utf8' }
    );
  } catch (err) {
    console.error(`❌ git show ${BASELINE_COMMIT}:${BASELINE_PATH} 실패:`, err);
    console.error('검증 미완료 사유: git 저장소에서 827dd60 원본 소스를 추출하지 못함.');
    process.exit(1);
  }

  assert(
    actualBlobHash === EXPECTED_BLOB_HASH,
    `Git Blob Hash 일치 (${actualBlobHash} === ${EXPECTED_BLOB_HASH})`
  );

  const actualSha256 = crypto.createHash('sha256').update(rawGitContent).digest('hex');
  assert(
    actualSha256 === EXPECTED_SHA256,
    `Content SHA-256 해시 일치 (${actualSha256} === ${EXPECTED_SHA256})`
  );

  // Fixture 파일이 원본 코드에서 import 경로 변환만 되었는지 검증
  const fixturePath = path.resolve(__dirname, 'fixtures/baseline-827dd60-trendStrategy.ts');
  assert(fs.existsSync(fixturePath), `Fixture 파일 실존 (${fixturePath})`);
  const fixtureContent = fs.readFileSync(fixturePath, 'utf8');

  // import 경로 치환 역변환 후 원본과 비교
  const normalizedFixture = fixtureContent
    .replace(/\/\*\*[\s\S]*?BASELINE FIXTURE[\s\S]*?\*\/\n\n/, '')
    .replace(/\.\.\/\.\.\/lib\/engine\/simulation\//g, '../');

  assert(
    normalizedFixture.trim() === rawGitContent.trim(),
    'Fixture 내용이 827dd60 원본 코드와 100% 바이트 단위 일치 (import 경로 변환 외 수정 없음)'
  );
  console.log('  -> 기준 코드 출처: 827dd6079a11f58cdb2746668cbab7290752b8f4');
  console.log('  -> 원본 파일 경로: lib/engine/simulation/strategies/trendStrategy.ts');
  console.log('  -> 진본성 확인 완료!\n');
}

// ─────────────────────────────────────────────────────────────────
// 테스트 보조 함수 및 비교 평가기
// ─────────────────────────────────────────────────────────────────
interface ComparisonResult {
  actionMatch: boolean;
  priceMatch: boolean;
  sizeMatch: boolean;
  orderTypeMatch: boolean;
  baseline: { action: string; price?: number; size?: number; orderType?: string; reason?: string };
  current: { action: string; price?: number; size?: number; orderType?: string; reason?: string };
  reasonDiff: boolean;
}

function compareStrategies(
  obs: MarketObservation,
  agent: AgentAccount,
  config: TrendStrategyConfig,
  label: string
): ComparisonResult {
  // 효과 OFF: effectParams 인자 없이 호출
  const bRes = baselineEvaluateTrendStrategy(obs, agent, config);
  const cRes = currentEvaluateTrendStrategy(obs, agent, config);

  const actionMatch = bRes.action === cRes.action;
  const priceMatch = (bRes.price || 0) === (cRes.price || 0);
  const sizeMatch = (bRes.size || 0) === (cRes.size || 0);
  const orderTypeMatch = (bRes.orderType || '') === (cRes.orderType || '');
  const reasonDiff = bRes.reason !== cRes.reason;

  if (!actionMatch || !priceMatch || !sizeMatch || !orderTypeMatch) {
    console.error(`\n❌ MISMATCH at [${label}]:`);
    console.error('  Baseline:', JSON.stringify(bRes));
    console.error('  Current: ', JSON.stringify(cRes));
    assert(false, `경제적 의사결정 불일치 발생 at ${label}`);
  }

  return {
    actionMatch,
    priceMatch,
    sizeMatch,
    orderTypeMatch,
    baseline: bRes,
    current: cRes,
    reasonDiff,
  };
}

const STOCK_ID = '00000000-0000-4000-8000-000000000101';

function makeBaseObs(overrides?: Partial<MarketObservation>): MarketObservation {
  return {
    stockId: STOCK_ID,
    ticker: '005930',
    midPrice: 10000,
    bestBid: 9900,
    bestAsk: 10100,
    spread: 200,
    hasTwoSidedBook: true,
    bidsDepth: [{ price: 9900, size: 5000 }],
    asksDepth: [{ price: 10100, size: 5000 }],
    lastTradePrice: 10000,
    lastTradeVolume: 1000,
    recentTrades: [
      { id: 't1', stock_id: STOCK_ID, price: 10000, size: 1000, buyer_id: 'b', seller_id: 's', buyer_is_bot: false, seller_is_bot: false, sequence: 1, created_at: '' }
    ],
    priceHistory: [9500, 9600, 9700, 9800, 10000],
    returns: [0.0526],
    volatility: 0.02,
    uncertaintyScore: 0.05,
    isWarmup: false,
    simulationTime: 1773500000000,
    account: {
      cash: 10000000,
      holdingQty: 0,
      avgPrice: 0,
      reservedCash: 0,
      reservedHolding: 0,
      availableCash: 10000000,
      availableHolding: 0,
      totalHoldingsValue: 0,
      nav: 10000000,
      isPortfolioValuationComplete: true,
    },
    activeOrders: [],
    ...overrides,
  };
}

function makeAgent(overrides?: Partial<AgentAccount>): AgentAccount {
  return {
    accountId: 'trend_agent_1',
    agentId: 'trend_agent_1',
    participantType: 'bot',
    strategyType: 'trend',
    name: 'Trend Follower',
    targetPositions: { [STOCK_ID]: 1000 },
    maxPosition: 5000,
    maxOrderSize: 1000,
    riskTolerance: 0.5,
    urgency: 0.3,
    activityRate: 1.0,
    nextDecisionTime: 0,
    stats: {
      ordersSubmitted: 0,
      ordersCancelled: 0,
      fillsCount: 0,
      volumeTraded: 0,
      feesPaid: 0,
      realizedPnl: 0,
    },
    ...overrides,
  };
}

const defaultConfig: TrendStrategyConfig = {
  trendWeight: 1.0,
  exposureWeight: 1.0,
  lookbackSteps: 4,
  minWarmupSteps: 5,
  trendScale: 0.05,
  buyThreshold: 0.35,
  sellThreshold: -0.35,
  participationRate: 1.0,
};

// ─────────────────────────────────────────────────────────────────
// [2] 기존 96개 다차원 입력 조합 검증
// ─────────────────────────────────────────────────────────────────
function runExisting96MatrixTests(): void {
  console.log('================================================================');
  console.log('  [2] 기존 96개 입력 조합 매트릭스 전수 비교');
  console.log('================================================================');

  const urgencies = [0.1, 0.3, 0.5, 0.8];
  const priceScenarios = [
    { name: 'Strong Rally (+11%)', hist: [9000, 9200, 9500, 9800, 10000] },
    { name: 'Moderate Rise (+4%)', hist: [9600, 9700, 9800, 9900, 10000] },
    { name: 'Flat / Neutral', hist: [10000, 10000, 10000, 10000, 10000] },
    { name: 'Moderate Drop (-4%)', hist: [10400, 10300, 10200, 10100, 10000] },
    { name: 'Strong Plunge (-11%)', hist: [11200, 11000, 10700, 10400, 10000] },
    { name: 'High Volatility Drop', hist: [9500, 10500, 9200, 10800, 9800] },
  ];

  const bookScenarios = [
    { name: 'Normal Spread', bestBid: 9900, bestAsk: 10100, hasTwoSidedBook: true },
    { name: 'No Best Ask', bestBid: 9900, bestAsk: null, hasTwoSidedBook: false },
    { name: 'No Best Bid', bestBid: null, bestAsk: 10100, hasTwoSidedBook: false },
    { name: 'Empty Book', bestBid: null, bestAsk: null, hasTwoSidedBook: false },
  ];

  let testCount = 0;
  let reasonDiffCount = 0;

  for (const urgency of urgencies) {
    for (const pScen of priceScenarios) {
      for (const bScen of bookScenarios) {
        testCount++;
        const obs = makeBaseObs({
          priceHistory: pScen.hist,
          midPrice: pScen.hist[pScen.hist.length - 1],
          bestBid: bScen.bestBid,
          bestAsk: bScen.bestAsk,
          hasTwoSidedBook: bScen.hasTwoSidedBook,
        });

        // 매도 테스트를 위해 하락 시나리오에서는 보유 주식과 holdingQty 설정
        const isDrop = pScen.name.includes('Drop') || pScen.name.includes('Plunge');
        if (isDrop) {
          obs.account.holdingQty = 2000;
          obs.account.availableHolding = 2000;
        }

        const agent = makeAgent({
          urgency,
        });

        const label = `Urgency=${urgency}, Price=${pScen.name}, Book=${bScen.name}`;
        const res = compareStrategies(obs, agent, defaultConfig, label);
        if (res.reasonDiff) {
          reasonDiffCount++;
        }
      }
    }
  }

  assert(testCount === 96, `96개 조합 검증 완료 (총 ${testCount}건)`);
  console.log(`  ✓ 96개 입력 조합 전수 일치! (경제적 행동 불일치: 0건, 진단 reason 차이: ${reasonDiffCount}건)\n`);
}

// ─────────────────────────────────────────────────────────────────
// [3] 경계값 보강 테스트 (Boundary Test Suites)
// ─────────────────────────────────────────────────────────────────
function runBoundaryTests(): void {
  console.log('================================================================');
  console.log('  [3] 경계값 집중 보강 테스트 (5대 정밀 경계)');
  console.log('================================================================');

  let boundaryCount = 0;

  // ── 경계 A: urgency 0.5 직전(0.499), 정확히 0.500, 직후(0.501)
  console.log('\n  [경계 A] Urgency 0.5 경계선 판정 (0.499 vs 0.500 vs 0.501)');
  const rallyHist = [9000, 9200, 9500, 9800, 10000]; // 강력 매수 신호
  const plungeHist = [11200, 11000, 10700, 10400, 10000]; // 강력 매도 신호

  for (const urg of [0.499, 0.500, 0.501]) {
    // 매수 시
    const buyObs = makeBaseObs({ priceHistory: rallyHist });
    const buyAgent = makeAgent({ urgency: urg });
    const bRes = compareStrategies(buyObs, buyAgent, defaultConfig, `Buy Urgency=${urg}`);
    boundaryCount++;

    if (urg < 0.5) {
      assert(bRes.current.orderType === 'limit', `urgency=${urg} (<0.5)는 지정가(limit) 주문`);
      assert(bRes.current.price === 9900, `urgency=${urg} (<0.5)는 bestBid(9,900원) 호가`);
    } else {
      assert(bRes.current.orderType === 'ioc', `urgency=${urg} (>=0.5)는 IOC 주문`);
      assert(bRes.current.price === 10100, `urgency=${urg} (>=0.5)는 bestAsk(10,100원) 호가`);
    }

    // 매도 시
    const sellObs = makeBaseObs({
      priceHistory: plungeHist,
      account: {
        cash: 10000000,
        holdingQty: 2000,
        avgPrice: 11000,
        reservedCash: 0,
        reservedHolding: 0,
        availableCash: 10000000,
        availableHolding: 2000,
        totalHoldingsValue: 20000000,
        nav: 30000000,
        isPortfolioValuationComplete: true,
      },
    });
    const sellAgent = makeAgent({ urgency: urg });
    const sRes = compareStrategies(sellObs, sellAgent, defaultConfig, `Sell Urgency=${urg}`);
    boundaryCount++;

    if (urg < 0.5) {
      assert(sRes.current.orderType === 'limit', `urgency=${urg} (<0.5) 매도는 지정가(limit) 주문`);
      assert(sRes.current.price === 10100, `urgency=${urg} (<0.5) 매도는 bestAsk(10,100원) 호가`);
    } else {
      assert(sRes.current.orderType === 'ioc', `urgency=${urg} (>=0.5) 매도는 IOC 주문`);
      assert(sRes.current.price === 9900, `urgency=${urg} (>=0.5) 매도는 bestBid(9,900원) 호가`);
    }
  }

  // ── 경계 B: bestBid/bestAsk 각각 부재 및 양쪽 부재
  console.log('\n  [경계 B] 호가창 비대칭/결손 경계');
  const bookEdges = [
    { name: 'bestBid=null, bestAsk=10100', bestBid: null, bestAsk: 10100 },
    { name: 'bestBid=9900, bestAsk=null', bestBid: 9900, bestAsk: null },
    { name: 'bestBid=null, bestAsk=null', bestBid: null, bestAsk: null },
  ];

  for (const bEdge of bookEdges) {
    for (const urg of [0.3, 0.8]) {
      const obs = makeBaseObs({
        priceHistory: rallyHist,
        bestBid: bEdge.bestBid,
        bestAsk: bEdge.bestAsk,
      });
      const agent = makeAgent({ urgency: urg });
      compareStrategies(obs, agent, defaultConfig, `BookEdge=${bEdge.name}, Urg=${urg}`);
      boundaryCount++;
    }
  }

  // ── 경계 C: 최소 히스토리 길이 직전(4) vs 충족 시점(5) (minWarmupSteps=5)
  console.log('\n  [경계 C] 최소 히스토리 웜업 경계 (len=4 vs len=5)');
  // 4개 데이터 포인트 (웜업 미달 -> hold)
  const shortHistObs = makeBaseObs({ priceHistory: [9600, 9700, 9800, 10000] });
  const shortAgent = makeAgent({ urgency: 0.8 });
  const shortRes = compareStrategies(shortHistObs, shortAgent, defaultConfig, 'History len=4');
  assert(shortRes.current.action === 'hold', 'len=4는 warmup_insufficient_history HOLD');
  assert(shortRes.current.reason === 'warmup_insufficient_history', '이유 코드 정확성 확인');
  boundaryCount++;

  // 5개 데이터 포인트 (웜업 충족 -> 정상 매수)
  const fullHistObs = makeBaseObs({ priceHistory: [9500, 9600, 9700, 9800, 10000] });
  const fullRes = compareStrategies(fullHistObs, shortAgent, defaultConfig, 'History len=5');
  assert(fullRes.current.action === 'buy', 'len=5는 웜업을 통과하여 정상 buy 진입');
  boundaryCount++;

  // ── 경계 D: 기존 주문, 부족한 현금·보유량
  console.log('\n  [경계 D] 기존 미체결 주문 및 자산 부족 경계');
  // D-1: 이미 동일 가격 매수 주문 존재 -> order_already_resting
  const restingBuyObs = makeBaseObs({
    priceHistory: rallyHist,
    activeOrders: [
      { id: 'o_rest', stock_id: STOCK_ID, user_id: 'trend_agent_1', side: 'buy', price: 9900, size: 500, filled: 0, status: 'open', is_lp: false, created_at: '' }
    ],
  });
  const restAgent = makeAgent({ urgency: 0.3 }); // limit 주문은 resting 중복 방지 작동
  const restRes = compareStrategies(restingBuyObs, restAgent, defaultConfig, 'Resting buy order duplicate');
  assert(restRes.current.action === 'hold', '동일 호가 주문 존재 시 중복 주문 방지 HOLD');
  boundaryCount++;

  // D-2: 현금 0원 -> insufficient_cash
  const zeroCashObs = makeBaseObs({
    priceHistory: rallyHist,
    account: {
      cash: 0,
      holdingQty: 0,
      avgPrice: 0,
      reservedCash: 0,
      reservedHolding: 0,
      availableCash: 0,
      availableHolding: 0,
      totalHoldingsValue: 0,
      nav: 0,
      isPortfolioValuationComplete: true,
    },
  });
  const zeroCashRes = compareStrategies(zeroCashObs, restAgent, defaultConfig, 'Zero cash');
  assert(zeroCashRes.current.action === 'hold', '현금 부족 시 insufficient_cash HOLD');
  boundaryCount++;

  // D-3: 보유량 0주에서 매도 신호 -> surplus <= 0 또는 insufficient_holding
  const zeroHoldObs = makeBaseObs({
    priceHistory: plungeHist,
    account: {
      cash: 10000000,
      holdingQty: 0,
      avgPrice: 0,
      reservedCash: 0,
      reservedHolding: 0,
      availableCash: 10000000,
      availableHolding: 0,
      totalHoldingsValue: 0,
      nav: 10000000,
      isPortfolioValuationComplete: true,
    },
  });
  const zeroHoldRes = compareStrategies(zeroHoldObs, restAgent, defaultConfig, 'Zero holding on drop');
  assert(zeroHoldRes.current.action === 'hold', '보유량 0주 하락 시 매도 미발생 HOLD');
  boundaryCount++;

  // ── 경계 E: 매수·매도 신호 임계값 주변 (buyThreshold=0.35, sellThreshold=-0.35)
  console.log('\n  [경계 E] 매수/매도 임계값 경계 (임계값 직전, 일치, 직후)');
  // 임계값 바로 아래 신호 생성: 약한 상승
  // rollingReturn = (current - past) / past
  // rawSignal = 0.70 * tanh(return / 0.05)
  // normTrend = tanh(rawSignal)
  // buyThreshold = 0.35 -> rawSignal ~ 0.365 -> return ~ 0.027
  const justBelowBuyHist = [9740, 9800, 9850, 9900, 10000]; // +2.67% -> normTrend ~ 0.345 < 0.35
  const justBelowObs = makeBaseObs({ priceHistory: justBelowBuyHist });
  const jbRes = compareStrategies(justBelowObs, restAgent, defaultConfig, 'Just below buy threshold');
  assert(jbRes.current.action === 'hold', '임계값 직전(0.345 < 0.35)은 trend_below_threshold HOLD');
  boundaryCount++;

  const justAboveBuyHist = [9700, 9780, 9850, 9920, 10000]; // +3.09% -> normTrend ~ 0.395 > 0.35
  const justAboveObs = makeBaseObs({ priceHistory: justAboveBuyHist });
  const jaRes = compareStrategies(justAboveObs, restAgent, defaultConfig, 'Just above buy threshold');
  assert(jaRes.current.action === 'buy', '임계값 직후(0.395 > 0.35)는 정상 BUY 발생');
  boundaryCount++;

  // 하락 임계값 경계
  const sellHoldAgent = makeAgent({ urgency: 0.3 });
  const justBelowSellHist = [10260, 10200, 10150, 10100, 10000]; // 약한 하락 -> normTrend > -0.35
  const jbsObs = makeBaseObs({
    priceHistory: justBelowSellHist,
    account: {
      cash: 10000000,
      holdingQty: 2000,
      avgPrice: 10500,
      reservedCash: 0,
      reservedHolding: 0,
      availableCash: 10000000,
      availableHolding: 2000,
      totalHoldingsValue: 20000000,
      nav: 30000000,
      isPortfolioValuationComplete: true,
    },
  });
  const jbsRes = compareStrategies(jbsObs, sellHoldAgent, defaultConfig, 'Just below sell threshold (abs)');
  assert(jbsRes.current.action === 'hold', '하락 임계값 미도달 시 trend_below_threshold HOLD');
  boundaryCount++;

  const justAboveSellHist = [10320, 10240, 10160, 10080, 10000]; // 강한 하락 -> normTrend < -0.35
  const jasObs = makeBaseObs({
    priceHistory: justAboveSellHist,
    account: {
      cash: 10000000,
      holdingQty: 2000,
      avgPrice: 10500,
      reservedCash: 0,
      reservedHolding: 0,
      availableCash: 10000000,
      availableHolding: 2000,
      totalHoldingsValue: 20000000,
      nav: 30000000,
      isPortfolioValuationComplete: true,
    },
  });
  const jasRes = compareStrategies(jasObs, sellHoldAgent, defaultConfig, 'Just above sell threshold (abs)');
  assert(jasRes.current.action === 'sell', '하락 임계값 초과 시 정상 SELL 발생');
  boundaryCount++;

  console.log(`\n  ✓ 경계값 집중 보강 테스트 총 ${boundaryCount}건 전수 통과!\n`);
}

// ─────────────────────────────────────────────────────────────────
// 메인 실행
// ─────────────────────────────────────────────────────────────────
function main(): void {
  console.log('################################################################');
  console.log('  STOCKSYS 827dd60 대비 OFF 추세 전략 함수 순수 동등성 검증');
  console.log('################################################################\n');

  verifyBaselineAuthenticity();
  runExisting96MatrixTests();
  runBoundaryTests();

  console.log('================================================================');
  console.log('  🎉 827dd60 대비 모든 96개 매트릭스 및 경계값 검증 100% 일치 통과!');
  console.log('  (Exit Code 0: 경제적 의사결정 action, price, size, orderType 완벽 일치)');
  console.log('================================================================\n');
}

main();
