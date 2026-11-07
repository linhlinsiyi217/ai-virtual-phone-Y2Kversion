"use client";

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, ChevronRight, Copy, KeyRound, LogIn, QrCode, RefreshCw, ScanLine, Shuffle, Sparkles, UserRound, X } from "lucide-react";
import { SettingsContext } from "../phone-settings-app";
import { loadCharacters } from "@/lib/character-storage";
import { resolveUserIdentity } from "@/lib/settings-storage";
import { addFriendByCode, ensureFriendIdentity, getActiveFriendCode, listFriends, refreshFriendCode, resolveFriendCode } from "@/lib/friend-service";
import { formatFriendCode, parseFriendCodePayload } from "@/lib/friend-code";
import { renderFriendCodeDataUrl } from "@/lib/friend-code-qr";
import { SOCIAL_DATA_UPDATED_EVENT, socialDb } from "@/lib/social-db";
import type { FriendIdentity, VirtualAccount } from "@/lib/social-types";
import { createCustomVirtualAccount, createGeneratedVirtualAccount, ensureVirtualAccount, getAppVirtualLogin, listVirtualAccounts, logoutAppVirtualLogin, saveAppVirtualLogin, setActiveVirtualAccountId, updateVirtualAccount, verifyVirtualPassword } from "@/lib/virtual-account-service";

type View = "home" | "friend-code" | "add-friend" | "chat-login";
type Notice = { tone: "ok" | "error"; text: string } | null;

type BarcodeDetectorLike = { detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string }>> };
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function initials(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "我";
}

export function AccountCenter({ onNotice, initialView = "home" }: { onNotice: (message: string) => void; initialView?: View }) {
  const { setSubpageTitle, setOverrideBack } = useContext(SettingsContext);
  const [view, setView] = useState<View>(initialView);
  const [account, setAccount] = useState<VirtualAccount | null>(null);
  const [accounts, setAccounts] = useState<VirtualAccount[]>([]);
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [friendCount, setFriendCount] = useState(0);

  const identity = useMemo(() => resolveUserIdentity(), []);

  const reload = useCallback(async () => {
    const ensured = await ensureVirtualAccount(identity ? { id: identity.id, name: identity.name, avatarUrl: identity.avatarUrl } : undefined);
    setAccount(ensured.account);
    if (ensured.password) setRevealedPassword(ensured.password);
    setAccounts(await listVirtualAccounts());
    setFriendCount((await listFriends(ensured.account.friendIdentityId)).length);
  }, [identity]);

  useEffect(() => {
    void reload();
    const sync = () => void reload();
    window.addEventListener(SOCIAL_DATA_UPDATED_EVENT, sync);
    return () => window.removeEventListener(SOCIAL_DATA_UPDATED_EVENT, sync);
  }, [reload]);

  useEffect(() => {
    const titles: Record<View, string> = { home: "账号与登录", "friend-code": "我的好友码", "add-friend": "添加好友", "chat-login": "登录到聊天" };
    setSubpageTitle(titles[view]);
    setOverrideBack(view === initialView ? null : () => setView(initialView));
    return () => {
      setSubpageTitle(null);
      setOverrideBack(null);
    };
  }, [initialView, setOverrideBack, setSubpageTitle, view]);

  const generateAccount = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const created = await createGeneratedVirtualAccount(identity ? { id: `${identity.id}:${Date.now()}`, name: identity.name, avatarUrl: identity.avatarUrl } : undefined);
      setAccount(created.account);
      setRevealedPassword(created.password);
      setNotice({ tone: "ok", text: "新账号已生成。密码只在本次显示，请先保存。" });
      await reload();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "生成失败" });
    } finally {
      setBusy(false);
    }
  };

  if (!account) return <div className="account-loading"><span className="account-spinner" />正在准备本机账号…</div>;

  return (
    <div className="account-center">
      {notice ? <div className={`account-notice is-${notice.tone}`}><span>{notice.text}</span><button onClick={() => setNotice(null)} aria-label="关闭"><X size={16} /></button></div> : null}
      {view === "home" ? (
        <AccountHome
          account={account}
          accounts={accounts}
          revealedPassword={revealedPassword}
          friendCount={friendCount}
          busy={busy}
          onSelect={item => void setActiveVirtualAccountId(item.id)}
          onGenerate={generateAccount}
          onOpen={setView}
          onCopyNotice={text => setNotice({ tone: "ok", text })}
          onSave={async name => {
            await updateVirtualAccount(account.id, { displayName: name, avatarUrl: account.avatarUrl });
            onNotice("账号资料已保存");
          }}
        />
      ) : null}
      {view === "friend-code" ? <FriendCodeView account={account} onNotice={setNotice} /> : null}
      {view === "add-friend" ? <AddFriendView account={account} onNotice={setNotice} onAdded={reload} /> : null}
      {view === "chat-login" ? <ChatLoginView account={account} accounts={accounts} onGenerated={reload} onNotice={setNotice} /> : null}
    </div>
  );
}

function AccountHome({ account, accounts, revealedPassword, friendCount, busy, onGenerate, onSelect, onOpen, onSave, onCopyNotice }: {
  account: VirtualAccount; accounts: VirtualAccount[]; revealedPassword: string | null; friendCount: number; busy: boolean;
  onGenerate: () => void; onSelect: (account: VirtualAccount) => void; onOpen: (view: View) => void; onSave: (name: string) => Promise<void>;
  onCopyNotice: (message: string) => void;
}) {
  const [name, setName] = useState(account.displayName);
  const [friendCode, setFriendCode] = useState("");
  const [allowCodeAdd, setAllowCodeAdd] = useState(true);
  const [autoFill, setAutoFill] = useState(Boolean(revealedPassword));
  const [mode, setMode] = useState<"random" | "custom">("random");
  const [customHandle, setCustomHandle] = useState("");
  const [customPassword, setCustomPassword] = useState("");
  const [customBusy, setCustomBusy] = useState(false);
  useEffect(() => {
    setName(account.displayName);
    void Promise.all([getActiveFriendCode(account.friendIdentityId), socialDb.friendIdentities.get(account.friendIdentityId)]).then(([code, identity]) => {
      setFriendCode(formatFriendCode(code.code));
      setAllowCodeAdd(identity?.allowCodeAdd !== false);
    });
  }, [account]);
  useEffect(() => setAutoFill(Boolean(revealedPassword)), [revealedPassword]);
  const copy = (value: string, label: string) => {
    if (!navigator.clipboard?.writeText) { onCopyNotice(`${label}：${value}`); return; }
    void navigator.clipboard.writeText(value).then(() => onCopyNotice(`${label}已复制`), () => onCopyNotice(`${label}：${value}`));
  };
  const setAllow = async (next: boolean) => {
    setAllowCodeAdd(next);
    await socialDb.friendIdentities.update(account.friendIdentityId, { allowCodeAdd: next, updatedAt: Date.now() });
  };
  const createCustom = async () => {
    setCustomBusy(true);
    try {
      const created = await createCustomVirtualAccount({ handle: customHandle, password: customPassword, displayName: name || customHandle, avatarUrl: account.avatarUrl });
      await setActiveVirtualAccountId(created.id);
      onCopyNotice("自定义虚拟账号已创建");
      setCustomHandle("");
      setCustomPassword("");
    } catch (error) {
      onCopyNotice(error instanceof Error ? error.message : "创建失败");
    } finally {
      setCustomBusy(false);
    }
  };
  return (
    <>
      <section className="account-hero">
        <div className="account-avatar">{account.avatarUrl ? <img src={account.avatarUrl} alt="" /> : initials(account.displayName)}</div>
        <div className="account-hero-copy">
          <h2>{account.displayName}</h2>
          <p>@{account.handle}</p>
        </div>
        <span className="account-status"><i />本机账号</span>
      </section>

      <section className="account-section">
        <div className="account-section-head"><span>登录凭据</span></div>
        <div className="account-panel account-panel-rows">
          <button className="account-row" onClick={() => copy(account.handle, "账号")}><span><b>账号</b></span><em>@{account.handle}</em><ChevronRight size={18} /></button>
          <button className="account-row" onClick={() => revealedPassword && copy(revealedPassword, "密码")} disabled={!revealedPassword}>
            <span><b>密码</b></span><em className="account-password-value">{revealedPassword ? "••••••••" : account.passwordHint}</em><ChevronRight size={18} />
          </button>
          <div className="account-row"><span><b>自动填充到应用</b></span><button type="button" className={`account-switch-toggle ${autoFill ? "is-on" : ""}`} onClick={() => setAutoFill(value => !value)} aria-pressed={autoFill}><i /></button></div>
        </div>
      </section>

      <section className="account-section">
        <div className="account-section-head"><span>好友身份</span><small>{friendCount} 位好友</small></div>
        <div className="account-panel account-panel-rows">
          <button className="account-row" onClick={() => copy(friendCode, "好友码")}><span className="account-row-icon"><KeyRound /></span><span><b>好友码</b></span><em>{friendCode}</em></button>
          <button className="account-row" onClick={() => onOpen("friend-code")}><span className="account-row-icon"><QrCode /></span><span><b>我的好友码</b></span><ChevronRight /></button>
          <div className="account-row"><span className="account-row-icon"><UserRound /></span><span><b>允许通过好友码添加</b></span><button type="button" className={`account-switch-toggle ${allowCodeAdd ? "is-on" : ""}`} onClick={() => void setAllow(!allowCodeAdd)} aria-pressed={allowCodeAdd}><i /></button></div>
        </div>
      </section>

      <section className="account-section">
        <div className="account-section-head"><span>生成方式</span></div>
        <div className="account-segment account-generation-segment"><button className={mode === "random" ? "is-active" : ""} onClick={() => setMode("random")}>随机生成</button><button className={mode === "custom" ? "is-active" : ""} onClick={() => setMode("custom")}>自己填写</button></div>
        {mode === "custom" ? <div className="account-panel account-custom-fields">
          <label><span>账号</span><input value={customHandle} onChange={event => setCustomHandle(event.target.value.replace(/^@/, ""))} placeholder="4–24 位字母、数字或下划线" /></label>
          <label><span>密码</span><input type="password" value={customPassword} onChange={event => setCustomPassword(event.target.value)} placeholder="至少 6 位" /></label>
        </div> : null}
        <button className="account-generate account-generate-primary" onClick={mode === "random" ? onGenerate : () => void createCustom()} disabled={busy || customBusy || (mode === "custom" && (!customHandle || !customPassword))}><Shuffle size={18} />{busy || customBusy ? "正在生成…" : mode === "random" ? "随机生成账号与好友码" : "创建自定义账号"}</button>
        <button className="account-save" onClick={() => void onSave(name.trim() || account.displayName)}>保存更改</button>
      </section>

      <section className="account-section account-more-section">
        <div className="account-section-head"><span>应用与好友</span><small>{accounts.length} 个账号</small></div>
        <div className="account-panel account-panel-rows">
          <button className="account-row" onClick={() => onOpen("add-friend")}><span className="account-row-icon"><ScanLine /></span><span><b>添加好友</b><small>扫一扫或输入好友码</small></span><ChevronRight /></button>
          <button className="account-row" onClick={() => onOpen("chat-login")}><span className="account-row-icon"><LogIn /></span><span><b>登录到聊天</b><small>使用虚拟账号模拟登录</small></span><ChevronRight /></button>
          {accounts.map(item => <button key={item.id} className={`account-row account-switch ${item.id === account.id ? "is-active" : ""}`} onClick={() => onSelect(item)}><span className="account-mini-avatar">{item.avatarUrl ? <img src={item.avatarUrl} alt="" /> : initials(item.displayName)}</span><span><b>{item.displayName}</b><small>@{item.handle}</small></span>{item.id === account.id ? <Check /> : <ChevronRight />}</button>)}
        </div>
      </section>
      <p className="account-footnote">这些账号只用于虚拟手机内的假登录，不会连接真实服务。</p>
    </>
  );
}

function FriendCodeView({ account, onNotice }: { account: VirtualAccount; onNotice: (notice: Notice) => void }) {
  const characters = useMemo(() => loadCharacters(), []);
  const subjects = useMemo(() => [{ id: account.friendIdentityId, localId: account.id, name: account.displayName, avatar: account.avatarUrl, kind: "user" as const }, ...characters.map(char => ({ id: "", localId: char.id, name: char.name, avatar: char.avatar || undefined, kind: "ai" as const }))], [account, characters]);
  const [selected, setSelected] = useState(0);
  const [friend, setFriend] = useState<FriendIdentity | null>(null);
  const [code, setCode] = useState("");
  const [qr, setQr] = useState("");
  const subject = subjects[selected];

  const loadCode = useCallback(async () => {
    const identity = subject.kind === "user" ? await socialDb.friendIdentities.get(account.friendIdentityId) : await ensureFriendIdentity("ai", subject.localId, subject.name, subject.avatar);
    if (!identity) return;
    const active = await getActiveFriendCode(identity.id);
    setFriend(identity); setCode(active.code); setQr(await renderFriendCodeDataUrl(active.code, identity.ownerType, subject.avatar));
  }, [account.friendIdentityId, subject]);
  useEffect(() => { void loadCode(); }, [loadCode]);

  const refresh = async () => {
    if (!friend) return;
    const next = await refreshFriendCode(friend.id);
    setCode(next.code); setQr(await renderFriendCodeDataUrl(next.code, friend.ownerType, subject.avatar));
    onNotice({ tone: "ok", text: "已换新好友码，旧码失效；已有好友关系不会改变。" });
  };
  return <>
    <div className="account-segment">{subjects.map((item, index) => <button key={`${item.kind}:${item.localId}`} className={selected === index ? "is-active" : ""} onClick={() => setSelected(index)}>{index === 0 ? "我" : item.name}</button>)}</div>
    <section className="friend-code-card">
      <div className="friend-code-person"><span className="account-mini-avatar large">{subject.avatar ? <img src={subject.avatar} alt="" /> : initials(subject.name)}</span><span><b>{subject.name}</b><small>{subject.kind === "ai" ? "AI 身份好友码" : "本机用户好友码"}</small></span></div>
      <div className="friend-qr">{qr ? <img src={qr} alt={`好友二维码 ${formatFriendCode(code)}`} /> : <span className="account-spinner" />}</div>
      <div className="friend-code-value">{formatFriendCode(code)}</div>
      <p>让对方使用“扫一扫”或输入这 8 位好友码。二维码只包含身份类型和好友码，不包含密码、聊天或角色卡内容。</p>
      <div className="friend-code-actions">
        <button onClick={() => void navigator.clipboard?.writeText(formatFriendCode(code)).then(() => onNotice({ tone: "ok", text: "好友码已复制" }))}><Copy />复制</button>
        <button onClick={() => void refresh()}><RefreshCw />换一个</button>
      </div>
    </section>
  </>;
}

function AddFriendView({ account, onNotice, onAdded }: { account: VirtualAccount; onNotice: (notice: Notice) => void; onAdded: () => Promise<void> }) {
  const characters = useMemo(() => loadCharacters(), []);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [value, setValue] = useState("");
  const [target, setTarget] = useState<FriendIdentity | null>(null);
  const [resolvedCode, setResolvedCode] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const resolve = async (raw: string) => {
    try {
      const payload = parseFriendCodePayload(raw);
      const result = await resolveFriendCode(payload.code);
      setValue(formatFriendCode(payload.code)); setResolvedCode(payload.code); setTarget(result.identity);
    } catch (error) {
      setTarget(null); onNotice({ tone: "error", text: error instanceof Error ? error.message : "无法识别好友码" });
    }
  };

  const stopCamera = useCallback(() => { streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null; setCameraOpen(false); }, []);
  useEffect(() => () => stopCamera(), [stopCamera]);

  const startCamera = async () => {
    const Detector = (window as typeof window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
    if (!Detector) { onNotice({ tone: "error", text: "当前浏览器不支持实时识码，请上传二维码图片或手动输入。" }); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      streamRef.current = stream; setCameraOpen(true);
      requestAnimationFrame(() => { if (videoRef.current) { videoRef.current.srcObject = stream; void videoRef.current.play(); } });
      const detector = new Detector({ formats: ["qr_code"] });
      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return;
        const result = await detector.detect(videoRef.current).catch(() => []);
        if (result[0]?.rawValue) { stopCamera(); await resolve(result[0].rawValue); return; }
        requestAnimationFrame(() => void tick());
      };
      requestAnimationFrame(() => void tick());
    } catch { onNotice({ tone: "error", text: "无法打开相机，请检查浏览器权限。" }); }
  };

  const readImage = async (file?: File) => {
    if (!file) return;
    const Detector = (window as typeof window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
    if (!Detector) { onNotice({ tone: "error", text: "当前浏览器无法读取图片二维码，请手动输入下方好友码。" }); return; }
    const bitmap = await createImageBitmap(file);
    const result = await new Detector({ formats: ["qr_code"] }).detect(bitmap);
    bitmap.close();
    if (!result[0]?.rawValue) onNotice({ tone: "error", text: "图片里没有识别到好友二维码。" });
    else await resolve(result[0].rawValue);
  };

  const add = async () => {
    try {
      const sourceCharacter = characters[sourceIndex - 1];
      const sourceId = sourceCharacter
        ? (await ensureFriendIdentity("ai", sourceCharacter.id, sourceCharacter.name, sourceCharacter.avatar || undefined)).id
        : account.friendIdentityId;
      await addFriendByCode(sourceId, resolvedCode); await onAdded();
      onNotice({ tone: "ok", text: `${sourceCharacter?.name || "你"} 已添加 ${target?.displayName || "好友"}` }); setTarget(null); setValue("");
    }
    catch (error) { onNotice({ tone: "error", text: error instanceof Error ? error.message : "添加失败" }); }
  };

  if (target) return <section className="friend-profile-view">
    <span className="friend-profile-avatar">{target.avatarUrl ? <img src={target.avatarUrl} alt="" /> : initials(target.displayName)}</span>
    <h2>{target.displayName}</h2>
    <span className="friend-profile-kind"><i />{target.ownerType === "ai" ? "AI 角色" : "用户"}</span>
    <span className="friend-profile-code">{formatFriendCode(resolvedCode)}</span>
    <div className="friend-profile-info">
      <div><b>简介</b><span>{target.ownerType === "ai" ? "温柔、擅长整理与陪伴" : "本机虚拟用户"}</span><ChevronRight /></div>
      <div><b>来源</b><span>{target.ownerType === "ai" ? "AI 好友码" : "用户好友码"}</span><ChevronRight /></div>
      <div><b>未来联机</b><span>可迁移</span><ChevronRight /></div>
    </div>
    <button className="friend-profile-add" onClick={() => void add()}>添加好友</button>
    <button className="friend-profile-cancel" onClick={() => { setTarget(null); setValue(""); }}>取消</button>
    <p className="friend-profile-note"><Check size={17} />添加后可在聊天、联系人和动态中找到她。</p>
  </section>;

  return <>
    <section className="account-section">
      <div className="account-section-head"><span>由谁添加</span><small>AI 也能扫描你的好友码</small></div>
      <div className="account-segment"><button className={sourceIndex === 0 ? "is-active" : ""} onClick={() => setSourceIndex(0)}>我</button>{characters.map((character, index) => <button key={character.id} className={sourceIndex === index + 1 ? "is-active" : ""} onClick={() => setSourceIndex(index + 1)}>{character.name}</button>)}</div>
    </section>
    <section className="scanner-card">
      <div className="scanner-visual">{cameraOpen ? <video ref={videoRef} muted playsInline /> : <><ScanLine size={54} /><span>扫描 AI PHONE 好友码</span></>}</div>
      <div className="scanner-actions"><button onClick={() => void startCamera()}><Camera />打开相机</button><label><QrCode />从相册选择<input type="file" accept="image/*" onChange={event => void readImage(event.target.files?.[0])} /></label></div>
    </section>
    <section className="account-section">
      <div className="account-section-head"><span>手动输入</span><small>支持 XXXX-XXXX</small></div>
      <div className="friend-input"><input value={value} onChange={event => setValue(formatFriendCode(event.target.value))} placeholder="输入 8 位好友码" maxLength={9} /><button onClick={() => void resolve(value)}>查找</button></div>
    </section>
  </>;
}

function ChatLoginView({ account, accounts, onGenerated, onNotice }: { account: VirtualAccount; accounts: VirtualAccount[]; onGenerated: () => Promise<void>; onNotice: (notice: Notice) => void }) {
  const [handle, setHandle] = useState(account.handle);
  const [password, setPassword] = useState("");
  const [current, setCurrent] = useState<VirtualAccount | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void getAppVirtualLogin("chat").then(result => setCurrent(result?.account ?? null)); }, []);
  const login = async () => {
    setBusy(true);
    const verified = await verifyVirtualPassword(handle, password);
    if (!verified) onNotice({ tone: "error", text: "账号或密码不正确。随机账号的密码只会在生成时显示一次。" });
    else { await saveAppVirtualLogin("chat", verified.id); setCurrent(verified); setPassword(""); onNotice({ tone: "ok", text: "聊天应用登录成功" }); }
    setBusy(false);
  };
  const generate = async () => {
    const result = await createGeneratedVirtualAccount({ id: `chat:${Date.now()}`, name: "新用户" });
    setHandle(result.account.handle); setPassword(result.password); await onGenerated();
    onNotice({ tone: "ok", text: "已生成账号并自动填入。请先保存密码，再点击登录。" });
  };
  const createCustom = async () => {
    try {
      const created = await createCustomVirtualAccount({ handle, password, displayName: handle });
      await saveAppVirtualLogin("chat", created.id); setCurrent(created); setPassword(""); await onGenerated();
      onNotice({ tone: "ok", text: "自定义虚拟账号已创建并登录" });
    } catch (error) { onNotice({ tone: "error", text: error instanceof Error ? error.message : "创建失败" }); }
  };
  if (current) return <section className="login-success"><span className="success-orbit"><Check /></span><span className="account-eyebrow">CHAT ACCOUNT</span><h2>已登录</h2><p>{current.displayName}<br />@{current.handle}</p><button onClick={async () => { await logoutAppVirtualLogin("chat"); setCurrent(null); }}>退出聊天账号</button></section>;
  return <>
    <section className="login-intro"><span><Sparkles /></span><div><h2>登录聊天应用</h2><p>这是虚拟手机内部的模拟账号，不会把资料上传到真实社交平台。</p></div></section>
    <section className="account-panel login-form">
      <label><span>账号</span><input value={handle} onChange={event => setHandle(event.target.value.replace(/^@/, ""))} autoCapitalize="none" placeholder="例如 luna.2688" /></label>
      <label><span>密码</span><input value={password} onChange={event => setPassword(event.target.value)} type="password" placeholder="输入本机虚拟密码" /></label>
      <button className="login-primary" onClick={() => void login()} disabled={busy || !handle || !password}>{busy ? "正在验证…" : "登录"}</button>
      <button className="login-random" onClick={() => void generate()}><Shuffle />随机生成账号和密码</button>
      <button className="login-random" onClick={() => void createCustom()} disabled={!handle || !password}><UserRound />用当前账号和密码新建</button>
    </section>
    <section className="account-section"><div className="account-section-head"><span>选择已有账号</span><small>{accounts.length} 个</small></div><div className="account-panel account-panel-rows">
      {accounts.map(item => <button className="account-row" key={item.id} onClick={() => setHandle(item.handle)}><span className="account-mini-avatar">{initials(item.displayName)}</span><span><b>{item.displayName}</b><small>@{item.handle}</small></span><ChevronRight /></button>)}
    </div></section>
  </>;
}
