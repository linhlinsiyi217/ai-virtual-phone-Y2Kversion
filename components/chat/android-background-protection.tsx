"use client";

import { useCallback, useEffect, useState } from "react";
import { BatteryCharging, Bell, Clock3, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";

import { isShellEnvironment } from "@/lib/push-client";

type ProtectionStatus = {
  accountReady: boolean;
  serviceRunning: boolean;
  watchdogScheduled: boolean;
  batteryOptimizationIgnored: boolean;
  notificationsEnabled: boolean;
  exactAlarmAllowed: boolean;
  manufacturer: string;
  sdk: number;
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

function StatusButton({ ok, onClick, children }: { ok: boolean; onClick?: () => void; children: string }) {
  return (
    <button
      type="button"
      className="ui-btn ui-btn-outline shrink-0 !px-3 !py-1.5 !text-[12px]"
      onClick={onClick}
      disabled={ok || !onClick}
    >
      {ok ? "已开启" : children}
    </button>
  );
}

function Dot({ ok }: { ok: boolean }) {
  return <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`} />;
}

export function AndroidBackgroundProtection() {
  const [supported, setSupported] = useState(false);
  const [status, setStatus] = useState<ProtectionStatus | null>(null);

  const refresh = useCallback(() => {
    if (!isShellEnvironment()) return;
    const native = bridge();
    if (!native?.getBackgroundProtectionStatus) return;
    setSupported(true);
    try {
      setStatus(JSON.parse(native.getBackgroundProtectionStatus()) as ProtectionStatus);
    } catch {
      setStatus(null);
    }
  }, []);

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

  if (!supported) return null;

  const serviceOk = Boolean(status?.accountReady && status?.serviceRunning && status?.watchdogScheduled);
  const run = (action: keyof ProtectionBridge) => {
    try {
      const native = bridge();
      const fn = native?.[action];
      if (typeof fn === "function") (fn as () => unknown).call(native);
    } finally {
      window.setTimeout(refresh, 800);
    }
  };

  return (
    <>
      <p className="menu-group-desc mx-2">安卓后台保护</p>
      <div className="menu-group">
        <div className="menu-item">
          <ShieldCheck size={20} strokeWidth={1.8} className="shrink-0" />
          <div className="menu-label-group">
            <span className="menu-label">后台消息服务</span>
            <span className="menu-desc">前台服务 + 15 分钟系统自检，被回收后会尝试恢复</span>
          </div>
          <div className="menu-right flex items-center gap-2">
            <Dot ok={serviceOk} />
            <span className="ts-12 whitespace-nowrap">{serviceOk ? "运行中" : status?.accountReady ? "恢复中" : "待登录"}</span>
          </div>
        </div>
        <div className="menu-item">
          <BatteryCharging size={20} strokeWidth={1.8} className="shrink-0" />
          <div className="menu-label-group">
            <span className="menu-label">电池无限制</span>
            <span className="menu-desc">让网络和自检在锁屏、Doze 时少被系统暂停</span>
          </div>
          <StatusButton ok={Boolean(status?.batteryOptimizationIgnored)} onClick={() => run("requestIgnoreBatteryOptimization")}>去开启</StatusButton>
        </div>
        <div className="menu-item">
          <Bell size={20} strokeWidth={1.8} className="shrink-0" />
          <div className="menu-label-group">
            <span className="menu-label">系统通知</span>
            <span className="menu-desc">关闭后后台仍可能运行，但你看不到消息提醒</span>
          </div>
          <StatusButton ok={Boolean(status?.notificationsEnabled)} onClick={() => run("openNotificationSettings")}>去开启</StatusButton>
        </div>
        <div className="menu-item">
          <Clock3 size={20} strokeWidth={1.8} className="shrink-0" />
          <div className="menu-label-group">
            <span className="menu-label">准时自检</span>
            <span className="menu-desc">允许系统在深度休眠时更准时检查后台服务</span>
          </div>
          <StatusButton ok={Boolean(status?.exactAlarmAllowed)} onClick={() => run("requestExactAlarmPermission")}>去开启</StatusButton>
        </div>
        <div className="menu-item">
          <Smartphone size={20} strokeWidth={1.8} className="shrink-0" />
          <div className="menu-label-group">
            <span className="menu-label">自启动与后台运行</span>
            <span className="menu-desc">打开 {status?.manufacturer || "手机"} 的真实系统管理页手动允许</span>
          </div>
          <button type="button" className="ui-btn ui-btn-outline shrink-0 !px-3 !py-1.5 !text-[12px]" onClick={() => run("openAutoStartSettings")}>去设置</button>
        </div>
        <div className="menu-item">
          <RefreshCw size={20} strokeWidth={1.8} className="shrink-0" />
          <div className="menu-label-group">
            <span className="menu-label">重新检查</span>
            <span className="menu-desc">从安卓系统重新读取当前状态，不保存假状态</span>
          </div>
          <button type="button" className="ui-btn ui-btn-outline shrink-0 !px-3 !py-1.5 !text-[12px]" onClick={refresh}>检查</button>
        </div>
      </div>
      <p className="menu-group-desc mx-2">
        这些状态直接来自安卓系统。不同品牌仍可能有额外省电限制；进入系统页面后请把小手机设为“允许自启动、允许后台活动、电池无限制”。
      </p>
    </>
  );
}
