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

## Market Simulation

Local Market Engine은 Next.js Node.js 프로세스 안에서 실행됩니다.

```text
npm run dev
     │
     ▼
Next.js Node Process
     │
     ├── Local Memory Database
     │
     ├── Local Market Engine
     │
     ├── Matching Engine
     │
     ├── Liquidity Providers
     │
     ├── Trading Bots
     │
     └── Next.js UI
```

Memory DB와 LocalMarketEngine은 `globalThis` singleton으로 유지되어
개발 중 Hot Module Reload가 발생하더라도 가능한 한 하나의
authoritative market state를 유지합니다.

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

## Liquidity Provider

Local Market Engine은 정기적으로 양방향 호가를 공급합니다.

```text
        ASK
         │
         │
────── Market Price ──────
         │
         │
        BID
```

LP 주문은 실제 `orders` state에 등록되며,
Local Mode에서는 브라우저가 임의로 생성한 synthetic depth가 아니라
시장 엔진의 실제 주문잔량을 표시합니다.

---

## Trading Agents

시장에는 다양한 투자자 행동을 표현하는 알고리즘 에이전트가 존재합니다.

Production MarketEngine에는 다음과 같은 전략 계열이 포함되어 있습니다.

```text
Retail Swarm
Hedge Fund
Quant
Statistical Arbitrage
Prop Desk
Pension Fund
Commercial Bank
Commercial Hedger
CTA
Market Maker
Options Market Maker
Adversarial Agent
Wall Breaker
```

각 Agent는 가격, 펀더멘털, 뉴스, 시장 이벤트 및 포트폴리오 상태를 기반으로
주문을 생성합니다.

---

## Price Dynamics

시장 가격은 단순 random walk만으로 생성되지 않습니다.

MarketEngine에는 확률적 가격 변동과 주문 흐름을 표현하기 위한
여러 모델이 포함되어 있습니다.

### Merton-style Jump Diffusion

일반적인 시장 변동 외에 드물게 큰 가격 충격이 발생하도록 구성합니다.

```text
dS
=
drift
++
diffusion
++
jump
```

### Hawkes-style Order Flow

주문이 증가하면 단기적으로 추가 주문이 발생할 확률이 높아지는
self-exciting order flow를 모사합니다.

이를 통해 평상시 시장과 높은 거래 집중 구간을 구분할 수 있습니다.

---

## Supported Markets

현재 프로젝트에는 다음 자산군의 데이터 구조와 UI가 포함되어 있습니다.

```text
Korean Equities
US Equities
European Equities
ETFs
Bonds
Commodities
Options
FX
```

Standalone Mode는 테스트 및 UI 개발을 위한 seed dataset을 포함합니다.

---

## Portfolio & Account

사용자는 `/mypage`에서 다음 정보를 확인할 수 있습니다.

```text
Cash
Holdings
Average Purchase Price
Current Market Value
Portfolio P/L
Foreign Currency Wallet
```

거래 체결 시 cash와 holdings가 settlement layer를 통해 갱신됩니다.

---

## Data Retention

시장 엔진이 장시간 실행될 경우 거래 데이터가 무한히 증가하지 않도록
Sliding Window 정책을 사용합니다.

기본값:

```text
Trades                Latest 5,000
Stock Price History   Latest 3,000
```

Local Memory Mode와 Production Database 모두 동일한 목적의
trimming 메커니즘을 갖습니다.

---

## Security Model & Transaction Safety

Production 환경과 Local Standalone 환경은 명확하게 분리됩니다.

```text
NODE_ENV=development
+ no external database
        │
        ▼
Local Standalone Mode (In-Memory Simulation)


NODE_ENV=production
        │
        ▼
External Database Required (PostgreSQL / Supabase)
```

### 핵심 보안 및 트랜잭션 원칙:

1. **브라우저는 절대로 Service Role Key를 사용하지 않음**:
   - 브라우저 클라이언트는 오직 공개 anon key 또는 NextAuth 세션 쿠키만 사용합니다.
   - `ENGINE_DB_SERVICE_ROLE_KEY` / `SUPABASE_SERVICE_ROLE_KEY`는 오직 서버 환경에서만 접근 가능합니다.

2. **사용자 식별은 서버 세션에서만 결정 (Request Body user_id 신뢰 금지)**:
   - `/api/orders`는 클라이언트가 요청 body로 보내는 `user_id`를 완전히 무시합니다.
   - 서버 사이드 NextAuth 세션(`getServerSession(authOptions)`)의 `session.user.id`만을 사용자의 신원으로 강제 바인딩합니다.
   - Production 환경에서 유효한 세션이 없으면 `401 Unauthorized`로 차단됩니다.
   - Local Mode에서는 개발 편의를 위해 `GUEST_USER_ID`(`서학개미`)로 자동 매핑됩니다.

3. **단일 원자적 DB 트랜잭션 (`submit_and_match_order`)**:
   - Production 주문 lifecycle 전체(프로필 락 → 자산 예약 검증 → 매칭 → Maker/Taker 수수료 정산 → 주문/체결/주식 통계 갱신)는 PostgreSQL RPC `submit_and_match_order` 내부에서 `FOR UPDATE` 행 잠금과 함께 단일 트랜잭션으로 처리됩니다.
   - 중간에 어떠한 에러(잔고 부족, 수량 부족, DB 오류)가 발생하더라도 전체가 `ROLLBACK`되어 부분 실패나 자산 불일치가 원천 방지됩니다.

4. **Anon Key Fallback 금지**:
   - 서버 주문 API는 Service Role Key가 누락되었을 때 anon key로 fallback하지 않고 즉시 에러를 반환합니다.

---

## Production Architecture

```text
                     Browser (NextAuth Session)
                                │
                                ▼
                  Next.js Web App (/api/orders)
                                │ (Server-side Session Validation)
                                │ (Service Role Client Only)
                                ▼
                      PostgreSQL Database
                     ┌─────────────────────┐
                     │ submit_and_match_   │
                     │ order (Single Tx)   │
                     └─────────────────────┘
                                ▲
                                │
                     MarketEngine (engine-server)
                                │
                 ┌──────────────┼──────────────┐
                Bots            LP           Events
```

Production에서는 웹 애플리케이션과 시장 엔진을 분리하여 실행합니다.

---

## Production Environment

Production에서는 최소 다음 서버 환경변수가 필요합니다.

```env
NEXT_PUBLIC_ENGINE_DB_URL=
NEXT_PUBLIC_ENGINE_DB_ANON_KEY=

ENGINE_DB_SERVICE_ROLE_KEY=
```

또는 기존 Supabase naming convention을 사용하는 경우:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

SUPABASE_SERVICE_ROLE_KEY=
```

Service Role Key는 server-side 환경에만 존재해야 합니다.

---

## Production Build

웹 애플리케이션:

```bash
npm run build
npm run start
```

MarketEngine:

```bash
npm run engine:build
npm run engine:start
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

## Development Principles

STOCKSYS는 Local Mode와 Production Mode에서 서로 완전히 다른 시장을
두 번 구현하는 것을 지양합니다.

핵심 방향은 다음과 같습니다.

```text
             Shared Market Logic
                     │
          ┌──────────┴───────────┐
          │                      │
   Local Memory Adapter    Production DB Adapter
          │                      │
 Local Standalone          PostgreSQL / Supabase
```

가능한 한 Matching, Settlement, Risk Control 및 Market Logic을 공유하고,
저장소 및 실행 환경만 교체하는 구조를 지향합니다.

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
