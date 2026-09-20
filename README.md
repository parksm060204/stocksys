# 무명 (STOCKSYS)

> Multi-asset market simulation and virtual trading system built with Next.js, TypeScript and PostgreSQL.

STOCKSYS는 실제 금융시장의 구조를 단순화하여 구현한 가상 자산시장 시뮬레이션 프로젝트입니다.

사용자는 주식 시장의 호가창을 직접 관찰하고 주문을 제출할 수 있으며,
LP(Liquidity Provider), 개인 투자자 및 기관 투자자 봇들의 주문 흐름에 의해
가격과 거래량이 지속적으로 변화합니다.

주식뿐 아니라 채권, 원자재, ETF, 옵션 등 여러 자산군을 하나의 시장 환경에서
시뮬레이션하는 것을 목표로 합니다.

> STOCKSYS는 실제 투자 또는 금융시장 예측을 위한 시스템이 아닙니다.
> 교육, 연구, 시뮬레이션 및 소프트웨어 실험을 목적으로 합니다.

---

## Quick Start

로컬 개발 환경에서는 별도의 데이터베이스나 시장 엔진이 필요하지 않습니다.

```bash
git clone https://github.com/parksm060204/stocksys.git
cd stocksys

npm install
npm run dev
```

브라우저에서:

```text
http://localhost:3000
```

을 열면 됩니다.

### Zero-Dependency Local Mode

개발 환경에서 외부 데이터베이스 설정이 존재하지 않으면
STOCKSYS는 자동으로 **Local Standalone Mode**를 시작합니다.

추가로 설치할 필요가 없습니다.

- Docker 불필요
- Supabase 불필요
- PostgreSQL 불필요
- PostgREST 불필요
- 별도 MarketEngine 서버 불필요
- 환경변수 설정 불필요

Next.js 개발 프로세스 자체가 로컬 시장 서버 역할을 수행합니다.

---

## Local Test Account

Standalone Mode에서는 자동으로 테스트 계정이 생성됩니다.

```text
Nickname     서학개미
Initial Cash ₩100,000,000
```

기본 주식 포트폴리오도 함께 생성되므로 실행 직후 바로 매수/매도와
포트폴리오 기능을 테스트할 수 있습니다.

우측 하단의 **Local Standalone** 패널에서 시장 전체를 초기 상태로 리셋할 수 있습니다.

---

## Core Features

### Continuous Double Auction

STOCKSYS의 주식 시장은 가격 우선·시간 우선 원칙을 기반으로 주문을 매칭합니다.

```text
BUY orders
가격 높은 순
→ 동일 가격에서는 먼저 들어온 주문 우선

SELL orders
가격 낮은 순
→ 동일 가격에서는 먼저 들어온 주문 우선
```

매수·매도 주문이 교차하면 resting maker의 가격을 기준으로 체결됩니다.

예:

```text
Existing BUY  ₩72,000
Incoming SELL ₩71,900

Execution     ₩72,000
```

---

## Maker / Taker Model

시장 유동성 공급을 표현하기 위해 Maker/Taker fee model을 사용합니다.

```text
Maker Rebate   -0.10%
Taker Fee      +0.25%
```

호가창에 먼저 존재하던 주문은 Maker,
기존 주문과 즉시 체결하는 신규 주문은 Taker로 처리됩니다.

Local Standalone Mode와 Production MarketEngine은 동일한
settlement interface를 사용하도록 구성되어 있습니다.

---

## Order Risk & Asset Reservation

미체결 주문이 존재하는 상황에서 동일 자산을 반복 주문하여
실제 보유 자산 이상으로 주문하는 것을 방지하기 위해
동적 Reservation 시스템을 사용합니다.

매수 가능 예수금:

```text
Available Cash
=
Current Cash
-
Reserved Cash from Open BUY Orders
```

매도 가능 수량:

```text
Available Quantity
=
Current Holdings
-
Reserved Quantity from Open SELL Orders
```

예약 대상 주문:

```text
open
partial
```

예약 대상이 아닌 주문:

```text
filled
cancelled
expired
```

따라서 이미 100%의 보유주식이 매도 주문으로 등록되어 있다면
동일 주식에 대한 추가 매도 주문은 거절됩니다.

---

## Market Simulation & Agent-Based Market (ABM)

Local Market Engine은 Next.js Node.js 단일 프로세스 안에서 실행되며, 현실적인 **에이전트 기반 시장(Agent-Based Market, ABM)** 구조를 갖추고 있습니다.

```text
npm run dev
     │
     ▼
Next.js Node Process
     │
     ├── Local Memory Database (Single Authoritative Ledger)
     │
     ├── Local Market Engine
     │     │
     │     ├── Simulation Clock (simulationTime, dt, monotonic sequence)
     │     ├── Decoupled PRNG Streams (Mulberry32 + Box-Muller Gaussian)
     │     ├── Merton Jump-Diffusion (MJD) Latent Fundamental Process
     │     └── Agent Manager
     │           │
     │           ├── Value Investors (Deadband/Hysteresis, Cost Check)
     │           ├── Trend Followers (Warm-up, Momentum, IOC Takers)
     │           └── Inventory-Skewed LP (Avellaneda-Stoikov Skew, Multi-level Budget)
     │
     ├── Unified Service & Matching Engine (LocalMarketService & dbMatching)
     │     ├── Universal Price-Time Priority
     │     ├── Resting Maker Price Execution & Self-Trade Prevention
     │     └── Immediate-Or-Cancel (IOC) Instant Cancellation
     │
     └── Next.js Web UI
```

### 1. 참가자 식별과 독립 계좌 장부
* **참가자 유형(`ParticipantType`)**: `human` | `bot` | `lp`
* **독립 계좌(`accountId`)**:
  * LP 주계좌: `acc_lp_main` (시드: 현금 50억 원, 종목별 5,000주)
  * 가치 투자자 봇: `acc_bot_val_01`, `acc_bot_val_02` (시드: 현금 15~20억 원, 500~1,000주)
  * 추세 추종자 봇: `acc_bot_trend_01`, `acc_bot_trend_02` (시드: 현금 15~20억 원, 500~1,000주)
* **자산 제약 & 무차입 원칙**:
  * 공매도 및 레버리지 금지 (가용 현금 초과 매수 및 가용 보유량 초과 매도 원천 차단).
  * 자동 잔고 충전 또는 강제 보정 배제 (파산 및 한도 도달 시 활동 자연 축소).
  * 단일 권위(Single Authority) 예약 자산 모델: 미체결(`open`, `partial`) 주문의 합산 예약금을 실시간 동적 차감하여 이중 지출 차단.

### 2. 구현된 3대 전략과 의사결정 방식
1. **가치 투자자 (Value Investor)**:
   * 잠재 펀더멘털 가치($F_t$)에 개별 추정 오차($\epsilon \sim \mathcal{N}(0, \sigma^2)$)와 지연을 반영하여 $\hat{V}$를 산출.
   * **1% 불감대(Deadband/Hysteresis)**: 미세한 가치 변동에 따른 잦은 포지션 뒤집기(churning) 억제.
   * **기대이익 검증**: 예상 차익이 거래비용(수수료 + 스프레드 + 슬리피지 한도)을 충분히 상회할 때만 주문 제출.
   * 저평가 시 매수, 고평가 시 매도가 대칭적으로 작동.
2. **추세 추종자 (Trend Follower)**:
   * 미래 정보를 보지 않고 순수 과거 체결 및 가격 이력으로 기간 모멘텀 계산.
   * **Warm-up 강제**: 최소 5스텝 이상의 과거 데이터 축적 전까지 주문 보류.
   * $\tanh$ 정규화 신호에 따른 동적 노출 조절 및 강한 추세 시 슬리피지 한도를 둔 IOC 주문 제출.
3. **재고 기반 유동성 공급자 (Inventory-Skewed LP)**:
   * **Avellaneda–Stoikov 휴리스틱**:
     $$\text{quoteCenter} = \text{referencePrice} - (q - q^*) \cdot \kappa \cdot \text{tickSize}$$
     $$\text{spread} = \text{baseSpread} + \text{volatilityPremium} + \text{inventoryRiskPremium}$$
   * 재고 과다 시($q > q^*$) 호가 중심을 낮추어 매도를 유도하고, 재고 부족 시 호가 중심을 높여 매수를 유도.
   * 변동성 및 재고 위험 증가 시 스프레드 자동 확대.
   * **다단계 합산 자산 예산 한도**: 3단계 호가의 총 매수 대금이 가용 현금을, 총 매도 수량이 가용 주식을 절대 초과하지 않도록 캡 적용.
   * 가격 미변경 시 기존 주문의 시간우선순위를 보존하는 차분 갱신(Differential Quoting).

### 3. 시뮬레이션 시계와 재현 가능한 난수 (PRNG)
* 벽시계(Wall Clock)와 경제 시뮬레이션 시간(`simulationTime`)의 명시적 분리.
* 시드 기반 Mulberry32 PRNG와 Box-Muller 가우시안 난수 생성기 사용.
* 시장 상태/가치 과정과 봇별 난수 스트림(`agentPrngs`)을 격리.
* **Merton Jump-Diffusion (MJD)** 연속 시간 모형:
  * Drift $\propto dt$, Diffusion $\propto \sigma \sqrt{dt}$, Jump 확률 $P(\text{jump}) = 1 - e^{-\lambda dt}$.
  * 런타임 속도 변경 시에도 경제적 변동성 왜곡 없음.
* **Headless 수동 전진**: 테스트 환경에서 백그라운드 타이머 없이 `stepSimulation(dt)`를 호출하여 결정론적 단위/회귀 테스트 수행 가능.

### 4. 공통 주문·매칭·정산 및 보안 경로
* 사람, 봇, LP 모두 단일 서비스 인터페이스(`LocalMarketService.submitOrder`, `cancelOrder`)와 매칭 엔진(`dbMatching`)을 사용.
* 체결은 resting maker 가격으로 성립되며, 동일 계좌 간 자기 매매(Self-Trade)는 원천 차단.
* IOC(Immediate-Or-Cancel) 주문은 허용 가격 내에서 체결 후 미체결 잔량을 즉시 `cancelled` 처리하여 호가창 잔류 방지.
* 정산 실패 시 주가 통계, 호가창, 보조 인덱스, 장부 잔고를 이전 스냅샷으로 100% 원자적 롤백.
* 공개 REST API는 클라이언트 요청 body의 `accountId`, `participantType`을 신뢰하지 않고 서버 세션 사용자로 강제 바인딩.

### 5. 진단 지표 (`MarketDiagnostics`)
* 전략별 주문 제출/취소/체결 수 및 거래량 집계.
* Maker/Taker 체결 비중 및 정산 수수료/리베이트 추적.
* 호가창 건전성: 스프레드(bps), 호가 뎁스, 단방향/빈 호가 상태 지속 틱수 모니터링.
* 주문 거절 사유 추적 (원형 링 버퍼 기반 200건 캡으로 메모리 누수 원천 차단).

### 6. 현실을 단순화한 가정 및 확장 인터페이스
* **주식 시장 무차입 원칙**: 주식 시장은 무차입 현물 거래를 기본 원칙으로 하며(공매도·신용 레버리지 제한), 기관 포트폴리오 리밸런싱, 개인 군집 행동 등은 `StrategyType` 및 `MarketObservation` 확장 인터페이스를 통해 모듈식으로 설계되어 있습니다.
* **파생상품 정산 분리**: 원자재 선물 및 옵션과 같은 파생상품은 별도의 전용 정산 파이프라인(마진콜, 제로섬 일일정산, 만기 현금결제)을 통해 안전하게 처리됩니다.
* **완전 독립형 구동**: 외부 실시간 시세 및 외부 호스팅 DB 연동 없이 로컬 인메모리 환경에서 자율적·결정론적으로 구동됩니다.

---

## Local Memory Database

Standalone Mode에서는 PostgreSQL 대신 인메모리 데이터베이스를 사용합니다.

주요 엔티티:

```text
stocks
profiles
holdings
orders
trades
stock_price_history

bonds
commodities
options_contracts
exchange_rates

admin_settings
bots_config
institutional_portfolios
player_events
```

종목과 사용자 ID는 Production PostgreSQL schema와의 호환성을 위해
고정 UUID 형태를 사용합니다.

---

---

## System Architecture

STOCKSYS는 외부 DB나 호스팅 서버 없이 Next.js 단일 프로세스 내부에서 동작하는 완전 독립형 아키텍처를 가집니다.

```text
                     Browser (NextAuth / Guest Session)
                                 │
                    ┌────────────┴────────────┐
                    │                         │
                    ▼                         ▼
            /api/orders (주문 API)      /api/local-db (데이터 API)
                    │                         │
                    └────────────┬────────────┘
                                 ▼
                     Local Standalone Engine
               (Price-Time CDA Matching & Settlement)
                                 │
                    ┌────────────┴────────────┐
                    │                         │
                    ▼                         ▼
              LocalMemoryStore        LocalMarketEngine
              (In-Memory DB)        (LP / 봇 시뮬레이션)
```

### 핵심 보안 및 트랜잭션 원칙:

1. **외부 DB 및 서드파티 호스팅 의존성 0% (Local Standalone)**:
   - Supabase, PostgreSQL, Render, Docker 등의 외부 인프라 없이 완전히 독립 구동됩니다.
   - Next.js 프로세스 내부의 Authoritative In-Memory DB와 임베디드 마켓 엔진으로 전 과정이 처리됩니다.
   - `npm install && npm run dev`만으로 프론트엔드와 시장 시뮬레이션이 즉시 실행됩니다.

2. **사용자 식별은 서버 세션에서만 결정 (Request Body user_id 신뢰 금지)**:
   - `/api/orders` 및 `/api/local-db`는 클라이언트가 요청 body로 보내는 `user_id`를 신뢰하지 않으며, 서버 세션(NextAuth)에서 확정된 사용자만 사용합니다.
   - Production 환경에서는 미인증 주문이 즉시 거절(401)되며, 비프로덕션 환경에서만 서버가 관리하는 테스트 게스트 계정이 허용됩니다.

3. **엔진 직렬화 및 원자적 트랜잭션 롤백**:
   - 동일 종목의 주문 매칭은 비동기 종목 락(per-stock mutex)을 통해 완전 직렬화됩니다.
   - 사용자 계정 락 및 자산 스냅샷/롤백 메커니즘을 통해 정산 실패 시 현금, 보유량, 주문, 거래, 호가, 주가 기록이 원자적으로 원상 복구됩니다.
   - 브라우저의 임의 장부 수정 및 내부 정산 RPC(`bulk_settle_trades` 등)의 외부 직접 호출은 차단됩니다.

---

## Causal Market Flow Architecture

STOCKSYS의 주식 시장은 가격과 거래량을 임의로 조작하지 않고, 구조화된 경제 이벤트와 봇의 인과적 의사결정 및 실제 주문 매칭을 통해서만 시장 가격과 주도주가 형성되는 단일 인과 구조(Causal Market Flow)를 갖추고 있습니다.

```text
구조화된 경제 이벤트 (MarketEvent)
         │  (단일 eventId, 멱등성 보장, UI 뉴스 피드 동기화)
         ▼
종목·산업별 관심도(Attention) & 불확실성(Uncertainty) 충격
         │  (반감기 지수 감쇠, 종목별 노출 계수 차등)
         ▼
에이전트별 관측 (MarketObservation)
         │  (가치봇: 지연 Latency 반영 / 추세봇: Taker Flow 모멘텀 / LP: 재고·스프레드 방어)
         ▼
유한 예산 기반 종목 선택 & 목표 비중 결정
         │  (가중 룰렛휠 샘플링 + ε-탐색, 자산 한도 내 정규화)
         ▼
LP 호가 공급 & 봇 주문 제출
         │  (LP 2단계 라이프사이클: 취소 확정 후 신규 주문, 잔여 수량 size-filled 계산)
         ▼
연속 이중 경매(CDA) 매칭 및 즉시 정산
         │  (가격 우선·시간 우선, 자산 보존 불변식 검증)
         ▼
구간 통계(Window Statistics) & 결과 기반 주도주(Leader Score) 형성
         │  (시뮬레이션 시간 비중복 윈도우, 점수 평활화 및 히스테리시스)
         ▼
관심 감소(Decay) 및 자금 순환(Capital Rotation)
```

### 1. 종목별 구조적 유동성 (Structural Liquidity)
- **단일 권위 시총 계산**: `market_cap = current_price * shares_outstanding`으로 일관되게 산출.
- **메타데이터**: 유통주식수(`floating_shares`), 섹터/테마 ID, 기본 유동성 점수(`base_liquidity`), 평상시 스프레드·깊이 프로필, 기관 투자 적합도, 뉴스/매크로 노출 계수.
- **대형주 vs 소형주 차이**: 대형주는 깊은 호가와 좁은 스프레드를 형성하여 대규모 IOC 주문에도 낮은 슬리피지를 보이며, 소형주는 얕은 호가와 넓은 스프레드로 인해 충격 비용이 자연스럽게 발생합니다.

### 2. 단일 뉴스 원천 (Single Source of News Event)
- 경제적 이벤트(`MarketEvent`)와 UI 뉴스 문자열을 동일한 `eventId`로 연결하여 멱등성 보장.
- 루머(`RUMOR`)의 진실 여부는 시뮬레이션 내부 상태로만 보존되며 봇 관측 시 비공개 처리.
- 정정 공시(`CORRECTION`)는 원본 루머의 신뢰도를 무효화하고 자연스러운 체결 조정을 유도(인위적 가격 원위치 조작 금지).

### 3. LP 주문 예산 및 2단계 라이프사이클
- LP의 유지 주문은 이미 예약된 잔량(`size - filled`)으로 정밀 계산되어 이중 차감이 방지됩니다.
- 취소 예정 주문은 실제 취소 성공이 확정된 후 신규 호가를 제출하여 예약 자산 한도를 초과하지 않습니다.

---

## Simulation Correctness & Architecture

### 1. 뉴스 이벤트 라이프사이클 (Three-Stage Lifecycle)
* **`registered` (등록 대기)**:
  - 이벤트가 엔진 내부 큐에 등록된 상태.
  - 미래 이벤트(`publishedAt > simulationTime`)는 내부 대기 큐에만 존재하며, 공개 뉴스 DB(`memoryDb.marketNews`), 대시보드, 일반 사용자 API, 봇 관측 어디에도 노출되지 않습니다.
  - 이벤트 등록 자체는 가격, 거래량, 관심도, 불확실성, 호가를 변경하지 않습니다.
* **`published` (공개 완료)**:
  - `publishedAt <= simulationTime`이 된 시점에 공개 뉴스 저장소와 타임라인에 정확히 한 번 추가(`NEWS_PUBLISHED` 로그 기록).
  - 봇은 이 시점부터 자신의 개인 정보 지연(`infoLatency`)이 경과한 뒤 뉴스를 인지합니다.
* **`effective` (효력 발생)**:
  - `effectiveFrom <= simulationTime`이 된 시점에 관심도(`attention`), 불확실성(`uncertainty`), 경제 가치 신호(`valuationSignal`)가 정확히 한 번 반영됩니다.
  - `publishedAt`과 `effectiveFrom`이 동일하더라도 멱등성 추적(`appliedEffectEventIds`)을 통해 중복 처리가 방지됩니다.

### 2. 시간 단위 및 변환 규칙
* 시뮬레이션 타임스탬프(`simulationTime`, `publishedAt`, `effectiveFrom`, `simulation_time`)는 **정수형 Epoch Millisecond(ms)**입니다.
* 시간 간격(`dt`), 봇 정보 지연(`infoLatency`), 뉴스 반감기(`halfLife`)는 **초(Seconds)** 단위입니다.
* 단위 변환 시 크기 추측(heuristic threshold)을 금지하고 반드시 `secondsToMs()` 및 `millisecondsToSeconds()` 변환 헬퍼를 사용합니다.

### 3. 봇별 정보 지연(`infoLatency`)과 효력 시점(`effectiveFrom`)의 차이
* **뉴스 인지 시점**: `publishedAt + infoLatencyMs <= observationTime`
  - 봇은 자신의 정보 지연이 지난 후에만 해당 뉴스의 존재와 헤드라인을 알 수 있습니다.
* **경제 신호 반영 시점**: `effectiveFrom <= observationTime`
  - 뉴스를 이미 인지했더라도 `effectiveFrom` 이전에는 전략의 `valuationSignal` 합산 및 관심도 반영에서 엄격히 제외됩니다.
* 두 조건을 모두 만족하는 `effectiveEvents`만 가치 전략 및 의사결정의 입력으로 사용됩니다.

### 4. 시뮬레이션 직렬 실행 큐와 락 획득 순서
모든 경제 상태 변경 및 엔진 명령은 다음 단일 직렬화 순서를 엄격히 준수합니다:
```text
SerialExecutionQueue (시뮬레이션 큐)
  → withStockLock (종목 락)
    → withAccountLocks (참여 계정 락)
```
- 외부 API 및 운영 코드는 `AgentManager.step()`을 직접 호출할 수 없으며, `LocalMarketEngineInstance`의 큐 인터페이스(`stepSimulation`, `publishEvent`, `resetSimulation`)를 통해서만 실행됩니다.
- 실패한 작업 뒤에도 큐가 안전하게 해제되어 다음 명령이 정상 실행되며, 자동 틱 지연 시 타이머 작업의 무제한 누적을 방지합니다.

### 5. 수동 전진 권한 및 API 정합성
- `GET /api/market-flow`: 순수 읽기 전용 진단 쿼리. 여러 번 반복 호출하더라도 시장 시각, 평활화 점수, 경제 상태가 일절 변경되지 않습니다.
- `POST /api/market-flow`: 관리자 권한(`verifyAdminSession`, 개발 환경의 `ALLOW_DEV_ADMIN=true` 또는 세션 어드민)이 필요하며, 비관리자 요청은 `403 Forbidden`으로 즉시 거절됩니다. 유효한 `dt`(0.1초~10.0초) 검증 및 초당 15회 호출 제한이 적용됩니다.

### 6. 대시보드 순위 및 뉴스 마커의 `asOfTime`
- 한 스텝 내에서 지수 평활화(`updateLeaderBoard`)는 모든 거래·체결이 완료된 후 동일한 `asOfTime`에 정확히 한 번만 수행됩니다.
- 스텝 종료 직전에 체결된 마지막 거래가 해당 스냅샷의 거래대금, 순매수, 주도주 순위에 함께 반영됩니다.
- 동일 시각(`asOfTime`)의 복수 뉴스는 마커 배열(`newsEvents`)에 누락 없이 보존되며, 동일 스냅샷 교체 시에도 기존 마커가 유실되지 않습니다.

### 7. 인과 로그 추적 범위 및 한계
- 지원 ID 체인: `eventId` → `decisionId` → `orderId` → `tradeIds` (모든 분할 체결 및 maker/taker 역할 정확히 연결)
- 체결 로그의 평균 체결가는 실제 체결 레코드 가중평균으로 계산되며, 주문 거절은 `ORDER_REJECTED`로 독립 기록됩니다.
- ID 체인이 완전하게 연결된 이벤트는 `[인과 추적]`으로 배지 표기되며, 단순 상관 기록은 `[시장 이벤트 흐름]`으로 명확히 구분하여 표기합니다.

### 8. 시장 국면(Market Regime) 및 거래 세션(Trading Session) 기반 엔진

STOCKSYS는 거시 경제 지표와 수급 충격에 적응하는 **시장 국면(Regime) & 세션(Session) 엔진**을 갖추고 있습니다.

#### (1) 시장 국면(MarketRegime) 및 거래 세션(TradingSession) 체계
* **5대 시장 국면**:
  - `BULL` (상승장): 양의 모멘텀, 매수 우위, 호가 스프레드 축소
  - `BEAR` (하락장): 음의 모멘텀, 매도 우위, 리스크 회피
  - `SIDEWAYS` (횡보장): 낮은 변동성, 좁은 스프레드, 박스권 횡보
  - `HIGH_VOLATILITY` (고변동성): 실현 변동성 급증, 스프레드 확대, 호가 두께 축소
  - `LIQUIDITY_CRISIS` (유동성 위기): 유효 호가 공백 지속, 스프레드 폭등, 호가 깊이 붕괴
* **5대 거래 세션**:
  - `PRE_OPEN` (장개시전), `OPENING_AUCTION` (시초가 동시호가), `CONTINUOUS` (정규 단일가/연속매매), `CLOSING_AUCTION` (종가 동시호가), `CLOSED` (장마감 후 익일 롤오버)
* **시간 기준점 및 반열린 구간 `[start, end)` 규칙**:
  - 거래일 시작 기준점(`tradingDayAnchorMs`)과 시뮬레이션 경과 시간(`elapsedMs`)의 양의 모듈로 연산을 통해 일중 시간(`timeWithinDayMs`)을 계산합니다.
  - 세션 구간은 `[start, end)` 반열린 구간 규칙을 엄격히 적용하여 경계 1ms 직전에는 이전 세션, 정확한 경계 시각에는 다음 세션으로 전환됩니다. 86,400초 경과 시 익일 롤오버 및 `tradingDayIndex`가 증가합니다.

#### (2) 1단계: 관측용 상태 전이 엔진 및 불변성 보장
* **완전한 런타임 불변성**:
  - `MarketStateEngine` 생성자에서 설정 및 세션 스케줄 전체를 `deepFreeze(deepClone(...))`하여 원본 변조를 차단합니다.
  - `getSnapshot()`, `getThresholds()`, `getRegimeHistory()`는 깊은 동결 복제본을 반환하여 외부 변조 시 `TypeError`를 발생시킵니다.
* **단일 권위 시가총액 산출**:
  - 순수 함수 `calculateAuthoritativeMarketCap`을 통해 `shares_outstanding`(부재 시 `floating_shares`) 기준으로 시총 가중 지수 수익률을 산출하여 대형주/소형주 가중치 왜곡을 원천 방지합니다.
* **양방향 히스테리시스 및 국면 전이 억제**:
  - 진입 임계치와 회복(이탈) 임계치를 분리하고, 최소 유지 시간(`minRegimeDurationSeconds`), 전환 쿨다운(`regimeCooldownSeconds`)을 두어 잦은 국면 진동(churning)을 방지합니다.
* **양측 유효 호가(`hasValidTwoSidedQuote`) 기반 위기 탐지**:
  - 매수/매도 중 한쪽만 남은 단측 호가(One-Sided Book)나 교차 호가를 정상 호가로 오인하지 않고 공백으로 집계(`emptyBookStockRatio >= 30%` & 지속시간 >= 2s 시 유동성 위기 진입).
* **다음 스텝 지연 활성화 원칙 (No Circular Causality)**:
  - 현재 스텝 $t_1$ 종료 시 확정 통계로 평가된 국면은 `pendingTransition`에 등록되며, 다음 스텝 $t_2$ 시작 시점에 활성화됩니다.
  - 이를 통해 한 스텝의 경제적 결과가 같은 스텝의 시장 국면을 바꾸고 다시 그 스텝의 주문을 바꾸는 순환 인과 및 시간 역행을 원천 차단합니다.

#### (3) 2단계: 활성 국면 효과(Regime Effects) 및 봇/LP 행동 적응
시장 국면 2단계는 활성화된 국면 파라미터가 봇의 주문 의사결정과 LP의 호가 공급에 직접 반영되는 시스템입니다.

* **순수 파라미터 변환 계층 (`regimeEffects.ts`)**:
  - 엔진 내부 상태를 직접 변이하지 않고, 활성 국면과 기본 설정을 결합하여 불변 컨텍스트(`AppliedRegimeContext`)를 도출하는 순수 함수 계층입니다.
* **봇 전략의 동적 적응**:
  - **방향별 주문 발생 확률**: $p_{\text{candidate}} = \max(p_{\text{buy}}, p_{\text{sell}})$ 게이트를 통해 불필요한 연산을 줄이고 국면 성향에 따라 비대칭 주문 제출.
  - **신호 민감도**: 가치 투자자(`valueSensitivity`) 및 추세 추종자(`trendSensitivity`)의 신호 반응 강도 조절.
  - **주문 크기 배수 (`orderSizeMultiplier`)**: 기본 희망 수량에 배수를 적용하되, 절대 한도/참여율/가용 자산으로 엄격히 클램핑.
  - **계좌 전체 NAV 기준 현금 선호 (`cashPreference`)**: 개별 종목의 호가창이 아닌 계좌 내 모든 보유 종목의 권위적 체결가(`current_price`) 기반 순자산 가치($\text{NAV} = \text{Cash} + \text{HoldingsValue}$)를 기준으로 목표 현금 비중을 유지.
  - **불확실성(`uncertaintyMultiplier`)과 위험 축소 매도 허용**: 불확실성 증폭 시 신규 매수(위험 노출 확대)는 엄격히 억제하지만, 기존 보유 포지션의 하락 방어 매도(`(risk_reduction)`)는 차단하지 않아 포트폴리오 건전성을 보존.
* **LP(유동성 공급자)의 5단계 라이프사이클 및 자산 보호**:
  - **5단계 절차**: 취소 대상 선정 → 취소 실행 → 최신 장부·자산 재조회(`fresh_observation`) → 신규 수량 확정 → 신규 호가 제출.
  - **취소 실패 방어 및 중복 방지 (`lpDeferrals`)**:
    - 체결 경합 등으로 인해 기존 호가의 취소가 실패한 경우, 동일 가격/변경된 가격을 불문하고 신규 호가 제출을 안전하게 보류(`unresolved_active_cancel_orders`)하여 호가 중복 팽창(예: 1,000주 취소 실패 + 200주 추가 제출) 및 자산 이중 지출을 원천 방지.
    - 다음 스텝에서 취소 완료 또는 체결 확인 시 보류가 정상 해제되고 최신 잔고 기반으로 재계획.
  - **지속 가능 목표 깊이 (`sustainableTargetSize`) 기반 Churn 방지**:
    - 가용 예산이 부족할 때 구조적 목표치 대신 가용 자산 한도 내 지속 가능 수량을 기준으로 삼아, 호가 가격과 예산이 동일하면 기존 주문 ID와 시간 우선순위를 유지(반복 취소·재호가 방지).
* **운영 안전성 및 A/B 무결성 격리**:
  - `enableRegimeEffects` 기본값은 `false`로 설정되어 있어 프로덕션 기본 동작은 완벽히 보호됩니다.
  - 효과 OFF 시 2단계 도입 직전 커밋(`4701f11`, `827dd60`) 대비 주문·체결·호가·시세·잔고·PRNG가 비트 단위로 100% 동일함을 증명하는 진정한 A/B 검증 체계를 갖추고 있습니다.
  - Shallow clone 환경에서도 검증이 가능하도록 픽스처 5종 및 Golden Output 117개 레코드의 SHA-256 해시 잠금을 유지합니다.

---

### 9. 다중 자산 파생 및 정산 파이프라인 (Multi-Asset Settlement Pipeline)

STOCKSYS는 현물 주식 외에도 원자재 선물(Commodity Futures)과 옵션(Options Contracts) 등 다양한 파생상품을 시뮬레이션하며, 정합성을 보장하는 다단계 정산 파이프라인을 갖추고 있습니다.

#### (1) 원자재 선물 시장 및 5대 전문 봇 생태계
- 8대 주요 원자재 선물(WTI 원유, 금, 은, 구리, 천연가스, 대두, 옥수수, 밀)을 자체 오더북(`CommodityOrderBook`)을 통해 지원합니다.
- 전문 트레이딩 봇 5종:
  - **`MarketMakerBot`**: 양방향 호가 공급 및 스프레드 캡처
  - **`TrendFollowingBot`**: 장단기 이동평균선 기반 모멘텀 추종
  - **`MeanReversionBot`**: 볼린저 밴드 및 RSI 기반 과매수/과매도 반전 매매
  - **`HedgerBot`**: 실물 생산자/소비자의 가격 변동성 헤지 주문
  - **`NewsTraderBot`**: 수급 보고서 및 지정학적 뉴스 충격 기반 모멘텀

#### (2) 파생상품 3단계 정산 파이프라인 (`npm run test:settlement`)
1. **Step 1: 선물 제로섬(Zero-Sum) 불변식 검증 (`step1_zerosum.ts`)**:
   - 모든 롱 포지션 평가손익의 합과 숏 포지션 평가손익의 합의 대수적 총합이 정확히 0임을 일일 정산(Mark-to-Market) 시마다 검증합니다.
2. **Step 2: 마진콜(Margin Call) & 강제 청산 (`step2_margincall.ts`)**:
   - 유지 증거금(Maintenance Margin) 미달 계좌를 탐지하고, 추가 증거금 납부 유예 및 미납 시 시장가 반대매매 강제 청산 파이프라인을 실행합니다.
3. **Step 3: 옵션 만기(Option Expiry) 현금 결제 (`step3_option_expiry.ts`)**:
   - 만기 시점 기초자산 종가 기준 행사가격(Strike)과의 내재가치(Intrinsic Value)를 산출하여 ITM(In-The-Money) 계약은 즉시 현금 차액 결제, OTM(Out-Of-The-Money) 계약은 가치 소멸(무가 만기)로 처리합니다.

---

### 10. 프로덕션 운영 및 고가용성 안정성 수칙 (Production Reliability & VM DB Lessons)

실제 프로덕션 및 장기 시뮬레이션 환경에서 검증된 핵심 운영 원칙입니다:

1. **디스크 포화 방지 롤링 슬라이딩 캡 (Rolling Ring Buffer)**:
   - 24시간 연속 가동되는 기관 봇 환경에서 `trades` 테이블은 매 20틱마다 슬라이딩 윈도우로 최신 5,000건만 유지합니다.
   - `stock_price_history` 역시 최신 3,000건을 초과하는 과거 레코드는 자동 정리하여 PostgreSQL WAL 누적 및 디스크 100% 포화를 원천 방지합니다.
2. **체결 로그와 영구 자산 장부의 엄격한 분리**:
   - 화면 렌더링용 체결 내역(`trades`)과 영구 자산 장부(`institutional_portfolios`)를 분리하고, 봇 자산은 In-Place `UPSERT` 방식으로 고정된 Row 수만 유지합니다.
3. **PostgreSQL WAL 및 Docker 로깅 제한**:
   - DB 컨테이너 기동 시 `-c max_wal_size=1GB -c min_wal_size=80MB`를 필수로 적용하며, 모든 서비스 컨테이너에 Docker log rotation(`max-size: 10m, max-file: 3`)을 설정합니다.
4. **인증(NextAuth) 및 DB 장애 격리**:
   - NextAuth 콜백 내부의 DB 조회는 전수 `try-catch`로 감싸고 `.maybeSingle()`을 사용하여 DB 지연이나 일시 다운 상황에서도 500 HTML 파싱 에러(`CLIENT_FETCH_ERROR`)가 발생하지 않도록 격리합니다.
5. **환경변수 하위 호환 Alias 유지**:
   - `NEXT_PUBLIC_ENGINE_DB_URL`과 `NEXT_PUBLIC_SUPABASE_URL`을 상호 폴백으로 동시에 유지하여 의존성 라이브러리의 누락 크래시를 방지합니다.

---

## Commands & Build

패키지 스크립트는 `package.json`에 정의된 명령어를 사용합니다.

### 실행 명령어

- **로컬 개발 서버**:
  ```bash
  npm run dev
  ```
- **프로덕션 빌드 (Turbopack)**:
  ```bash
  npm run build
  ```
- **프로덕션 서버 시작**:
  ```bash
  npm run start
  ```
- **린트 검사**:
  ```bash
  npm run lint
  ```
- **파생상품 정산 파이프라인 검증 (선물 제로섬, 마진콜, 옵션 만기)**:
  ```bash
  npm run test:settlement
  ```

---

## Verification & Test Suites

STOCKSYS는 시스템의 무결성, 동시성, 정산 불변식, 그리고 시장 국면 및 A/B 결정론을 전수 검증하기 위한 포괄적인 테스트 스위트를 갖추고 있습니다.

### 1. 타입 검사 및 프로덕션 빌드
```bash
npx tsc --noEmit
npm run build
```

### 2. 시장 국면(Market Regime) 및 효과(Effects) 검증 스위트
- **시장 국면 1단계 기반 엔진 검증 (33대 시나리오 전수 검증)**:
  ```bash
  npx tsx scripts/test-market-regime-foundation.ts
  ```
- **시장 국면 2단계 효과(Regime Effects) 검증 (방향별 확률, 민감도, 주문크기, NAV 현금선호, LP Churn 방지)**:
  ```bash
  npx tsx scripts/test-regime-effects-stage2.ts
  ```
- **2단계 코드 리뷰 및 체결 경합 정산 불변식 검증 (A~H 사례, 부분/전량체결, 1:1 보조인덱스 정합성)**:
  ```bash
  npx tsx scripts/test-stage2-review-fixes-v2.ts
  npx tsx scripts/test-stage2-review-fixes.ts
  ```
- **과거 기준선(827dd60) 대비 3자 병렬 A/B 검증 (Shallow Clone SHA-256 픽스처 5종 + Golden Output 117건)**:
  ```bash
  npx tsx scripts/test-comparison-827dd60.ts
  ```
- **장기 다중 시드 시뮬레이션 검증 (20 Seeds × 86,400s 1거래일 5대 세션 순환, 결정론 100%, 불변식 위반 0건)**:
  ```bash
  npx tsx scripts/test-market-regime-long-run.ts
  ```
- **국면 효과 품질 및 현실성 평가 (5개 시드 × 6대 시나리오 30건 전수 통과, 지연·스프레드·회복 관측)**:
  ```bash
  npx tsx scripts/test-market-regime-scenarios.ts
  ```
- **안전한 실험 활성화 모드 및 무중단 전환 검증 (OFF / SHADOW / EXPERIMENTAL_ON 3대 모드)**:
  ```bash
  npx tsx scripts/test-regime-activation-modes.ts
  ```

### 3대 국면 효과 운용 모드 (Regime Effects Modes)
1. **`OFF` (기본값, 기본 운영 모드)**:
   - 국면 탐지 엔진 및 국면 효과가 완전히 비활성화되거나 효과 배수가 중립(1.0)으로 유지됩니다.
   - 기존의 안정적인 기준선(baseline) 시장 동작을 100% 보장합니다.
2. **`SHADOW` (섀도 관측 모드)**:
   - 국면 탐지 엔진은 백그라운드에서 실시간으로 시장 지표를 분석하여 국면을 탐지하지만, 봇 및 LP에는 일절 효과를 주지 않습니다 (`appliedRegime = null`, 무영향성 100% 비트 단위 일치 검증 완료).
   - 관측과 실제 적용을 명확히 분리하여 안전한 모니터링을 지원합니다.
3. **`EXPERIMENTAL_ON` (제한적 실험 모드)**:
   - 인가 키(`regime-eval-auth`) 및 비인가 차단 정책을 통해서만 전환 가능하며, 진행 중인 스텝 중간이 아닌 다음 스텝 경계(`pendingEffectsMode`)에서 원자적으로 적용됩니다.
   - 이상 징후나 불변식 위반 감지 시 즉시 `OFF` 모드로 롤백 가능한 킬 스위치가 동작합니다.
   - `mgr.getRegimeModeDiagnostics()` API를 통해 현재 모드, 대기 모드, 탐지 국면, 실제 적용 국면, 적용 배수, 최근 호가 보류 횟수, 전환 이력을 실시간 모니터링할 수 있습니다.

### 3. 주문 위험, 트랜잭션 및 정산 검증 스위트
- **주문 리스크 및 단일 권위 예약 자산 검증**:
  ```bash
  npx tsx scripts/test-order-risk-and-settlement.ts
  ```
- **동시성 경합 및 원자적 롤백(Atomic Rollback) 보안 검증**:
  ```bash
  npx tsx scripts/test-order-security-and-atomic.ts
  npx tsx scripts/test-transaction-isolation.ts
  npx tsx scripts/test-concurrency-and-stale-ref.ts
  ```
- **다중 자산 파생상품 정산(선물/옵션 만기) 검증**:
  ```bash
  npm run test:settlement
  ```

### 4. 에이전트 기반 시장(ABM) 및 인과 흐름 검증
```bash
npx tsx scripts/test-agent-based-market.ts
npx tsx scripts/test-causal-market-flow.ts
npx tsx scripts/test-news-lifecycle-and-causal-flow.ts
```

### 핵심 불변식 (Invariants):
```text
1. 자산 비음수: cash >= 0, holdings.quantity >= 0 (차입/공매도 원천 차단)
2. 체결 한도: order.filled <= order.size
3. 거래 유효성: trade.price > 0, trade.size > 0
4. 자산 보존: 거래소 순수수료 = ∑(총 현금 변화), 주식 발행 총량 불변
5. 인덱스 정합: memoryDb.orders ↔ orderStockIndex / orderUserIndex 1:1 양방향 일치
```

---

## Important Notice

STOCKSYS는 실제 증권 거래소가 아닙니다.

이 프로젝트에서 표시되는:

- 가격
- 뉴스
- 주문
- 거래량
- 기업
- 자산
- 투자자 행동

등의 일부 또는 전체는 시뮬레이션을 위해 생성되거나 단순화된 데이터일 수 있습니다.

실제 투자 의사결정에 사용하지 마십시오.

---

## Project History

상세한 구현 변경 이력은 [`HISTORY.md`](./HISTORY.md)를 참고하십시오.

---

## License

This project is currently developed as an experimental simulation project.

Copyright © STOCKSYS / MUMYEONG.
