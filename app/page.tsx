import Dashboard from "@/components/Dashboard";

// 매 요청마다 최신 파일을 읽도록 (정적 캐시 방지)
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <main className="wrap">
      <div className="page-head">
        <h1>취업 상황판</h1>
        <p>
          <code>data/ranked-jobs.json</code> 을 읽어 등급·점수로 정리하고, 지원상태를{" "}
          <code>data/status.json</code> 에 저장합니다.
        </p>
      </div>
      <Dashboard />
    </main>
  );
}
