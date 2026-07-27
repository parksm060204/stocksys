import React from "react";

export default function GlassCard({
  children,
  className = "",
  hoverEffect = true,
}: {
  children: React.ReactNode;
  className?: string;
  hoverEffect?: boolean;
}) {
  return (
    <div 
      className={`
        bg-white/5 backdrop-blur-md border border-white/10 rounded-xl 
        ${hoverEffect ? "transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_16px_36px_rgba(0,0,0,0.45),0_0_20px_rgba(255,255,255,0.02)] hover:border-white/20" : ""}
        ${className}
      `}
    >
      {children}
    </div>
  );
}
