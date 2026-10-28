// lib/study-room/npc-avatar.ts — 书友圈头像素材（自制 SVG，来源明确）。
//
// 头像走「正常人会选的头像」路线：动物、可爱人物、天气、天空、风景。
// 全部是这里画的简单几何小图，不调用外部图片服务，也不生成怪异假人脸；
// 生成结果会随人设一起保存，随时可以换一个，加载失败时退回昵称首字。

export type AvatarCategory = "animal" | "cute" | "weather" | "sky" | "landscape";

export type NpcAvatar = {
  category: AvatarCategory;
  /** 同类里的第几个样式 */
  variant: number;
  /** 背景色（也是整张图的底色） */
  bg: string;
};

export const AVATAR_CATEGORIES: Array<{ key: AvatarCategory; label: string }> = [
  { key: "animal", label: "动物" },
  { key: "cute", label: "可爱人物" },
  { key: "weather", label: "天气" },
  { key: "sky", label: "天空" },
  { key: "landscape", label: "风景" },
];

const BACKGROUNDS = [
  "#E8F0FA", "#F3EAF7", "#E9F5EC", "#FDF1E3", "#EAF4F7", "#F6EBEA", "#EDF0F7",
];

const TINTS = ["#5C7A9E", "#8B6E9E", "#6E9E7A", "#C08A54", "#5A9AA8", "#B4736F", "#6A7391"];

export function randomAvatar(seed?: number): NpcAvatar {
  const random = typeof seed === "number" ? mulberry(seed) : Math.random;
  const category = AVATAR_CATEGORIES[Math.floor(random() * AVATAR_CATEGORIES.length)].key;
  const variant = Math.floor(random() * 6);
  const bg = BACKGROUNDS[Math.floor(random() * BACKGROUNDS.length)];
  return { category, variant, bg };
}

/** 换一个同类别的其它样式（保持头像风格稳定）。 */
export function nextVariant(avatar: NpcAvatar): NpcAvatar {
  return { ...avatar, variant: (avatar.variant + 1) % 6 };
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tintFor(avatar: NpcAvatar): string {
  return TINTS[(avatar.variant + avatar.category.length) % TINTS.length];
}

/** 具体图形：每种分类 6 个样式，都是简单几何拼出来的。 */
function shapeSvg(avatar: NpcAvatar): string {
  const c = tintFor(avatar);
  const v = avatar.variant;
  switch (avatar.category) {
    case "animal": {
      const ears =
        v % 3 === 0
          ? `<path d="M28 34 L38 18 L50 32 Z" fill="${c}"/><path d="M72 34 L62 18 L50 32 Z" fill="${c}"/>`
          : v % 3 === 1
            ? `<ellipse cx="31" cy="30" rx="8" ry="14" fill="${c}"/><ellipse cx="69" cy="30" rx="8" ry="14" fill="${c}"/>`
            : `<circle cx="30" cy="26" r="10" fill="${c}"/><circle cx="70" cy="26" r="10" fill="${c}"/>`;
      const face = v < 3 ? `<circle cx="50" cy="54" r="24" fill="${c}"/>` : `<ellipse cx="50" cy="54" rx="26" ry="22" fill="${c}"/>`;
      return `${ears}${face}
  <circle cx="41" cy="50" r="3" fill="#2E3440"/><circle cx="59" cy="50" r="3" fill="#2E3440"/>
  <path d="M50 58 l-4 4 h8 z" fill="#2E3440"/>
  <path d="M44 66 q6 6 12 0" stroke="#2E3440" stroke-width="2" fill="none" stroke-linecap="round"/>`;
    }
    case "cute": {
      const hair =
        v % 3 === 0
          ? `<path d="M28 46 q4 -24 22 -24 q18 0 22 24 q-6 -10 -22 -10 q-16 0 -22 10 z" fill="${c}"/>`
          : v % 3 === 1
            ? `<path d="M26 48 q6 -26 24 -26 q18 0 24 26 q-10 -14 -24 -14 q-14 0 -24 14 z" fill="${c}"/><circle cx="26" cy="52" r="6" fill="${c}"/><circle cx="74" cy="52" r="6" fill="${c}"/>`
            : `<path d="M28 46 q6 -22 22 -22 q16 0 22 22 z" fill="${c}"/><rect x="45" y="14" width="10" height="10" rx="4" fill="${c}"/>`;
      return `<circle cx="50" cy="54" r="22" fill="#F7DFC8"/>${hair}
  <circle cx="42" cy="54" r="2.6" fill="#3A3F4A"/><circle cx="58" cy="54" r="2.6" fill="#3A3F4A"/>
  <path d="M45 63 q5 5 10 0" stroke="#B96A5E" stroke-width="2" fill="none" stroke-linecap="round"/>
  <path d="M26 92 q24 -16 48 0 z" fill="${c}"/>`;
    }
    case "weather": {
      const cloud = (x: number, y: number, s = 1) =>
        `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="0" rx="18" ry="12" fill="#FFFFFF"/><ellipse cx="-14" cy="4" rx="12" ry="9" fill="#FFFFFF"/><ellipse cx="14" cy="4" rx="12" ry="9" fill="#FFFFFF"/></g>`;
      if (v === 0) return `<circle cx="50" cy="50" r="20" fill="#F4C15C"/><g stroke="#F4C15C" stroke-width="3" stroke-linecap="round">${Array.from({ length: 8 }, (_, i) => { const a = (i * Math.PI) / 4; return `<line x1="${50 + Math.cos(a) * 26}" y1="${50 + Math.sin(a) * 26}" x2="${50 + Math.cos(a) * 34}" y2="${50 + Math.sin(a) * 34}"/>`; }).join("")}</g>`;
      if (v === 1) return `${cloud(50, 46, 1.3)}<g stroke="${c}" stroke-width="3" stroke-linecap="round">${[0, 1, 2].map((i) => `<line x1="${36 + i * 14}" y1="70" x2="${32 + i * 14}" y2="84"/>`).join("")}</g>`;
      if (v === 2) return `${cloud(50, 44, 1.2)}<g stroke="#FFFFFF" stroke-width="3" stroke-linecap="round">${[0, 1, 2, 3].map((i) => `<line x1="${34 + i * 11}" y1="${64 + (i % 2) * 6}" x2="${34 + i * 11}" y2="${78 + (i % 2) * 6}"/>`).join("")}</g>`;
      if (v === 3) return `${["#E4756B", "#F0A85C", "#F2D05C", "#7FB98A", "#6E9BD1"].map((color, i) => `<path d="M14 ${72 - i * 8} q36 -26 72 0" stroke="${color}" stroke-width="6" fill="none" stroke-linecap="round"/>`).join("")}`;
      if (v === 4) return `${cloud(50, 42, 1.1)}<path d="M50 60 l0 34" stroke="${c}" stroke-width="3"/><path d="M50 66 q14 -6 18 6 q-12 4 -18 -6 z" fill="${c}"/>`;
      return `${normalStar(50, 22, 10)}`;
    }
    case "sky": {
      if (v === 0) return `<circle cx="50" cy="50" r="22" fill="#F6E6B8"/>${normalStar(26, 28, 6)}${normalStar(74, 34, 5)}${normalStar(66, 74, 4)}<circle cx="36" cy="62" r="4" fill="#F6E6B8" opacity="0.7"/>`;
      if (v === 1) return `<rect x="0" y="0" width="100" height="100" fill="none"/><circle cx="50" cy="66" r="26" fill="#F2B85B"/><rect x="0" y="66" width="100" height="34" fill="${c}" opacity="0.35"/>`;
      if (v === 2) return `${[0, 1, 2, 3, 4, 5].map((i) => normalStar(16 + ((i * 29) % 68), 20 + ((i * 37) % 60), 3 + (i % 3))).join("")}<path d="M70 74 a18 18 0 1 0 -30 0 z" fill="#DDE6F2"/>`;
      if (v === 3) return `<path d="M0 70 q25 -22 50 -4 q25 18 50 -6 v40 h-100 z" fill="${c}" opacity="0.5"/><circle cx="34" cy="34" r="12" fill="#F6E6B8"/>`;
      if (v === 4) return `${[0, 1, 2, 3, 4].map((i) => `<path d="M10 ${26 + i * 13} q18 -12 36 0 q18 12 36 0" stroke="${i % 2 ? "#FFFFFF" : c}" stroke-width="4" fill="none" opacity="0.85"/>`).join("")}`;
      return `<path d="M0 60 q30 -40 60 -6 q22 -22 40 4 v42 h-100 z" fill="${c}" opacity="0.45"/><circle cx="72" cy="26" r="10" fill="#F6E6B8"/>`;
    }
    default: {
      if (v === 0) return `<path d="M0 74 l26 -34 l18 22 l16 -26 l40 38 z" fill="${c}"/><rect x="0" y="74" width="100" height="26" fill="${c}" opacity="0.35"/>`;
      if (v === 1) return `<rect x="0" y="58" width="100" height="42" fill="${c}" opacity="0.45"/><path d="M18 58 q6 -10 12 0 M40 58 q6 -10 12 0 M62 58 q6 -10 12 0" stroke="#FFFFFF" stroke-width="3" fill="none"/>`;
      if (v === 2) return `${[20, 44, 68].map((x, i) => `<path d="M${x} 78 l-12 0 l12 -${30 + i * 8} l12 ${30 + i * 8} z" fill="${i % 2 ? c : "#7FA07F"}"/>`).join("")}<rect x="0" y="78" width="100" height="22" fill="${c}" opacity="0.3"/>`;
      if (v === 3) return `<path d="M0 78 q26 -16 50 0 q24 16 50 -4 v26 h-100 z" fill="#E7C88A"/><circle cx="74" cy="28" r="11" fill="#F4C15C"/>`;
      if (v === 4) return `<rect x="0" y="72" width="100" height="28" fill="${c}" opacity="0.35"/>${[14, 30, 46, 62, 78].map((x, i) => `<rect x="${x}" y="${30 + (i % 3) * 14}" width="12" height="${42 - (i % 3) * 14}" fill="${c}" opacity="${0.5 + (i % 3) * 0.15}"/>`).join("")}`;
      return `<path d="M0 70 q22 -30 44 -8 q20 -20 40 2 q10 10 16 6 v30 h-100 z" fill="${c}" opacity="0.55"/><circle cx="24" cy="26" r="9" fill="#F6E6B8"/>`;
    }
  }
}

function normalStar(cx: number, cy: number, r: number): string {
  const points = Array.from({ length: 10 }, (_, i) => {
    const radius = i % 2 === 0 ? r : r / 2.4;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    return `${(cx + Math.cos(angle) * radius).toFixed(1)},${(cy + Math.sin(angle) * radius).toFixed(1)}`;
  }).join(" ");
  return `<polygon points="${points}" fill="#F6E6B8"/>`;
}

export function avatarSvg(avatar: NpcAvatar): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100" role="img">
  <rect width="100" height="100" rx="24" fill="${avatar.bg}"/>
  ${shapeSvg(avatar)}
</svg>`;
}

/** 直接能放进 <img src> 或 CSS background 的 data URL。 */
export function avatarDataUrl(avatar: NpcAvatar): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(avatarSvg(avatar))}`;
}

/** 输入一个稳定字符串（如人设 id）得到固定头像，保证同一人设头像不乱跳。 */
export function avatarFromKey(key: string): NpcAvatar {
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) % 100000;
  return randomAvatar(hash);
}
