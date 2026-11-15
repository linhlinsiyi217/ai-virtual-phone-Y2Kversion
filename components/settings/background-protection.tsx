"use client";

// 设置里的「后台保护」入口：渲染设计图 v2 的后台保护页。
// 状态读取与原生调用都在 lib/keep-alive-native.ts 里，兼容现有安装包的 AndroidShell。

import { useAccount } from "@/lib/account-context";
import { KeepAlivePage } from "@/components/keep-alive/keep-alive-page";

export function BackgroundProtection({
  onOpenCloudServices,
  onNotice,
}: {
  onOpenCloudServices: () => void;
  onNotice: (message: string) => void;
}) {
  const { account } = useAccount();
  return (
    <KeepAlivePage
      embedded
      loggedIn={!!account}
      onBack={() => {}}
      onOpenCloud={onOpenCloudServices}
      onNotice={onNotice}
    />
  );
}
