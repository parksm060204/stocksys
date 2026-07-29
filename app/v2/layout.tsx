import React from "react";
import V2Navbar from "@/app/components/v2/V2Navbar";
import V2VersionToggle from "@/app/components/v2/V2VersionToggle";

export const metadata = {
  title: "Antigravity Fintech V2",
  description: "Next-Gen Minimal Dark Fintech Terminal (V2 Beta)",
};

export default function V2Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0C0E12] text-[#F3F4F6] font-sans antialiased selection:bg-[#3182F6]/30 selection:text-white">
      {/* V2 Header Navbar */}
      <V2Navbar />

      {/* V2 Main Content Area — fluid, child controls padding/height */}
      <main className="w-full">{children}</main>

      {/* Floating V1 / V2 Version Switcher */}
      <V2VersionToggle />
    </div>
  );
}
