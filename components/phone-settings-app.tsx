"use client";

import { useState, useEffect, useLayoutEffect, useCallback, useRef, createContext, type CSSProperties, type ReactNode } from "react";
import { Activity, CalendarDays, Camera, Check, ChevronRight, Database, Fingerprint, Globe, HardDrive, Image, Info, KeyRound, Laptop, Layers, LayoutTemplate, Link2, Loader2, LogOut, MessageSquare, Mic, PhoneCall, ShieldCheck, UserCircle, Wrench, X, CloudUpload, Zap } from "lucide-react";
import { ConfirmDialog } from "./ui/modal";
import { useAccount } from "@/lib/account-context";
import { isSelfHostedModeEnabled } from "@/lib/self-hosting";
import { changeAccountPassword } from "@/lib/account-client";
import { ApiSettings } from "./settings/api-settings";
import { VoiceSettings } from "./settings/voice-settings";
import { ImageGenerationSettings } from "./settings/image-generation-settings";
import { PresetManager } from "./settings/preset-manager";
import { WorldBookManager } from "./settings/worldbook-manager";
import { RegexManager } from "./settings/regex-manager";
import { DataManagement } from "./settings/data-management";
import { UserIdentitySettings } from "./settings/user-identity";
import { AccountCenter } from "./settings/account-center";
import { ChangelogPage } from "./update-log/changelog-page";
import { BindingManager } from "./settings/binding-manager";
import { WeixinSettings } from "./settings/weixin-settings";
import { CloudServicesPage } from "./settings/cloud-services-setup";
import { ToolboxSettings } from "./settings/toolbox-settings";
import { ModerationCenter } from "./settings/moderation-center";
import { AgentComputerSettings } from "./settings/agent-computer-settings";
import { CallOverlaySettings } from "./settings/call-overlay-settings";
import { PerceptionSettings } from "./perception/perception-settings";
import { DeviceActionSettings } from "./device-action/device-action-settings";
import { SystemCalendarSettings } from "./system-calendar/system-calendar-settings";
import { ScreenshotSettings } from "./screenshot/screenshot-settings";
import { WidgetSettings } from "./widget/widget-settings";
import { fetchIsAdmin } from "@/lib/moderation-client";
import { PageShell } from "./ui/page-shell";
import { CardGrid, FeaturedCard, type CardItem, type FeaturedCardItem } from "./ui/card-grid";
import { GlassIcon } from "./ui/glass-icon";
import { Toggle } from "./ui/form";
import { loadChatAppSettings, saveChatAppSettings } from "@/lib/chat-storage";
import { loadKeepAlive, saveKeepAlive } from "@/lib/weixin-storage";
import { BINDING_ACCENTS, CONTENT_APP_ACCENTS } from "@/lib/ui-accent-colors";
import { changeFloatingTool } from "@/lib/floating-tools";
import { CHAT_APP_SETTINGS_UPDATED_EVENT } from "@/lib/chat-storage";
import { getActiveVirtualAccount } from "@/lib/virtual-account-service";
import { SOCIAL_DATA_UPDATED_EVENT } from "@/lib/social-db";
import type { VirtualAccount } from "@/lib/social-types";

export const SettingsContext = createContext<{
    setSubpageTitle: (title: string | null) => void;
    setOverrideBack: (action: (() => void) | null) => void;
    setSubpageRightAction: (page: string, action: ReactNode | null) => void;
}>({ setSubpageTitle: () => { }, setOverrideBack: () => { }, setSubpageRightAction: () => { } });

type SettingsPageProps = {
    onClose: () => void;
    onNotice: (msg: string) => void;
};

type SubPage =
    | "main"
    | "api"
    | "voice"
    | "imageGeneration"
    | "presets"
    | "worldbook"
    | "regex"
    | "data"
    | "binding"
    | "accountCenter"
    | "appAccounts"
    | "identity"
    | "cloud"
    | "weixin"
    | "toolbox"
    | "agentComputer"
    | "moderation"
    | "callOverlay"
    | "perception"
    | "deviceAction"
    | "systemCalendar"
    | "screenshot"
    | "widget"
    | "about";

const SETTINGS_MENU = [
    { id: "api", icon: HardDrive, label: "API 设置", desc: "大模型接口", iconColor: BINDING_ACCENTS.api , glass: "api" },
    { id: "voice", icon: Mic, label: "语音 API", desc: "语音合成", iconColor: BINDING_ACCENTS.voice , glass: "voice" },
    { id: "imageGeneration", icon: Image, label: "图像生成 API", desc: "模型、参考图与提示词", iconColor: CONTENT_APP_ACCENTS.moments , glass: "image-generation" },
    { id: "presets", icon: Fingerprint, label: "预设", desc: "角色预设", iconColor: BINDING_ACCENTS.preset , glass: "presets" },
    { id: "worldbook", icon: Globe, label: "世界书", desc: "世界观设定", iconColor: BINDING_ACCENTS.worldBook , glass: "worldbook" },
    { id: "regex", icon: Database, label: "正则规则", desc: "文本替换", iconColor: BINDING_ACCENTS.regex , glass: "regex" },
    { id: "data", icon: Layers, label: "数据管理", desc: "导入导出", iconColor: BINDING_ACCENTS.api , glass: "data" },
    { id: "binding", icon: Link2, label: "配置绑定", desc: "管理全局默认、角色与应用的配置绑定关系", iconColor: BINDING_ACCENTS.identity , glass: "binding" },
    { id: "cloud", icon: CloudUpload, label: "云服务部署", desc: "备份 / 微信 / 推送一站配置", iconColor: BINDING_ACCENTS.api , glass: "" },
    { id: "weixin", icon: MessageSquare, label: "微信接入", desc: "iLink Bot", iconColor: CONTENT_APP_ACCENTS.chat , glass: "weixin" },
    { id: "toolbox", icon: Wrench, label: "聊天工具箱", desc: "外部工具调用", iconColor: BINDING_ACCENTS.voice , glass: "toolbox" },
    { id: "callOverlay", icon: PhoneCall, label: "通话浮窗外观", desc: "回复条配色", iconColor: BINDING_ACCENTS.voice , glass: "voice" },
    { id: "perception", icon: Activity, label: "感知", desc: "让角色知道电量、网络与在用应用", iconColor: BINDING_ACCENTS.memory , glass: "" },
    { id: "deviceAction", icon: Zap, label: "操作设备", desc: "让角色帮你开灯、调音量、打开应用", iconColor: BINDING_ACCENTS.voice , glass: "" },
    { id: "systemCalendar", icon: CalendarDays, label: "系统日历", desc: "让角色知道你的日程、记下纪念日", iconColor: BINDING_ACCENTS.memory , glass: "" },
    { id: "screenshot", icon: Camera, label: "截屏", desc: "让角色看一眼你现在的屏幕", iconColor: BINDING_ACCENTS.voice , glass: "" },
    { id: "widget", icon: LayoutTemplate, label: "桌面小组件", desc: "角色留在桌面上的话", iconColor: BINDING_ACCENTS.memory , glass: "" },
    { id: "agentComputer", icon: Laptop, label: "角色电脑", desc: "云端小电脑（自部署）", iconColor: BINDING_ACCENTS.memory , glass: "agent-computer" },
    { id: "identity", icon: UserCircle, label: "用户身份", desc: "个人信息", iconColor: BINDING_ACCENTS.identity , glass: "identity" },
    { id: "about", icon: Info, label: "更新日志", desc: "版本与历史", iconColor: BINDING_ACCENTS.memory , glass: "about" },
] as const;

const realtimeIconStyle = {
    "--icon-color": CONTENT_APP_ACCENTS.calendar,
} as CSSProperties;

const keepAliveIconStyle = {
    "--icon-color": CONTENT_APP_ACCENTS.chat,
} as CSSProperties;

const promptViewerIconStyle = {
    "--icon-color": BINDING_ACCENTS.preset,
} as CSSProperties;

const quickActionIconStyle = {
    "--icon-color": BINDING_ACCENTS.worldBook,
} as CSSProperties;

const accountIconStyle = {
    "--icon-color": BINDING_ACCENTS.identity,
} as CSSProperties;

const passwordIconStyle = {
    "--icon-color": BINDING_ACCENTS.api,
} as CSSProperties;

const logoutIconStyle = {
    "--icon-color": "var(--c-danger)",
} as CSSProperties;

export function PhoneSettingsApp({ onClose, onNotice }: SettingsPageProps) {
    const [currentPage, setCurrentPage] = useState<SubPage>("main");
    const [subpageTitle, setSubpageTitle] = useState<string | null>(null);
    const [subpageRightActions, setSubpageRightActions] = useState<Record<string, ReactNode>>({});
    const [overrideBack, setOverrideBack] = useState<(() => void) | null>(null);
    const [timeAware, setTimeAware] = useState(true);
    const [promptViewerEnabled, setPromptViewerEnabled] = useState(false);
    const [quickActionEnabled, setQuickActionEnabled] = useState(false);
    const [floatingToolsEnabled, setFloatingToolsEnabled] = useState(false);
    const [keepAlive, setKeepAlive] = useState(false);
    // 角色电脑：施工中弹窗（返回 / 仍要看看）
    const pageBodyRef = useRef<HTMLDivElement | null>(null);

    // ── 账号：显示当前登录 / 修改密码 / 退出登录 ──
    const selfHostedMode = isSelfHostedModeEnabled();
    const { account, logout } = useAccount();
    const [pwdModalOpen, setPwdModalOpen] = useState(false);
    const [oldPwd, setOldPwd] = useState("");
    const [newPwd, setNewPwd] = useState("");
    const [confirmPwd, setConfirmPwd] = useState("");
    const [pwdBusy, setPwdBusy] = useState(false);
    const [pwdError, setPwdError] = useState("");
    const [confirmLogout, setConfirmLogout] = useState(false);
    const [accountSheetOpen, setAccountSheetOpen] = useState(false);
    const [virtualAccount, setVirtualAccount] = useState<VirtualAccount | null>(null);

    useEffect(() => {
        const loadLocalAccount = async () => {
            setVirtualAccount(await getActiveVirtualAccount());
        };
        void loadLocalAccount();
        const sync = () => void loadLocalAccount();
        window.addEventListener(SOCIAL_DATA_UPDATED_EVENT, sync);
        return () => window.removeEventListener(SOCIAL_DATA_UPDATED_EVENT, sync);
    }, []);

    // ── 管理中心入口：仅 role=admin 的账号可见 ──
    const [isAdmin, setIsAdmin] = useState(false);
    useEffect(() => {
        if (selfHostedMode || !account) return;
        let cancelled = false;
        void fetchIsAdmin().then(result => { if (!cancelled) setIsAdmin(result); });
        return () => { cancelled = true; };
    }, [selfHostedMode, account]);

    const closePwdModal = () => {
        if (pwdBusy) return;
        setPwdModalOpen(false);
        setOldPwd("");
        setNewPwd("");
        setConfirmPwd("");
        setPwdError("");
    };

    const handleChangePassword = async () => {
        if (pwdBusy) return;
        if (!oldPwd || !newPwd) { setPwdError("请填写当前密码和新密码。"); return; }
        if (newPwd.length < 6) { setPwdError("新密码至少需要 6 位。"); return; }
        if (newPwd !== confirmPwd) { setPwdError("两次输入的新密码不一致。"); return; }
        setPwdBusy(true);
        setPwdError("");
        try {
            const result = await changeAccountPassword({ oldPassword: oldPwd, newPassword: newPwd });
            if (!result.ok) { setPwdError(result.error || "修改失败。"); return; }
            setPwdModalOpen(false);
            setOldPwd("");
            setNewPwd("");
            setConfirmPwd("");
            onNotice("密码已修改");
        } finally {
            setPwdBusy(false);
        }
    };

    const handleCopyUsername = () => {
        if (navigator.clipboard?.writeText) {
            void navigator.clipboard.writeText(account.username).then(() => onNotice("用户名已复制"));
        } else {
            onNotice(`用户名：${account.username}`);
        }
    };

    const defaultTitle = currentPage === "main"
        ? "设置"
        : currentPage === "accountCenter"
            ? "账号与登录"
        : currentPage === "appAccounts"
            ? "登录到聊天"
        : currentPage === "identity"
            ? "我的资料"
        : currentPage === "api" || currentPage === "voice" || currentPage === "imageGeneration" || currentPage === "presets" || currentPage === "worldbook" || currentPage === "regex"
            ? ""
            : currentPage === "moderation"
                ? "管理中心"
                : SETTINGS_MENU.find(m => m.id === currentPage)?.label || "设置";
    const title = subpageTitle || defaultTitle;

    const setSubpageRightAction = useCallback((page: string, action: ReactNode | null) => {
        setSubpageRightActions(prev => {
            if (action === null) {
                const next = { ...prev };
                delete next[page];
                return next;
            }
            return { ...prev, [page]: action };
        });
    }, []);

    const handleBack = () => {
        if (overrideBack) {
            overrideBack();
        } else if (currentPage !== "main") {
            setCurrentPage("main");
            setSubpageTitle(null);
            setOverrideBack(null);
        } else {
            onClose();
        }
    };

    const makeCardItem = (item: typeof SETTINGS_MENU[number]): CardItem => ({
        id: item.id,
        icon: item.icon,
        label: item.label,
        desc: item.desc,
        iconColor: item.iconColor,
        glassIcon: item.glass,
        onClick: () => {
            // 施工中：角色电脑先弹提示，可选择仍要看看
            setCurrentPage(item.id as SubPage);
        },
    });

    const handleTimeAwareChange = useCallback((next: boolean) => {
        setTimeAware(next);
        saveChatAppSettings({ ...loadChatAppSettings(), timeAware: next });
        onNotice(next ? "已开启全局真实时间感知" : "已关闭全局真实时间感知");
    }, [onNotice]);

    const handlePromptViewerChange = useCallback((next: boolean) => {
        setPromptViewerEnabled(next);
        saveChatAppSettings(changeFloatingTool(loadChatAppSettings(), "promptViewerEnabled", next));
        onNotice(next ? "已开启提示词查看器" : "已关闭提示词查看器");
    }, [onNotice]);

    const handleQuickActionChange = useCallback((next: boolean) => {
        setQuickActionEnabled(next);
        saveChatAppSettings(changeFloatingTool(loadChatAppSettings(), "quickActionEnabled", next));
        onNotice(next ? "已开启快捷操作" : "已关闭快捷操作");
    }, [onNotice]);

    const handleFloatingToolsChange = useCallback((next: boolean) => {
        saveChatAppSettings(changeFloatingTool(loadChatAppSettings(), "floatingToolsEnabled", next));
        onNotice(next ? "已开启悬浮工具" : "已关闭悬浮工具");
    }, [onNotice]);

    const handleKeepAliveChange = useCallback((next: boolean) => {
        setKeepAlive(next);
        saveKeepAlive(next);
        // use-weixin-bridge 监听这个事件来起停保活（与微信 Bot 的启用状态无关）
        window.dispatchEvent(new CustomEvent("weixin-config-changed"));
        onNotice(next ? "已开启后台保活" : "已关闭后台保活");
    }, [onNotice]);

    const imageGenerationItem = SETTINGS_MENU.find(i => i.id === "imageGeneration")!;
    const imageGenerationFeaturedItem: FeaturedCardItem = {
        id: imageGenerationItem.id,
        icon: imageGenerationItem.icon,
        label: imageGenerationItem.label,
        desc: imageGenerationItem.desc,
        iconColor: imageGenerationItem.iconColor,
        glassIcon: imageGenerationItem.glass,
        onClick: () => setCurrentPage("imageGeneration"),
    };

    const cloudItem = SETTINGS_MENU.find(i => i.id === "cloud")!;
    const cloudFeaturedItem: FeaturedCardItem = {
        id: cloudItem.id,
        icon: cloudItem.icon,
        label: cloudItem.label,
        desc: cloudItem.desc,
        iconColor: cloudItem.iconColor,
        onClick: () => setCurrentPage("cloud"),
    };

    const agentComputerItem = SETTINGS_MENU.find(i => i.id === "agentComputer")!;
    const agentComputerFeaturedItem: FeaturedCardItem = {
        id: agentComputerItem.id,
        icon: agentComputerItem.icon,
        label: agentComputerItem.label,
        desc: agentComputerItem.desc,
        iconColor: agentComputerItem.iconColor,
        glassIcon: agentComputerItem.glass,
        onClick: () => setCurrentPage("agentComputer"),
    };

    const bindingItem = SETTINGS_MENU.find(i => i.id === "binding")!;
    const bindingFeaturedItem: FeaturedCardItem = {
        id: bindingItem.id,
        icon: bindingItem.icon,
        label: bindingItem.label,
        desc: bindingItem.desc,
        iconColor: bindingItem.iconColor,
        glassIcon: bindingItem.glass,
        onClick: () => setCurrentPage("binding"),
    };

    const renderSubPage = () => {
        switch (currentPage) {
            case "api":
                return <ApiSettings />;
            case "voice":
                return <VoiceSettings />;
            case "imageGeneration":
                return <ImageGenerationSettings />;
            case "presets":
                return <PresetManager isActive />;
            case "worldbook":
                return <WorldBookManager isActive />;
            case "regex":
                return <RegexManager isActive />;
            case "data":
                return <DataManagement onNotice={onNotice} />;
            case "binding":
                return <BindingManager />;
            case "accountCenter":
                return <AccountCenter onNotice={onNotice} />;
            case "appAccounts":
                return <AccountCenter initialView="chat-login" onNotice={onNotice} />;
            case "cloud":
                return <CloudServicesPage />;
            case "weixin":
                return <WeixinSettings onOpenCloudServices={() => setCurrentPage("cloud")} />;
            case "toolbox":
                return <ToolboxSettings />;
            case "callOverlay":
                return <CallOverlaySettings onNotice={onNotice} />;
            case "perception":
                return <PerceptionSettings onNotice={onNotice} />;
            case "deviceAction":
                return <DeviceActionSettings onNotice={onNotice} />;
            case "systemCalendar":
                return <SystemCalendarSettings onNotice={onNotice} />;
            case "screenshot":
                return <ScreenshotSettings onNotice={onNotice} />;
            case "widget":
                return <WidgetSettings onNotice={onNotice} />;
            case "agentComputer":
                return <AgentComputerSettings onNotice={onNotice} />;
            case "moderation":
                return <ModerationCenter onNotice={onNotice} />;
            case "identity":
                return <UserIdentitySettings />;
            case "about":
                return <ChangelogPage />;
            default:
                return null;
        }
    };

    useLayoutEffect(() => {
        pageBodyRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }, [currentPage]);

    // Check for pending mascot navigation mode on mount (stored by desktop-shell)
    useEffect(() => {
        const pending = sessionStorage.getItem("mascot-settings-mode");
        if (pending) {
            sessionStorage.removeItem("mascot-settings-mode");
            if (pending === "accountCenter" || SETTINGS_MENU.some(m => m.id === pending)) {
                setCurrentPage(pending as SubPage);
            }
        }
    }, []);

    useEffect(() => {
        const syncTools = () => {
            const current = loadChatAppSettings();
            setPromptViewerEnabled(current.promptViewerEnabled === true);
            setQuickActionEnabled(current.quickActionEnabled === true);
            setFloatingToolsEnabled(current.floatingToolsEnabled === true);
        };
        const settings = loadChatAppSettings();
        setTimeAware(settings.timeAware !== false);
        syncTools();
        setKeepAlive(loadKeepAlive());
        window.addEventListener(CHAT_APP_SETTINGS_UPDATED_EVENT, syncTools);
        return () => window.removeEventListener(CHAT_APP_SETTINGS_UPDATED_EVENT, syncTools);
    }, []);

    // Listen for mascot navigation mode (e.g. jump to worldbook/regex tab)
    useEffect(() => {
        const onMode = (e: Event) => {
            const { mode } = (e as CustomEvent).detail ?? {};
            if (mode && (mode === "accountCenter" || SETTINGS_MENU.some(m => m.id === mode))) {
                setCurrentPage(mode as SubPage);
            }
        };
        window.addEventListener("mascot-navigate-mode", onMode);
        return () => window.removeEventListener("mascot-navigate-mode", onMode);
    }, []);

    // Listen for internal settings tab navigation (e.g. mascot "修改绑定" button)
    useEffect(() => {
        const onNav = (e: Event) => {
            const { page } = (e as CustomEvent).detail ?? {};
            if (page) setCurrentPage(page as SubPage);
        };
        window.addEventListener("settings-navigate", onNav);
        return () => window.removeEventListener("settings-navigate", onNav);
    }, []);

    return (
        <SettingsContext.Provider value={{ setSubpageTitle, setOverrideBack, setSubpageRightAction }}>
            <PageShell className={currentPage === "main" ? "settings-shell settings-shell-main" : "settings-shell"} title={currentPage === "main" ? "" : title} onBack={handleBack} rightAction={currentPage !== "main" ? subpageRightActions[currentPage] : undefined} bodyRef={pageBodyRef}>
                {currentPage === "main" && (
                    <div className="settings-overview">
                        <h1 className="settings-page-title">设置</h1>
                        <button type="button" className="settings-profile-card jelly-button" onClick={() => setCurrentPage("identity")}>
                            <span className="settings-profile-avatar">
                                {virtualAccount?.avatarUrl ? <img src={virtualAccount.avatarUrl} alt="" /> : <UserCircle size={32} strokeWidth={1.55} />}
                            </span>
                            <span className="settings-profile-copy">
                                <b>{virtualAccount?.displayName || "设置本机资料"}</b>
                                <small>{virtualAccount ? `虚拟账号 · @${virtualAccount.handle}` : "添加头像、名称与个人资料"}</small>
                            </span>
                            <ChevronRight size={20} />
                        </button>

                        <div className="settings-overview-group settings-overview-account">
                            <button className="settings-overview-row jelly-button" onClick={() => setCurrentPage("accountCenter")}>
                                <span className="settings-overview-icon"><KeyRound size={21} /></span>
                                <span className="settings-overview-copy"><b>账号与登录</b><small>虚拟账号、密码与好友码</small></span>
                                <i className="settings-online-dot" aria-label="本机账号可用" />
                                <ChevronRight size={19} />
                            </button>
                        </div>

                        <div className="settings-overview-group">
                            {[
                                { id: "identity", icon: UserCircle, label: "个人资料", desc: "头像、称呼与对外资料" },
                                { id: "appAccounts", icon: Layers, label: "应用账号", desc: "管理各应用的虚拟登录" },
                                { id: "data", icon: ShieldCheck, label: "隐私与安全", desc: "本机数据与导入导出" },
                                { id: "cloud", icon: CloudUpload, label: "数据与备份", desc: "备份、恢复与云端服务" },
                                { id: "about", icon: Info, label: "关于", desc: "版本、更新日志与说明" },
                            ].map(item => {
                                const Icon = item.icon;
                                return <button key={item.label} className="settings-overview-row jelly-button" onClick={() => setCurrentPage(item.id as SubPage)}>
                                    <span className="settings-overview-icon"><Icon size={21} strokeWidth={1.7} /></span>
                                    <span className="settings-overview-copy"><b>{item.label}</b><small>{item.desc}</small></span>
                                    <ChevronRight size={19} />
                                </button>;
                            })}
                        </div>

                        <section className="settings-advanced">
                            <h2>高级设置</h2>
                            {[
                                ["接口", ["api", "voice", "imageGeneration"]],
                                ["数据与规则", ["presets", "worldbook", "regex", "data", "binding"]],
                                ["连接与工具", ["weixin", "toolbox", "agentComputer", "callOverlay", "perception", "deviceAction", "systemCalendar", "screenshot", "widget"]],
                            ].map(([label, ids]) => <div className="settings-advanced-section" key={label as string}>
                                <h3>{label as string}</h3>
                                <div className="settings-overview-group">
                                    {SETTINGS_MENU.filter(item => (ids as string[]).includes(item.id)).map(item => {
                                        const Icon = item.icon;
                                        return <button key={item.id} className="settings-overview-row jelly-button" onClick={() => setCurrentPage(item.id as SubPage)}>
                                            <span className="settings-overview-icon"><Icon size={20} strokeWidth={1.7} /></span>
                                            <span className="settings-overview-copy"><b>{item.label}</b><small>{item.desc}</small></span>
                                            <ChevronRight size={18} />
                                        </button>;
                                    })}
                                </div>
                            </div>)}

                            <div className="settings-advanced-section">
                                <h3>运行</h3>
                                <div className="settings-overview-group">
                                    <div className="settings-overview-row"><span className="settings-overview-icon"><Activity size={20} /></span><span className="settings-overview-copy"><b>真实时间感知</b><small>在历史事件中注入时间</small></span><Toggle checked={timeAware} onChange={handleTimeAwareChange} /></div>
                                    <div className="settings-overview-row"><span className="settings-overview-icon"><CloudUpload size={20} /></span><span className="settings-overview-copy"><b>后台保活</b><small>保持消息与轮询不中断</small></span><Toggle checked={keepAlive} onChange={handleKeepAliveChange} /></div>
                                    <div className="settings-overview-row"><span className="settings-overview-icon"><Wrench size={20} /></span><span className="settings-overview-copy"><b>悬浮工具</b><small>提示词与快捷操作</small></span><Toggle checked={floatingToolsEnabled} onChange={handleFloatingToolsChange} /></div>
                                </div>
                            </div>
                            {isAdmin ? <button className="settings-overview-row settings-admin-row jelly-button" onClick={() => setCurrentPage("moderation")}><span className="settings-overview-icon"><ShieldCheck size={20} /></span><span className="settings-overview-copy"><b>管理中心</b><small>举报、审核与封禁</small></span><ChevronRight size={18} /></button> : null}
                            {!selfHostedMode ? <button className="settings-overview-row settings-admin-row jelly-button" onClick={() => setAccountSheetOpen(true)}><span className="settings-overview-icon"><UserCircle size={20} /></span><span className="settings-overview-copy"><b>站点账号</b><small>@{account.username} · 修改密码与退出</small></span><ChevronRight size={18} /></button> : null}
                        </section>
                        {accountSheetOpen && (
                            <div className="modal-overlay modal-overlay-bottom" data-ui="modal" onClick={() => setAccountSheetOpen(false)}>
                                <div className="modal-sheet" data-ui="modal-sheet" onClick={event => event.stopPropagation()}>
                                    <div className="modal-header" data-ui="modal-header">
                                        <button className="modal-header-btn modal-header-btn-muted" onClick={() => setAccountSheetOpen(false)}><X size={18} /></button>
                                        <h3 className="modal-title">账号</h3>
                                        <span style={{ width: 44 }} />
                                    </div>
                                    <div className="modal-body modal-body-tight" data-ui="modal-body">
                                        <div className="menu-group">
                                            <div className="menu-item settings-tools-menu-item">
                                                <span className="card-icon" style={accountIconStyle}>
                                                    <UserCircle size={22} strokeWidth={1.75} />
                                                </span>
                                                <span className="settings-tools-menu-copy">
                                                    <span className="menu-label appearance-menu-item-label">当前账号</span>
                                                    <span className="menu-desc settings-tools-menu-desc">@{account.username}</span>
                                                </span>
                                                <span className="menu-right">
                                                    <button className="ui-btn ui-btn-outline py-1 px-3 ts-12" style={{ whiteSpace: "nowrap" }} onClick={handleCopyUsername}>复制</button>
                                                </span>
                                            </div>
                                            <button type="button" className="menu-item settings-tools-menu-item w-full text-left" onClick={() => { setAccountSheetOpen(false); setPwdModalOpen(true); }}>
                                                <span className="card-icon" style={passwordIconStyle}>
                                                    <KeyRound size={22} strokeWidth={1.75} />
                                                </span>
                                                <span className="settings-tools-menu-copy">
                                                    <span className="menu-label appearance-menu-item-label">修改密码</span>
                                                    <span className="menu-desc settings-tools-menu-desc">需验证当前密码</span>
                                                </span>
                                                <span className="menu-right"><ChevronRight size={17} className="settings-account-chevron" /></span>
                                            </button>
                                            <button type="button" className="menu-item settings-tools-menu-item w-full text-left" onClick={() => { setAccountSheetOpen(false); setConfirmLogout(true); }}>
                                                <span className="card-icon" style={logoutIconStyle}>
                                                    <LogOut size={22} strokeWidth={1.75} />
                                                </span>
                                                <span className="settings-tools-menu-copy">
                                                    <span className="menu-label appearance-menu-item-label" style={{ color: "var(--c-danger)" }}>退出登录</span>
                                                    <span className="menu-desc settings-tools-menu-desc">退出后需重新输入用户名和密码</span>
                                                </span>
                                                <span className="menu-right"><ChevronRight size={17} className="settings-account-chevron" /></span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {pwdModalOpen && (
                            <div className="modal-overlay modal-overlay-bottom" data-ui="modal" onClick={closePwdModal}>
                                <div className="modal-sheet" data-ui="modal-sheet" onClick={event => event.stopPropagation()}>
                                    <div className="modal-header" data-ui="modal-header">
                                        <button className="modal-header-btn modal-header-btn-muted" onClick={closePwdModal} disabled={pwdBusy}><X size={18} /></button>
                                        <h3 className="modal-title">修改密码</h3>
                                        <button className="modal-header-btn modal-header-btn-action" onClick={() => void handleChangePassword()} disabled={pwdBusy}>
                                            {pwdBusy ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                                        </button>
                                    </div>
                                    <div className="modal-body" data-ui="modal-body">
                                        <div className="flex flex-col gap-3 px-1">
                                            <input type="password" className="ui-input" placeholder="当前密码" autoComplete="current-password"
                                                value={oldPwd} onChange={event => setOldPwd(event.target.value)} />
                                            <input type="password" className="ui-input" placeholder="新密码（至少 6 位）" autoComplete="new-password"
                                                value={newPwd} onChange={event => setNewPwd(event.target.value)} />
                                            <input type="password" className="ui-input" placeholder="确认新密码" autoComplete="new-password"
                                                value={confirmPwd} onChange={event => setConfirmPwd(event.target.value)} />
                                            {pwdError ? <p className="ts-12" style={{ color: "var(--c-danger)" }}>{pwdError}</p> : null}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {confirmLogout && (
                            <ConfirmDialog
                                title="退出登录"
                                message={`当前账号 @${account.username}。退出后需要重新输入用户名和密码才能登录，密码无法找回，请确认已牢记。`}
                                icon={LogOut}
                                variant="danger"
                                confirmLabel="退出登录"
                                onConfirm={() => { setConfirmLogout(false); void logout(); }}
                                onCancel={() => setConfirmLogout(false)}
                            />
                        )}
                    </div>
                )}

                {currentPage !== "main" && (currentPage === "about" ? (
                    <div className="settings-log-wrap">
                        {renderSubPage()}
                    </div>
                ) : (
                    // shrink-0：page-body 是 flex 容器，包裹层默认可压缩——内容超一屏时会被压到
                    // 恰好一屏高、卡片从中溢出，底部 padding 落不到内容末尾，最后一张卡贴死滚动边界
                    //（iOS 底部工具栏/安全区一盖就"没放下又滚不动"）。尾部留白 = 原 pb-8 + 安全区。
                    <div className="block min-h-full shrink-0 p-4 box-border" style={{ paddingBottom: "calc(32px + env(safe-area-inset-bottom, 0px))" }}>
                        {renderSubPage()}
                    </div>
                ))}
            </PageShell>
        </SettingsContext.Provider>
    );
}
