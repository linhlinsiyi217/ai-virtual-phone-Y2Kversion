"use client";

import { useEffect, useState } from "react";
import { Camera, Check, ChevronRight, Link2, Plus, Trash2, User } from "lucide-react";
import { loadUserIdentities, saveUserIdentities } from "@/lib/settings-storage";
import { createIdentityId } from "@/lib/identity-space";
import { deletePhoneIdentity } from "@/lib/identity-lifecycle";
import { UserPortraitSettings } from "./user-portrait-settings";

export type UserIdentity = {
    id: string;
    name: string;
    nickname?: string;
    realName?: string;
    signature?: string;
    suffix?: string;
    previousNames?: string[];
    avatarUrl?: string;
    chatAvatarUrl?: string;
    portraitEnabled?: boolean;
    portraitUrl?: string;
    portraitDescription?: string;
    bio: string;
    gender: string;
    age: string;
    occupation: string;
    customSettings: string;
};

function createIdentity(): UserIdentity {
    return {
        id: `identity-${createIdentityId()}`,
        name: "本机用户",
        nickname: "本机用户",
        realName: "",
        signature: "请让我继续感知快乐",
        suffix: "",
        bio: "",
        gender: "保密",
        age: "",
        occupation: "",
        customSettings: "",
    };
}

function fileToDataUrl(file: File, maxSize = 640, quality = .86): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const image = new Image();
            image.onload = () => {
                const scale = Math.min(maxSize / image.width, maxSize / image.height, 1);
                const canvas = document.createElement("canvas");
                canvas.width = Math.max(1, Math.round(image.width * scale));
                canvas.height = Math.max(1, Math.round(image.height * scale));
                const context = canvas.getContext("2d");
                if (!context) return reject(new Error("无法处理头像"));
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL("image/webp", quality));
            };
            image.onerror = reject;
            image.src = String(reader.result || "");
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

export function UserIdentitySettings() {
    const [identities, setIdentities] = useState<UserIdentity[]>([]);
    const [activeId, setActiveId] = useState("");

    useEffect(() => {
        const saved = loadUserIdentities();
        if (saved.length) {
            setIdentities(saved);
            setActiveId(saved[0].id);
            return;
        }
        const first = createIdentity();
        setIdentities([first]);
        setActiveId(first.id);
        saveUserIdentities([first]);
    }, []);

    const active = identities.find(item => item.id === activeId) || identities[0];
    const persist = (next: UserIdentity[]) => {
        setIdentities(next);
        saveUserIdentities(next);
    };
    const update = (updates: Partial<UserIdentity>) => {
        if (!active) return;
        persist(identities.map(item => item.id === active.id ? { ...item, ...updates } : item));
    };
    const uploadAvatar = () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = async () => {
            const file = input.files?.[0];
            if (file) update({ avatarUrl: await fileToDataUrl(file) });
        };
        input.click();
    };
    const add = () => {
        const next = createIdentity();
        persist([next, ...identities]);
        setActiveId(next.id);
    };
    const remove = async (id: string) => {
        if (identities.length <= 1) return;
        await deletePhoneIdentity(id);
        const next = loadUserIdentities();
        setIdentities(next);
        setActiveId(next[0]?.id || "");
    };

    if (!active) return <div className="account-loading"><span className="account-spinner" />正在准备个人资料…</div>;

    return (
        <div className="profile-v2">
            <section className="profile-v2-hero">
                <button type="button" className="profile-v2-avatar jelly-button" onClick={uploadAvatar} aria-label="更换照片">
                    {active.avatarUrl ? <img src={active.avatarUrl} alt="" /> : <User size={38} strokeWidth={1.45} />}
                    <span><Camera size={13} /></span>
                </button>
                <button type="button" className="profile-v2-change" onClick={uploadAvatar}>更换照片</button>
                <h2>{active.nickname || active.name}</h2>
            </section>

            <section className="profile-v2-section">
                <h3>称呼</h3>
                <div className="profile-v2-group">
                    <label><b>网名</b><input value={active.nickname ?? active.name} onChange={event => update({ nickname: event.target.value, name: event.target.value || active.name })} /></label>
                    <label><b>名字</b><input value={active.realName ?? ""} onChange={event => update({ realName: event.target.value })} placeholder="选填" /></label>
                    <div className="profile-v2-row"><b>性别</b><div className="profile-v2-segment">{["女", "男", "其他"].map(value => <button key={value} className={active.gender === value ? "is-active" : ""} onClick={() => update({ gender: value })}>{value}</button>)}</div></div>
                </div>
            </section>

            <section className="profile-v2-section">
                <h3>对外显示</h3>
                <div className="profile-v2-group">
                    <label><b>个性签名</b><input value={active.signature ?? ""} onChange={event => update({ signature: event.target.value })} placeholder="写一句介绍" /></label>
                    <label><b>被拍后缀</b><input value={active.suffix ?? ""} onChange={event => update({ suffix: event.target.value })} placeholder="选填" /></label>
                </div>
            </section>

            <section className="profile-v2-section">
                <h3>锁脸参考图</h3>
                <div className="profile-v2-group profile-v2-portrait">
                    <UserPortraitSettings identity={active} onChange={updates => update(updates)} />
                </div>
            </section>

            <section className="profile-v2-section profile-v2-profiles">
                <div className="profile-v2-title-row"><h3>其他资料</h3><button onClick={add}><Plus size={15} />新增</button></div>
                <div className="profile-v2-group">
                    {identities.map(item => <div className="profile-v2-profile-row" key={item.id}>
                        <button className="profile-v2-profile-main" onClick={() => setActiveId(item.id)}>
                            <span className="account-mini-avatar">{item.avatarUrl ? <img src={item.avatarUrl} alt="" /> : item.name.slice(0, 1)}</span>
                            <span><b>{item.nickname || item.name}</b><small>{item.id === active.id ? "当前资料" : item.signature || "本机资料"}</small></span>
                            {item.id === active.id ? <Check size={18} /> : <ChevronRight size={18} />}
                        </button>
                        {identities.length > 1 ? <button className="profile-v2-delete" onClick={() => void remove(item.id)} aria-label={`删除${item.name}`}><Trash2 size={17} /></button> : null}
                    </div>)}
                </div>
            </section>
            <p className="profile-v2-footnote">修改后即时生效。</p>
        </div>
    );
}
