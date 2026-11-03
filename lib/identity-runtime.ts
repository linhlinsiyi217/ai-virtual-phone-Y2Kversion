import { IdentityBoundaryError, identityStoragePrefix, type IdentitySpaceManifest, normalizeIdentitySpace } from "./identity-space";
import { requestPhoneSessionRemount } from "./phone-session-protocol";

export const IDENTITY_RUNTIME_KEY = "float_identity_runtime_v1";
export const IDENTITY_RUNTIME_RECOVERY_KEY = "float_identity_runtime_recovery_v1";
export const IDENTITY_ACCESS_KEY = "float_identity_character_access_v1";
export const IDENTITY_BASE_BINDING_KEY = "float_identity_default_bindings_v1";
const PRIVATE_PREFIX = "identity:";

const SHARED_KEYS = new Set([
  "ai_phone_user_identities_v1", IDENTITY_ACCESS_KEY, IDENTITY_BASE_BINDING_KEY,
  "ai_phone_characters_v1", "ai_phone_bg_items_v1", "ai_phone_character_versions_v1",
  "ai_phone_api_configs_v1", "ai_phone_voice_configs_v1", "ai_phone_image_generation_settings_v1",
  "ai_phone_presets_v1", "ai_phone_worldbooks_v1", "ai_phone_regexes_v1", "ai_phone_settings_idb_migrated_v1",
  "ai_phone_theme_profile_v1", "ai_phone_icon_layout_v1", "ai_phone_icon_layout_v2",
  "ai_phone_desktop_folders_v1", "ai_phone_dock_layout_v1", "ai_phone_canvas_pan_v2",
  "ai_phone_widgets_v1", "ai_phone_diy_templates_v1", "css-schemes-v1",
  "ai_phone_sticker_packs_v1", "ai_phone_css_assets_v1", "ai_phone_custom_apps_v1",
  "ai_phone_custom_app_icon_styles_v1", "chat-app-custom-css", "music-custom-css", "calendar-custom-css",
  "music-custom-bg-v1", "ai_phone_memory_config_v1", "ai_phone_follow_up_config_v1", "ai_phone_chat_send_config_v1",
  "ai_phone_rest_tools_v1", "ai_phone_rest_tool_packages_v1", "ai_phone_composite_tools_v1",
  "ai_phone_composite_tool_packages_v1", "ai_phone_mcp_servers_v1", "ai_phone_internal_capabilities_v1",
  "ai_phone_music_api_v1", "ai_phone_netease_cookie_v1", "music_api_config_v1", "netease_cookie_v1",
  "wb-tripo-api-key", "ai_phone_cloud_backup_config_v1", "ai_phone_personal_push_cloud_v1",
]);
const SHARED_DATABASES = new Set(["AiPhoneKvDB", "AiPhoneSettingsDB", "ai_phone_theme_db_v1", "AiPhoneIdentitySpacesDB", "AiPhoneIdentityRecoveryDB"]);

export function isSharedIdentityKey(key: string): boolean {
  return SHARED_KEYS.has(key) || key.startsWith("ai_phone_resource_hub_")
    || key.startsWith("ai_phone_cloud_backup_") || key.startsWith("ai_phone_personal_push_")
    || key.startsWith("ai_phone_push_subscription") || key.startsWith("supabase.auth.");
}

function nativeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage; } catch { return null; }
}

export function readIdentityRuntime(): IdentitySpaceManifest | null {
  const storage = nativeStorage();
  const raw = storage?.getItem(IDENTITY_RUNTIME_KEY);
  if (!raw) return null;
  try {
    const normalized = normalizeIdentitySpace(JSON.parse(raw));
    const hasUsableIdentity = normalized.userIds.length > 0
      && (Boolean(normalized.activeUserId) || normalized.deletingUserIds.length > 0);
    if (!hasUsableIdentity) throw new Error("identity manifest has no usable identity");
    return normalized;
  } catch (error) {
    // 运行态索引损坏不代表角色、聊天等业务数据损坏。旧实现会在模块初始化时
    // 直接抛错，导致 Next.js 整页 client-side exception，用户连恢复入口都看不到。
    // 先保留原始值，再移除这一条运行态索引；hydrateKvDb 会根据仍在的身份目录
    // 重建它，绝不清空 IndexedDB / KV / localStorage 里的实际用户数据。
    try {
      if (!storage?.getItem(IDENTITY_RUNTIME_RECOVERY_KEY)) {
        storage?.setItem(IDENTITY_RUNTIME_RECOVERY_KEY, JSON.stringify({
          capturedAt: new Date().toISOString(),
          raw,
          reason: error instanceof Error ? error.message : String(error),
        }));
      }
      storage?.removeItem(IDENTITY_RUNTIME_KEY);
    } catch {
      // 浏览器禁用存储时仍允许页面继续进入无身份的安全初始化流程。
    }
    console.warn("[IdentityRuntime] invalid runtime manifest quarantined; rebuilding index");
    return null;
  }
}

// Each phone realm is bound to one immutable identity; retired callbacks never rebind.
let bootState = readIdentityRuntime();
let blocked = false;
let dispatchPaused = false;
const controllers = new Set<AbortController>();
const connections = new Set<IDBDatabase>();
function trackDatabase(db: IDBDatabase, logicalName: string): void {
  const close = db.close.bind(db);
  db.close = () => { connections.delete(db); close(); };
  if (!identityDatabaseIsShared(logicalName)) {
    const transact = db.transaction.bind(db);
    db.transaction = ((...args: Parameters<IDBDatabase["transaction"]>) => {
      assertIdentityActive(); return transact(...args);
    }) as IDBDatabase["transaction"];
  }
  connections.add(db);
}

export function installIdentityRuntime(state: IdentitySpaceManifest): void {
  const storage = nativeStorage();
  if (!storage) throw new IdentityBoundaryError("无法保存身份状态");
  storage.setItem(IDENTITY_RUNTIME_KEY, JSON.stringify(state));
  if (!bootState) bootState = state;
}

export function getCurrentIdentityId(): string | null { return bootState?.activeUserId ?? null; }
export function currentIdentityCloudTag(): { userIdentityId: string | null; identityRevision: number } {
  assertIdentityActive();
  return { userIdentityId: getCurrentIdentityId(), identityRevision: bootState?.revision ?? 0 };
}
export function identityIndexedDbFactory(): IDBFactory {
  return new Proxy(indexedDB, { get(target, property) {
    if (property === "open") return (name: string, version?: number) => {
      assertIdentityActive();
      const request = target.open(identityDatabaseName(name), version);
      if (!identityDatabaseIsShared(name)) request.addEventListener("upgradeneeded", () => {
        try { assertIdentityActive(); } catch { request.transaction?.abort(); }
      });
      request.addEventListener("success", () => {
        try { assertIdentityActive(); trackDatabase(request.result, name); }
        catch { request.result.close(); }
      });
      return request;
    };
    if (property === "deleteDatabase") return (name: string) => { assertIdentityActive(); return target.deleteDatabase(identityDatabaseName(name)); };
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
export function isIdentityInitialized(): boolean { return bootState !== null; }
export function assertIdentityActive(): void {
  if (typeof window === "undefined") return;
  const now = readIdentityRuntime();
  if (blocked || (bootState && (!bootState.activeUserId || now?.activeUserId !== bootState.activeUserId
    || now?.revision !== bootState.revision || now.deletingUserIds.includes(bootState.activeUserId)))) {
    throw new IdentityBoundaryError();
  }
}
export function hasActiveIdentity(): boolean {
  try { assertIdentityActive(); return !dispatchPaused && (!bootState || Boolean(bootState.activeUserId)); } catch { return false; }
}
export function identityDispatchIsPaused(): boolean { return dispatchPaused; }
export function pauseIdentityDispatch(paused: boolean): void {
  dispatchPaused = paused;
  if (paused) { for (const controller of controllers) controller.abort(); controllers.clear(); }
}

export function privateIdentityPrefix(state = bootState): string {
  if (!state) return "";
  // Keeping the legacy owner's namespace prevents copying or relabelling old records.
  if (state.activeUserId && state.activeUserId === state.legacyOwnerId) return "";
  return identityStoragePrefix(state.activeUserId ?? "__no_identity__");
}

export function physicalIdentityKey(key: string): string {
  return isSharedIdentityKey(key) ? key : `${privateIdentityPrefix()}${key}`;
}

export function logicalIdentityKey(key: string): string | null {
  if (isSharedIdentityKey(key)) return key;
  const prefix = privateIdentityPrefix();
  if (!prefix) return key.startsWith(PRIVATE_PREFIX) ? null : key;
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

export function identityDatabaseName(name: string): string {
  if (SHARED_DATABASES.has(name)) return name;
  assertIdentityActive();
  if (name.includes("::identity:")) {
    if (!name.endsWith(`::${privateIdentityPrefix().slice(0, -1)}`)) throw new IdentityBoundaryError("不能访问其他身份的数据");
    return name;
  }
  const prefix = privateIdentityPrefix();
  return prefix ? `${name}::${prefix.slice(0, -1)}` : name;
}

export function identityDatabaseIsShared(name: string): boolean { return SHARED_DATABASES.has(name); }

/** Local app preferences and migration flags obey the same scope as IndexedDB/KV. */
export const identityLocalStorage: Storage = {
  get length() { return localKeys().length; },
  key(index) { return localKeys()[index] ?? null; },
  getItem(key) { return nativeStorage()?.getItem(physicalIdentityKey(key)) ?? null; },
  setItem(key, value) { if (!isSharedIdentityKey(key)) assertIdentityActive(); nativeStorage()?.setItem(physicalIdentityKey(key), value); },
  removeItem(key) { if (!isSharedIdentityKey(key)) assertIdentityActive(); nativeStorage()?.removeItem(physicalIdentityKey(key)); },
  clear() { for (const key of localKeys()) if (!isSharedIdentityKey(key)) this.removeItem(key); },
};
function localKeys(): string[] {
  const storage = nativeStorage();
  if (!storage) return [];
  const result: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const physical = storage.key(i);
    if (!physical || physical === IDENTITY_RUNTIME_KEY) continue;
    const logical = logicalIdentityKey(physical);
    if (logical !== null) result.push(logical);
  }
  return result;
}

export function registerIdentityRequest(controller: AbortController): () => void {
  if (typeof window !== "undefined" && !bootState) throw new IdentityBoundaryError("正在准备身份数据，请稍后重试");
  if (dispatchPaused) throw new IdentityBoundaryError("身份切换中，请稍后重试");
  assertIdentityActive(); controllers.add(controller);
  return () => controllers.delete(controller);
}
export function silenceIdentityRuntime(): void {
  blocked = true;
  for (const controller of controllers) controller.abort();
  controllers.clear();
  for (const connection of [...connections]) connection.close();
  window.dispatchEvent(new Event("float-identity-silenced"));
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", event => {
    if (event.key === IDENTITY_RUNTIME_KEY) {
      const now = readIdentityRuntime();
      if (now?.activeUserId === bootState?.activeUserId && now?.revision === bootState?.revision) return;
      silenceIdentityRuntime(); requestPhoneSessionRemount();
    }
  });
}
