import React from "react";

interface V2CardProps {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export default function V2Card({ title, subtitle, action, children, className = "" }: V2CardProps) {
  return (
    <div className={`rounded-2xl bg-[#151821] border border-white/5 p-5 shadow-sm transition-all hover:border-white/10 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-2 border-b border-white/5 pb-3">
          <div>
            {title && <h3 className="font-bold text-white text-[15px] tracking-tight">{title}</h3>}
            {subtitle && <p className="text-[12px] text-[#9CA3AF] mt-0.5">{subtitle}</p>}
          </div>
          {action && <div>{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
