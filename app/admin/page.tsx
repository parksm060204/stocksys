export default function AdminPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-6 text-center">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-tx">관리자 페이지</h1>
        <p className="text-[13px] text-muted">웹소설 기입 · 신규 상장 · 상장폐지 · 주식 병합 · 세력 관리</p>
      </div>

      <div className="rounded-xl border border-border bg-panel p-10">
        <h2 className="text-lg font-semibold text-tx">🛠️ 백엔드 이전 중 (Migrating to Backend)</h2>
        <p className="mt-2 text-[14px] text-dim">
          현재 프론트엔드 최적화 및 Supabase 연동 작업으로 인해 관리자 기능이 일시적으로 비활성화되었습니다.
          <br />
          Engine Server에 API가 구축되는 대로 관리자 기능이 다시 활성화될 예정입니다.
        </p>
      </div>
    </div>
  );
}
