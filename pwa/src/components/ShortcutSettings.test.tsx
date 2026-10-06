import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ShortcutSettings } from './ShortcutSettings';
const { rpc } = vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../lib/api',()=>({supabase:{schema:()=>({rpc})}}));
beforeEach(()=>{rpc.mockReset();});
afterEach(cleanup);
describe('shortcut connections',()=>{
 it('loads connections on demand and issues only after an explicit click',async()=>{
  rpc.mockResolvedValue({data:[],error:null});
  render(<ShortcutSettings/>);
  expect(rpc).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('管理快捷指令连接'));
  await screen.findByText('创建 英语 连接码');
  expect(rpc).toHaveBeenCalledTimes(1);
  rpc.mockResolvedValueOnce({data:{id:'fixture-id',token:'fixture-only-token'},error:null}).mockResolvedValueOnce({data:[{id:'fixture-id',label:'fixture',expiresAt:'2099-01-01',revokedAt:null}],error:null});
  fireEvent.click(screen.getByText('创建 英语 连接码'));
  const input=await screen.findByLabelText('英语 连接码');
  expect(input.getAttribute('type')).toBe('password');
  expect((input as HTMLInputElement).value).toBe('fixture-only-token');
  expect((screen.getByText('创建 英语 连接码') as HTMLButtonElement).disabled).toBe(true);
  rpc.mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce({data:[],error:null});
  await waitFor(()=>expect((screen.getByText('撤销连接') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByText('撤销连接'));
  await waitFor(()=>expect(screen.queryByLabelText('英语 连接码')).toBeNull());
  expect(rpc).toHaveBeenCalledWith('revoke_shortcut_device',{p_id:'fixture-id'});
 });
 it('does not present a connection code when issuance fails',async()=>{
  rpc.mockResolvedValueOnce({data:[],error:null}).mockResolvedValueOnce({data:null,error:{message:'private diagnostic'}});
  render(<ShortcutSettings/>);
  fireEvent.click(screen.getByText('管理快捷指令连接'));
  fireEvent.click(await screen.findByText('创建 英语 连接码'));
  await screen.findByText('操作未完成，请检查连接后重试。');
  expect(screen.queryByLabelText('英语 连接码')).toBeNull();
  expect(screen.queryByText('private diagnostic')).toBeNull();
 });
});
