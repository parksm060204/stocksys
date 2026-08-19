import { execSync } from 'child_process';

interface SweepResult {
  users: number;
  duration: number;
  rounds: number;
  ordersPlaced: number;
  tradesExecuted: number;
  fillRate: string;
  avgLatencyMs: number;
  p95LatencyMs: number;
  maxLatencyMs: number;
  timeouts: number;
  accountingMismatch: number;
}

const userCounts = [50, 100, 25, 10]; // 역순 스윕으로 잔여 부하 오염 가설 검증
const DURATION = 15; // 전 구간 15초로 동일하게 통일

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runSingleTest(users: number, duration: number): SweepResult {
  console.log(`\n================================================================`);
  console.log(`🚀 [SWEEP RUN] 동시 유저 ${users}명 | 실행시간 ${duration}초 테스트 시작`);
  console.log(`================================================================`);

  const cmd = `npx tsx scripts/loadtest/concurrentTrading.ts --users ${users} --duration ${duration} --mode remote --cleanup`;
  const output = execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' });

  // 결과 파싱
  const roundsMatch = output.match(/총 (\d+)회 라운드/);
  const ordersMatch = output.match(/총 주문 건수:\s*([\d,]+)건/);
  const tradesMatch = output.match(/총 체결 건수:\s*([\d,]+)건/);
  const fillRateMatch = output.match(/체결율 \(Fill Rate\):\s*([\d.]+)%/);
  const avgLatencyMatch = output.match(/평균 지연시간:\s*([\d.]+)ms/);
  const p95LatencyMatch = output.match(/95th 백분위 \(P95\):\s*([\d.]+)ms/);
  const maxLatencyMatch = output.match(/최대 지연시간:\s*([\d.]+)ms/);
  const timeoutsMatch = output.match(/에러\/타임아웃 발생 건수:\s*(\d+)건/);
  const accountingMatch = output.match(/회계 불일치 건수:\s*(\d+)건/);

  const res: SweepResult = {
    users,
    duration,
    rounds: roundsMatch ? parseInt(roundsMatch[1]!, 10) : 0,
    ordersPlaced: ordersMatch ? parseInt(ordersMatch[1]!.replace(/,/g, ''), 10) : 0,
    tradesExecuted: tradesMatch ? parseInt(tradesMatch[1]!.replace(/,/g, ''), 10) : 0,
    fillRate: fillRateMatch ? `${fillRateMatch[1]}%` : '0.0%',
    avgLatencyMs: avgLatencyMatch ? parseFloat(avgLatencyMatch[1]!) : 0,
    p95LatencyMs: p95LatencyMatch ? parseFloat(p95LatencyMatch[1]!) : 0,
    maxLatencyMs: maxLatencyMatch ? parseFloat(maxLatencyMatch[1]!) : 0,
    timeouts: timeoutsMatch ? parseInt(timeoutsMatch[1]!, 10) : 0,
    accountingMismatch: accountingMatch ? parseInt(accountingMatch[1]!, 10) : 0,
  };

  console.log(`  -> 완료: 라운드 ${res.rounds}회, 주문 ${res.ordersPlaced}건, 체결 ${res.tradesExecuted}건 (${res.fillRate}), P95 ${res.p95LatencyMs}ms, 타임아웃 ${res.timeouts}건`);
  return res;
}

async function runCalibratedSweep() {
  console.log('================================================================');
  console.log('🔬 [CALIBRATED SWEEP] 30초 쿨다운 보장 정밀 단계별 스윕 테스트');
  console.log('================================================================\n');

  const results: SweepResult[] = [];

  for (let i = 0; i < userCounts.length; i++) {
    const users = userCounts[i]!;

    if (i > 0) {
      console.log(`\n⏳ [쿨다운] 이전 테스트 잔여 커넥션 해소 대기 (30초 쿨다운)...`);
      await sleep(30000);
    }

    try {
      const res = runSingleTest(users, DURATION);
      results.push(res);
    } catch (e: any) {
      console.error(`  ❌ ${users}명 테스트 실행 중 예외:`, e.message);
    }
  }

  // 사용자 수 오름차순으로 정렬
  results.sort((a, b) => a.users - b.users);

  console.log('\n\n================================================================');
  console.log('📊 [정제된 최종 스윕 결과표 (30초 쿨다운 및 15초 동일 시간 기준)]');
  console.log('================================================================');
  console.log('| 동시 유저 수 | 라운드 수 | 총 주문 건수 | 총 체결 건수 | 체결율 | 평균 지연시간 | P95 지연시간 | 최대 지연시간 | 타임아웃 |');
  console.log('|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|');
  for (const r of results) {
    console.log(`| **${r.users}명** | ${r.rounds}회 | ${r.ordersPlaced.toLocaleString()}건 | ${r.tradesExecuted.toLocaleString()}건 | ${r.fillRate} | ${r.avgLatencyMs.toFixed(1)}ms | ${r.p95LatencyMs.toFixed(1)}ms | ${r.maxLatencyMs.toFixed(1)}ms | ${r.timeouts}건 |`);
  }
  console.log('================================================================\n');
}

runCalibratedSweep().catch(console.error);
