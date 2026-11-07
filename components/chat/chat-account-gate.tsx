"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, Eye, EyeOff, LogOut, Shuffle, Trash2, UserPlus, X } from "lucide-react";
import type { VirtualAccount } from "@/lib/social-types";
import {
  createCustomVirtualAccount,
  createGeneratedVirtualAccount,
  deleteVirtualAccount,
  getAppVirtualLogin,
  listVirtualAccounts,
  logoutAppVirtualLogin,
  saveAppVirtualLogin,
  verifyVirtualPassword,
} from "@/lib/virtual-account-service";

type Mode = "login" | "create";
type Phase = "idle" | "busy" | "error" | "success";

function initial(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "我";
}

export function ChatAccountGate({ onClose, onAuthenticated, manage = false }: {
  onClose: () => void;
  onAuthenticated: (account: VirtualAccount) => void;
  manage?: boolean;
}) {
  const [accounts, setAccounts] = useState<VirtualAccount[]>([]);
  const [current, setCurrent] = useState<VirtualAccount | null>(null);
  const [mode, setMode] = useState<Mode>("login");
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleteTimer = useRef<number | null>(null);

  const reload = useCallback(async () => {
    const [rows, login] = await Promise.all([listVirtualAccounts(), getAppVirtualLogin("chat")]);
    setAccounts(rows);
    setCurrent(login?.account ?? null);
    if (!handle && login?.account) setHandle(login.account.handle);
  }, [handle]);

  useEffect(() => { void reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (deleteTimer.current) window.clearTimeout(deleteTimer.current); }, []);

  const choose = (account: VirtualAccount) => {
    setHandle(account.handle);
    setPassword("");
    setMode("login");
    setPhase("idle");
    setMessage("");
  };

  const finish = async (account: VirtualAccount) => {
    await saveAppVirtualLogin("chat", account.id);
    setCurrent(account);
    setPhase("success");
    setMessage("登录成功");
    window.setTimeout(() => onAuthenticated(account), 620);
  };

  const submit = async () => {
    if (!handle || !password || phase === "busy") return;
    setPhase("busy");
    setMessage("");
    try {
      if (mode === "create") {
        const created = await createCustomVirtualAccount({ handle, password, displayName: handle });
        await finish(created);
        return;
      }
      const verified = await verifyVirtualPassword(handle, password);
      if (!verified) {
        setPhase("error");
        setMessage("账号或密码不正确，请重新输入");
        return;
      }
      await finish(verified);
    } catch (error) {
      setPhase("error");
      setMessage(error instanceof Error ? error.message : "暂时无法完成登录");
    }
  };

  const generate = async () => {
    if (phase === "busy") return;
    setPhase("busy");
    setMessage("");
    try {
      const created = await createGeneratedVirtualAccount({ id: `chat:${Date.now()}`, name: "新用户" });
      setHandle(created.account.handle);
      setPassword(created.password);
      setMode("login");
      setPhase("idle");
      setMessage("账号和密码已生成并填入，请保存后登录");
      await reload();
    } catch (error) {
      setPhase("error");
      setMessage(error instanceof Error ? error.message : "生成失败");
    }
  };

  const requestDelete = (accountId: string) => {
    if (deleteId === accountId) {
      void (async () => {
        await deleteVirtualAccount(accountId);
        if (current?.id === accountId) setCurrent(null);
        setDeleteId(null);
        setHandle(value => accounts.find(item => item.id !== accountId)?.handle || (value === accounts.find(item => item.id === accountId)?.handle ? "" : value));
        setMessage("账号已从本机删除");
        await reload();
      })();
      return;
    }
    setDeleteId(accountId);
    if (deleteTimer.current) window.clearTimeout(deleteTimer.current);
    deleteTimer.current = window.setTimeout(() => setDeleteId(null), 4200);
  };

  const heading = current && manage ? "聊天账号" : "登录到聊天";
  const subheading = current && manage ? `当前使用 @${current.handle}` : "使用虚拟账号进入应用";
  const selected = useMemo(() => accounts.find(item => item.handle === handle), [accounts, handle]);

  return (
    <div className={`chat-account-gate is-${phase}`}>
      <header className="chat-login-topbar">
        <button type="button" className="chat-login-back" onClick={onClose} aria-label="返回">
          <ChevronLeft />
        </button>
      </header>

      <main className="chat-login-scroll">
        <section className="chat-login-hero">
          <h1 className="chat-login-title">{heading}</h1>
          <p className="chat-login-subtitle">{subheading}</p>
          <span className="chat-login-bubble" aria-hidden="true"><i /><i /><i /></span>
          {phase === "success" ? <span className="chat-login-success"><Check /></span> : null}
        </section>

        <section className={`chat-login-form ${phase === "error" ? "is-shaking" : ""}`}>
          <label className={handle ? "has-value" : ""}>
            <span>账号</span>
            <input value={handle} onChange={event => { setHandle(event.target.value.replace(/^@/, "")); setPhase("idle"); }} autoCapitalize="none" autoComplete="username" placeholder="@tianzhenlei_0217" />
          </label>
          <label className={password ? "has-value" : ""}>
            <span>密码</span>
            <input value={password} onChange={event => { setPassword(event.target.value); setPhase("idle"); }} type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="登录密码只保存在本机" />
            <button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? "隐藏密码" : "显示密码"}>{showPassword ? <EyeOff /> : <Eye />}</button>
          </label>
          {selected ? <p className="chat-login-saved"><Check /> 使用已保存账号 @{selected.handle}</p> : null}
          <div className={`chat-login-message ${message ? "is-visible" : ""}`}>{message || "模拟登录 · 不连接真实服务器"}</div>
        </section>

        <button className="chat-login-submit" onClick={() => void submit()} disabled={!handle || !password || phase === "busy"}>
          <span>{phase === "busy" ? "正在验证" : phase === "success" ? "已登录" : mode === "login" ? "登录" : "创建并登录"}</span>
          {phase === "busy" ? <i className="chat-login-loader"><b /><b /><b /></i> : null}
        </button>

        <button className="chat-login-generate" onClick={() => void generate()} disabled={phase === "busy"}>
          <Shuffle />换一个随机账号
        </button>

        <button
          type="button"
          className="chat-login-switch"
          onClick={() => { setMode(mode === "login" ? "create" : "login"); setHandle(""); setPassword(""); setPhase("idle"); }}
        >
          {mode === "login" ? "没有账号？新建一个" : "已有账号？返回登录"}
        </button>

        {current && manage ? (
          <button className="chat-login-logout" onClick={async () => { await logoutAppVirtualLogin("chat"); setCurrent(null); setMessage("已退出聊天账号"); }}><LogOut />退出当前账号</button>
        ) : null}

        <section className="chat-login-accounts">
          <div className="chat-login-section-title"><span>本机账号</span><small>{accounts.length} 个</small></div>
          {accounts.length ? accounts.map(account => (
            <div key={account.id} className={`chat-login-account ${selected?.id === account.id ? "is-selected" : ""} ${deleteId === account.id ? "is-confirming" : ""}`}>
              <button className="chat-login-account-main" onClick={() => choose(account)}>
                <span className="chat-login-account-avatar">{account.avatarUrl ? <img src={account.avatarUrl} alt="" /> : initial(account.displayName)}</span>
                <span><b>{account.displayName}</b><small>@{account.handle}{current?.id === account.id ? " · 当前登录" : ""}</small></span>
                {selected?.id === account.id ? <Check /> : null}
              </button>
              <button className="chat-login-delete" onClick={() => requestDelete(account.id)} aria-label={deleteId === account.id ? `确认删除 ${account.displayName}` : `删除 ${account.displayName}`}>
                {deleteId === account.id ? <><span>确认删除</span><X /></> : <Trash2 />}
              </button>
            </div>
          )) : <div className="chat-login-empty"><UserPlus /><b>还没有虚拟账号</b><span>可以随机生成，也可以自己填写账号和密码。</span></div>}
        </section>
        <p className="chat-login-privacy">所有账号只保存在当前设备，不会上传</p>
      </main>
    </div>
  );
}
