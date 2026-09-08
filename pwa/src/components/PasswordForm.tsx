import { useState, type FormEvent } from "react";
import { supabase } from "../lib/api";

export function PasswordForm({ onSaved, demo = false }: { onSaved?(): void; demo?: boolean }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [requiresLogin, setRequiresLogin] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null); setRequiresLogin(false);
    if (password.length < 10 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) return setError("新密码至少 10 个字符，并包含大写字母、小写字母和数字。");
    if (password !== confirmation) return setError("两次输入的密码不一致。");
    if (!supabase || demo) return setError("演示模式不能修改账号密码。");
    setBusy(true);
    try {
      const { error: authError } = await supabase.auth.updateUser({ password, data: { password_set: true } });
      if (authError) throw authError;
      setPassword(""); setConfirmation(""); setSaved(true);
    } catch (caught) {
      const code = caught && typeof caught === "object" && "code" in caught ? String(caught.code) : "";
      const detail = caught instanceof Error ? caught.message : "请重新登录后重试。";
      const needsLogin = ["reauthentication_needed", "reauthentication_not_valid", "session_not_found", "refresh_token_not_found", "bad_jwt"].includes(code) || /reauthenticat|session.*(missing|expired|not found)/i.test(detail);
      setRequiresLogin(needsLogin);
      setError(needsLogin ? "为了确认是你本人操作，请重新登录，再到设置中修改密码。" : `密码未更新。${detail}`);
    } finally { setBusy(false); }
  }
  async function loginAgain() {
    setBusy(true);
    try { const result = await supabase?.auth.signOut(); if (result?.error) throw result.error; }
    catch { setError("退出登录未完成，请稍后重试。"); }
    finally { setBusy(false); }
  }
  return <section className="card settings-card"><h2>修改登录密码</h2><p>至少 10 个字符，包含大小写字母和数字。下次登录使用新密码。</p>{saved ? <div role="status"><p>密码已更新。</p>{onSaved && <button className="primary-button" onClick={onSaved}>进入学习空间</button>}</div> : <form onSubmit={save}><label>新密码<input type="password" autoComplete="new-password" minLength={10} value={password} onChange={event => setPassword(event.target.value)} required /></label><label>确认新密码<input type="password" autoComplete="new-password" minLength={10} value={confirmation} onChange={event => setConfirmation(event.target.value)} required /></label>{error && <p className="inline-error" role="alert">{error}</p>}{requiresLogin && <button type="button" className="secondary-button" disabled={busy} onClick={() => void loginAgain()}>重新登录后修改</button>}<button className="primary-button" disabled={busy || demo}>{busy ? "正在更新…" : "保存新密码"}</button></form>}</section>;
}
