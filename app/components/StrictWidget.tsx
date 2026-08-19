import React from "react";

export default function StrictWidget({
  children,
  className = "",
  title,
  overflowClass = "overflow-auto"
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  overflowClass?: string;
}) {
  return (
    <div className={`bg-[#0E1117] border border-[#212631] rounded-2xl flex flex-col overflow-hidden shadow-xl ${className}`}>
      {title && (
        <div className="bg-[#090B0F] border-b border-[#212631] px-5 py-3 text-[13px] font-mono font-black text-white tracking-tight shrink-0 flex items-center justify-between">
          <span>{title}</span>
        </div>
      )}
      <div className={`flex-1 flex flex-col ${overflowClass}`}>
        {children}
      </div>
    </div>
  );
}

