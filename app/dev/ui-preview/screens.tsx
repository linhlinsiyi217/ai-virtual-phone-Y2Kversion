import { Fragment, type CSSProperties, type ReactNode } from "react";
import sample from "@/design/sample-data.json";

/* ────────────────────────────── 图标 ────────────────────────────── */

function I({ children, size }: { children: ReactNode; size?: number }) {
  return (
    <svg className="ic" viewBox="0 0 24 24" style={size ? { width: size, height: size } : undefined}>
      {children}
    </svg>
  );
}

const ICON = {
  search: (
    <I>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </I>
  ),
  user: (
    <I>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
    </I>
  ),
  mask: (
    <I>
      <path d="M4.5 8c0-1.7 1.3-3 3-3h9c1.7 0 3 1.3 3 3v3.5c0 4-3.4 7.5-7.5 7.5S4.5 15.5 4.5 11.5V8z" />
      <path d="M8.5 10.5h1.5M14 10.5h1.5M9.5 14.5q2.5 2 5 0" />
    </I>
  ),
  book: (
    <I>
      <path d="M5 5.5A2 2 0 017 3.5h11v15H7a2 2 0 00-2 2v-15z" />
      <path d="M5 20.5h13" />
    </I>
  ),
  people: (
    <I>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
      <circle cx="17" cy="9.5" r="2.4" />
      <path d="M16.5 14.2c2.3 0 3.6 1.5 4 3.8" />
    </I>
  ),
  plus: (
    <I>
      <path d="M12 5v14M5 12h14" />
    </I>
  ),
  grid: (
    <I>
      <rect x="4.5" y="4.5" width="6" height="6" rx="2" />
      <rect x="13.5" y="4.5" width="6" height="6" rx="2" />
      <rect x="4.5" y="13.5" width="6" height="6" rx="2" />
      <rect x="13.5" y="13.5" width="6" height="6" rx="2" />
    </I>
  ),
  chev: (
    <I>
      <path d="M9 6l6 6-6 6" />
    </I>
  ),
  exit: (
    <I>
      <path d="M10 5H6.5A2 2 0 004.5 7v10a2 2 0 002 2H10M14 8l4 4-4 4M18 12H9" />
    </I>
  ),
  pencil: (
    <I>
      <path d="M4 20l4-1 10-10-3-3L5 16l-1 4zM14 7l3 3" />
    </I>
  ),
  trash: (
    <I>
      <path d="M5.5 7h13M9.5 7V5h5v2M7.5 7l.7 12h7.6l.7-12" />
    </I>
  ),
  star: (
    <I>
      <path d="M12 4l1.8 5.2L19 11l-5.2 1.8L12 18l-1.8-5.2L5 11l5.2-1.8L12 4z" />
    </I>
  ),
  bolt: (
    <I>
      <path d="M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z" />
    </I>
  ),
  eye: (
    <I>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </I>
  ),
  x: (
    <I>
      <path d="M6 6l12 12M18 6L6 18" />
    </I>
  ),
  check: (
    <I>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </I>
  ),
};

/* ────────────────────────────── 猫咪 ────────────────────────────── */

function catSvg(pose = "stand", face?: string, acc = "") {
  const f = face || (pose === "sleep" ? "sleepy" : pose === "wave" ? "happy" : "normal");
  const big = (cx: number, r: number, hx: number) =>
    `<g class="eye"><g transform="rotate(${r} ${cx} 84)"><ellipse class="ey" cx="${cx}" cy="84" rx="${
      f === "wow" ? 7 : 6
    }" ry="${f === "wow" ? 9.6 : 8}"/></g><circle class="hi" cx="${hx}" cy="80.4" r="2.3"/><circle class="hi" cx="${
      hx + (hx > 80 ? 4 : -4)
    }" cy="88" r="1"/></g>`;
  const arcH = (x: number) => `<path class="ln" d="M${x - 7} 86Q${x} 77 ${x + 7} 86"/>`;
  const arcS = (x: number) => `<path class="ln" d="M${x - 7} 84q7 5 14 0"/>`;
  const L =
    ({ normal: big(62, 10, 64.6), happy: arcH(62), sleepy: arcS(62), wink: arcH(62), wow: big(62, 10, 64.6) } as Record<
      string,
      string
    >)[f] || big(62, 10, 64.6);
  const R =
    ({ normal: big(98, -10, 95.4), happy: arcH(98), sleepy: arcS(98), wink: big(98, -10, 95.4), wow: big(98, -10, 95.4) } as Record<
      string,
      string
    >)[f] || big(98, -10, 95.4);
  const M =
    ({
      happy: '<path class="ln s" d="M73.5 97Q80 108 86.5 97Z" style="fill:#E2E2E5"/>',
      wow: '<ellipse class="ln s" cx="80" cy="99.5" rx="3" ry="3.6" style="fill:#E2E2E5"/>',
    } as Record<string, string>)[f] || '<path class="ln s" d="M74.5 97.5Q77 101 80 97Q83 101 85.5 97.5"/>';
  let s = '<svg class="cat" viewBox="0 0 160 144" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">';
  if (pose === "walk")
    s +=
      '<ellipse class="sd" cx="80" cy="141" rx="28" ry="3.2"/><path id="dust" class="ln s" style="opacity:.3" d="M20 98H36M12 110H30M22 122H36"/>';
  s +=
    `<g id="cat" class="${pose === "walk" ? "hop" : "bob"}">` +
    (acc.indexOf("halo") >= 0
      ? '<ellipse id="halo" class="ln s halo" style="stroke:#8e8e93" cx="80" cy="15" rx="21" ry="5"/>'
      : "") +
    '<g id="ears"><g class="ear l"><path class="ln wf" d="M38 70C32 52 28 32 29 17C30 11 35 9 40 12C54 20 68 32 76 46"/><path class="gy" d="M40 61C36 47 33 33 34 23C44 28 56 36 64 47Z"/></g>' +
    '<g class="ear r"><path class="ln wf" d="M122 70C128 52 132 32 131 17C130 11 125 9 120 12C106 20 92 32 84 46"/><path class="gy" d="M120 61C124 47 127 33 126 23C116 28 104 36 96 47Z"/></g></g>' +
    '<path id="body" class="ln wf" d="M54 112C50 128 60 138 80 138C100 138 110 128 106 112"/>' +
    '<ellipse id="head" class="ln wf" cx="80" cy="80" rx="47" ry="38"/>' +
    '<path class="ln s tuft" d="M80 42C76 33 81 26 88 28"/><path class="ln s" style="stroke-width:1.5" d="M35 89L19 85M35 94L18 96M36 99L21 106M125 89L141 85M125 94L142 96M124 99L139 106"/>' +
    '<g id="face"><circle class="dt" cx="60" cy="69" r="2.4"/><circle class="dt" cx="100" cy="69" r="2.4"/>' +
    '<ellipse class="bl" cx="45" cy="94" rx="9" ry="5.5"/><ellipse class="bl" cx="115" cy="94" rx="9" ry="5.5"/>' +
    '<path class="bs" d="M40 92l-1.5 4M45 91l-1.5 4M50 91.5l-1.5 4M110 91.5l1.5 4M115 91l1.5 4M120 92l1.5 4"/>' +
    '<g id="eyes">' +
    L +
    R +
    '</g><g id="muzzle"><ellipse class="mz" cx="74" cy="95" rx="8.5" ry="6.2"/><ellipse class="mz" cx="86" cy="95" rx="8.5" ry="6.2"/>' +
    '<path class="nz" d="M76.5 88.5h7l-3.5 4.2z"/>' +
    M +
    "</g></g>";
  if (pose !== "box")
    s +=
      '<path class="ln s" d="M64 117Q80 127 96 117"/><g class="bell"><circle class="ln s gy" style="stroke:#111;stroke-width:1.7" cx="80" cy="124" r="4"/><path class="ln s" d="M78 124h4"/></g>';
  if (pose === "box")
    s +=
      '<rect class="ln wf" x="50" y="112" width="60" height="26" rx="5"/><path class="ln s" d="M50 121H110M80 112V138"/><path class="ln" d="M80 112C72 103 66 109 72 112M80 112C88 103 94 109 88 112"/><ellipse class="ln s wf" cx="63" cy="112" rx="7" ry="5"/><ellipse class="ln s wf" cx="97" cy="112" rx="7" ry="5"/>';
  else {
    s += '<ellipse class="ln s wf" cx="63" cy="133" rx="7.5" ry="5.5"/>';
    if (pose === "wave")
      s +=
        '<g class="arm"><path class="ln" d="M104 122C116 120 124 110 122 97"/><circle class="ln s wf" cx="122" cy="93" r="6.5"/><circle class="gy2" cx="122" cy="95" r="2"/></g><path class="ln s" style="opacity:.4" d="M133 86q5 5 0 12M138 81q8 10 0 22"/>';
    else s += '<ellipse class="ln s wf" cx="97" cy="133" rx="7.5" ry="5.5"/>';
  }
  if (pose === "sleep")
    s +=
      '<path class="z ln s" d="M118 46h9l-9 10h9"/><path class="z ln s" style="animation-delay:1.2s" d="M130 32h6l-6 7h6"/>';
  return s + "</g></svg>";
}

function Cat({ pose = "stand" }: { pose?: string }) {
  return <span dangerouslySetInnerHTML={{ __html: catSvg(pose) }} />;
}

/* ────────────────────────────── 果冻导航 ────────────────────────────── */

type Tab = { icon: ReactNode; label: string };

function JellyNav({ tabs, live = false }: { tabs: Tab[]; live?: boolean }) {
  return (
    <div className={`tb${live ? " live" : ""}`}>
      <div className="ind" style={{ left: 8, width: 104 }} />
      {tabs.map((tab, index) => (
        <div key={tab.label} className={`tab${index === 0 ? " on" : ""}`}>
          {tab.icon}
          <span>{tab.label}</span>
        </div>
      ))}
      <div className="pl">{ICON.plus}</div>
    </div>
  );
}

/* ────────────────────────────── 侧栏 ────────────────────────────── */

function Rail({ active }: { active: string }) {
  const items = ["档案", "设定", "关系", "世界书", "声音", "记忆", "更多"];
  return (
    <div className="rail">
      <div className="mn">{ICON.grid}</div>
      <div className="av">{sample.profile.railAvatar}</div>
      <div className="hd">{sample.profile.railHandle}</div>
      {items.map((item) => (
        <div className="ri" key={item}>
          <span className={item === active ? "pl" : undefined}>{item}</span>
          {ICON.chev}
        </div>
      ))}
      <div className="ex">{ICON.exit}</div>
    </div>
  );
}

function StatusBar() {
  return (
    <>
      <div className="sb">
        <b>9:41</b>
        <i />
      </div>
      <div className="hb" />
    </>
  );
}

function SectionHead({ title }: { title: string }) {
  return (
    <div className="sh">
      <i>×</i>
      <b>{title}</b>
    </div>
  );
}

function Meter() {
  return (
    <div className="meter">
      档案完整度
      <div>
        <i style={{ width: `${sample.profile.percent}%` }} />
      </div>
      <b>{sample.profile.percent}%</b>
    </div>
  );
}

/* ────────────────────────────── 1 · 角色库 ────────────────────────────── */

function Library() {
  const d = sample.library;
  return (
    <div className="ph">
      <StatusBar />
      <div className="lib">
        <div className="ey">CHARACTER ARCHIVE</div>
        <h1>{d.title}</h1>
        <div className="sch">
          {ICON.search}搜索角色、标签、人设
        </div>
        <div className="chips">
          {d.filters.map((filter, index) => (
            <b className={index === 0 ? "on" : undefined} key={filter}>
              {filter}
            </b>
          ))}
        </div>
        <div className="gr">
          {d.cards.map((card) => (
            <div className="ac" key={card.name}>
              <div className="a">{card.avatar}</div>
              <div className="n">{card.name}</div>
              <div className="g">{card.sign}</div>
              <div className="f">
                <div className="tgm">
                  {card.tags.map((tag) => (
                    <i key={tag}>{tag}</i>
                  ))}
                </div>
                <div className="rg" style={{ "--p": `${card.percent}%` } as CSSProperties}>
                  <b>{card.percent}</b>
                </div>
              </div>
            </div>
          ))}
          <div className="ac new">
            <Cat pose="sleep" />
            新建档案
            <br />
            <span style={{ color: "#aeaeb2", fontSize: "11.5px" }}>从空白或 AI 建议开始</span>
          </div>
        </div>
      </div>
      <JellyNav
        tabs={[
          { icon: ICON.user, label: d.tabs[0] },
          { icon: ICON.mask, label: d.tabs[1] },
          { icon: ICON.book, label: d.tabs[2] },
          { icon: ICON.people, label: d.tabs[3] },
        ]}
      />
    </div>
  );
}

/* ────────────────────────────── 2 · 档案总览 ────────────────────────────── */

function Profile() {
  const d = sample.profile;
  return (
    <div className="ph">
      <StatusBar />
      <Rail active="档案" />
      <div className="card">
        <div className="ch">
          <b>角色档案</b>
          <u>···</u>
        </div>
        <div className="cb">
          <Meter />
          <div className="lab">TAGS · 标签</div>
          <div className="tgs">
            {d.tags.map((tag) => (
              <span className="tg" key={tag}>
                {tag}
                <i>×</i>
              </span>
            ))}
            <span className="tg add">＋ 添加</span>
          </div>
          <div className="qt">个性签名</div>
          <div className="qs">{d.signature}</div>
          <SectionHead title="ABOUT ME" />
          <div className="sl">基本信息</div>
          <div className="ln">
            {Object.entries(d.about).map(([key, value], index, all) => (
              <Fragment key={key}>
                <span>{key}</span>
                {value}
                {index < all.length - 1 && <br />}
              </Fragment>
            ))}
          </div>
          <SectionHead title="ONLINE STYLE" />
          <div className="sl">线上风格</div>
          <div className="ln">{d.style}</div>
          <SectionHead title="OPENING" />
          <div className="sl">开场白</div>
          <div className="ln">{d.opening}</div>
          <SectionHead title="RELATIONSHIPS" />
          <div className="sl">关系网 · 4 位</div>
          <div className="ln">
            {d.relations.map((relation, index) => (
              <Fragment key={relation}>
                {relation}
                {index < d.relations.length - 1 && <br />}
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Lines({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, index) => (
        <Fragment key={index}>
          {line}
          {index < text.split("\n").length - 1 && <br />}
        </Fragment>
      ))}
    </>
  );
}

/* ────────────────────────────── 3 · 灵魂工作台 ────────────────────────────── */

function Soul() {
  const d = sample.soul;
  return (
    <div className="ph">
      <StatusBar />
      <Rail active="设定" />
      <div className="card">
        <div className="ch">
          <b>灵魂工作台</b>
          <u>···</u>
        </div>
        <div className="cb">
          <div className="row2" style={{ marginTop: 0 }}>
            <span className="lab">CORE PERSONA · 核心人设</span>
            <span className="cnt">{d.count} 字</span>
          </div>
          <div className="ta">
            <Lines text={d.persona} />
          </div>
          <div style={{ marginTop: 12 }}>
            <span className="seg">
              <b className="on">编辑</b>
              <b>预览</b>
            </span>
          </div>
          <div className="row2">
            <span className="lab">PROFILES · 配置方案</span>
            <span className="btn">
              {ICON.plus}
              新建
            </span>
          </div>
          <div className="pfs">
            {d.profiles.map((profile, index) => (
              <span className={`pf${index === 0 ? " on" : ""}`} key={profile}>
                {profile}
                {index === 0 && (
                  <>
                    {" "}
                    {ICON.pencil}
                    {ICON.trash}
                  </>
                )}
              </span>
            ))}
          </div>
          <div className="box">
            <div className="hh">
              <span>
                OOC 补丁<small>{d.profiles[0]}</small>
              </span>
              <span className="btn">
                {ICON.star}
                专业化
              </span>
            </div>
            <div className="ta sm" style={{ color: "#aaa" }}>
              {d.ooc}
            </div>
          </div>
          <div className="box">
            <div className="hh">
              <span>
                风控报告<small>{d.profiles[0]}</small>
              </span>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className="btn k">
                  {ICON.bolt}
                  生成
                </span>
                <span style={{ color: "#888" }}>{ICON.eye}</span>
              </span>
            </div>
            <div className="ta sm" style={{ height: 70, fontFamily: "ui-monospace,Menlo,monospace", fontSize: 11.5 }}>
              <Lines text={d.report} />
            </div>
          </div>
          <div className="hint">{d.hint}</div>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────── 4 · 关系网 ────────────────────────────── */

function Relations() {
  const d = sample.relations;
  return (
    <div className="ph">
      <StatusBar />
      <Rail active="关系" />
      <div className="card">
        <div className="ch">
          <b>关系网</b>
          <u>···</u>
        </div>
        <div className="cb">
          <div className="row2" style={{ marginTop: 0 }}>
            <span className="lab">RELATIONS · 关系网</span>
            <span className="btn">
              {ICON.plus}
              添加
            </span>
          </div>
          {d.rows.map(([name, relation]) => (
            <div className="rl" key={name}>
              <div className="fd">{name}</div>
              <div className="dash" />
              <div className="fd">{relation}</div>
              <div className="rm">×</div>
            </div>
          ))}
          <div className="ck">
            <i>✓</i>
            生成人设时同步生成关系网 NPC
          </div>
          <svg viewBox="0 0 250 150" style={{ width: "100%", marginTop: 8 }} fill="none" stroke="#c9c9ce" strokeWidth={1.2}>
            <path d="M125 75L42 32M125 75L208 32M125 75L42 118M125 75L208 118" />
            <g fill="#fff">
              <circle cx="42" cy="32" r="16" />
              <circle cx="208" cy="32" r="16" />
              <circle cx="42" cy="118" r="16" />
              <circle cx="208" cy="118" r="16" />
            </g>
            <circle cx="125" cy="75" r="22" fill="#111" stroke="none" />
            <g fill="#111" stroke="none" fontSize={11} fontWeight={600} textAnchor="middle" fontFamily="sans-serif">
              <text x="42" y="36">
                小一
              </text>
              <text x="208" y="36">
                小二
              </text>
              <text x="42" y="122">
                三三
              </text>
              <text x="208" y="122">
                小四
              </text>
            </g>
            <text x="125" y="80" fill="#fff" stroke="none" fontSize={15} fontWeight={600} textAnchor="middle" fontFamily="sans-serif">
              五
            </text>
          </svg>
          <div className="row2">
            <span className="lab">WORLDBOOK · 关联世界书</span>
          </div>
          <div className="sel">
            {d.worldbookPlaceholder}
            {ICON.chev}
          </div>
          <div className="hint">{d.worldbookHint}</div>
          <div className="row2">
            <span className="lab">ONLINE STYLE · 线上风格</span>
          </div>
          <div className="ta sm">{d.style}</div>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────── 5 / 6 · AI 设定建议 ────────────────────────────── */

function Steps({ step }: { step: number }) {
  return (
    <div className="steps">
      {[0, 1, 2, 3].map((index) => (
        <i className={index < step ? "on" : undefined} key={index} />
      ))}
    </div>
  );
}

function SheetTop({ step }: { step: number }) {
  return (
    <div className="top">
      <div className="ey">AI SUGGESTIONS · {step} / 4</div>
      <h2>角色设定建议</h2>
      <div className="x">{ICON.x}</div>
    </div>
  );
}

function Suggestion({ text }: { text: string }) {
  return (
    <div className="sg">
      <em>AI 建议</em>
      <p>{text}</p>
      <span className="btn">填充</span>
    </div>
  );
}

function Suggest1() {
  const d = sample.suggest.step1;
  return (
    <div className="ph">
      <StatusBar />
      <div className="dim" />
      <div className="sheet">
        <SheetTop step={1} />
        <Steps step={1} />
        <div className="sb2">
          <div className="lab" style={{ marginTop: 6 }}>
            NICKNAME · 角色网名
          </div>
          <div className="fd" style={{ height: 50, borderRadius: 18 }}>
            {d.nickname}
          </div>
          <Suggestion text={d.nicknameSuggest} />
          <div className="lab" style={{ marginTop: 28 }}>
            SIGNATURE · 个性签名
          </div>
          <div className="ta sm" style={{ height: 84 }}>
            {d.signature}
          </div>
          <Suggestion text={d.signatureSuggest} />
        </div>
        <div className="sfoot">
          <div className="big">确认使用设定</div>
        </div>
      </div>
    </div>
  );
}

function Suggest3() {
  const d = sample.suggest.step3;
  return (
    <div className="ph">
      <StatusBar />
      <div className="dim" />
      <div className="sheet">
        <SheetTop step={3} />
        <Steps step={3} />
        <div className="sb2">
          <div className="lab" style={{ marginTop: 6 }}>
            OPENING · 开场白
          </div>
          <div className="ta sm" style={{ height: 96, fontFamily: "var(--sans)" }}>
            {d.opening}
          </div>
          <Suggestion text={d.openingSuggest} />
          <div className="row2" style={{ marginTop: 30 }}>
            <span className="lab">RELATED · 生成的关联角色 ({d.related.length})</span>
          </div>
          <div className="car">
            {d.related.map((item) => (
              <div className="rc" key={item.name}>
                <div className="mo">{item.avatar}</div>
                <div className="k">网名</div>
                <div className="v">{item.name}</div>
                <div className="k">人设</div>
                <p>{item.bio}</p>
                <div className="rr">关系 · {item.relation}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="sfoot">
          <div className="big">确认使用设定</div>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────── 7 · 动效 ────────────────────────────── */

function Motion() {
  const tabs = [
    { icon: ICON.user, label: "角色" },
    { icon: ICON.mask, label: "面具" },
    { icon: ICON.book, label: "世界书" },
    { icon: ICON.people, label: "我" },
  ];
  return (
    <div className="ph">
      <div className="pn">
        <h3>动效规范</h3>
        <div className="sub">MOTION · 点一点试试</div>
        <div className="dm">
          <b style={{ fontSize: 14 }}>① 果冻导航条</b>
          <JellyNav tabs={tabs} live />
          <small>
            切换时，白色选中块先横向拉长、连到目标，再弹回成圆角块。左侧栏的选中块用同样的动作，只是方向改成上下。
          </small>
        </div>
        <div className="dm">
          <b style={{ fontSize: 14 }}>② 开关：按下先拉伸</b>
          <div style={{ marginTop: 14, display: "flex", gap: 22, alignItems: "center" }}>
            <button type="button" className="sw2">
              <i />
            </button>
            <button type="button" className="sw2 on">
              <i />
            </button>
            <span style={{ fontSize: 12, color: "#888" }}>按住别松手看看</span>
          </div>
          <small>按下时圆块变长，松开后再滑到另一边。适用于所有开关。</small>
        </div>
        <div className="dm">
          <b style={{ fontSize: 14 }}>③ 按钮：压扁再回弹</b>
          <div style={{ marginTop: 14 }}>
            <button type="button" className="pb">
              确认使用设定
            </button>
          </div>
          <small>按下横向 +8%、纵向 -6%，0.09 秒；松开 0.42 秒带过冲回弹。系统开了“减少动态效果”就只做轻微缩放。</small>
        </div>
        <div className="dm" style={{ margin: 0 }}>
          <b style={{ fontSize: 14 }}>④ 页面与列表</b>
          <small>档案页内容自下而上淡入 12px；列表行按下变浅灰；删除标签时向左缩小消失。统一 0.26 秒，不用别的曲线。</small>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────── 8 · 功能清单 ────────────────────────────── */

const FEATURES: Array<[string, string, string]> = [
  ["核心人设", "字数统计、编辑/预览", "保留"],
  ["配置方案（按模型）", "新建、改名、删除", "保留"],
  ["OOC 补丁", "指令专业化", "保留"],
  ["风控报告", "生成、显示/隐藏", "保留"],
  ["关系网 + 同步 NPC", "并增加关系图", "保留"],
  ["线上风格 / 开场白", "AI 建议可填充", "保留"],
  ["关联世界书", "只绑相关条目", "保留"],
  ["头像（图片/链接）", "并增加头像库、历史", "保留"],
  ["档案完整度", "缺什么一眼看到", "新增"],
  ["版本快照与回滚", "改坏了能退回", "新增"],
  ["标签与口癖", "点标签快速筛选", "新增"],
  ["示例对话", "给 AI 参考说话方式", "新增"],
  ["禁忌与边界", "永远不说/不做", "新增"],
  ["声音卡", "声音 ID、供应商", "新增"],
  ["互动范围与分享", "谁能看、能用", "新增"],
  ["导入 / 导出", "酒馆卡、备份", "新增"],
  ["档案体检", "查矛盾与重复", "新增"],
];

function Features() {
  return (
    <div className="ph ph-auto">
      <div className="pn">
        <h3>功能清单</h3>
        <div className="sub">KEEP · EXPAND</div>
        <ul className="fl">
          {FEATURES.map(([name, desc, keep]) => (
            <li key={name}>
              <b>{name}</b>
              <span>{desc}</span>
              <em className={keep === "保留" ? "o" : undefined}>{keep}</em>
            </li>
          ))}
        </ul>
        <p className="hint" style={{ marginTop: 18 }}>
          “新增”是我的建议，不一定全做，你来挑。“保留”来自你发的截图和仓库说明，实际字段要让 Trae 读代码后对照。
        </p>
      </div>
    </div>
  );
}

/* ────────────────────────────── 路由分发 ────────────────────────────── */

export const SCREEN_NAMES = ["library", "profile", "soul", "relations", "suggest1", "suggest3", "motion", "features"] as const;

export type ScreenName = (typeof SCREEN_NAMES)[number];

const SCREENS: Record<ScreenName, () => ReactNode> = {
  library: Library,
  profile: Profile,
  soul: Soul,
  relations: Relations,
  suggest1: Suggest1,
  suggest3: Suggest3,
  motion: Motion,
  features: Features,
};

export function PreviewScreen({ screen }: { screen: string }) {
  const Comp = SCREENS[(screen as ScreenName) in SCREENS ? (screen as ScreenName) : "library"];
  return <Comp />;
}
