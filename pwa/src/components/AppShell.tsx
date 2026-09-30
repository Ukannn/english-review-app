import { BarChart3, BookOpen, CircleGauge, History, Inbox, Settings2, Wifi, WifiOff } from "lucide-react";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { ThemeControl } from "./ThemeControl";

export type ViewId = "today" | "intake" | "analytics" | "history" | "library" | "status";
const navigation = [
  { id: "today", label: "今日学习", icon: CircleGauge },
  { id: "intake", label: "语料", icon: Inbox },
  { id: "analytics", label: "学习报告", icon: BarChart3 },
  { id: "history", label: "学习记录", icon: History },
  { id: "library", label: "学习资料库", icon: BookOpen },
  { id: "status", label: "同步与设置", icon: Settings2 },
] as const;
const compactNavigation = [
  { id: "today", label: "今日", icon: CircleGauge },
  { id: "analytics", label: "报告", icon: BarChart3 },
  { id: "history", label: "记录", icon: History },
  { id: "library", label: "资料", icon: BookOpen },
  { id: "status", label: "设置", icon: Settings2 },
] as const;

export function AppShell({ activeView, onNavigate, children, online, demo, onSignOut }: {
  activeView: ViewId; onNavigate(view: ViewId): void; children: ReactNode;
  online: boolean; demo: boolean; onSignOut?(): void;
}) {
  const label = navigation.find(item => item.id === activeView)?.label;
  const toolbar = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!toolbar.current) return;
    const measure = () => document.documentElement.style.setProperty("--app-toolbar-height", `${Math.ceil(toolbar.current!.getBoundingClientRect().height)}px`);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(toolbar.current);
    return () => { observer?.disconnect(); document.documentElement.style.removeProperty("--app-toolbar-height"); };
  }, []);
  return <div className="app-shell sample-shell">
    <header ref={toolbar} className="sample-toolbar"><span>{demo ? "交互预览 / 示例数据，不影响正式学习记录" : "English Learning Lab"}</span><ThemeControl/></header>
    <a className="skip-link" href="#learning-content" onClick={event => {event.preventDefault(); document.getElementById("learning-content")?.focus();}}>跳到页面内容</a>
    <aside className="sidebar" aria-label="主菜单">
      <div className="brand-lockup sample-brand"><span className="brand-icon" aria-hidden="true">ll<span>•</span></span><div><strong>Learning<br/>Lab</strong><span>ENGLISH</span></div></div>
      <div className="nav-label">我的学习</div>
      <nav className="sidebar-nav" aria-label="主导航">{navigation.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${activeView === id ? "is-active" : ""}`} aria-current={activeView === id ? "page" : undefined} onClick={() => onNavigate(id)}><Icon size={19} strokeWidth={1.8}/><span>{label}</span></button>)}</nav>
      <div className="sidebar-footer"><div className={`connection-pill ${online ? "is-online" : "is-offline"}`}>{online ? <Wifi size={15}/> : <WifiOff size={15}/>}<span>{online ? (demo ? "演示模式 · 示例数据" : "网络在线") : "离线"}</span></div>{onSignOut && <button className="text-button" onClick={onSignOut}>退出登录</button>}</div>
    </aside>
    <main className="main-surface" id="learning-content" tabIndex={-1} lang="zh-CN">
      <header className="mobile-header"><div className="brand-lockup brand-lockup--compact"><div className="brand-mark" aria-hidden="true"><img src="/logo-128.png" alt=""/></div><strong>English Lab</strong></div><span className={`online-dot ${online ? "" : "is-offline"}`} role="status" aria-label={online ? (demo ? "演示模式" : "网络在线") : "离线"}/></header>
      <div className="content-wrap"><div className="topline"><span>我的学习 <b>/ {label}</b></span><span>{demo ? "示例 · " : ""}英语</span></div>{children}</div>
    </main>
    <nav className="bottom-nav" aria-label="移动端主导航">{compactNavigation.map(({ id, label, icon: Icon }) => <button key={id} aria-label={({today:"今日学习",analytics:"学习报告",history:"学习记录",library:"学习资料库",status:"同步与设置"})[id]} className={activeView === id || (id === "library" && activeView === "intake") ? "is-active" : ""} aria-current={activeView === id || (id === "library" && activeView === "intake") ? "page" : undefined} onClick={() => onNavigate(id)}><Icon size={21} strokeWidth={activeView === id ? 2.2 : 1.7}/><span>{label}</span></button>)}</nav>
  </div>;
}
