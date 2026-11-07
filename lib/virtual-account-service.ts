import { announceSocialDataUpdated, socialDb } from "./social-db";
import type { AppVirtualLogin, GeneratedVirtualCredentials, VirtualAccount } from "./social-types";

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
const ACTIVE_ACCOUNT_KEY = "ai_phone_active_virtual_account_v1";

function secureToken(alphabet: string, length: number): string {
  if (typeof crypto === "undefined" || !crypto.getRandomValues) throw new Error("当前环境不支持安全随机数。");
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
}

function id(prefix: string): string {
  return `${prefix}_${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : secureToken(PASSWORD_ALPHABET, 20)}`;
}

async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function generateUniqueHandle(): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const candidate = `u_${secureToken("abcdefghjkmnpqrstuvwxyz23456789", 10)}`;
    if (!(await socialDb.virtualAccounts.where("handle").equals(candidate).first())) return candidate;
  }
  return `u_${Date.now().toString(36)}`;
}

function generatePassword(): string {
  const required = [
    secureToken("ABCDEFGHJKLMNPQRSTUVWXYZ", 1),
    secureToken("abcdefghijkmnopqrstuvwxyz", 1),
    secureToken("23456789", 1),
    secureToken("!@#$", 1),
  ];
  const chars = [...required, ...secureToken(PASSWORD_ALPHABET, 10)];
  const random = new Uint32Array(chars.length);
  crypto.getRandomValues(random);
  return chars.map((_, index) => ({ value: chars[index], key: random[index] })).sort((a, b) => a.key - b.key).map(item => item.value).join("");
}

export async function createGeneratedVirtualAccount(identity?: { id: string; name: string; avatarUrl?: string }): Promise<GeneratedVirtualCredentials> {
  const now = Date.now();
  const password = generatePassword();
  const accountId = id("va");
  const friendIdentityId = id("friend");
  const account: VirtualAccount = {
    id: accountId,
    identityId: identity?.id ?? null,
    displayName: identity?.name?.trim() || "本机用户",
    handle: await generateUniqueHandle(),
    passwordHash: await hashPassword(password),
    passwordHint: `••••••••${password.slice(-2)}`,
    avatarUrl: identity?.avatarUrl,
    friendIdentityId,
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1,
  };
  await socialDb.transaction("rw", socialDb.virtualAccounts, socialDb.friendIdentities, async () => {
    await socialDb.virtualAccounts.add(account);
    await socialDb.friendIdentities.add({
      id: friendIdentityId,
      ownerType: "user",
      ownerLocalId: accountId,
      displayName: account.displayName,
      avatarUrl: account.avatarUrl,
      allowCodeAdd: true,
      createdAt: now,
      updatedAt: now,
    });
  });
  if (typeof window !== "undefined") localStorage.setItem(ACTIVE_ACCOUNT_KEY, accountId);
  announceSocialDataUpdated({ kind: "virtual-account-created", accountId });
  return { account, password };
}

export async function createCustomVirtualAccount(input: { handle: string; password: string; displayName?: string; identityId?: string | null; avatarUrl?: string }): Promise<VirtualAccount> {
  const handle = input.handle.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9_]{3,23}$/.test(handle)) throw new Error("账号需为 4–24 位小写字母、数字或下划线。");
  if (input.password.length < 6) throw new Error("密码至少需要 6 位。");
  if (await socialDb.virtualAccounts.where("handle").equals(handle).first()) throw new Error("这个虚拟账号已存在，请换一个。");
  const now = Date.now();
  const accountId = id("va");
  const friendIdentityId = id("friend");
  const account: VirtualAccount = {
    id: accountId, identityId: input.identityId ?? null, displayName: input.displayName?.trim() || handle,
    handle, passwordHash: await hashPassword(input.password), passwordHint: `••••••••${input.password.slice(-2)}`,
    avatarUrl: input.avatarUrl, friendIdentityId, createdAt: now, updatedAt: now, schemaVersion: 1,
  };
  await socialDb.transaction("rw", socialDb.virtualAccounts, socialDb.friendIdentities, async () => {
    await socialDb.virtualAccounts.add(account);
    await socialDb.friendIdentities.add({ id: friendIdentityId, ownerType: "user", ownerLocalId: accountId, displayName: account.displayName, avatarUrl: account.avatarUrl, allowCodeAdd: true, createdAt: now, updatedAt: now });
  });
  if (typeof window !== "undefined") localStorage.setItem(ACTIVE_ACCOUNT_KEY, accountId);
  announceSocialDataUpdated({ kind: "virtual-account-created", accountId });
  return account;
}

export async function ensureVirtualAccount(identity?: { id: string; name: string; avatarUrl?: string }): Promise<GeneratedVirtualCredentials | { account: VirtualAccount; password: null }> {
  const activeId = typeof window !== "undefined" ? localStorage.getItem(ACTIVE_ACCOUNT_KEY) : null;
  if (activeId) {
    const active = await socialDb.virtualAccounts.get(activeId);
    if (active) return { account: active, password: null };
  }
  const identityId = identity?.id ?? null;
  const existing = identityId
    ? await socialDb.virtualAccounts.where("identityId").equals(identityId).first()
    : await socialDb.virtualAccounts.orderBy("updatedAt").last();
  if (existing) return { account: existing, password: null };
  return createGeneratedVirtualAccount(identity);
}

export async function setActiveVirtualAccountId(accountId: string): Promise<void> {
  const account = await socialDb.virtualAccounts.get(accountId);
  if (!account) throw new Error("账号不存在。");
  if (typeof window !== "undefined") localStorage.setItem(ACTIVE_ACCOUNT_KEY, accountId);
  announceSocialDataUpdated({ kind: "active-account", accountId });
}

export async function listVirtualAccounts(): Promise<VirtualAccount[]> {
  return (await socialDb.virtualAccounts.orderBy("updatedAt").reverse().toArray());
}

export async function getActiveVirtualAccount(): Promise<VirtualAccount | null> {
  const activeId = typeof window !== "undefined" ? localStorage.getItem(ACTIVE_ACCOUNT_KEY) : null;
  if (activeId) {
    const active = await socialDb.virtualAccounts.get(activeId);
    if (active) return active;
  }
  return (await socialDb.virtualAccounts.orderBy("updatedAt").last()) ?? null;
}

export async function updateVirtualAccount(accountId: string, updates: Pick<VirtualAccount, "displayName" | "avatarUrl">): Promise<void> {
  const now = Date.now();
  await socialDb.transaction("rw", socialDb.virtualAccounts, socialDb.friendIdentities, async () => {
    const account = await socialDb.virtualAccounts.get(accountId);
    if (!account) throw new Error("账号不存在。");
    await socialDb.virtualAccounts.update(accountId, { ...updates, updatedAt: now });
    await socialDb.friendIdentities.update(account.friendIdentityId, { ...updates, updatedAt: now });
  });
  announceSocialDataUpdated({ kind: "virtual-account-updated", accountId });
}

export async function verifyVirtualPassword(handle: string, password: string): Promise<VirtualAccount | null> {
  const account = await socialDb.virtualAccounts.where("handle").equals(handle.trim().replace(/^@/, "")).first();
  if (!account) return null;
  return (await hashPassword(password)) === account.passwordHash ? account : null;
}

export async function saveAppVirtualLogin(appId: string, accountId: string): Promise<AppVirtualLogin> {
  const now = Date.now();
  const login: AppVirtualLogin = {
    id: `${appId}:${accountId}`,
    appId,
    virtualAccountId: accountId,
    status: "logged_in",
    loggedInAt: now,
    lastUsedAt: now,
  };
  await socialDb.transaction("rw", socialDb.appLogins, async () => {
    const previous = await socialDb.appLogins.where("appId").equals(appId).toArray();
    await socialDb.appLogins.bulkPut(previous.map(row => ({ ...row, status: "logged_out" as const, lastUsedAt: now })));
    await socialDb.appLogins.put(login);
  });
  announceSocialDataUpdated({ kind: "app-login", appId, accountId });
  return login;
}

export async function getAppVirtualLogin(appId: string): Promise<{ login: AppVirtualLogin; account: VirtualAccount } | null> {
  const login = await socialDb.appLogins.where("appId").equals(appId).and(row => row.status === "logged_in").last();
  if (!login) return null;
  const account = await socialDb.virtualAccounts.get(login.virtualAccountId);
  if (!account) {
    await socialDb.appLogins.update(login.id, { status: "account_missing" });
    return null;
  }
  return { login, account };
}

export async function logoutAppVirtualLogin(appId: string): Promise<void> {
  const rows = await socialDb.appLogins.where("appId").equals(appId).toArray();
  await socialDb.appLogins.bulkPut(rows.map(row => ({ ...row, status: "logged_out" as const, lastUsedAt: Date.now() })));
  announceSocialDataUpdated({ kind: "app-logout", appId });
}
