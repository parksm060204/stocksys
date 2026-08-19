export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-5 animate-pulse">
      <div className="h-6 w-48 rounded bg-[#222736]" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-[#222736] bg-[#151821] p-5 space-y-3">
            <div className="h-4 w-20 rounded bg-[#222736]" />
            <div className="h-6 w-32 rounded bg-[#222736]" />
            <div className="h-3 w-full rounded bg-[#1c2030]" />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-center gap-2 pt-2 text-[12px] text-dim">
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#3182F6] border-t-transparent" />
        원자재 데이터 불러오는 중...
      </div>
    </div>
  );
}
