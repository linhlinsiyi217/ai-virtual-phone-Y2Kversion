import type { ContentAppId } from "@/lib/settings-types";

export const BINDING_ACCENTS = {
    api: "#0a0a0a",
    voice: "#2c2c2e",
    preset: "#48484a",
    worldBook: "#5c5c60",
    regex: "#6e6e73",
    identity: "#8a8a8f",
    memory: "#a1a1a6",
    embedding: "#0a0a0a",
} as const;

export const CONTENT_APP_ACCENTS: Record<ContentAppId, string> = {
    chat: "#2c2c2e",
    diary: "#48484a",
    music: "#5c5c60",
    reading: "#6e6e73",
    forum: "#8a8a8f",
    cocreate: "#a1a1a6",
    story: "#0a0a0a",
    game: "#2c2c2e",
    xiaohongshu: "#48484a",
    dwelling: "#5c5c60",
    checkphone: "#6e6e73",
    shopping: "#8a8a8f",
    calendar: "#a1a1a6",
    interview_magazine: "#0a0a0a",
    moments: "#2c2c2e",
    group_chat: "#48484a",
    vn: "#5c5c60",
    adventure: "#6e6e73",
};
