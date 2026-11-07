"use client";

import { useCallback, useEffect, useState } from "react";
import { LogOut, MessageCircle, ShieldCheck } from "lucide-react";
import type { VirtualAccount } from "@/lib/social-types";
import { SOCIAL_DATA_UPDATED_EVENT } from "@/lib/social-db";
import { getAppVirtualLogin, logoutAppVirtualLogin } from "@/lib/virtual-account-service";

export function AppAccountsSettings({ onNotice }: { onNotice: (message: string) => void }) {
  const [chatAccount, setChatAccount] = useState<VirtualAccount | null>(null);
  const load = useCallback(() => void getAppVirtualLogin("chat").then(result => setChatAccount(result?.account ?? null)), []);
  useEffect(() => {
    load();
    window.addEventListener(SOCIAL_DATA_UPDATED_EVENT, load);
    return () => window.removeEventListener(SOCIAL_DATA_UPDATED_EVENT, load);
  }, [load]);

  return <div className="app-account-settings">
    <section className="app-account-summary">
      <span><ShieldCheck /></span>
      <div><h2>应用登录状态</h2><p>这里只管理状态。输入密码和切换账号请在对应应用内完成。</p></div>
    </section>
    <section className="app-account-list">
      <div className="app-account-row">
        <span className="app-account-icon"><MessageCircle /></span>
        <span className="app-account-copy"><b>聊天</b><small>{chatAccount ? `${chatAccount.displayName} · @${chatAccount.handle}` : "未登录"}</small></span>
        <span className={`app-account-state ${chatAccount ? "is-on" : ""}`}><i />{chatAccount ? "已登录" : "未登录"}</span>
      </div>
      {chatAccount ? <button className="app-account-logout" onClick={async () => { await logoutAppVirtualLogin("chat"); onNotice("聊天账号已退出"); }}><LogOut />退出聊天账号</button> : null}
    </section>
    <p className="app-account-note">设置和聊天是两个独立界面。退出这里只会清除聊天应用的模拟登录，不会删除虚拟账号。</p>
  </div>;
}
