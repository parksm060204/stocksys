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

## Development Principles

STOCKSYS는 외부 DB 서버 의존성 없이 프론트엔드와 시장 시뮬레이션을 단일 Next.js 개발 런타임에서 완전히 재현하도록 설계되었습니다.

```text
         Shared Market Logic (CDA Matching & Settlement)
                               │
                 Local Standalone Architecture
                               │
             In-Memory Store & Embedded Simulation
```

모든 주문 매칭, 체결, 호가 공급 및 자산 관리는 메모리 상에서 원자적으로 처리되어 즉각적인 피드백과 신속한 로컬 개발 경험을 제공합니다.

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
