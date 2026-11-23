'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/db/client';
import { useAuth } from '@/lib/auth/useAuth';
import { useToast } from './ToastProvider';
import { getBondQuoteMultiplierToKrw, isUsdQuotedAsset } from '@/lib/engine/currency';
import { fmtPrice } from '@/lib/format';

type AssetDisplayInfo = {
  name: string;
  ticker: string;
  market: string;
  unitLabel: string;
  notionalMultiplier: number;
};

export default function TradeNotifier() {
  const { userId, isLoggedIn } = useAuth();
  const { showToast } = useToast();
  const processedTradesRef = useRef<Set<string>>(new Set());
  const lastCheckTimeRef = useRef<string>('');
  const isInitialMountRef = useRef<boolean>(true);
  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoggedIn || !userId) {
      processedTradesRef.current.clear();
      lastCheckTimeRef.current = '';
      isInitialMountRef.current = true;
      lastUserIdRef.current = null;
      return;
    }

    if (lastUserIdRef.current !== userId) {
      processedTradesRef.current.clear();
      lastCheckTimeRef.current = new Date(Date.now() - 5000).toISOString();
      isInitialMountRef.current = true;
      lastUserIdRef.current = userId;
    } else if (!lastCheckTimeRef.current) {
      lastCheckTimeRef.current = new Date(Date.now() - 5000).toISOString();
    }

    const db = createClient();
    let isSubscribed = true;

    // 종목/옵션/채권 캐시 맵
    const assetCache = new Map<string, AssetDisplayInfo>();

    const getAssetInfo = async (assetId: string): Promise<AssetDisplayInfo> => {
      if (assetCache.has(assetId)) return assetCache.get(assetId)!;

      const { data: stockData } = await db
        .from('stocks')
        .select('name, ticker, market')
        .eq('id', assetId)
        .maybeSingle();
      if (stockData) {
        const info: AssetDisplayInfo = {
          name: stockData.name,
          ticker: stockData.ticker,
          market: stockData.market,
          unitLabel: '주',
          notionalMultiplier: 1,
        };
        assetCache.set(assetId, info);
        return info;
      }

      const { data: optionData } = await db
        .from('options_contracts')
        .select('ticker, multiplier')
        .eq('id', assetId)
        .maybeSingle();
      if (optionData) {
        const info: AssetDisplayInfo = {
          name: optionData.ticker || '옵션 계약',
          ticker: optionData.ticker || 'OPT',
          market: 'options',
          unitLabel: '계약',
          notionalMultiplier: Number(optionData.multiplier || 250000),
        };
        assetCache.set(assetId, info);
        return info;
      }

      const { data: bondData } = await db
        .from('bonds')
        .select('name, ticker, face_value, quote_base, current_price')
        .eq('id', assetId)
        .maybeSingle();
      if (bondData) {
        const info: AssetDisplayInfo = {
          name: bondData.name || bondData.ticker || '채권',
          ticker: bondData.ticker || 'BOND',
          market: 'bonds',
          unitLabel: '좌',
          notionalMultiplier: getBondQuoteMultiplierToKrw(bondData),
        };
        assetCache.set(assetId, info);
        return info;
      }

      return { name: '자산', ticker: 'ASSET', market: 'domestic', unitLabel: '주', notionalMultiplier: 1 };
    };

    const pollNewTrades = async () => {
      if (!isSubscribed) return;

      try {
        // 내가 매수자이거나 매도자인 최근 체결건 조회 (상대방 ID 노출 없이 서버 세션 기준)
        const { data: myTrades, error } = await db.rpc('get_my_recent_trades', {
          p_after: lastCheckTimeRef.current,
          p_limit: 20,
        });

        if (error) throw error;

        if (myTrades && myTrades.length > 0) {
          for (const t of myTrades) {
            if (processedTradesRef.current.has(t.id)) continue;
            processedTradesRef.current.add(t.id);

            // 초기 마운트 시의 과거 데이터는 알림을 띄우지 않고 ID만 등록
            if (!isInitialMountRef.current) {
              const isBuyer = Boolean(t.is_buyer);
              const asset = await getAssetInfo(t.stock_id);
              const p = Number(t.price);
              const s = Number(t.size);
              const totalVal = p * s * asset.notionalMultiplier;

              const isUsd = isUsdQuotedAsset(asset);
              const priceFmt = fmtPrice(p, asset.market as any, asset.ticker);
              const totalFmt = isUsd ? `$${totalVal.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : `₩${Math.round(totalVal).toLocaleString()}`;

              if (isBuyer) {
                showToast({
                  type: 'buy',
                  title: `${asset.name} ${s.toLocaleString()}${asset.unitLabel} 매수 체결`,
                  description: `체결가: ${priceFmt} · 총 ${totalFmt}`,
                  duration: 5000,
                });
              } else {
                showToast({
                  type: 'sell',
                  title: `${asset.name} ${s.toLocaleString()}${asset.unitLabel} 매도 체결`,
                  description: `체결가: ${priceFmt} · 총 ${totalFmt}`,
                  duration: 5000,
                });
              }
            }
          }

          // 최신 시각 갱신
          const latest = myTrades[myTrades.length - 1];
          if (latest && latest.created_at) {
            lastCheckTimeRef.current = latest.created_at;
          }
        }

        isInitialMountRef.current = false;
      } catch {
        // 백그라운드 폴링 에러 무시
      }
    };

    // 최초 1회 즉시 실행
    pollNewTrades();

    // 2.5초 간격 체결 폴링
    const intervalId = setInterval(pollNewTrades, 2500);

    return () => {
      isSubscribed = false;
      clearInterval(intervalId);
    };
  }, [isLoggedIn, userId, showToast]);

  return null;
}
