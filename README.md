# 무명 (STOCKSYS) — 가상 주식 거래소 시뮬레이션 시스템

웹소설과 연계된 실시간 알고리즘 자산 시장 거래소 시스템입니다.
국민연금, 블랙록, 시타델 등 50개 기관 봇들이 호가창을 형성하며, 주식, 채권, 원자재, 파생상품 옵션 시장의 가격 흐름과 체결을 실시간으로 관측하고 직접 거래할 수 있습니다.

---

## ⚡ LOCAL DEVELOPMENT

```bash
npm install
npm run dev
```

**That's it.**

- **No Docker.**
- **No Supabase.**
- **No PostgreSQL.**
- **No MarketEngine server.**
- **No environment variables required.**

브라우저에서 `http://localhost:3000`을 열면 즉시 게임 및 전체 시장 시뮬레이션을 플레이할 수 있습니다.
로컬 독립형 모드(`LOCAL_MEMORY_MODE`)에서는 100,000,000 KRW의 예수금과 기본 포트폴리오를 가진 테스트 계정(`서학개미`)으로 즉시 매수/매도 주문, 호가창 체결, 포트폴리오 관리가 작동합니다.

---

## 🏗️ Architecture

```text
npm run dev
     │
     ▼
 Next.js Dev Process (Node.js)
     │
     ├── LocalMemoryStore  ← 유일한 authoritative memory state
     │      ├─ stocks (고정 UUID 규격)
     │      ├─ profiles (서학개미 1억 원)
     │      ├─ holdings
     │      ├─ orders
     │      ├─ trades
     │      └─ history
     │
     ├── LocalMarketEngine ← 유일한 authoritative engine (globalThis 싱글톤)
     │      ├─ Order Matching (In-memory Order Cross)
     │      ├─ Dynamic LP (5틱마다 호가창 공급)
     │      ├─ Institutional & Retail Bots (자율 주문 흐름)
     │      ├─ Maker-Taker Fee 정산
     │      └─ Sliding Window Trimming (20틱마다 WAL/메모리 보호)
     │
     ├── Route Handler (/api/local-db)
     │      └─ 브라우저 클라이언트의 쿼리/주문/RPC를 서버 단일 상태로 중계
     │
     └── Next.js UI
            ├─ /stocks (국내, 미국, 유럽, ETF)
            ├─ /stocks/[id] (실시간 호가창, 차트, 즉시 체결 OrderEntry)
            ├─ /mypage (보유 주식 손익, 외화 지갑, 포트폴리오)
            ├─ /options (선물옵션 월물별 행사가 매트릭스)
            ├─ /commodities (원유, 금, 은, 구리 원자재 거래)
            └─ 🔄 시장 리셋 플로팅 버튼 (우측 하단)
```

---

## 🚀 Production Deployment

프로덕션 환경에서는 분리된 PostgreSQL / PostgREST (또는 Supabase) 인프라 및 전용 `engine-server`를 구동합니다:

```bash
# Next.js 웹 프론트엔드 빌드 및 실행
npm run build
npm run start

# 전용 시장 엔진 서버 실행
npm run engine:build
npm run engine:start
```
