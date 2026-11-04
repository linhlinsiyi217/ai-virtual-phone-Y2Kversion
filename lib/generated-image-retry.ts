import { saveChatImageToIndexedDB } from "./chat-asset-storage";
import { loadChatMessages, syncChatGeneratedImagePromptText, updateChatMessage, type ChatMessage } from "./chat-storage";
import { generatedImageFilename, generateImageFromConfiguredApi } from "./image-generation-service";
import {
    buildMultiImageSheetPrompt,
    createPhotoGroupPlan,
    MULTI_IMAGE_TARGET_CELL_ASPECT_RATIO,
    resolveMultiImageGenerationSize,
} from "./image-delivery-protocol";
import { imageBlobToDataUrl, isImageGridCount, splitImageGrid } from "./image-grid-split";
import { loadImageGenerationSettings } from "./settings-storage";
import { deleteMediaRef, storeMediaBlob } from "./media-cache-storage";
import { isAbortError } from "./abort-utils";
import { updateMomentPost } from "./moments-storage";
import type { MomentPost } from "./moments-types";

function errorToMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function dispatchChatMessagesUpdated(sessionId: string, message: ChatMessage): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("chat-messages-updated", {
        detail: { sessionId, message },
    }));
}

function dispatchMomentsUpdated(): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("moments-updated"));
}

export function createPendingChatGeneratedImageData(
    mediaData: ChatMessage["mediaData"] | undefined,
    description?: string,
): ChatMessage["mediaData"] {
    const label = (description || mediaData?.label || "").trim();
    return {
        ...mediaData,
        label,
        imageGenerationStatus: "pending",
        imageGenerationError: undefined,
    };
}

export function isPendingChatGeneratedImageMessage(message: Pick<ChatMessage, "mediaType" | "mediaData">): boolean {
    return message.mediaType === "image" && message.mediaData?.imageGenerationStatus === "pending";
}

export function isMultiImageGenerationExecutor(message: Pick<ChatMessage, "mediaType" | "mediaData">): boolean {
    const plan = message.mediaData?.multiImagePlan;
    if (message.mediaType !== "image" || !plan || !isImageGridCount(plan.displayImageCount)) return false;
    return message.mediaData?.photoGroupIndex === plan.displayImageCount - 1;
}

function applyTextPhotoFallback(message: ChatMessage, description: string, error?: unknown, dispatch = true): ChatMessage {
    const updated = updateChatMessage(message.id, {
        content: "",
        mediaType: "image",
        mediaUrl: undefined,
        mediaData: {
            ...message.mediaData,
            label: description,
            photoKind: "text_photo",
            imageGenerationStatus: "fallback",
            imageGenerationError: error ? errorToMessage(error) : undefined,
        },
    });
    if (!updated) throw new Error("原消息不存在，无法降级为文字图");
    if (dispatch) dispatchChatMessagesUpdated(updated.sessionId, updated);
    return updated;
}

export async function generateAndApplyChatGeneratedImage(
    message: ChatMessage,
    characterId?: string,
    options?: { signal?: AbortSignal; description?: string },
): Promise<ChatMessage> {
    const previousDescription = message.mediaData?.label?.trim() || "";
    const description = (options?.description ?? previousDescription).trim();
    if (!description) throw new Error("缺少图片描述，无法重新生成");
    if (previousDescription && previousDescription !== description) {
        syncChatGeneratedImagePromptText(message.id, previousDescription, description);
    }

    // 重试路径：先落库为 pending 并广播，气泡立刻切到"生成中"态（首次生图本来就是 pending，无需重写）。
    // 之后无论成功/失败都会再写一次状态，不会卡在 pending。
    if (message.mediaData?.imageGenerationStatus !== "pending") {
        const marked = updateChatMessage(message.id, {
            mediaData: {
                ...message.mediaData,
                label: description,
                imageGenerationStatus: "pending",
                imageGenerationError: undefined,
            },
        });
        if (marked) dispatchChatMessagesUpdated(marked.sessionId, marked);
    }

    try {
        const generated = await generateImageFromConfiguredApi({
            description,
            characterId,
            useReferenceImage: message.mediaData?.useReferenceImage === true,
            signal: options?.signal,
        });
        if (!generated) throw new Error("生图配置未启用或不完整");

        const fileName = generatedImageFilename(description, generated.mimeType);
        const previousData = message.mediaData ?? {};
        const nextData: ChatMessage["mediaData"] = {
            ...previousData,
            label: description,
            photoKind: "photo",
            fileType: "image",
            fileName,
            imageGenerationMediaRef: generated.mediaRef,
            imageGenerationPrompt: generated.prompt,
            imageGenerationUsedReference: generated.usedReferenceImage,
            imageGenerationStatus: "generated",
            imageGenerationError: undefined,
        };
        const updated = updateChatMessage(message.id, {
            content: fileName,
            mediaType: "media_file",
            mediaUrl: generated.dataUrl,
            mediaData: nextData,
        });
        if (!updated) throw new Error("原消息不存在，无法替换图片");
        dispatchChatMessagesUpdated(updated.sessionId, updated);
        return updated;
    } catch (error) {
        if (!isAbortError(error)) return applyTextPhotoFallback(message, description, error);
        const failed = updateChatMessage(message.id, {
            mediaData: { ...message.mediaData, label: description, imageGenerationStatus: "failed", imageGenerationError: errorToMessage(error) },
        });
        if (failed) dispatchChatMessagesUpdated(failed.sessionId, failed);
        throw error;
    }
}

export async function generateAndApplyChatGeneratedImageGroup(
    executorMessage: ChatMessage,
    characterId?: string,
    options?: { signal?: AbortSignal },
): Promise<ChatMessage[]> {
    const groupId = executorMessage.mediaData?.photoGroupId;
    const rawPlan = executorMessage.mediaData?.multiImagePlan;
    if (!groupId || !rawPlan || !isImageGridCount(rawPlan.displayImageCount)) {
        throw new Error("缺少有效的多图生成计划");
    }

    const groupMessages = loadChatMessages(executorMessage.sessionId)
        .filter(message => message.mediaData?.photoGroupId === groupId)
        .sort((a, b) => (a.mediaData?.photoGroupIndex ?? 0) - (b.mediaData?.photoGroupIndex ?? 0));
    if (groupMessages.length !== rawPlan.displayImageCount) {
        throw new Error(`照片组数量应为 ${rawPlan.displayImageCount}，当前为 ${groupMessages.length}`);
    }

    const plan = createPhotoGroupPlan(
        rawPlan.displayImageCount,
        rawPlan.visualIntent,
        rawPlan.shots,
        rawPlan.characterExpressionStyle,
    );
    const sheet = buildMultiImageSheetPrompt(plan);
    let contactSheetMediaRef: string | undefined;

    try {
        const settings = loadImageGenerationSettings();
        const generationSize = resolveMultiImageGenerationSize(sheet.canvasGuidance, {
            model: settings.model,
            configuredSize: settings.size,
        });
        const generated = await generateImageFromConfiguredApi({
            description: sheet.prompt,
            characterId,
            useReferenceImage: rawPlan.useReferenceImage,
            settings: { ...settings, size: generationSize.size },
            signal: options?.signal,
        });
        if (!generated) throw new Error("生图配置未启用或不完整");
        contactSheetMediaRef = generated.mediaRef;

        const pieces = await splitImageGrid(generated.blob, sheet.layout, {
            mimeType: "image/jpeg",
            quality: 0.92,
            outputAspectRatio: MULTI_IMAGE_TARGET_CELL_ASPECT_RATIO,
        });
        if (pieces.length !== groupMessages.length) throw new Error("多图切割结果数量不匹配");

        const assets = await Promise.all(pieces.map(async (piece, index) => ({
            mediaRef: await storeMediaBlob(piece, piece.type || "image/jpeg", "image"),
            dataUrl: await imageBlobToDataUrl(piece),
            fileName: generatedImageFilename(rawPlan.shots[index], piece.type || "image/jpeg"),
        })));
        const updated = groupMessages.map((message, index) => {
            const next = updateChatMessage(message.id, {
                content: assets[index].fileName,
                mediaType: "media_file",
                mediaUrl: assets[index].dataUrl,
                mediaData: {
                    ...message.mediaData,
                    label: rawPlan.shots[index],
                    photoKind: "photo",
                    fileType: "image",
                    fileName: assets[index].fileName,
                    imageGenerationMediaRef: assets[index].mediaRef,
                    imageGenerationPrompt: generated.prompt,
                    imageGenerationUsedReference: generated.usedReferenceImage,
                    imageGenerationStatus: "generated",
                    imageGenerationError: undefined,
                },
            });
            if (!next) throw new Error("照片组中的原消息不存在，无法替换图片");
            return next;
        });
        if (updated[0]) dispatchChatMessagesUpdated(updated[0].sessionId, updated[0]);
        return updated;
    } catch (error) {
        if (isAbortError(error)) {
            groupMessages.forEach(message => {
                const failed = updateChatMessage(message.id, {
                    mediaData: { ...message.mediaData, imageGenerationStatus: "failed", imageGenerationError: errorToMessage(error) },
                });
                if (failed) dispatchChatMessagesUpdated(failed.sessionId, failed);
            });
            throw error;
        }
        const fallback = groupMessages.map((message, index) => applyTextPhotoFallback(message, rawPlan.shots[index], error, false));
        if (fallback[0]) dispatchChatMessagesUpdated(fallback[0].sessionId, fallback[0]);
        return fallback;
    } finally {
        if (contactSheetMediaRef) await deleteMediaRef(contactSheetMediaRef).catch(() => undefined);
    }
}

export async function retryChatGeneratedImage(
    message: ChatMessage,
    characterId?: string,
    nextDescription?: string,
    useReferenceImage?: boolean,
): Promise<ChatMessage> {
    return generateAndApplyChatGeneratedImage(message, characterId, { description: nextDescription });
}

export async function retryMomentGeneratedPhoto(post: MomentPost, nextDescription?: string, useReferenceImage?: boolean): Promise<MomentPost> {
    const description = (nextDescription ?? post.photoDescription)?.trim();
    if (!description) throw new Error("缺少图片描述，无法重新生成");

    // 同聊天：重试先置 pending 并广播，卡片立刻显示"图片生成中…"；成功/失败都会再写状态。
    updateMomentPost(post.id, {
        photoDescription: description,
        photoGenerationStatus: "pending",
        photoGenerationError: undefined,
    });
    dispatchMomentsUpdated();

    try {
        const generated = await generateImageFromConfiguredApi({
            description,
            characterId: post.authorType === "character" ? post.authorId : undefined,
            useReferenceImage: useReferenceImage ?? post.photoUseReferenceImage === true,
        });
        if (!generated) throw new Error("生图配置未启用或不完整");

        const assetId = await saveChatImageToIndexedDB(generated.blob);
        const updated = updateMomentPost(post.id, {
            photoUrl: `asset://${assetId}`,
            photoDescription: description,
            photoGenerationStatus: "generated",
            photoGenerationPrompt: generated.prompt,
            photoGenerationError: undefined,
        });
        if (!updated) throw new Error("原朋友圈不存在，无法替换图片");
        dispatchMomentsUpdated();
        return updated;
    } catch (error) {
        updateMomentPost(post.id, {
            photoDescription: description,
            photoGenerationStatus: "failed",
            photoGenerationError: errorToMessage(error),
        });
        dispatchMomentsUpdated();
        throw error;
    }
}
