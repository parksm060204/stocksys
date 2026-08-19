export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-5 animate-pulse">
      <div className="h-6 w-32 rounded bg-[#222736]" />
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-[#222736] bg-[#151821] p-6 space-y-3">
            <div className="h-5 w-36 rounded bg-[#222736]" />
            <div className="h-8 w-28 rounded-lg bg-[#222736]" />
            <div className="h-3 w-full rounded bg-[#1c2030]" />
            <div className="h-10 w-full rounded-lg bg-[#1c2030]" />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-center gap-2 pt-2 text-[12px] text-dim">
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#3182F6] border-t-transparent" />
        상점 불러오는 중...
      </div>
    </div>
  );
}
