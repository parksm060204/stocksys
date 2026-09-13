"use client";

import React, { useState, useRef, useEffect } from "react";
import { useTheme } from "./ThemeProvider";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  // 현재 선택된 테마에 맞는 단일 아이콘 반환
  const renderCurrentIcon = () => {
    if (theme === "system") {
      return (
        <svg
          className="h-4 w-4 text-[#8E939D] group-hover:text-white transition-colors"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
      );
    }
    if (theme === "light") {
      return (
        <svg
          className="h-4 w-4 text-amber-400 group-hover:text-amber-300 transition-colors"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
      );
    }
    return (
      <svg
        className="h-4 w-4 text-indigo-400 group-hover:text-indigo-300 transition-colors"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
        />
      </svg>
    );
  };

  const getThemeTitle = () => {
    if (theme === "system") return `시스템 (${resolvedTheme === "dark" ? "다크" : "라이트"})`;
    if (theme === "light") return "해 (라이트 모드)";
    return "달 (다크 모드)";
  };

  return (
    <div className={`relative inline-block select-none ${className}`} ref={dropdownRef}>
      {/* 1. 단일 아이콘 토글 버튼 */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`group flex h-7 w-7 items-center justify-center rounded-lg border transition-all duration-150 cursor-pointer ${
          isOpen
            ? "border-[#F04452] bg-[#1F242C] shadow-[0_0_8px_rgba(240,68,82,0.3)] ring-1 ring-[#F04452]"
            : "border-border bg-[#161B22] hover:border-[#384050] hover:bg-[#1E232B] shadow-sm"
        }`}
        title={`테마: ${getThemeTitle()}`}
        aria-label="테마 변경 드롭다운"
        aria-expanded={isOpen}
      >
        {renderCurrentIcon()}
      </button>

      {/* 2. 드롭다운 팝오버 메뉴 (시스템 / 해 / 달) */}
      {isOpen && (
        <div className="absolute right-0 mt-1.5 w-36 rounded-xl border border-border bg-[#0E1117]/95 backdrop-blur-md p-1 shadow-2xl z-50 animate-in fade-in duration-100 flex flex-col gap-0.5">
          {/* 옵션 1: 시스템 */}
          <button
            type="button"
            onClick={() => {
              setTheme("system");
              setIsOpen(false);
            }}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors cursor-pointer ${
              theme === "system"
                ? "bg-[#1E232B] text-white font-bold"
                : "text-[#8E939D] hover:bg-[#161B22] hover:text-white"
            }`}
          >
            <div className="flex items-center gap-2">
              <svg className="h-3.5 w-3.5 text-[#8E939D]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <span>시스템</span>
            </div>
            {theme === "system" && <span className="text-up text-xs font-bold">✓</span>}
          </button>

          {/* 옵션 2: 해 (라이트 모드) */}
          <button
            type="button"
            onClick={() => {
              setTheme("light");
              setIsOpen(false);
            }}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors cursor-pointer ${
              theme === "light"
                ? "bg-amber-500/15 text-amber-400 font-bold"
                : "text-[#8E939D] hover:bg-[#161B22] hover:text-amber-400"
            }`}
          >
            <div className="flex items-center gap-2">
              <svg className="h-3.5 w-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              <span>해 (라이트)</span>
            </div>
            {theme === "light" && <span className="text-amber-400 text-xs font-bold">✓</span>}
          </button>

          {/* 옵션 3: 달 (다크 모드) */}
          <button
            type="button"
            onClick={() => {
              setTheme("dark");
              setIsOpen(false);
            }}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors cursor-pointer ${
              theme === "dark"
                ? "bg-indigo-500/15 text-indigo-300 font-bold"
                : "text-[#8E939D] hover:bg-[#161B22] hover:text-indigo-300"
            }`}
          >
            <div className="flex items-center gap-2">
              <svg className="h-3.5 w-3.5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
              <span>달 (다크)</span>
            </div>
            {theme === "dark" && <span className="text-indigo-400 text-xs font-bold">✓</span>}
          </button>
        </div>
      )}
    </div>
  );
}

