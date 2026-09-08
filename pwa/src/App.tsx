import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell, type ViewId } from "./components/AppShell";
import { AuthGate } from "./components/AuthGate";
import { TodayView } from "./components/TodayView";
import { AnalyticsView } from "./components/AnalyticsView";
import { SettingsView } from "./components/SettingsView";
import { LibraryWorkspace, ContextView } from "./components/LibraryViews";
import { api, supabase } from "./lib/api";
import type { ApiClient, DashboardData, ReviewBootstrap } from "./lib/contracts";
import { demoApi } from "./lib/demoApi";
import { clearAllRecovery } from "./lib/recovery";

function routeFromHash(): ViewId {
  const route = location.hash.replace(/^#\/?/, "").split("/")[0];
  return ["today", "intake", "analytics", "library", "status"].includes(route) ? route as ViewId : "today";
}
export function App() {
  const demo = import.meta.env.VITE_DEMO_MODE === "true";
  const client = useMemo(() => demo ? demoApi : api, [demo]);
  return <AuthGate demo={demo}><LearningApp client={client} demo={demo} /></AuthGate>;
}

export function LearningApp({ client, demo }: { client: ApiClient; demo: boolean }) {
  const [view, setView] = useState<ViewId>(routeFromHash);
  const [online, setOnline] = useState(navigator.onLine);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [bootstrap, setBootstrap] = useState<ReviewBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // The queue must be ready before dashboard totals are read.
      setBootstrap(await client.getReviewBootstrap());
      setDashboard(await client.getDashboard());
    } catch (caught) { setError(caught instanceof Error ? caught.message : "内容加载失败，请重试。"); }
    finally { setLoading(false); }
  }, [client]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const hash = () => setView(routeFromHash());
    const connection = () => setOnline(navigator.onLine);
    window.addEventListener("hashchange", hash); window.addEventListener("online", connection); window.addEventListener("offline", connection);
    return () => { window.removeEventListener("hashchange", hash); window.removeEventListener("online", connection); window.removeEventListener("offline", connection); };
  }, []);
  function navigate(next: ViewId) {
    location.hash = next; setView(next); window.scrollTo({ top: 0, behavior: "instant" });
  }
  async function signOut() {
    try { const result = await supabase?.auth.signOut(); if (result?.error) throw result.error; await clearAllRecovery(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "退出失败，请重试。"); }
  }
  return <AppShell activeView={view} onNavigate={navigate} online={online} demo={demo} onSignOut={demo ? undefined : () => void signOut()}>
    {error && <div className="notice notice--red" role="alert"><span>{error}</span><button className="text-button" onClick={() => void refresh()}>重试</button></div>}
    {/* Keep the active question mounted when visiting another top-level page. */}
    <div hidden={view !== "today"}><TodayView key={bootstrap?.queueId ?? bootstrap?.learningDate ?? "loading"} client={client} bootstrap={bootstrap} dashboard={dashboard} loading={loading} demo={demo} online={online} onRefresh={refresh} onNavigate={navigate}/></div>
    {view === "intake" && <ContextView client={client}/>}
    {view === "analytics" && <AnalyticsView dashboard={dashboard} loading={loading} onRefresh={refresh}/>}
    {view === "library" && <LibraryWorkspace client={client} onGenerate={() => navigate("status")}/>}
    {view === "status" && <SettingsView client={client} demo={demo} onSignOut={signOut} onChanged={refresh}/>}
  </AppShell>;
}
