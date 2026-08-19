"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";

interface ThemeContextType {
  theme: ThemeMode;
  resolvedTheme: "light" | "dark";
  setTheme: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "system",
  resolvedTheme: "dark",
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>("system");
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    const savedTheme = (localStorage.getItem("stock_sys_theme_preference") as ThemeMode) || "system";
    setThemeState(savedTheme);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const updateResolvedTheme = (currentTheme: ThemeMode) => {
      let active: "light" | "dark";
      if (currentTheme === "system") {
        active = mediaQuery.matches ? "dark" : "light";
        document.documentElement.setAttribute("data-theme", "system");
      } else if (currentTheme === "light") {
        active = "light";
        document.documentElement.setAttribute("data-theme", "light");
      } else {
        active = "dark";
        document.documentElement.setAttribute("data-theme", "dark");
      }
      setResolvedTheme(active);
    };

    updateResolvedTheme(theme);

    const handleMediaChange = () => {
      if (theme === "system") {
        updateResolvedTheme("system");
      }
    };

    mediaQuery.addEventListener("change", handleMediaChange);
    return () => mediaQuery.removeEventListener("change", handleMediaChange);
  }, [theme]);

  const setTheme = (mode: ThemeMode) => {
    setThemeState(mode);
    localStorage.setItem("stock_sys_theme_preference", mode);
  };

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
