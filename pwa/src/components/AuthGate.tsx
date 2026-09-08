import { type FormEvent, type ReactNode, Fragment, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSession, hasSupabaseConfig, supabase } from "../lib/api";
import { clearAllRecovery } from "../lib/recovery";
import { PasswordForm } from "./PasswordForm";

function recoveryUrl() { return new URL("/?recovery=1", window.location.origin).toString(); }
function isRecovery() { return new URLSearchParams(location.search).has("recovery") || new URLSearchParams(location.hash.slice(1)).get("type") === "recovery"; }

export function AuthGate({ demo, children }: { demo: boolean; children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!demo);
  const [recovering, setRecovering] = useState(isRecovery);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (demo || !supabase) return;
    let active = true;
    const hash = new URLSearchParams(location.hash.slice(1));
    const authError = hash.get("error_description");
    if (authError) { setError("恢复链接无效或已过期，请重新发送恢复邮件。"); setRecovering(false); history.replaceState(null, "", location.pathname); }
    void getSession().then(next => { if (active) { setSession(next); setLoading(false); } }).catch(() => { if (active) { setLoading(false); setError("登录状态读取失败，请重试。"); } });
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      if (event === "SIGNED_OUT") { void clearAllRecovery(); setRecovering(false); }
      setSession(next); setLoading(false);
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, [demo]);

  async function signIn(event: FormEvent) {
    event.preventDefault(); if (!supabase) return;
    setSubmitting(true); setError(null); setMessage(null);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (authError) throw authError;
      setPassword(""); setRecovering(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "登录失败，请重试。"); }
    finally { setSubmitting(false); }
  }
  async function reset() {
    if (!supabase) return;
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("请先填写有效的邮箱地址。");
    setSubmitting(true); setError(null); setMessage(null);
    try {
      const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: recoveryUrl() });
      if (authError) throw authError;
      setMessage("恢复邮件已请求发送。如该邮箱有账号，请打开邮件中的最新链接。");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "发送失败，请稍后重试。"); }
    finally { setSubmitting(false); }
  }
  if (demo) return children;
  if (!hasSupabaseConfig) return <main className="auth-shell"><section className="auth-card card" role="alert"><h1>学习空间暂不可用</h1><p>此站点尚未完成连接配置，请联系维护者。</p></section></main>;
  if (loading) return <div className="center-state"><span className="spinner" />正在恢复登录状态…</div>;
  if (session && (recovering || session.user.user_metadata?.password_set !== true)) return <main className="auth-shell"><div className="auth-card"><PasswordForm onSaved={() => { setRecovering(false); setSession({ ...session, user: { ...session.user, user_metadata: { ...session.user.user_metadata, password_set: true } } }); history.replaceState(null, "", location.pathname); }} /></div></main>;
  if (session) return <Fragment key={session.user.id}>{children}</Fragment>;
  return <main className="auth-shell"><section className="auth-card card"><div className="brand-mark brand-mark--large" aria-hidden="true"><img src="/logo-128.png" alt=""/></div><p className="eyebrow">PRIVATE LEARNING SPACE</p><h1>English Learning Lab</h1><p className="muted">登录后继续今天的搭配练习。</p><form onSubmit={signIn}><label>邮箱<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required /></label><label>密码<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>{error && <p className="inline-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}<button className="primary-button full" disabled={submitting}>{submitting ? "正在处理…" : "登录"}</button><button type="button" className="quiet-button" onClick={() => void reset()} disabled={submitting}>忘记密码</button></form></section></main>;
}
