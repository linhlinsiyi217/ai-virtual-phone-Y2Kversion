import { generateFriendCode, normalizeFriendCode } from "./friend-code";
import { announceSocialDataUpdated, socialDb } from "./social-db";
import type { FriendCodeRecord, FriendIdentity, FriendOwnerType, FriendRelationship } from "./social-types";

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export async function ensureFriendIdentity(ownerType: FriendOwnerType, ownerLocalId: string, displayName: string, avatarUrl?: string): Promise<FriendIdentity> {
  const existing = await socialDb.friendIdentities.where("[ownerType+ownerLocalId]").equals([ownerType, ownerLocalId]).first();
  if (existing) {
    const next = { ...existing, displayName: displayName || existing.displayName, avatarUrl: avatarUrl || existing.avatarUrl, updatedAt: Date.now() };
    await socialDb.friendIdentities.put(next);
    return next;
  }
  const now = Date.now();
  const created: FriendIdentity = { id: newId("friend"), ownerType, ownerLocalId, displayName, avatarUrl, allowCodeAdd: true, createdAt: now, updatedAt: now };
  await socialDb.friendIdentities.add(created);
  return created;
}

async function uniqueCode(): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const code = generateFriendCode();
    if (!(await socialDb.friendCodes.where("code").equals(code).first())) return code;
  }
  throw new Error("好友码生成繁忙，请稍后重试。");
}

export async function getActiveFriendCode(friendIdentityId: string): Promise<FriendCodeRecord> {
  const active = await socialDb.friendCodes.where("[friendIdentityId+active]").equals([friendIdentityId, 1]).first();
  if (active) return active;
  return refreshFriendCode(friendIdentityId);
}

export async function refreshFriendCode(friendIdentityId: string): Promise<FriendCodeRecord> {
  const now = Date.now();
  const old = await socialDb.friendCodes.where("friendIdentityId").equals(friendIdentityId).toArray();
  const record: FriendCodeRecord = {
    id: newId("code"), friendIdentityId, code: await uniqueCode(), revision: Math.max(0, ...old.map(item => item.revision)) + 1,
    active: 1, createdAt: now, revokedAt: null,
  };
  await socialDb.transaction("rw", socialDb.friendCodes, async () => {
    await socialDb.friendCodes.bulkPut(old.filter(item => item.active).map(item => ({ ...item, active: 0 as const, revokedAt: now })));
    await socialDb.friendCodes.add(record);
  });
  announceSocialDataUpdated({ kind: "friend-code-refreshed", friendIdentityId });
  return record;
}

export async function resolveFriendCode(code: string): Promise<{ code: FriendCodeRecord; identity: FriendIdentity }> {
  const record = await socialDb.friendCodes.where("code").equals(normalizeFriendCode(code)).first();
  if (!record || !record.active) throw new Error("好友码不存在或已失效。");
  const identity = await socialDb.friendIdentities.get(record.friendIdentityId);
  if (!identity || !identity.allowCodeAdd) throw new Error("对方暂时不允许通过好友码添加。");
  return { code: record, identity };
}

export async function addFriendByCode(fromFriendId: string, code: string): Promise<FriendRelationship> {
  const target = await resolveFriendCode(code);
  if (target.identity.id === fromFriendId) throw new Error("不能添加自己。");
  const existing = await socialDb.relationships.where("[fromFriendId+toFriendId]").equals([fromFriendId, target.identity.id]).first();
  if (existing?.status === "accepted") throw new Error("你们已经是好友了。");
  const now = Date.now();
  const initiatorType = (await socialDb.friendIdentities.get(fromFriendId))?.ownerType ?? "user";
  const relation: FriendRelationship = existing ? { ...existing, status: "accepted", updatedAt: now } : {
    id: newId("relation"), fromFriendId, toFriendId: target.identity.id,
    initiatorType,
    status: "accepted", createdAt: now, updatedAt: now,
  };
  const reverseExisting = await socialDb.relationships.where("[fromFriendId+toFriendId]").equals([target.identity.id, fromFriendId]).first();
  const reverse: FriendRelationship = reverseExisting ? { ...reverseExisting, status: "accepted", updatedAt: now } : {
    id: newId("relation"), fromFriendId: target.identity.id, toFriendId: fromFriendId,
    initiatorType, status: "accepted", createdAt: now, updatedAt: now,
  };
  await socialDb.relationships.bulkPut([relation, reverse]);
  announceSocialDataUpdated({ kind: "friend-added", relationshipId: relation.id });
  return relation;
}

export async function listFriends(fromFriendId: string): Promise<FriendIdentity[]> {
  const relations = await socialDb.relationships.where("fromFriendId").equals(fromFriendId).and(item => item.status === "accepted").toArray();
  return (await Promise.all(relations.map(item => socialDb.friendIdentities.get(item.toFriendId)))).filter((item): item is FriendIdentity => Boolean(item));
}
