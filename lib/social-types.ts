export type FriendOwnerType = "user" | "ai";

export type VirtualAccount = {
  id: string;
  identityId: string | null;
  displayName: string;
  handle: string;
  passwordHash: string;
  passwordHint: string;
  avatarUrl?: string;
  friendIdentityId: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: 1;
};

export type AppVirtualLogin = {
  id: string;
  appId: string;
  virtualAccountId: string;
  status: "logged_out" | "logged_in" | "account_missing";
  loggedInAt: number | null;
  lastUsedAt: number;
};

export type FriendIdentity = {
  id: string;
  ownerType: FriendOwnerType;
  ownerLocalId: string;
  displayName: string;
  avatarUrl?: string;
  allowCodeAdd: boolean;
  createdAt: number;
  updatedAt: number;
};

export type FriendCodeRecord = {
  id: string;
  friendIdentityId: string;
  code: string;
  revision: number;
  active: 0 | 1;
  createdAt: number;
  revokedAt: number | null;
};

export type FriendRelationship = {
  id: string;
  fromFriendId: string;
  toFriendId: string;
  initiatorType: FriendOwnerType;
  status: "pending" | "accepted" | "blocked";
  createdAt: number;
  updatedAt: number;
};

export type FriendCodePayload = {
  version: 1;
  kind: FriendOwnerType;
  code: string;
};

export type GeneratedVirtualCredentials = {
  account: VirtualAccount;
  password: string;
};
