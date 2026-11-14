"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BatteryCharging,
  Bell,
  CheckCircle2,
  ChevronRight,
  Clock3,
  CloudUpload,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  Wifi,
} from "lucide-react";

import { Toggle } from "@/components/ui/form";
import { isPersonalPushCloudActive } from "@/lib/personal-push-cloud";
import { isShellEnvironment, sendTestOfflinePush } from "@/lib/push-client";
import { loadKeepAlive, saveKeepAlive } from "@/lib/weixin-storage";

type ProtectionStatus = {
  accountReady: boolean;
  serviceRunning: boolean;
  watchdogScheduled: boolean;
  batteryOptimizationIgnored: boolean;
  notificationsEnabled: boolean;
  exactAlarmAllowed: boolean;
  manufacturer: string;
  sdk: number;
  connectionState?: "stopped" | "connecting" | "connected" | "reconnecting" | "site_unreachable" | "not_configured";
  lastConnectedAt?: number;
  lastMessageAt?: number;
};

type ProtectionBridge = {
  getBackgroundProtectionStatus?: () => string;
  requestIgnoreBatteryOptimization?: () => void;
  openNotificationSettings?: () => void;
  requestExactAlarmPermission?: () => void;
  openAutoStartSettings?: () => boolean;
};

function bridge(): ProtectionBridge | undefined {
  return (window as unknown as { AndroidShell?: ProtectionBridge }).AndroidShell;
}

function Dot({ ok, warning = false }: { ok: boolean; warning?: boolean }) {
  return <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${ok ? "bg-emerald-500" : warning ? "bg-amber-500" : "bg-black/20"}`} />;
}

function StatusButton({ ok, onClick, children }: { ok: boolean; onClick?: () => void; children: string }) {
  return (
    <button
      type="button"
      className="ui-btn ui-btn-outline shrink-0 !px-3 !py-1.5 !text-[12px]"
      onClick={onClick}
      disabled={ok || !onClick}
    >
      {ok ? "已完成" : children}
    </button>
  );
}

function readableTime(value?: number): string {
  if (!value) return "暂无记录";
  return new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function connectionCopy(status: ProtectionStatus | null): { label: string; desc: string; ok: boolean } {
  if (!status?.accountReady) return { label: "等待账号登录", desc: "登录后 APK 才会订阅你的专属消息通道", ok: false };
  if (status.connectionState === "connected") {
    return { label: "消息通道已连接", desc: `最近连通：${readableTime(status.lastConnectedAt)}`, ok: true };
  }
  if (status.connectionState === "not_configured") {
    return { label: "云端消息尚未配置", desc: "先完成云服务部署，APK 才知道去哪里接收消息", ok: false };
  }
  if (status.connectionState === "site_unreachable") {
    return { label: "站点暂时不可达", desc: "后台会自动重连，不会反复弹出登录提醒", ok: false };
  }
  if (!status.connectionState && status.serviceRunning) {
    return { label: "后台服务运行中", desc: "安装新版 APK 后，这里会显示实时连接状态", ok: false };
  }
  if (status.serviceRunning) return { label: "正在建立消息通道", desc: "前台服务正在运行，连接成功后会自动更新", ok: false };
  return { label: "后台服务正在恢复", desc: "系统看门狗会尝试重新拉起", ok: false };
}

export function BackgroundProtection({
  onOpenCloudServices,
  onNotice,
}: {
  onOpenCloudServices: () => void;
  onNotice: (message: string) => void;
}) {
  const shell = isShellEnvironment();
  const [webProtection, setWebProtection] = useState(false);
  const [cloudActive, setCloudActive] = useState(false);
  const [status, setStatus] = useState<ProtectionStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [testHint, setTestHint] = useState("");

  const refresh = useCallback(() => {
    setWebProtection(loadKeepAlive());
    setCloudActive(isPersonalPushCloudActive());
    if (!shell) {
      setStatus(null);
      return;
    }
    const native = bridge();
    if (!native?.getBackgroundProtectionStatus) {
      setStatus(null);
      return;
    }
    try {
      setStatus(JSON.parse(native.getBackgroundProtectionStatus()) as ProtectionStatus);
    } catch {
      setStatus(null);
    }
  }, [shell]);

  useEffect(() => {
    refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") window.setTimeout(refresh, 250);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const runNative = (action: keyof ProtectionBridge) => {
    try {
      const native = bridge();
      const fn = native?.[action];
      if (typeof fn === "function") (fn as () => unknown).call(native);
    } finally {
      window.setTimeout(refresh, 800);
    }
  };

  const setWeb = (next: boolean) => {
    setWebProtection(next);
    saveKeepAlive(next);
    window.dispatchEvent(new CustomEvent("weixin-config-changed"));
    onNotice(next ? "网页运行保护已开启" : "网页运行保护已关闭");
  };

  const handleTest = async () => {
    if (testing) return;
    setTesting(true);
    setTestHint("测试消息已排队。现在可以把 App 划到后台，约 6 秒后应收到系统通知。");
    try {
      const result = await sendTestOfflinePush();
      if (!result.ok) setTestHint(result.error || "测试发送失败，请先检查云端消息通道。");
    } finally {
      setTesting(false);
      window.setTimeout(refresh, 1000);
    }
  };

  const serviceOk = Boolean(status?.accountReady && status?.serviceRunning && status?.watchdogScheduled);
  const connection = connectionCopy(status);
  const completed = useMemo(() => {
    if (!shell) return webProtection ? 1 : 0;
    return [
      cloudActive,
      connection.ok,
      serviceOk,
      Boolean(status?.notificationsEnabled),
      Boolean(status?.batteryOptimizationIgnored),
      Boolean(status?.exactAlarmAllowed),
    ].filter(Boolean).length;
  }, [cloudActive, connection.ok, serviceOk, shell, status, webProtection]);
  const total = shell ? 6 : 1;

  return (
    <div className="page-menu profile-settings-menu">
      <div className="menu-group">
        <div className="menu-item !items-start !gap-3 !py-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-600">
            <ShieldCheck size={24} strokeWidth={1.8} />
          </span>
          <div className="menu-label-group">
            <span className="menu-label">保护状态 {completed}/{total}</span>
            <span className="menu-desc">
              {shell
                ? completed === total ? "关键保护均已完成，可以划到后台做消息测试。" : "按下面顺序完成，状态全部来自安卓系统与真实消息通道。"
                : "当前是网页环境，只能保护仍存活的网页；要获得 APK 系统保护请安装安卓包。"}
            </span>
          </div>
        </div>
      </div>

      <p className="menu-group-desc mx-2">网页保护</p>
      <div className="menu-group">
        <div className="menu-item">
          <Wifi size={20} strokeWidth={1.8} className="shrink-0" />
          <div className="menu-label-group">
            <span className="menu-label">网页运行保护</span>
            <span className="menu-desc">网页仍在内存时保持心跳与重连；被系统彻底结束后不能单独救活</span>
          </div>
          <Toggle checked={webProtection} onChange={setWeb} />
        </div>
      </div>

      <p className="menu-group-desc mx-2">云端消息</p>
      <div className="menu-group">
        <button type="button" className="menu-item w-full text-left" onClick={onOpenCloudServices}>
          <CloudUpload size={20} strokeWidth={1.8} className="shrink-0" />
          <div className="menu-label-group">
            <span className="menu-label">云端离线生成</span>
            <span className="menu-desc">{cloudActive ? "已部署到你的 Supabase" : "填写一次 Supabase 配置，让 App 关闭后仍能生成并投递消息"}</span>
          </div>
          <div className="menu-right flex items-center gap-2">
            <Dot ok={cloudActive} />
            <span className="ts-12 whitespace-nowrap">{cloudActive ? "已部署" : "去配置"}</span>
            <ChevronRight size={16} />
          </div>
        </button>
      </div>

      {shell ? (
        <>
          <p className="menu-group-desc mx-2">APK 真实保护</p>
          <div className="menu-group">
            <div className="menu-item">
              <Send size={20} strokeWidth={1.8} className="shrink-0" />
              <div className="menu-label-group">
                <span className="menu-label">{connection.label}</span>
                <span className="menu-desc">{connection.desc}</span>
              </div>
              <Dot ok={connection.ok} warning={Boolean(status?.accountReady)} />
            </div>
            <div className="menu-item">
              <ShieldCheck size={20} strokeWidth={1.8} className="shrink-0" />
              <div className="menu-label-group">
                <span className="menu-label">后台消息服务</span>
                <span className="menu-desc">常驻消息服务 + 15 分钟系统自检，被回收后尝试恢复</span>
              </div>
              <div className="menu-right flex items-center gap-2">
                <Dot ok={serviceOk} warning={Boolean(status?.accountReady)} />
                <span className="ts-12 whitespace-nowrap">{serviceOk ? "运行中" : status?.accountReady ? "恢复中" : "待登录"}</span>
              </div>
            </div>
            <div className="menu-item">
              <Bell size={20} strokeWidth={1.8} className="shrink-0" />
              <div className="menu-label-group">
                <span className="menu-label">系统通知</span>
                <span className="menu-desc">允许锁屏、横幅和通知栏显示角色消息</span>
              </div>
              <StatusButton ok={Boolean(status?.notificationsEnabled)} onClick={() => runNative("openNotificationSettings")}>去开启</StatusButton>
            </div>
            <div className="menu-item">
              <BatteryCharging size={20} strokeWidth={1.8} className="shrink-0" />
              <div className="menu-label-group">
                <span className="menu-label">电池无限制</span>
                <span className="menu-desc">降低锁屏和省电模式暂停后台网络的概率</span>
              </div>
              <StatusButton ok={Boolean(status?.batteryOptimizationIgnored)} onClick={() => runNative("requestIgnoreBatteryOptimization")}>去开启</StatusButton>
            </div>
            <div className="menu-item">
              <Clock3 size={20} strokeWidth={1.8} className="shrink-0" />
              <div className="menu-label-group">
                <span className="menu-label">准时自检</span>
                <span className="menu-desc">深度休眠时也尽量按计划检查消息服务</span>
              </div>
              <StatusButton ok={Boolean(status?.exactAlarmAllowed)} onClick={() => runNative("requestExactAlarmPermission")}>去开启</StatusButton>
            </div>
            <div className="menu-item">
              <Smartphone size={20} strokeWidth={1.8} className="shrink-0" />
              <div className="menu-label-group">
                <span className="menu-label">自启动与后台运行</span>
                <span className="menu-desc">进入 {status?.manufacturer || "手机"} 的真实系统页面，手动允许自启动和后台活动</span>
              </div>
              <button type="button" className="ui-btn ui-btn-outline shrink-0 !px-3 !py-1.5 !text-[12px]" onClick={() => runNative("openAutoStartSettings")}>去设置</button>
            </div>
          </div>

          <p className="menu-group-desc mx-2">验证</p>
          <div className="menu-group">
            <button type="button" className="menu-item w-full text-left" onClick={() => void handleTest()} disabled={testing}>
              {testing ? <Loader2 size={20} className="shrink-0 animate-spin" /> : <Send size={20} strokeWidth={1.8} className="shrink-0" />}
              <div className="menu-label-group">
                <span className="menu-label">发送后台测试消息</span>
                <span className="menu-desc">点击后立刻划到后台，约 6 秒后检查是否收到通知</span>
              </div>
              <ChevronRight size={16} />
            </button>
            <button type="button" className="menu-item w-full text-left" onClick={refresh}>
              <RefreshCw size={20} strokeWidth={1.8} className="shrink-0" />
              <div className="menu-label-group">
                <span className="menu-label">重新读取系统状态</span>
                <span className="menu-desc">最近收到后台消息：{readableTime(status?.lastMessageAt)}</span>
              </div>
              <ChevronRight size={16} />
            </button>
          </div>
          {testHint ? <p className="menu-group-desc mx-2">{testHint}</p> : null}
          <p className="menu-group-desc mx-2">
            这套是可验证的前台服务、断线重连和系统恢复，不是假开关。手机厂商仍可能强制结束普通应用；真正做到接近微信，还需要后续接入 Google 或手机厂商的系统级推送通道。
          </p>
        </>
      ) : (
        <div className="menu-group">
          <div className="menu-item !items-start">
            <Smartphone size={20} strokeWidth={1.8} className="mt-0.5 shrink-0" />
            <div className="menu-label-group">
              <span className="menu-label">APK 系统保护仅在安卓包内可用</span>
              <span className="menu-desc">浏览器网页无法申请自启动、电池无限制或启动原生后台消息服务。</span>
            </div>
          </div>
        </div>
      )}

      {shell && completed === total ? (
        <div className="mx-2 mt-3 flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-emerald-700">
          <CheckCircle2 size={18} />
          <span className="ts-13 font-semibold">本机可配置的保护项目已全部完成</span>
        </div>
      ) : null}
    </div>
  );
}
