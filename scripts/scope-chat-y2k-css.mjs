#!/usr/bin/env node
/**
 * Scope the iMessage-only presentation to the Y2K chat mode.
 *
 * The original chat CSS is already loaded before these files.  Keeping the
 * iMessage rules in the bundle is useful for the default Y2K mode, but those
 * rules must not win when the user switches to the original xiaolongbao
 * presentation.  This small CSS walker prefixes ordinary selectors while
 * leaving keyframes/font-face/property blocks intact.
 */
import fs from "node:fs";

const scope = ':is(.chat-app[data-chat-ui-mode="y2k"], .imessage26-dev-shell)';
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: scope-chat-y2k-css.mjs <css-file> [...]");
  process.exit(1);
}

function skipTrivia(source, index) {
  let i = index;
  while (i < source.length) {
    if (/\s/.test(source[i])) {
      i += 1;
      continue;
    }
    if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? source.length : end + 2;
      continue;
    }
    break;
  }
  return i;
}

function splitSelectorList(selector) {
  const parts = [];
  let start = 0;
  let paren = 0;
  let bracket = 0;
  let quote = "";
  let escape = false;
  for (let i = 0; i < selector.length; i += 1) {
    const ch = selector[i];
    if (quote) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === "(") paren += 1;
    else if (ch === ")") paren = Math.max(0, paren - 1);
    else if (ch === "[") bracket += 1;
    else if (ch === "]") bracket = Math.max(0, bracket - 1);
    else if (ch === "," && paren === 0 && bracket === 0) {
      parts.push(selector.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(selector.slice(start));
  return parts;
}

function prefixPrelude(prelude) {
  // Preserve comments/whitespace immediately before a selector.
  let i = 0;
  while (i < prelude.length) {
    if (/\s/.test(prelude[i])) { i += 1; continue; }
    if (prelude.startsWith("/*", i)) {
      const end = prelude.indexOf("*/", i + 2);
      i = end < 0 ? prelude.length : end + 2;
      continue;
    }
    break;
  }
  const trivia = prelude.slice(0, i);
  const selector = prelude.slice(i).trim();
  if (!selector) return prelude;
  // Development preview already lives under its own scope; keep its rules
  // unchanged so the dedicated preview route remains usable.
  if (selector.includes(".imessage26-dev-shell") || selector.includes("data-chat-ui-mode")) return prelude;
  const prefixed = splitSelectorList(selector)
    .map((part) => {
      const trimmedPart = part.trim();
      // A few legacy rules are written against the chat-app root itself
      // (for example `.chat-app > .chat-tab-bar`). Replace that root instead
      // of creating an impossible `.chat-app[data-mode] .chat-app` descendant.
      if (/^\.chat-app(?=[.#\[:\s>+~]|$)/.test(trimmedPart)) {
        return trimmedPart.replace(/^\.chat-app/, scope);
      }
      return `${scope} ${trimmedPart}`;
    })
    .join(",\n");
  return `${trivia}${prefixed}`;
}

function findNextToken(source, from) {
  let quote = "";
  let escape = false;
  let comment = false;
  for (let i = from; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (comment) {
      if (ch === "*" && next === "/") { comment = false; i += 1; }
      continue;
    }
    if (quote) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === "/" && next === "*") { comment = true; i += 1; continue; }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === "{" || ch === "}") return { index: i, token: ch };
  }
  return { index: source.length, token: null };
}

function transformBlock(source, start, stopAtBrace = false, inert = false) {
  let out = "";
  let cursor = start;
  while (cursor < source.length) {
    const token = findNextToken(source, cursor);
    if (!token.token) {
      out += source.slice(cursor);
      return { text: out, next: source.length };
    }
    if (token.token === "}") {
      if (stopAtBrace) {
        out += source.slice(cursor, token.index);
        return { text: out, next: token.index + 1, closed: true };
      }
      out += source.slice(cursor, token.index + 1);
      return { text: out, next: token.index + 1 };
    }

    const prelude = source.slice(cursor, token.index);
    const atStart = skipTrivia(prelude, 0);
    const trimmed = prelude.slice(atStart);
    const atName = trimmed.match(/^@([\w-]+)/)?.[1]?.toLowerCase() || "";
    const keepUnscoped = inert || ["keyframes", "-webkit-keyframes", "font-face", "property", "page", "counter-style"].includes(atName);
    const nested = transformBlock(source, token.index + 1, true, keepUnscoped);
    if (keepUnscoped || inert || atName) {
      out += prelude + "{" + nested.text + "}";
    } else {
      out += prefixPrelude(prelude) + "{" + nested.text + "}";
    }
    cursor = nested.next;
  }
  return { text: out, next: cursor };
}

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const result = transformBlock(source, 0).text;
  fs.writeFileSync(file, result);
  console.log(`scoped ${file}`);
}
