"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Library, Store, NotebookPen, User, Users, Shuffle } from "lucide-react";

import { hydrateReadingStorage, loadBooks } from "@/lib/reading-storage";
import { applyAppearance, loadAppearance } from "@/lib/study-room/appearance";
import { loadForum } from "@/lib/study-room/forum";
import { readStudyRoomTarget } from "@/lib/study-room/share-to-chat";
import { STUDYROOM_SEARCH_EVENT } from "@/lib/study-room/events";
import type { Book } from "@/lib/reading-types";
import { StudyRoomShelf } from "./study-room-shelf";
import { StudyRoomStore } from "./study-room-store";
import { useStableStudyRoomScreen } from "./use-stable-screen";
import { StudyRoomDesk } from "./study-room-desk";
import { StudyRoomMine } from "./study-room-mine";
import { StudyRoomNotes } from "./study-room-notes";
import { StudyRoomReader } from "./study-room-reader";
import { StudyRoomMessages } from "./study-room-messages";
import { StudyRoomAppearance } from "./study-room-appearance";
import { StudyRoomBackup } from "./study-room-backup";
import { StudyRoomReadingMemory } from "./study-room-reading-memory";
import { StudyRoomCreativeEditor } from "./study-room-creative-editor";
import { StudyRoomForum } from "./study-room-forum";
import { StudyRoomDock, type DockItem } from "./study-room-dock";
import { StudyRoomSplash, shouldSkipStudyRoomSplash } from "./study-room-splash";
import { StudyRoomUpdateLog } from "./study-room-update-log";
import { StudyRoomUpdateNotice } from "./study-room-update-notice";
import { StudyRoomDraw } from "./study-room-draw";
import { StudyRoomWishlist } from "./study-room-wishlist";
import { StudyRoomNpcPanel } from "./study-room-npc-panel";
import { StudyRoomGifts } from "./study-room-gifts";
import { ImportSuccessHost } from "./import-success";
import { duckAmbient, stopAmbient } from "@/lib/study-room/ambient";

type StudyRoomAppProps = {
  onClose: () => void;
  /** 从聊天里的书房分享卡点进来时带上要打开的书或帖子 */
  launchContext?: Record<string, unknown> | null;
};

type StudyRoomTab = "shelf" | "store" | "desk" | "forum" | "mine";

type StudyRoomView =
  | { kind: "tabs" }
  | { kind: "reader"; book: Book; chapterIndex?: number; paragraphIndex?: number; tts?: boolean }
  | { kind: "notes" }
  | { kind: "messages" }
  | { kind: "appearance" }
  | { kind: "backup" }
  | { kind: "readingMemory" }
  | { kind: "creative"; draftId: string }
  | { kind: "npcPanel" }
  | { kind: "gifts" }
  | { kind: "updateLog" }
  | { kind: "draw" }
  | { kind: "wishlist" };

/** label 是 Dock 上的短名；title 是页面顶部显示的当前界面名字 */
const TAB_META: Record<StudyRoomTab, { label: string; icon: typeof Library; title: string }> = {
  shelf: { label: "书架", icon: Library, title: "书架" },
  store: { label: "书城", icon: Store, title: "书城" },
  desk: { label: "书桌", icon: NotebookPen, title: "书桌" },
  forum: { label: "书友圈", icon: Users, title: "书友圈" },
  mine: { label: "我的", icon: User, title: "我的" },
};

const TAB_ORDER: StudyRoomTab[] = ["shelf", "store", "desk", "forum", "mine"];

export default function StudyRoomApp(props: StudyRoomAppProps) {
  // 背景声音在书房各页面间一直播放，只有退出书房（整个书房卸载）时才停
  useEffect(
    () => () => {
      duckAmbient(false);
      stopAmbient();
    },
    [],
  );
  // 导入成功弹窗挂在书房最外层：从详情页导入后会马上切到阅读器，弹窗不能跟着详情页一起消失
  return (
    <>
      <StudyRoomScreens {...props} />
      <ImportSuccessHost />
    </>
  );
}

function StudyRoomScreens({ onClose, launchContext }: StudyRoomAppProps) {
  const [ready, setReady] = useState(false);
  // 冷启动播放一次启动画面；书房内部切页不重播（见 study-room-splash）
  const [splashDone, setSplashDone] = useState(() => shouldSkipStudyRoomSplash());
  const [tab, setTab] = useState<StudyRoomTab>("shelf");
  // 记住最近一个不是书友圈的标签：剧透提示里选「不再观看」时回到那里
  const prevTabRef = useRef<StudyRoomTab>("shelf");
  useEffect(() => {
    if (tab !== "forum") prevTabRef.current = tab;
  }, [tab]);
  const [view, setView] = useState<StudyRoomView>({ kind: "tabs" });
  // 书友圈剧透提示：本次进入书房只问一次（本组件在退出书房时卸载，状态随之清空）
  const [forumGateAccepted, setForumGateAccepted] = useState(false);
  // 从阅读器返回时，让那本书先以「抽出」状态出现再放回架上
  const lastOpenedBookRef = useRef<string | null>(null);
  const [returnFromBookId, setReturnFromBookId] = useState<string | null>(null);

  useEffect(() => {
    applyAppearance(loadAppearance());
  }, []);

  // 键盘弹出时不让浏览器把书房整屏推歪（露出两侧壁纸）
  useStableStudyRoomScreen();

  useEffect(() => {
    if (!returnFromBookId) return;
    const timer = window.setTimeout(() => setReturnFromBookId(null), 1400);
    return () => window.clearTimeout(timer);
  }, [returnFromBookId]);

  // 阅读时选词点「搜索」：跳到书城并把关键词带过去
  const [storeQuery, setStoreQuery] = useState<string | null>(null);
  useEffect(() => {
    const onSearch = (event: Event) => {
      const detail = (event as CustomEvent<{ query?: string }>).detail;
      const value = detail?.query?.trim();
      if (!value) return;
      setView({ kind: "tabs" });
      setTab("store");
      setStoreQuery(value);
    };
    window.addEventListener(STUDYROOM_SEARCH_EVENT, onSearch);
    return () => window.removeEventListener(STUDYROOM_SEARCH_EVENT, onSearch);
  }, []);

  // 从「我的主页」点动态卡：切到书友圈并直接打开原帖（只用一次）
  const [forumPostId, setForumPostId] = useState<string | null>(null);
  // 从「我的」点「发布第一条动态」：切到书友圈并直接打开发帖（只用一次）
  const [forumCompose, setForumCompose] = useState(false);

  // 聊天分享卡点进来：书在书架上就直接打开阅读，帖子就切到书友圈打开原帖；每个启动对象只处理一次
  const handledLaunchRef = useRef<Record<string, unknown> | null>(null);
  const [launchNotice, setLaunchNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!ready || !launchContext || handledLaunchRef.current === launchContext) return;
    handledLaunchRef.current = launchContext;
    const target = readStudyRoomTarget(launchContext);
    if (!target) return;
    if (target.kind === "book") {
      const book = loadBooks().find((item) => item.id === target.bookId);
      if (book) {
        lastOpenedBookRef.current = book.id;
        setView({ kind: "reader", book });
      } else {
        setView({ kind: "tabs" });
        setTab("shelf");
        setLaunchNotice("这本书已经不在书架上了");
      }
      return;
    }
    setView({ kind: "tabs" });
    setForumCompose(false);
    setTab("forum");
    if (loadForum().posts.some((post) => post.id === target.postId)) setForumPostId(target.postId);
    else setLaunchNotice("这条帖子已经被删除了");
  }, [ready, launchContext]);
  useEffect(() => {
    if (!launchNotice) return;
    const timer = window.setTimeout(() => setLaunchNotice(null), 2400);
    return () => window.clearTimeout(timer);
  }, [launchNotice]);

  // 论坛名可以在书友管理里改，这里跟着刷新
  const [forumName, setForumName] = useState<string>(() => loadForum().name);
  useEffect(() => {
    setForumName(loadForum().name);
  }, [tab, view]);

  useEffect(() => {
    let cancelled = false;
    hydrateReadingStorage()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 启动画面：只占一屏，结束后再进入书房（此时才加载书架）
  if (!splashDone) {
    return (
      <section className="sr-app sr-app--splash">
        <StudyRoomSplash onDone={() => setSplashDone(true)} />
      </section>
    );
  }

  if (view.kind === "reader") {
    return (
      <StudyRoomReader
        book={view.book}
        initialChapterIndex={view.chapterIndex}
        initialParagraphIndex={view.paragraphIndex}
        openTts={view.tts}
        onBack={() => {
          setReturnFromBookId(lastOpenedBookRef.current);
          setView({ kind: "tabs" });
        }}
      />
    );
  }

  if (view.kind === "notes") {
    return (
      <StudyRoomNotes
        onBack={() => setView({ kind: "tabs" })}
        onOpenSource={(book, chapterIndex, paragraphIndex) => {
          setView({ kind: "reader", book, chapterIndex, paragraphIndex });
        }}
      />
    );
  }

  if (view.kind === "messages") {
    return <StudyRoomMessages onBack={() => setView({ kind: "tabs" })} />;
  }

  if (view.kind === "appearance") {
    return <StudyRoomAppearance onBack={() => setView({ kind: "tabs" })} />;
  }

  if (view.kind === "backup") {
    return <StudyRoomBackup onBack={() => setView({ kind: "tabs" })} />;
  }

  if (view.kind === "creative") {
    return (
      <StudyRoomCreativeEditor
        draftId={view.draftId}
        onBack={() => setView({ kind: "tabs" })}
        onOpenBook={(book) => {
          lastOpenedBookRef.current = book.id;
          setView({ kind: "reader", book });
        }}
      />
    );
  }

  if (view.kind === "npcPanel") {
    return <StudyRoomNpcPanel onBack={() => setView({ kind: "tabs" })} />;
  }

  if (view.kind === "gifts") {
    return <StudyRoomGifts onBack={() => setView({ kind: "tabs" })} />;
  }

  if (view.kind === "updateLog") {
    return <StudyRoomUpdateLog onBack={() => setView({ kind: "tabs" })} />;
  }

  if (view.kind === "wishlist") {
    return <StudyRoomWishlist onBack={() => setView({ kind: "tabs" })} />;
  }

  if (view.kind === "draw") {
    return (
      <StudyRoomDraw
        onBack={() => setView({ kind: "tabs" })}
        onRead={(book) => {
          lastOpenedBookRef.current = book.id;
          setView({ kind: "reader", book });
        }}
        onImported={() => undefined}
      />
    );
  }

  if (view.kind === "readingMemory") {
    return (
      <StudyRoomReadingMemory
        onBack={() => setView({ kind: "tabs" })}
        onOpenBook={(book, chapterIndex) => setView({ kind: "reader", book, chapterIndex })}
      />
    );
  }

  const active = TAB_META[tab];
  // Dock 六个入口：书架 / 书城 / 抽一本 / 书桌 / 书友圈 / 我的
  const dockItems: DockItem[] = TAB_ORDER.flatMap((key) => {
    const item: DockItem = {
      key,
      label: key === "forum" ? forumName : TAB_META[key].label,
      icon: TAB_META[key].icon,
    };
    // 「抽一本」是独立的一次抽取流程（整屏，有自己的返回），放在书城之后
    return key === "store" ? [item, { key: "draw", label: "抽一本", icon: Shuffle }] : [item];
  });

  return (
    <section className="sr-app">
      <header className="sr-header">
        <div className="sr-header-safe" />
        <div className="sr-header-row">
          <button type="button" className="sr-icon-btn" onClick={onClose} aria-label="返回桌面">
            <ChevronLeft size={22} strokeWidth={1.6} />
          </button>
          {/* 标题就是当前界面的名字（书架 / 书城 / 书桌 / 书友圈 / 我的主页），不统一叫「书房」；
              不再在标题下面挂一行解释小字 */}
          <div className="sr-header-title">{tab === "forum" ? forumName : active.title}</div>
          <span style={{ width: 44 }} />
        </div>
      </header>

      <div className="sr-body" key={tab}>
        <div className="sr-tab-pane sr-tab-pane--dock">
          {!ready ? (
            <div className="sr-empty">
              <p>正在打开书房…</p>
            </div>
          ) : tab === "shelf" ? (
            <StudyRoomShelf
              returnFromBookId={returnFromBookId}
              onOpenBook={(book, chapterIndex, paragraphIndex, options) => {
                lastOpenedBookRef.current = book.id;
                setView({ kind: "reader", book, chapterIndex, paragraphIndex, tts: options?.tts });
              }}
              onOpenMessages={() => setView({ kind: "messages" })}
            />
          ) : tab === "store" ? (
            <StudyRoomStore
              initialQuery={storeQuery ?? undefined}
              onRead={(book) => {
                lastOpenedBookRef.current = book.id;
                setView({ kind: "reader", book });
              }}
            />
          ) : tab === "forum" ? (
            <StudyRoomForum
              initialPostId={forumPostId ?? undefined}
              initialCompose={forumCompose}
              gateAccepted={forumGateAccepted}
              onGateAccept={() => setForumGateAccepted(true)}
              onLeave={() => {
                setForumPostId(null);
                setForumCompose(false);
                setTab(prevTabRef.current);
              }}
              onOpenNpcPanel={() => setView({ kind: "npcPanel" })}
              onOpenMine={() => {
                setView({ kind: "tabs" });
                setTab("mine");
              }}
              onOpenBook={(book) => {
                lastOpenedBookRef.current = book.id;
                setView({ kind: "reader", book });
              }}
            />
          ) : tab === "desk" ? (
            <StudyRoomDesk
              onOpenDraft={(draftId) => setView({ kind: "creative", draftId })}
              onOpenNotes={() => setView({ kind: "notes" })}
              onOpenWishlist={() => setView({ kind: "wishlist" })}
            />
          ) : (
            <StudyRoomMine
              onOpenNotes={() => setView({ kind: "notes" })}
              onOpenMessages={() => setView({ kind: "messages" })}
              onOpenAppearance={() => setView({ kind: "appearance" })}
              onOpenBackup={() => setView({ kind: "backup" })}
              onOpenReadingMemory={() => setView({ kind: "readingMemory" })}
              onOpenGifts={() => setView({ kind: "gifts" })}
              onOpenUpdateLog={() => setView({ kind: "updateLog" })}
              onOpenWishlist={() => setView({ kind: "wishlist" })}
              onOpenDraft={(draftId) => setView({ kind: "creative", draftId })}
              onOpenBook={(book) => {
                lastOpenedBookRef.current = book.id;
                setView({ kind: "reader", book });
              }}
              onOpenPost={(postId) => {
                setForumCompose(false);
                setForumPostId(postId);
                setTab("forum");
              }}
              onCompose={() => {
                setForumPostId(null);
                setForumCompose(true);
                setTab("forum");
              }}
              onOpenDesk={() => setTab("desk")}
            />
          )}
        </div>
      </div>

      {launchNotice && (
        <div className="sr-toast" role="status">
          {launchNotice}
        </div>
      )}

      <StudyRoomDock
        items={dockItems}
        active={tab}
        onSelect={(key) => {
          setForumPostId(null);
          setForumCompose(false);
          if (key === "draw") {
            setView({ kind: "draw" });
            return;
          }
          setTab(key as StudyRoomTab);
        }}
      />

      {/* 书房自己的更新便签：启动画面结束后才出现，只跟书房版本有关 */}
      <StudyRoomUpdateNotice enabled={splashDone} onOpenLog={() => setView({ kind: "updateLog" })} />
    </section>
  );
}
