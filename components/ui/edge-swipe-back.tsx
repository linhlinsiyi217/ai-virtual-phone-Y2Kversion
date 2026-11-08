"use client";

import { useEffect, useRef } from "react";
import { installEdgeSwipeBack } from "@/lib/edge-swipe-back";

export function EdgeSwipeBack({ onBack }: { onBack?: () => void } = {}) {
    const host = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        const root = host.current?.closest<HTMLElement>('[data-ui="phone-screen"]');
        if (!root) return;
        return installEdgeSwipeBack(root, () => { onBack?.(); });
    }, []);
    return <span ref={host} hidden aria-hidden="true" />;
}
