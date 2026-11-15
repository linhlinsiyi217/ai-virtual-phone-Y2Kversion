"use client";

// 后台保护页：总览 / 后台测试 / 诊断记录。
// 所有“已完成”都来自原生真实读取；原生桥不存在时如实显示“需更新安装包”。

import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendDiag,
  confirmManual,
  formatCheckedAgo,
  formatClock,
  getDiagLog,
  getLastMessageAt,
  getShellVersion,
  hasBridge,
  openSystemSettings,
  readStatus,
  sendTestMessage,
  unsupportedItems,
  type DiagEntry,
  type KeepAliveItem,
  type KeepAliveItemKey,
} from "@/lib/keep-alive-native";
import { isPersonalPushCloudActive } from "@/lib/personal-push-cloud";
import { loadKeepAlive, saveKeepAlive } from "@/lib/weixin-storage";

type View = "overview" | "test" | "diag";

type Props = {
  loggedIn: boolean;
  onBack: () => void;
  onOpenCloud: () => void;
  onNotice: (message: string) => void;
  /** 嵌在设置子页里时不再画自己的返回按钮 */
  embedded?: boolean;
};

const ICONS: Record<string, string> = {
  wifi: "M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.6v.01",
  cloud: "M7 18a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6-1A4.5 4.5 0 0 1 17 18zM12 16v-5M9.5 13l2.5-2.5 2.5 2.5",
  user: "M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 21a8 8 0 0 1 16 0",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4",
  bell: "M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7M10 20a2 2 0 0 0 4 0",
  bat: "M2 7h17v10H2zM22 11v2M10.5 9.5l-2 3h4l-2 3",
  clk: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2",
  ph: "M6.5 3h11v18h-11zM12 17.5v.01",
  snd: "M21 3L3 10l7 3.5L13.5 21zM21 3L10 13.5",
  ref: "M20 11a8 8 0 0 0-14-4L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4l2-2M20 20v-5h-5",
};

function Icon({ name }: { name: string }) {
  return (
    <svg className="ka-ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONS[name] ?? ""} />
    </svg>
  );
}

const ITEM_META: Record<KeepAliveItemKey, { icon: string; title: string; desc: string }> = {
  login: { icon: "user", title: "账号登录", desc: "登录后才会订阅你的专属消息通道" },
  service: { icon: "shield", title: "后台消息服务", desc: "常驻通知 + 15 分钟系统自检，被回收后尝试恢复" },
  notification: { icon: "bell", title: "系统通知", desc: "允许锁屏、横幅和通知栏显示角色消息" },
  battery: { icon: "bat", title: "电池无限制", desc: "降低锁屏和省电模式暂停后台网络的概率" },
  exactAlarm: { icon: "clk", title: "准时自检", desc: "深度休眠时也尽量按计划检查消息服务" },
  autostart: { icon: "ph", title: "自启动与后台运行", desc: "进入手机系统的真实页面，手动允许自启动和后台活动" },
};

const SETTINGS_TYPE: Record<KeepAliveItemKey, "notification" | "battery" | "autostart" | "exactAlarm"> = {
  login: "notification",
  service: "notification",
  notification: "notification",
  battery: "battery",
  exactAlarm: "exactAlarm",
  autostart: "autostart",
};

export function KeepAlivePage({ loggedIn, onBack, onOpenCloud, onNotice, embedded = false }: Props) {
  const [view, setView] = useState<View>("overview");
  const [items, setItems] = useState<KeepAliveItem[]>(unsupportedItems());
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [webGuard, setWebGuard] = useState(true);
  const [manualAuto, setManualAuto] = useState(false);
  const [diag, setDiag] = useState<DiagEntry[]>([]);

  const [testState, setTestState] = useState<"idle" | "running" | "ok" | "fail">("idle");
  const [testStep, setTestStep] = useState(0);
  const [testMsg, setTestMsg] = useState("");
  const [cloudActive, setCloudActive] = useState(false);
  const pollRef = useRef<number | null>(null);

  const bridgeReady = hasBridge();
  const shell = getShellVersion();

  const refresh = useCallback(() => {
    setChecking(true);
    setCloudActive(isPersonalPushCloudActive());
    window.setTimeout(() => {
      const real = readStatus();
      if (real) {
        const merged = real.map(item => (item.key === "login"
          ? { ...item, state: loggedIn ? ("ok" as const) : ("pending" as const), detail: loggedIn ? "已登录，消息通道已订阅" : "还没有登录账号" }
          : item));
        setItems(merged);
      } else {
        setItems(unsupportedItems().map(item => (item.key === "login"
          ? { ...item, state: loggedIn ? ("ok" as const) : ("pending" as const), detail: loggedIn ? "已登录" : "还没有登录账号" }
          : item)));
      }
      setCheckedAt(Date.now());
      setChecking(false);
      appendDiag({
        ts: Date.now(),
        key: "refresh",
        result: bridgeReady ? "ok" : "unsupported",
        detail: bridgeReady ? "已重新读取系统状态" : "安装包没有原生桥，只能显示网页层状态",
        durationMs: 400,
      });
    }, 420);
  }, [bridgeReady, loggedIn]);

  useEffect(() => {
    refresh();
    setWebGuard(loadKeepAlive());
    setDiag(getDiagLog());
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
    // 首次进入读取一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 从系统设置回到前台时自动刷新
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        refresh();
        setDiag(getDiagLog());
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const doneCount = items.filter(item => item.state === "ok").length;

  const handleWebGuard = (next: boolean) => {
    setWebGuard(next);
    saveKeepAlive(next);
    window.dispatchEvent(new CustomEvent("weixin-config-changed"));
    onNotice(next ? "已开启网页运行保护" : "已关闭网页运行保护");
  };

  const handleOpenSetting = (key: KeepAliveItemKey) => {
    if (!bridgeReady) {
      onNotice("当前安装包还没有这项功能，请先更新安装包");
      appendDiag({ ts: Date.now(), key, result: "unsupported", detail: "安装包未接入原生桥" });
      setDiag(getDiagLog());
      return;
    }
    setBusyKey(key);
    const started = Date.now();
    window.setTimeout(() => {
      const res = openSystemSettings(SETTINGS_TYPE[key]);
      const ok = !!res?.opened;
      appendDiag({
        ts: Date.now(),
        key,
        result: ok ? "ok" : "fail",
        detail: ok ? "已打开系统设置页" : `没能打开系统页面${res?.error ? `：${res.error}` : ""}`,
        durationMs: Date.now() - started,
      });
      setBusyKey(null);
      setDiag(getDiagLog());
      onNotice(ok ? "已打开系统设置" : "没能打开系统页面，已记录到诊断");
    }, 420);
  };

  const handleManualAutostart = () => {
    if (!bridgeReady) {
      onNotice("当前安装包还没有这项功能，请先更新安装包");
      return;
    }
    const res = confirmManual("autostart", true);
    if (res?.saved) {
      setManualAuto(true);
      appendDiag({ ts: Date.now(), key: "autostart", result: "ok", detail: "用户手动确认已设置自启动" });
      setDiag(getDiagLog());
      onNotice("已记录：你手动确认过自启动设置");
    } else {
      onNotice("保存失败，请稍后再试");
    }
  };

  const runTest = async () => {
    if (!bridgeReady) {
      setTestState("fail");
      setTestStep(1);
      setTestMsg("当前安装包还没有后台测试功能，请先更新安装包。");
      appendDiag({ ts: Date.now(), key: "test", result: "unsupported", detail: "安装包未接入原生桥" });
      setDiag(getDiagLog());
      return;
    }
    if (testState === "running") return;
    const started = Date.now();
    const before = getLastMessageAt() ?? 0;
    setTestState("running");
    setTestStep(1);
    setTestMsg("测试消息已排队，现在把应用划到后台。");
    window.setTimeout(() => setTestStep(2), 900);

    const res = await sendTestMessage();
    if (!res.ok) {
      setTestState("fail");
      setTestStep(2);
      setTestMsg(res.error || "测试发送失败，请先检查云端消息通道。");
      appendDiag({ ts: Date.now(), key: "test", result: "fail", detail: res.error || "测试发送失败", durationMs: Date.now() - started });
      setDiag(getDiagLog());
      return;
    }

    if (pollRef.current) window.clearInterval(pollRef.current);
    const deadline = started + 20000;
    pollRef.current = window.setInterval(() => {
      const last = getLastMessageAt() ?? 0;
      if (last > before) {
        window.clearInterval(pollRef.current!);
        pollRef.current = null;
        setTestStep(3);
        setTestState("ok");
        const seconds = ((Date.now() - started) / 1000).toFixed(1);
        setTestMsg(`后台消息通道正常，约 ${seconds} 秒后收到消息。这次结果已写进诊断记录。`);
        appendDiag({ ts: Date.now(), key: "test", result: "ok", detail: `约 ${seconds} 秒收到后台消息`, durationMs: Date.now() - started });
        setDiag(getDiagLog());
        return;
      }
      if (Date.now() > deadline) {
        window.clearInterval(pollRef.current!);
        pollRef.current = null;
        setTestStep(2);
        setTestState("fail");
        setTestMsg("20 秒内没有收到消息。可能是电池未放行、自启动没允许，或通知被关闭。");
        appendDiag({ ts: Date.now(), key: "test", result: "fail", detail: "20 秒内没有收到后台消息", durationMs: Date.now() - started });
        setDiag(getDiagLog());
      }
    }, 1000);
  };

  useEffect(() => {
    if (testState !== "running") return;
    const timer = window.setTimeout(() => {
      if (testState === "running") setTestStep(prev => (prev < 2 ? 2 : prev));
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [testState]);

  if (view === "test") {
    return (
      <div className="ka-wrap">
        <button type="button" className="ka-back" onClick={() => setView("overview")}>‹ 返回后台保护</button>
        <div className="ka-card ka-mt12">
          <div className="ka-row">
            <Icon name="snd" />
            <div className="ka-tx">
              <b>后台消息测试</b>
              <span>点开始后会回到桌面，别手动划掉小手机</span>
            </div>
          </div>
          <div className="ka-tl">
            {[
              { n: 1, title: "发出测试消息", sub: "通过后台服务发出" },
              { n: 2, title: "回到桌面，等待 6 秒", sub: "这段时间里小手机在后台" },
              { n: 3, title: "检查系统通知", sub: "看通知栏是否真的收到" },
            ].map(step => (
              <div key={step.n} className={`ka-stp ${testStep === step.n && testState === "running" ? "doing" : ""} ${testStep > step.n || (testState === "ok" && step.n === 3) ? "done" : ""}`}>
                <div className="ka-d" />
                <div><b>{step.title}</b><span>{step.sub}</span></div>
              </div>
            ))}
          </div>
          {testState === "ok" && <div className="ka-res"><b>收到了</b>{testMsg}</div>}
          {testState === "fail" && (
            <div className="ka-res bad">
              <b>没收到</b>
              {testMsg}
              <ol>
                <li>电池还没有设成“无限制”</li>
                <li>自启动和后台运行没有允许</li>
                <li>系统通知被关闭了</li>
              </ol>
            </div>
          )}
          {testState === "running" && <div className="ka-res">{testMsg}</div>}
          <div className="ka-pad">
            <button type="button" className="ka-pill d" onClick={() => void runTest()}>
              {testState === "running" ? "测试中…" : testState === "idle" ? "开始测试" : "再测一次"}
            </button>
          </div>
        </div>
        <div className="ka-sec"><span>没收到时</span><em>FAILED</em></div>
        <div className="ka-card">
          <div className="ka-res bad" style={{ margin: 16 }}>
            <b>6 秒内没有收到通知</b>
            先按下面三项逐条检查，再回来重测。
            <ol>
              <li>电池还没有设成“无限制”</li>
              <li>自启动和后台运行没有允许</li>
              <li>系统通知被关闭了</li>
            </ol>
          </div>
          <div className="ka-pad ka-row-btns">
            <button type="button" className="ka-pill f" onClick={() => handleOpenSetting("battery")}>去检查电池</button>
            <button type="button" className="ka-pill d" onClick={() => void runTest()}>再测一次</button>
          </div>
        </div>
      </div>
    );
  }

  if (view === "diag") {
    return (
      <div className="ka-wrap">
        <button type="button" className="ka-back" onClick={() => setView("overview")}>‹ 返回后台保护</button>
        <p className="ka-note">每个按钮最近一次的点击结果。出了问题，截图这一页就够了。</p>
        <div className="ka-card ka-mt14">
          {diag.length === 0 && <div className="ka-empty">还没有记录。点一下上面的按钮试试。</div>}
          {diag.slice(0, 60).map((entry, index) => (
            <div className="ka-log" key={`${entry.ts}-${index}`}>
              <time>{formatClock(entry.ts)}</time>
              <div>
                <b>{diagTitle(entry.key)}</b>
                <span className={`ka-tag ${entry.result === "ok" ? "ok" : entry.result === "fail" ? "bad" : "old"}`}>
                  {entry.result === "ok" ? "成功" : entry.result === "fail" ? "失败" : "未接入"}
                </span>
                <span>{entry.detail || "已记录"}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="ka-wrap">
      {!embedded && (
        <button type="button" className="ka-back" onClick={onBack}>‹ 返回设置</button>
      )}

      <div className="ka-card ka-hero">
        <svg className="ka-cat" viewBox="0 0 80 74" aria-hidden="true">
          <path d="M13 32L9 7l24 12M67 32l4-25-24 12" />
          <ellipse cx="40" cy="42" rx="28" ry="23" />
          <path d="M40 19q-5-8 3-11" />
          <ellipse cx="29" cy="41" rx="3.4" ry="4.6" fill="currentColor" />
          <ellipse cx="51" cy="41" rx="3.4" ry="4.6" fill="currentColor" />
          <path d="M15 49h7M16 53h6M65 49h-7M64 53h-6" stroke="#f0a9b6" />
          <path d="M36 49q2 3 4 0q2 3 4 0" />
          <circle cx="40" cy="68" r="3.6" />
        </svg>
        <div className="ka-k">保护状态</div>
        <div className="ka-big"><b>{doneCount}</b><span>/ 6</span></div>
        <div className="ka-seg">
          {items.map(item => <u key={item.key} className={item.state === "ok" ? "on" : ""} />)}
        </div>
        <p>
          {doneCount === 6
            ? "六项都已完成。手机系统仍可能强制结束后台应用，这套保护只能提高存活概率。"
            : `还差 ${6 - doneCount} 项。${loggedIn ? "按下面的提示逐项处理即可。" : "登录账号后，账号登录和后台消息服务会自动开启。"}`}
          <br />{checkedAt ? `上次读取：${formatClock(checkedAt)}` : "正在读取系统状态…"}
        </p>
        <div className="ka-acts">
          <button type="button" className="ka-pill d" onClick={refresh} disabled={checking}>
            {checking ? "检查中…" : "重新检查"}
          </button>
          <button type="button" className="ka-pill f" onClick={() => { setDiag(getDiagLog()); setView("diag"); }}>诊断记录</button>
        </div>
      </div>

      <div className="ka-sec"><span>网页层</span><em>WEB</em></div>
      <div className="ka-card">
        <div className="ka-row">
          <Icon name="wifi" />
          <div className="ka-tx">
            <b>网页运行保护</b>
            <span>网页还在内存时保持心跳与重连；被系统彻底结束后，不能单独救活</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={webGuard}
            className={`ka-sw ${webGuard ? "on" : ""}`}
            onClick={() => handleWebGuard(!webGuard)}
          >
            <i />
          </button>
        </div>
      </div>

      <div className="ka-sec"><span>云端</span><em>CLOUD</em></div>
      <div className="ka-card">
        <button type="button" className="ka-row ka-row-btn" onClick={onOpenCloud}>
          <Icon name="cloud" />
          <div className="ka-tx">
            <b>云端离线生成</b>
            <span>{cloudActive ? "已部署到你的云端，点开查看真实连接状态" : "还没有配置云端，点开去部署"}</span>
          </div>
          <span className="ka-arr">›</span>
        </button>
      </div>

      <div className="ka-sec"><span>安卓系统</span><em>SYSTEM</em></div>
      <div className="ka-card">
        {items.map(item => {
          const meta = ITEM_META[item.key];
          return (
            <div className="ka-row" key={item.key}>
              <Icon name={meta.icon} />
              <div className="ka-tx">
                <b>{meta.title}</b>
                <span>{stateText(item, loggedIn)}</span>
                {item.checkedAt && <small>{formatCheckedAgo(item.checkedAt)}</small>}
              </div>
              {renderChip(item, loggedIn, busyKey === item.key, () => {
                if (item.key === "login") { onNotice("请到用户身份里登录账号"); return; }
                handleOpenSetting(item.key);
              })}
            </div>
          );
        })}
        {bridgeReady && (
          <div className="ka-row">
            <Icon name="shield" />
            <div className="ka-tx">
              <b>手动确认</b>
              <span>系统读不到自启动状态，设置好后可以在这里记一笔</span>
            </div>
            <button type="button" className="ka-chip go" onClick={handleManualAutostart}>
              {manualAuto ? "已确认" : "我已设置好"}
            </button>
          </div>
        )}
      </div>

      <div className="ka-sec"><span>验证</span><em>VERIFY</em></div>
      <div className="ka-card">
        <button type="button" className="ka-row ka-row-btn" onClick={() => { setTestState("idle"); setTestStep(0); setView("test"); }}>
          <Icon name="snd" />
          <div className="ka-tx">
            <b>发送后台测试消息</b>
            <span>点击后立刻划到后台，约 6 秒后检查是否收到通知</span>
          </div>
          <span className="ka-arr">›</span>
        </button>
        <button type="button" className="ka-row ka-row-btn" onClick={refresh}>
          <Icon name="ref" />
          <div className="ka-tx">
            <b>重新读取系统状态</b>
            <span>{lastMessageText(diag)}</span>
          </div>
          <span className="ka-arr">›</span>
        </button>
      </div>

      <p className="ka-foot">
        这套是可验证的前台服务、断线重连和系统恢复，不是假开关。
        手机厂商仍可能强制结束普通应用；要做到接近微信，还需要接入系统级推送通道。
        {!bridgeReady && <><br /><b>当前安装包没有原生桥，系统项只能显示“需更新安装包”。</b></>}
        {bridgeReady && shell?.version && <><br />当前安装包版本：{shell.version}</>}
      </p>
    </div>
  );
}

function stateText(item: KeepAliveItem, loggedIn: boolean): string {
  if (item.key === "login") return loggedIn ? "已登录，消息通道已订阅" : "登录后才会订阅你的专属消息通道";
  if (item.state === "unsupported") return "需要更新的安装包才能读取这一项";
  return item.detail;
}

function renderChip(item: KeepAliveItem, loggedIn: boolean, busy: boolean, onClick: () => void) {
  if (item.key === "login") {
    return <button type="button" className="ka-chip go" onClick={onClick}>{loggedIn ? "已登录" : "去登录"}</button>;
  }
  if (item.state === "unsupported") {
    return <span className="ka-chip old">需更新</span>;
  }
  if (item.key === "autostart") {
    return (
      <button type="button" className="ka-chip go" onClick={onClick}>
        {busy ? "打开中…" : "去设置"}
      </button>
    );
  }
  if (busy) return <span className="ka-chip">读取中…</span>;
  if (item.state === "ok") return <span className="ka-chip ok">已完成</span>;
  if (item.state === "fail") return <span className="ka-chip bad">未开启</span>;
  if (item.key === "service") return <span className="ka-chip wait">{loggedIn ? "待启动" : "待登录"}</span>;
  return <button type="button" className="ka-chip go" onClick={onClick}>去开启</button>;
}

function diagTitle(key: string): string {
  const map: Record<string, string> = {
    login: "账号登录",
    service: "后台消息服务",
    notification: "系统通知",
    battery: "电池无限制",
    exactAlarm: "准时自检",
    autostart: "自启动与后台运行",
    refresh: "重新读取系统状态",
    test: "发送后台测试消息",
  };
  return map[key] ?? key;
}

function lastMessageText(diag: DiagEntry[]): string {
  const last = diag.find(entry => entry.key === "test");
  if (!last) return "最近收到后台消息：暂无记录";
  return `最近一次测试：${formatClock(last.ts)} · ${last.result === "ok" ? "成功" : "失败"}`;
}
