export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-6 w-32 rounded bg-[#222736]" />
        <div className="h-8 w-24 rounded-lg bg-[#1c2030]" />
      </div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-[#222736] bg-[#151821] p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-5 w-16 rounded bg-[#222736]" />
            <div className="h-4 w-10 rounded bg-[#1c2030]" />
          </div>
          <div className="h-4 w-3/4 rounded bg-[#222736]" />
          <div className="h-3 w-1/2 rounded bg-[#1c2030]" />
        </div>
      ))}
      <div className="flex items-center justify-center gap-2 pt-2 text-[12px] text-dim">
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#3182F6] border-t-transparent" />
        뉴스 불러오는 중...
      </div>
    </div>
  );
}
