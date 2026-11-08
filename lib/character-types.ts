export type CharacterAvatarHistoryEntry = {
  id: string;
  avatar: string | null;
  label: string;
  recordedAt: string;
  lastSelectedAt: string;
  selections: number;
};

export type Character = {
  id: string;
  name: string;
  avatar: string | null; // data URL 或外部 URL
  /** Most recently used distinct avatars, oldest first; travels with local character data. */
  avatarHistory?: CharacterAvatarHistoryEntry[];
  persona: string;       // 人设
  briefPersona?: string; // 简量版人设：注入到同世界有关系角色的「角色关系」marker，供对方了解 TA（防 OOC）
  briefPersonaUpdatedAt?: string; // 简介生成时间；早于 updatedAt 时编辑器提示「设定已更新，建议重新生成」
  wechatID?: string;     // 手机号格式的微信号
  personality?: string;    // 角色性格
  timeZone?: string;       // IANA 时区，例如 America/New_York；空值表示跟随系统时间
  /** 母语；persona 表示依人设。 */
  nativeLanguage?: "persona" | "zh" | "ko" | "ja" | "en";
  /** 默认日常交流语言；persona 表示依人设。 */
  communicationLanguage?: "persona" | "zh" | "ko" | "ja" | "en";
  /** 语言能力与习惯的自由描述。 */
  languageUsage?: string;
  /** 中文代输入：用户用中文说话时，视为用角色当前语言表达。 */
  chineseProxyInput?: boolean;
  tags?: string[];
  createdAt: string;
  updatedAt: string;

  // 画布坐标与渲染属性
  canvasX?: number;
  canvasY?: number;
  canvasRot?: number;
  canvasZIndex?: number;
  polaroidStyle?: number; // 用户选择的拍立得样式索引
};

export type CanvasBgItem = {
  id: string;
  type: 'a4' | 'yellow-note' | 'blue-note' | 'torn' | 'grid' | 'scrap';
  x: number;
  y: number;
  rot: number;
  zIndex: number;
  worldId?: string; // 所属世界画布；缺省 = 默认世界（存量数据零迁移）
};
