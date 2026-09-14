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

### 6. 현실을 단순화한 가정 및 미구현 기능
* **기관 포트폴리오 리밸런싱, 개인 투자자 군집 행동, 레버리지, 공매도, 복잡한 금융 위기 시나리오**는 향후 플러그인 확장이 용이하도록 `StrategyType` 및 `MarketObservation` 인터페이스로 설계되어 있으며, 이번 버전에서는 무차입 현물 시장에 집중하여 구현되었습니다.
* 외부 실시간 시세 및 외부 DB 연동 없이 독립적인 Standalone 인메모리 환경에서 구동됩니다.

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

## Commands & Build

패키지 스크립트는 `package.json`에 정의된 명령어를 사용합니다.

### 실행 명령어

- **로컬 개발 서버**:
  ```bash
  npm run dev
  ```
- **프로덕션 빌드**:
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
- **정산 시스템 검증**:
  ```bash
  npm run test:settlement
  ```

---

## Verification

TypeScript:

```bash
npx tsc --noEmit
```

Production build:

```bash
npm run build
```

Order risk, security and settlement tests:

```bash
npx tsx scripts/test-order-risk-and-settlement.ts
npx tsx scripts/test-order-security-and-atomic.ts
```

검증해야 할 핵심 invariant:

```text
cash >= 0

holdings.quantity >= 0

order.filled <= order.size

trade.price > 0

trade.size > 0
```

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
