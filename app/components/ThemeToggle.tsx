"use client";

import React, { useState, useRef, useEffect } from "react";
import { useTheme } from "./ThemeProvider";

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const getIcon = () => {
    if (theme === "system") {
      return (
        <svg className="h-4 w-4 text-[#8E939D]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      );
    }
    if (theme === "light") {
      return (
        <svg className="h-4 w-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      );
    }
    return (
      <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
      </svg>
    );
  };

  const getLabel = () => {
    if (theme === "system") return `시스템 (${resolvedTheme === 'dark' ? '다크' : '라이트'})`;
    if (theme === "light") return "라이트 모드";
    return "다크 모드";
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-xl border border-[#212631] bg-[#161B22] px-3 py-1.5 text-[12px] font-medium text-[#8E939D] transition-all hover:border-amber-400/50 hover:text-white cursor-pointer shadow-sm select-none"
        title="테마 설정 (시스템 환경 추종 / 라이트 / 다크)"
      >
        {getIcon()}
        <span className="hidden sm:inline font-sans text-[11.5px] font-bold">{getLabel()}</span>
        <svg className="h-3 w-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 rounded-2xl border border-[#212631] bg-[#0E1117] p-1.5 shadow-2xl z-50 text-xs font-sans space-y-1">
          <button
            onClick={() => { setTheme("system"); setIsOpen(false); }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-colors cursor-pointer ${
              theme === "system" ? "bg-[#161B22] text-amber-400 font-extrabold" : "text-[#8E939D] hover:bg-[#161B22] hover:text-white"
            }`}
          >
            <svg className="h-4 w-4 shrink-0 text-[#8E939D]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <div className="flex flex-col">
              <span className="font-bold">💻 시스템 설정</span>
              <span className="text-[9.5px] opacity-70">OS 환경 자동추종</span>
            </div>
          </button>

          <button
            onClick={() => { setTheme("light"); setIsOpen(false); }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-colors cursor-pointer ${
              theme === "light" ? "bg-[#161B22] text-amber-400 font-extrabold" : "text-[#8E939D] hover:bg-[#161B22] hover:text-white"
            }`}
          >
            <svg className="h-4 w-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <div className="flex flex-col">
              <span className="font-bold">☀️ 라이트 모드</span>
              <span className="text-[9.5px] opacity-70">밝은 테마</span>
            </div>
          </button>

          <button
            onClick={() => { setTheme("dark"); setIsOpen(false); }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-colors cursor-pointer ${
              theme === "dark" ? "bg-[#161B22] text-amber-400 font-extrabold" : "text-[#8E939D] hover:bg-[#161B22] hover:text-white"
            }`}
          >
            <svg className="h-4 w-4 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
            <div className="flex flex-col">
              <span className="font-bold">🌙 다크 모드</span>
              <span className="text-[9.5px] opacity-70">어두운 테마</span>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
