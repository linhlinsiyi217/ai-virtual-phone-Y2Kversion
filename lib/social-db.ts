import Dexie, { type Table } from "dexie";
import type {
  AppVirtualLogin,
  FriendCodeRecord,
  FriendIdentity,
  FriendRelationship,
  VirtualAccount,
} from "./social-types";

class AiPhoneSocialDatabase extends Dexie {
  virtualAccounts!: Table<VirtualAccount, string>;
  appLogins!: Table<AppVirtualLogin, string>;
  friendIdentities!: Table<FriendIdentity, string>;
  friendCodes!: Table<FriendCodeRecord, string>;
  relationships!: Table<FriendRelationship, string>;

  constructor() {
    super("AiPhoneSocialDB");
    this.version(1).stores({
      virtualAccounts: "id, identityId, &handle, friendIdentityId, updatedAt",
      appLogins: "id, appId, virtualAccountId, status, lastUsedAt, [appId+virtualAccountId]",
      friendIdentities: "id, [ownerType+ownerLocalId], ownerType, ownerLocalId, updatedAt",
      friendCodes: "id, friendIdentityId, &code, active, [friendIdentityId+active]",
      relationships: "id, fromFriendId, toFriendId, status, [fromFriendId+toFriendId]",
    });
  }
}

export const socialDb = new AiPhoneSocialDatabase();

export const SOCIAL_DATA_UPDATED_EVENT = "ai-phone-social-data-updated";

export function announceSocialDataUpdated(detail?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SOCIAL_DATA_UPDATED_EVENT, { detail }));
}
