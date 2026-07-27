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
    <div className={`bg-[#151821] border border-[#222736] rounded-xl flex flex-col overflow-hidden ${className}`}>
      {title && (
        <div className="bg-[#12151e] border-b border-[#222736] px-4 py-2.5 text-[12px] font-semibold text-[#9ca3af] tracking-tight shrink-0 flex items-center justify-between">
          <span>{title}</span>
        </div>
      )}
      <div className={`flex-1 flex flex-col ${overflowClass}`}>
        {children}
      </div>
    </div>
  );
}
