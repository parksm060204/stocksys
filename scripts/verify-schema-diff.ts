import * as fs from 'fs';
import * as path from 'path';

/**
 * SQL 파일들에서 CREATE TABLE 및 ALTER TABLE 컬럼 정의 파싱
 */
function parseAllSqlSchemas(): Map<string, Set<string>> {
  const tableMap = new Map<string, Set<string>>();
  const sqlFiles: string[] = [];

  const addDirSqls = (dir: string) => {
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach((file) => {
        if (file.endsWith('.sql')) {
          sqlFiles.push(path.join(dir, file));
        }
      });
    }
  };

  addDirSqls(path.resolve(process.cwd(), 'vm-db/sql/init'));
  addDirSqls(path.resolve(process.cwd(), 'supabase'));
  addDirSqls(path.resolve(process.cwd(), 'supabase/migrations'));

  for (const filePath of sqlFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    let currentTable: string | null = null;
    let currentCols: Set<string> = new Set();
    let inAlterTable = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // CREATE TABLE
      const createMatch = trimmed.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-zA-Z0-9_]+)\s*\(/i);
      if (createMatch && createMatch[1]) {
        if (currentTable) {
          if (!tableMap.has(currentTable)) tableMap.set(currentTable, new Set());
          for (const col of currentCols) tableMap.get(currentTable)!.add(col);
        }
        currentTable = createMatch[1].toLowerCase();
        currentCols = new Set();
        continue;
      }

      // ALTER TABLE
      const alterTableMatch = trimmed.match(/ALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?([a-zA-Z0-9_]+)/i);
      if (alterTableMatch && alterTableMatch[1]) {
        currentTable = alterTableMatch[1].toLowerCase();
        inAlterTable = true;
      }

      if (inAlterTable && currentTable) {
        const colMatches = Array.from(trimmed.matchAll(/(?:ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?|ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?)([a-zA-Z0-9_]+)\s+/gi));
        for (const m of colMatches) {
          if (m[1]) {
            if (!tableMap.has(currentTable)) tableMap.set(currentTable, new Set());
            tableMap.get(currentTable)!.add(m[1].toLowerCase());
          }
        }
        if (trimmed.endsWith(';')) {
          inAlterTable = false;
          currentTable = null;
        }
      }

      if (currentTable && !inAlterTable) {
        if (trimmed.startsWith(');')) {
          if (!tableMap.has(currentTable)) tableMap.set(currentTable, new Set());
          for (const col of currentCols) tableMap.get(currentTable)!.add(col);
          currentTable = null;
          currentCols = new Set();
          continue;
        }

        if (
          !trimmed.startsWith('--') &&
          !trimmed.startsWith('PRIMARY') &&
          !trimmed.startsWith('CONSTRAINT') &&
          !trimmed.startsWith('UNIQUE') &&
          !trimmed.startsWith('FOREIGN') &&
          !trimmed.startsWith('CHECK')
        ) {
          const colMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s+/);
          if (colMatch && colMatch[1]) {
            currentCols.add(colMatch[1].toLowerCase());
          }
        }
      }
    }

    if (currentTable && !inAlterTable) {
      if (!tableMap.has(currentTable)) tableMap.set(currentTable, new Set());
      for (const col of currentCols) tableMap.get(currentTable)!.add(col);
    }
  }

  return tableMap;
}

const MEMORY_STORE_ENTITIES: Record<string, string[]> = {
  profiles: [
    'id', 'username', 'nickname', 'cash', 'net_worth', 'rank_tier', 'created_at'
  ],
  holdings: [
    'id', 'user_id', 'stock_id', 'quantity', 'avg_price', 'created_at'
  ],
  orders: [
    'id', 'stock_id', 'user_id', 'side', 'price', 'size', 'filled', 'status', 'is_lp', 'created_at'
  ],
  trades: [
    'id', 'stock_id', 'buyer_id', 'seller_id', 'buyer_is_bot', 'seller_is_bot', 'price', 'size', 'created_at'
  ],
  options_contracts: [
    'id', 'underlying_stock_id', 'ticker', 'asset_class', 'type', 'option_type',
    'strike_price', 'current_price', 'expiry_date', 'open_interest', 'volume',
    'delta', 'gamma', 'theta', 'implied_volatility', 'created_at'
  ],
  bonds: [
    'id', 'ticker', 'name', 'bond_type', 'maturity', 'coupon_rate', 'face_value', 'current_price', 'ytm', 'duration', 'volume'
  ],
  market_news: [
    'id', 'type', 'category', 'publisher', 'title', 'content', 'target_sector', 'target_ticker', 'impact_score', 'is_fake', 'created_at'
  ],
  option_settlements: [
    'id', 'option_id', 'user_id', 'underlying_stock_id', 'option_type',
    'strike_price', 'underlying_close_price', 'is_itm', 'quantity',
    'multiplier', 'payout_amount', 'idempotency_key', 'settled_at', 'created_at'
  ],
  bond_coupon_payments: [
    'id', 'bond_id', 'user_id', 'payment_type', 'coupon_rate',
    'face_value', 'quantity', 'payment_amount', 'idempotency_key', 'payment_date', 'created_at'
  ],
  stocks: [
    'id', 'ticker', 'name', 'market', 'current_price', 'previous_close', 'open_price', 'volume', 'market_cap', 'sector'
  ],
  commodities: [
    'id', 'commodity_id', 'ticker', 'name', 'category', 'current_price', 'previous_close', 'unit', 'tick_size', 'volume'
  ],
};

async function runSchemaDiffVerification() {
  console.log('================================================================');
  console.log('🔍 [SCHEMA DIFF] vm-db (PostgreSQL) vs In-Memory Store 정합성 검증');
  console.log('================================================================\n');

  const sqlTables = parseAllSqlSchemas();
  let totalMismatches = 0;
  let verifiedTableCount = 0;

  for (const [tableName, memoryCols] of Object.entries(MEMORY_STORE_ENTITIES)) {
    const dbCols = sqlTables.get(tableName.toLowerCase());
    verifiedTableCount++;

    console.log(`▶ [테이블: ${tableName}]`);
    if (!dbCols) {
      console.log(`  - ⚠️ vm-db DDL에 '${tableName}' 테이블 정의 없음`);
      totalMismatches++;
      continue;
    }

    const missingInDb: string[] = [];

    for (const col of memoryCols) {
      if (!dbCols.has(col.toLowerCase())) {
        missingInDb.push(col);
      }
    }

    if (missingInDb.length === 0) {
      console.log(`  - vm-db ↔ memoryStore 컬럼 정합성: ✅ 100% 완벽 일치 (${memoryCols.length}개 컬럼 확인)`);
    } else {
      console.log(`  - ⚠️ DB에 누락된 메모리 필드: ${missingInDb.join(', ')}`);
      totalMismatches += missingInDb.length;
    }
  }

  console.log('\n================================================================');
  if (totalMismatches === 0) {
    console.log(`🏁 [최종 결과] 스키마 정합성 검증: 전체 ${verifiedTableCount}개 엔티티 100% 완벽 일치 ✅`);
  } else {
    console.log(`🏁 [최종 결과] 스키마 정합성 검증: 총 ${totalMismatches}건의 불일치 발견 ⚠️`);
  }
  console.log('================================================================\n');
}

runSchemaDiffVerification().catch(console.error);
