"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Download, Upload, Database, RotateCcw, AlertTriangle } from "lucide-react";

import {
  buildStudyRoomBackup,
  parseStudyRoomBackup,
  restoreStudyRoomBackup,
  studyRoomBackupFileName,
  type StudyRoomBackupSummary,
} from "@/lib/study-room/backup";
import { loadBooks } from "@/lib/reading-storage";
import { HelpFoot } from "./help-tip";

type StudyRoomBackupProps = { onBack: () => void };

export function StudyRoomBackup({ onBack }: StudyRoomBackupProps) {
  const [summary, setSummary] = useState<StudyRoomBackupSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<{ name: string; raw: unknown } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    const { summary: next } = await buildStudyRoomBackup();
    setSummary(next);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const flash = (message: string, ms = 2600) => {
    setNotice(message);
    window.setTimeout(() => setNotice((n) => (n === message ? null : n)), ms);
  };

  const handleExport = async () => {
    setBusy(true);
    try {
      const { backup, summary: current } = await buildStudyRoomBackup();
      const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = studyRoomBackupFileName();
      anchor.click();
      URL.revokeObjectURL(url);
      flash(`已导出备份：${current.books} 本书、${current.notes} 条笔记、${current.annotations} 条角色批注`);
    } catch {
      flash("导出失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  const handlePickFile = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text()) as unknown;
      const backup = parseStudyRoomBackup(raw);
      setPending({ name: file.name, raw: backup });
      flash(`备份文件可用：包含 ${backup.books.length} 本书，请选择恢复方式`, 4000);
    } catch (err) {
      setPending(null);
      flash(err instanceof Error ? err.message : "这个文件读不出来");
    }
  };

  const handleRestore = async (mode: "merge" | "replace") => {
    if (!pending) return;
    const backup = parseStudyRoomBackup(pending.raw);
    if (mode === "replace") {
      const current = loadBooks().length;
      if (current > 0 && !confirm(`清空当前书架上的 ${current} 本书，再导入备份？此操作不可撤销。`)) return;
    }
    setBusy(true);
    try {
      const result = await restoreStudyRoomBackup(backup, mode);
      setPending(null);
      await refresh();
      flash(
        `已恢复：${result.books} 本书、${result.chapters} 章、${result.notes} 条笔记、${result.annotations} 条角色批注`,
        4200,
      );
    } catch {
      flash("恢复失败：备份文件可能不完整");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sr-app">
      <header className="sr-header">
        <div className="sr-header-safe" />
        <div className="sr-header-row">
          <button type="button" className="sr-icon-btn" onClick={onBack} aria-label="返回">
            <ChevronLeft size={22} strokeWidth={1.6} />
          </button>
          <div>
            <div className="sr-header-title">数据与备份</div>
            <span className="sr-header-sub">书房自己的备份，可随时恢复</span>
          </div>
          <span style={{ width: 40 }} />
        </div>
      </header>

      <div className="sr-body">
        <div className="sr-tab-pane">
          {notice && (
            <div className="sr-note-card">
              <div className="sr-note-meta">{notice}</div>
            </div>
          )}

          <div className="sr-section-label">当前书房</div>
          <div className="sr-note-card">
            <div className="sr-note-meta" style={{ lineHeight: 1.9 }}>
              {summary
                ? `书架 ${summary.books} 本 · 章节 ${summary.chapters} 章 · 笔记 ${summary.notes} 条 · 角色批注 ${summary.annotations} 条 · 书签 ${summary.bookmarks} 个`
                : "正在统计…"}
              <br />
              备份包含书目、正文、进度、书签、笔记、角色批注、书架排序与外观设置；不含宿主账号、角色卡与聊天记录。
            </div>
          </div>

          <div className="sr-actions" style={{ marginTop: 12 }}>
            <button type="button" className="sr-btn" onClick={() => void handleExport()} disabled={busy}>
              <Download size={16} strokeWidth={1.7} />
              导出书房备份
            </button>
            <button type="button" className="sr-btn" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload size={16} strokeWidth={1.7} />
              选择备份文件
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void handlePickFile(f);
            }}
          />

          {pending && (
            <>
              <div className="sr-section-label">恢复「{pending.name}」</div>
              <div className="sr-note-card">
                <div className="sr-note-meta" style={{ lineHeight: 1.9 }}>
                  <AlertTriangle size={14} strokeWidth={1.8} style={{ verticalAlign: -2, marginRight: 4 }} />
                  「合并」保留现有书架，同 id 的书用备份覆盖；「清空后恢复」会先删掉当前书架上的书及它们的笔记。
                </div>
              </div>
              <div className="sr-actions" style={{ marginTop: 12 }}>
                <button type="button" className="sr-btn sr-btn-primary" onClick={() => void handleRestore("merge")} disabled={busy}>
                  <Database size={16} strokeWidth={1.7} />
                  合并恢复
                </button>
                <button type="button" className="sr-btn sr-btn-danger" onClick={() => void handleRestore("replace")} disabled={busy}>
                  <RotateCcw size={16} strokeWidth={1.7} />
                  清空后恢复
                </button>
              </div>
            </>
          )}

          <HelpFoot id="backup-about" label="关于备份">
            备份文件保存在你自己的设备上，不会上传。导出的 EPUB 在书详情里单独提供，用于把某一本带批注的书带走。
          </HelpFoot>
        </div>
      </div>
    </section>
  );
}
