const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Parse .env.local manually
try {
  const envContent = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        process.env[key] = val;
      }
    }
  });
} catch (e) {
  console.warn("⚠️ Could not read .env.local, checking process.env");
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Missing Supabase URL or Key in environment variables.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// 티커별 현실적인 적정 주가(Fair Target Price) 매핑 테이블
const FAIR_TARGET_PRICES = {
  // 국내주식 (KOSPI / KOSDAQ - KRW)
  "005930": 78000,   // 삼성전자
  "000660": 185000,  // SK하이닉스
  "035420": 195000,  // NAVER
  "005380": 245000,  // 현대차
  "000270": 115000,  // 기아
  "035720": 48000,   // 카카오
  "051910": 340000,  // LG화학
  "006400": 380000,  // 삼성SDI
  "068270": 190000,  // 셀트리온
  "207940": 820000,  // 삼성바이오로직스
  "005935": 62000,   // 삼성전자우
  "000810": 280000,  // 삼성화재
  "015760": 21000,   // 한국전력
  "032830": 85000,   // 삼성생명
  "055550": 49000,   // 신한지주
  "105560": 74000,   // KB금융
  "086790": 58000,   // 하나금융지주

  // 미국주식 (S&P 50 / NASDAQ - USD)
  "NVDA": 125.00,   // 엔비디아
  "AAPL": 228.00,   // 애플
  "MSFT": 445.00,   // 마이크로소프트
  "AMZN": 185.00,   // 아마존
  "GOOGL": 178.00,  // 알파벳 A
  "META": 510.00,   // 메타
  "TSLA": 235.00,   // 테슬라
  "NFLX": 680.00,   // 넷플릭스
  "AMD": 155.00,    // AMD
  "INTC": 32.00,    // 인텔
  "JPM": 210.00,    // JP모건
  "BAC": 41.00,     // 뱅크오브아메리카
  "GS": 480.00,     // 골드만삭스
  "BRK": 440.00,    // 버크셔 해서웨이
  "LLY": 840.00,    // 일라이 릴리
  "UNH": 530.00,    // 유나이티드헬스
  "V": 275.00,      // 비자
  "MA": 460.00,     // 마스터카드

  // 유럽주식 (EURO STOXX 50 - EUR)
  "ASML": 850.00,   // ASML
  "SAP": 195.00,    // SAP
  "LVMH": 720.00,   // LVMH
  "NOVO": 130.00,   // 노보 노디스크
  "NESN": 92.00,    // 네슬레
  "SHEL": 34.00,    // 쉘
  "AZN": 78.00,     // 아스트라제네카
  "TTE": 65.00,     // 토탈에너지스

  // 주요 ETF 및 원자재/채권
  "SPY": 540.00,    // S&P 500 ETF
  "QQQ": 470.00,    // NASDAQ ETF
  "VOO": 495.00,    // Vanguard S&P ETF
  "GOLD": 2400.00,  // 금 선물
  "WTI": 78.50,     // 원유 선물
  "US10Y": 100.00,  // 미 10년 국채 액면
  "KR10Y": 100.00,  // 한국 10년 국채 액면
};

function alignToTickSize(price) {
  if (!price || price <= 0) return price;
  let tick = 1;
  if (price < 2000) tick = 1;
  else if (price < 5000) tick = 5;
  else if (price < 20000) tick = 10;
  else if (price < 50000) tick = 50;
  else if (price < 200000) tick = 100;
  else if (price < 500000) tick = 500;
  else tick = 1000;
  return Math.round(price / tick) * tick;
}

async function rebasePrices() {
  console.log("🔄 Starting stock price rebase & fair target calculation...");

  // 1. 전체 주식 데이터 가져오기
  const { data: stocks, error } = await supabase.from('stocks').select('*');
  if (error || !stocks) {
    console.error("❌ Failed to fetch stocks from Supabase:", error);
    process.exit(1);
  }

  console.log(`📊 Found ${stocks.length} stocks. Processing rebase...`);

  let updatedCount = 0;

  for (const stock of stocks) {
    const ticker = stock.ticker.toUpperCase();
    let fairTarget = FAIR_TARGET_PRICES[ticker];

    // 매핑 테이블에 없는 경우 시장/가격대에 따라 자동 산정
    if (!fairTarget) {
      if (stock.market === 'domestic') {
        fairTarget = stock.current_price > 0 ? stock.current_price : 50000;
      } else if (stock.market === 'overseas' || stock.market === 'europe') {
        fairTarget = stock.current_price > 0 ? stock.current_price : 150.0;
      } else if (stock.market === 'commodities') {
        fairTarget = stock.current_price > 0 ? stock.current_price : 100.0;
      } else if (stock.market === 'bonds') {
        fairTarget = 100.0;
      } else {
        fairTarget = stock.current_price > 0 ? stock.current_price : 10000;
      }
    }

    // 적정 주가(target_price)를 기준으로 ±1% 내에서 현재가/종가/시가/고가/저가를 리베이스 및 틱 정렬
    const isDomestic = stock.market === 'domestic' || stock.market === 'kr' || !stock.market;
    const rawRebased = +(fairTarget * (0.995 + Math.random() * 0.01)).toFixed(isDomestic ? 0 : 2);
    const rawPrevClose = +(fairTarget * (0.99 + Math.random() * 0.02)).toFixed(isDomestic ? 0 : 2);
    const rawOpenPrice = +(rawPrevClose * (0.998 + Math.random() * 0.004)).toFixed(isDomestic ? 0 : 2);
    const rawHigh = +Math.max(rawRebased, rawPrevClose, rawOpenPrice * 1.005).toFixed(isDomestic ? 0 : 2);
    const rawLow = +Math.min(rawRebased, rawPrevClose, rawOpenPrice * 0.995).toFixed(isDomestic ? 0 : 2);

    const rebasedPrice = isDomestic ? alignToTickSize(rawRebased) : rawRebased;
    const prevClose = isDomestic ? alignToTickSize(rawPrevClose) : rawPrevClose;
    const openPrice = isDomestic ? alignToTickSize(rawOpenPrice) : rawOpenPrice;
    const high = isDomestic ? alignToTickSize(rawHigh) : rawHigh;
    const low = isDomestic ? alignToTickSize(rawLow) : rawLow;

    const marketCap = isDomestic ? rebasedPrice * 100000000 : rebasedPrice * 10000000;

    const { error: updateError } = await supabase
      .from('stocks')
      .update({
        target_price: fairTarget,
        current_price: rebasedPrice,
        previous_close: prevClose,
        open_price: openPrice,
        high: high,
        low: low,
        market_cap: marketCap
      })
      .eq('id', stock.id);

    if (updateError) {
      console.error(`❌ Failed to update stock ${stock.name} (${ticker}):`, updateError);
    } else {
      updatedCount++;
    }
  }

  console.log(`✅ Successfully rebased and updated fair target prices for ${updatedCount} stocks.`);

  // 2. 주가 대폭 변동으로 인한 기존 오픈 주문(Stale Orders) 정리
  console.log("🧹 Clearing stale open orders to match new rebased prices...");
  const { error: clearOrdersError } = await supabase
    .from('orders')
    .delete()
    .eq('status', 'open');

  if (clearOrdersError) {
    console.error("⚠️ Failed to clear open orders:", clearOrdersError);
  } else {
    console.log("✅ Stale open orders cleared successfully.");
  }

  console.log("🎉 Rebase completed cleanly!");
}

rebasePrices();
