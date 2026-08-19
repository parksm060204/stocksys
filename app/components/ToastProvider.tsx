'use client';

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

export type ToastType = 'buy' | 'sell' | 'success' | 'warn' | 'info' | 'error';

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  type?: ToastType;
  duration?: number;
}

interface ToastContextType {
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    ({ title, description, type = 'info', duration = 4500 }: Omit<ToastMessage, 'id'>) => {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const newToast: ToastMessage = { id, title, description, type, duration };

      setToasts((prev) => [...prev.slice(-4), newToast]); // 최대 5개 동시 노출

      if (duration > 0) {
        setTimeout(() => {
          removeToast(id);
        }, duration);
      }
    },
    [removeToast]
  );

  const contextValue = useMemo(() => ({ showToast, removeToast }), [showToast, removeToast]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div className="fixed top-16 right-4 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

function ToastItem({ toast, onClose }: { toast: ToastMessage; onClose: () => void }) {
  const getBadgeStyle = (type?: ToastType) => {
    switch (type) {
      case 'buy':
        return {
          badgeBg: 'bg-[#F04452]/15 text-[#F04452] border-[#F04452]/40',
          barColor: 'bg-[#F04452]',
          icon: '📈',
          label: '매수 체결',
        };
      case 'sell':
        return {
          badgeBg: 'bg-[#3182F6]/15 text-[#3182F6] border-[#3182F6]/40',
          barColor: 'bg-[#3182F6]',
          icon: '📉',
          label: '매도 체결',
        };
      case 'success':
        return {
          badgeBg: 'bg-[#00C853]/15 text-[#00C853] border-[#00C853]/40',
          barColor: 'bg-[#00C853]',
          icon: '✅',
          label: '성공',
        };
      case 'warn':
        return {
          badgeBg: 'bg-amber-400/15 text-amber-400 border-amber-400/40',
          barColor: 'bg-amber-400',
          icon: '⚠️',
          label: '주의',
        };
      case 'error':
        return {
          badgeBg: 'bg-rose-500/15 text-rose-500 border-rose-500/40',
          barColor: 'bg-rose-500',
          icon: '🚫',
          label: '오류',
        };
      case 'info':
      default:
        return {
          badgeBg: 'bg-cyan-400/15 text-cyan-400 border-cyan-400/40',
          barColor: 'bg-cyan-400',
          icon: '💡',
          label: '알림',
        };
    }
  };

  const style = getBadgeStyle(toast.type);

  return (
    <div className="pointer-events-auto rounded-2xl border border-[#212631] bg-[#0E1117]/95 backdrop-blur-md p-4 shadow-2xl transition-all animate-in fade-in slide-in-from-top-4 duration-300 font-sans overflow-hidden relative">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="text-lg leading-none mt-0.5">{style.icon}</span>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className={`inline-block px-1.5 py-0.2 text-[10px] font-mono font-bold rounded border ${style.badgeBg}`}>
                {style.label}
              </span>
              <h4 className="text-[13px] font-bold text-white tracking-tight">{toast.title}</h4>
            </div>
            {toast.description && (
              <p className="text-[12px] text-[#8E939D] font-mono leading-snug">{toast.description}</p>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-[#565A63] hover:text-white transition-colors text-sm p-0.5 cursor-pointer shrink-0"
          aria-label="닫기"
        >
          ✕
        </button>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#212631]/50 overflow-hidden">
        <div
          className={`h-full ${style.barColor} animate-[shrink_linear_forwards]`}
          style={{ animationDuration: `${toast.duration ?? 4500}ms` }}
        />
      </div>
    </div>
  );
}
