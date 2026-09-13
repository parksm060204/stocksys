export default function Loading() {
  return (
    <div className="h-screen w-full bg-bg text-tx flex flex-col p-2 overflow-hidden animate-pulse">
      {/* Breadcrumb */}
      <div className="mb-2 flex items-center gap-2 px-2">
        <div className="h-3 w-12 rounded bg-panel2" />
        <div className="h-3 w-3 rounded bg-panel2" />
        <div className="h-3 w-16 rounded bg-panel2" />
        <div className="h-3 w-3 rounded bg-panel2" />
        <div className="h-3 w-20 rounded bg-panel2" />
      </div>
      {/* Header */}
      <div className="mb-3 flex items-end justify-between border-b border-border pb-2 px-2">
        <div className="space-y-2">
          <div className="h-7 w-40 rounded bg-panel2" />
          <div className="h-3 w-64 rounded bg-panel2" />
        </div>
        <div className="h-10 w-48 rounded bg-panel2" />
      </div>
      {/* Content grid */}
      <div className="flex-1 grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-panel border border-border" />
        <div className="rounded-xl bg-panel border border-border" />
        <div className="rounded-xl bg-panel border border-border" />
      </div>
    </div>
  );
}
