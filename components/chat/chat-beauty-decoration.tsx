"use client";

import { useMemo } from "react";

function sanitizeDecorationHTML(raw: string): string {
  if (!raw || typeof window === "undefined") return "";
  const doc = new DOMParser().parseFromString(raw, "text/html");
  doc.querySelectorAll("script,iframe,object,embed,link,meta,base,form,input,button,textarea,select").forEach(node => node.remove());
  doc.body.querySelectorAll("*").forEach(node => {
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on") || ((name === "href" || name === "src") && value.startsWith("javascript:"))) node.removeAttribute(attr.name);
    }
  });
  return doc.body.innerHTML;
}

export function ChatBeautyDecoration({ slot, html }: { slot: string; html: string }) {
  const safeHTML = useMemo(() => sanitizeDecorationHTML(html), [html]);
  if (!safeHTML) return null;
  return <div className={`chat-html-decoration chat-html-decoration--${slot}`} data-beauty-slot={slot} aria-hidden="true" dangerouslySetInnerHTML={{ __html: safeHTML }} />;
}

