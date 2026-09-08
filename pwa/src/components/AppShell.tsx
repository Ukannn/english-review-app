import { BarChart3, BookOpen, CircleGauge, Inbox, Settings2, Wifi, WifiOff } from "lucide-react";
import type { ReactNode } from "react";

export type ViewId = "today" | "intake" | "analytics" | "library" | "status";
const navigation = [
  { id: "today", label: "今日学习", icon: CircleGauge },
  { id: "intake", label: "语料", icon: Inbox },
  { id: "analytics", label: "学习报告", icon: BarChart3 },
  { id: "library", label: "学习资料库", icon: BookOpen },
  { id: "status", label: "同步与设置", icon: Settings2 },
] as const;

export function AppShell({ activeView, onNavigate, children, online, demo, onSignOut }: {
  activeView: ViewId; onNavigate(view: ViewId): void; children: ReactNode;
  online: boolean; demo: boolean; onSignOut?(): void;
}) {
  return <div className="app-shell">
    <a className="skip-link" href="#learning-content" onClick={event => {event.preventDefault(); document.getElementById("learning-content")?.focus();}}>跳到页面内容</a>
    <aside className="sidebar" aria-label="主菜单">
      <div className="brand-lockup"><div className="brand-mark" aria-hidden="true"><img src="/logo-128.png" alt="" /></div><div><strong>English Lab</strong><span>我的英语复习空间</span></div></div>
      <nav className="sidebar-nav" aria-label="主导航">{navigation.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${activeView === id ? "is-active" : ""}`} aria-current={activeView === id ? "page" : undefined} onClick={() => onNavigate(id)}><Icon size={19} strokeWidth={1.8}/><span>{label}</span></button>)}</nav>
      <div className="sidebar-footer"><div className={`connection-pill ${online ? "is-online" : "is-offline"}`}>{online ? <Wifi size={15}/> : <WifiOff size={15}/>}<span>{online ? (demo ? "演示模式" : "网络在线") : "离线"}</span></div>{onSignOut && <button className="text-button" onClick={onSignOut}>退出登录</button>}</div>
    </aside>
    <main className="main-surface" id="learning-content" tabIndex={-1} lang="zh-CN">
      <header className="mobile-header"><div className="brand-lockup brand-lockup--compact"><div className="brand-mark" aria-hidden="true"><img src="/logo-128.png" alt=""/></div><strong>English Lab</strong></div><span className={`online-dot ${online ? "" : "is-offline"}`} role="status" aria-label={online ? (demo ? "演示模式" : "网络在线") : "离线"}/></header>
      <div className="content-wrap">{children}</div>
    </main>
    <nav className="bottom-nav" aria-label="移动端主导航">{navigation.map(({ id, label, icon: Icon }) => <button key={id} className={activeView === id ? "is-active" : ""} aria-current={activeView === id ? "page" : undefined} onClick={() => onNavigate(id)}><Icon size={21} strokeWidth={activeView === id ? 2.2 : 1.7}/><span>{label}</span></button>)}</nav>
  </div>;
}
