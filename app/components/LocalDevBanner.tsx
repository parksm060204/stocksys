'use client';

import { useEffect, useState } from 'react';
import { isLocalStandaloneMode } from '@/lib/engine/localDevMode';

export default function LocalDevBanner() {
  const [isLocal, setIsLocal] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  useEffect(() => {
    const localActive = isLocalStandaloneMode();
    setIsLocal(localActive);

    if (localActive && typeof window !== 'undefined') {
      (window as any).__STOCKSYS_RESET_MARKET__ = async () => {
        console.log('🔄 [STOCKSYS] Resetting local market...');
        try {
          const res = await fetch('/api/local-db', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'reset_market' }),
          });
          const data = await res.json();
          console.log('✅ [STOCKSYS] Market reset complete:', data);
          window.location.reload();
        } catch (e) {
          console.error('❌ [STOCKSYS] Market reset failed:', e);
        }
      };
    }
  }, []);

  if (!isLocal) return null;

  const handleReset = async () => {
    if (isResetting) return;
    if (!confirm('로컬 시장 데이터를 초기 시드 상태로 리셋하시겠습니까?\n(예수금 1억 원 및 기본 보유 주식 상태로 복원됩니다)')) return;

    setIsResetting(true);
    try {
      await (window as any).__STOCKSYS_RESET_MARKET__();
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <aside aria-label="로컬 개발 모드 상태" className="fixed bottom-4 right-4 z-50 flex items-center gap-2.5 rounded-full border border-[#238636]/40 bg-[#0d1117]/95 px-4 py-2 shadow-2xl backdrop-blur-md">
      <span className="flex h-2.5 w-2.5 items-center justify-center">
        <span className="h-2 w-2 rounded-full bg-[#2ea043] animate-ping" />
      </span>
      <span className="font-mono text-[11px] font-bold tracking-wider text-[#3fb950] uppercase">
        Local Standalone
      </span>
      <span className="text-[#30363d]">|</span>
      <button
        onClick={handleReset}
        disabled={isResetting}
        className="cursor-pointer rounded-full bg-[#21262d] hover:bg-[#30363d] px-2.5 py-1 font-sans text-[10.5px] font-bold text-gray-300 hover:text-white transition-all active:scale-95 disabled:opacity-50"
      >
        {isResetting ? '리셋 중...' : '🔄 시장 리셋'}
      </button>
    </aside>
  );
}
