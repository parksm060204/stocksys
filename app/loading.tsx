export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-10 space-y-8 animate-pulse">
      {/* Hero skeleton */}
      <div className="rounded-2xl border border-[#222736] bg-[#151821] p-8 md:p-12">
        <div className="max-w-3xl space-y-4">
          <div className="h-5 w-48 rounded bg-[#222736]" />
          <div className="h-9 w-80 rounded bg-[#222736]" />
          <div className="h-4 w-full max-w-xl rounded bg-[#1c2030]" />
          <div className="flex gap-3 pt-2">
            <div className="h-10 w-36 rounded-xl bg-[#222736]" />
            <div className="h-10 w-32 rounded-xl bg-[#1c2030]" />
          </div>
        </div>
      </div>
      {/* Cards skeleton */}
      <div className="grid gap-4 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-[#222736] bg-[#151821] p-5 space-y-3">
            <div className="h-3 w-16 rounded bg-[#222736]" />
            <div className="h-5 w-40 rounded bg-[#222736]" />
            <div className="h-3 w-full rounded bg-[#1c2030]" />
          </div>
        ))}
      </div>
    </div>
  );
}
