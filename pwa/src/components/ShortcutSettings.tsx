import { useState } from "react";
import { supabase } from "../lib/api";
type Device = { id:string; label:string; expiresAt:string; revokedAt:string|null };
export function ShortcutSettings() {
  const [opened,setOpened]=useState(false);
  const [devices,setDevices]=useState<Device[]>([]);
  const [token,setToken]=useState("");
  const [tokenId,setTokenId]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  async function rpc(name:string,args:Record<string,unknown>={}) {
    if(!supabase) throw new Error("请先连接正式学习空间。");
    const {data,error}=await supabase.schema("english_api").rpc(name,args);
    if(error) throw new Error("操作未完成，请检查连接后重试。");
    return data;
  }
  async function refresh() { setDevices(await rpc("list_shortcut_devices") as Device[]); }
  async function run(job:()=>Promise<void>) {setBusy(true);setMessage("");try{await job();}catch(e){setMessage(e instanceof Error?e.message:"操作失败");}finally{setBusy(false);}}
  async function create() {
    const data=await rpc("issue_shortcut_device",{p_label:"iPhone / Mac 快捷指令"}) as {token:string;id:string};
    setToken(data.token);setTokenId(data.id);await refresh();
  }
  async function revoke(id:string) {
    await rpc("revoke_shortcut_device",{p_id:id});
    if(id===tokenId){setToken("");setTokenId("");}await refresh();setMessage("连接已撤销，已保存的语料仍会保留。");
  }
  return <article className="card settings-card" lang="zh-CN">
    <h2>快捷指令收集语料</h2>
    <p>从 iPhone 或 Mac 分享、复制文字，自动归入英语或韩语待整理区。</p>
    {!opened?<button className="secondary-button" disabled={busy} onClick={()=>void run(async()=>{await refresh();setOpened(true);})}>管理快捷指令连接</button>:<>
      <p>连接仅允许新增语料，有效期 90 天，可随时撤销。不能读取语料、修改学习进度或调用 AI。</p>
      <p>连接码只显示一次。将它填入「收集语料」快捷指令对应的 英语 连接码。配置后的快捷指令含私人连接码，会随你的快捷指令同步；请勿共享配置后的副本。</p>
      <button className="primary-button" disabled={busy||Boolean(token)} onClick={()=>void run(create)}>创建 英语 连接码</button>
      {token&&<div><label>英语 连接码<input type="password" readOnly value={token} autoComplete="off" aria-label="英语 连接码" /></label><button className="secondary-button" disabled={busy} onClick={()=>void run(async()=>{await navigator.clipboard.writeText(token);setMessage("已复制，请粘贴到快捷指令。");})}>复制连接码</button><button className="text-button" onClick={()=>{setToken("");setTokenId("");}}>已完成配置，隐藏连接码</button></div>}
      <ul>{devices.map(device=><li key={device.id}>{device.label} · {device.revokedAt?"已撤销":`到期 ${new Date(device.expiresAt).toLocaleDateString()}`} {!device.revokedAt&&<button className="text-button" disabled={busy} onClick={()=>void run(()=>revoke(device.id))}>撤销连接</button>}</li>)}</ul>
    </>}
    {message&&<p role="status">{message}</p>}
  </article>;
}
