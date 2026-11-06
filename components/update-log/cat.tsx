"use client";

/**
 * 林淮的专属大耳猫形象（来自 design/update-ui.html 自带的 cat 函数）。
 * 造型不要重画，只按设计稿调用：box 抱礼物 / walk 赶路 / wave 招手 / sleep 睡觉。
 */
type CatPose = "stand" | "box" | "walk" | "wave" | "sleep";
type CatFace = "normal" | "happy" | "sleepy" | "wink" | "wow";

export function Cat({ pose = "stand", face, acc }: { pose?: CatPose; face?: CatFace; acc?: string }) {
  return (
    <span
      className="uui-cat"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: catSvg(pose, face, acc) }}
    />
  );
}

function catSvg(rawPose: CatPose = "stand", rawFace?: CatFace, acc?: string): string {
  const p = rawPose;
  const f = rawFace ?? (p === "sleep" ? "sleepy" : p === "wave" ? "happy" : "normal");

  const big = (cx: number, r: number, hx: number) =>
    `<g class="eye"><g transform="rotate(${r} ${cx} 84)"><ellipse class="ey" cx="${cx}" cy="84" rx="${f === "wow" ? 7 : 6}" ry="${f === "wow" ? 9.6 : 8}"/></g><circle class="hi" cx="${hx}" cy="80.4" r="2.3"/><circle class="hi" cx="${hx + (hx > 80 ? 4 : -4)}" cy="88" r="1"/></g>`;
  const arcH = (x: number) => `<path class="ln" d="M${x - 7} 86Q${x} 77 ${x + 7} 86"/>`;
  const arcS = (x: number) => `<path class="ln" d="M${x - 7} 84q7 5 14 0"/>`;

  const left = { normal: big(62, 10, 64.6), happy: arcH(62), sleepy: arcS(62), wink: arcH(62), wow: big(62, 10, 64.6) }[f];
  const right = { normal: big(98, -10, 95.4), happy: arcH(98), sleepy: arcS(98), wink: big(98, -10, 95.4), wow: big(98, -10, 95.4) }[f];
  const mouth =
    f === "happy"
      ? '<path class="ln s mzf" d="M73.5 97Q80 108 86.5 97Z"/>'
      : f === "wow"
        ? '<ellipse class="ln s mzf" cx="80" cy="99.5" rx="3" ry="3.6"/>'
        : '<path class="ln s" d="M74.5 97.5Q77 101 80 97Q83 101 85.5 97.5"/>';

  let svg = '<svg class="cat" viewBox="0 0 160 144" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">';
  if (p === "walk") {
    svg += '<ellipse class="sd" cx="80" cy="141" rx="28" ry="3.2"/><path class="ln s" style="opacity:.3" d="M20 98H36M12 110H30M22 122H36"/>';
  }
  svg += `<g class="${p === "walk" ? "hop" : "bob"}">`;
  svg += acc?.includes("halo")
    ? '<ellipse class="ln s halo" style="stroke:#8e8e93" cx="80" cy="15" rx="21" ry="5"/>'
    : "";
  svg +=
    '<g class="ears"><g class="ear l"><path class="ln wf" d="M38 70C32 52 28 32 29 17C30 11 35 9 40 12C54 20 68 32 76 46"/><path class="gy" d="M40 61C36 47 33 33 34 23C44 28 56 36 64 47Z"/></g>' +
    '<g class="ear r"><path class="ln wf" d="M122 70C128 52 132 32 131 17C130 11 125 9 120 12C106 20 92 32 84 46"/><path class="gy" d="M120 61C124 47 127 33 126 23C116 28 104 36 96 47Z"/></g></g>';
  svg +=
    '<path class="ln wf" d="M54 112C50 128 60 138 80 138C100 138 110 128 106 112"/>' +
    '<ellipse class="ln wf" cx="80" cy="80" rx="47" ry="38"/>' +
    '<path class="ln s tuft" d="M80 42C76 33 81 26 88 28"/><path class="ln s" style="stroke-width:1.5" d="M35 89L19 85M35 94L18 96M36 99L21 106M125 89L141 85M125 94L142 96M124 99L139 106"/>';
  svg +=
    '<g class="face"><circle class="dt" cx="60" cy="69" r="2.4"/><circle class="dt" cx="100" cy="69" r="2.4"/>' +
    '<ellipse class="bl" cx="45" cy="94" rx="9" ry="5.5"/><ellipse class="bl" cx="115" cy="94" rx="9" ry="5.5"/>' +
    '<path class="bs" d="M40 92l-1.5 4M45 91l-1.5 4M50 91.5l-1.5 4M110 91.5l1.5 4M115 91l1.5 4M120 92l1.5 4"/>' +
    `<g class="eyes">${left}${right}</g><g class="muzzle"><ellipse class="mz" cx="74" cy="95" rx="8.5" ry="6.2"/><ellipse class="mz" cx="86" cy="95" rx="8.5" ry="6.2"/>` +
    `<path class="nz" d="M76.5 88.5h7l-3.5 4.2z"/>${mouth}</g></g>`;

  if (p !== "box") {
    svg +=
      '<path class="ln s" d="M64 117Q80 127 96 117"/><g class="bell"><circle class="ln s gy cat-bell" cx="80" cy="124" r="4"/><path class="ln s" d="M78 124h4"/></g>';
  }

  if (p === "box") {
    svg +=
      '<rect class="ln wf" x="52" y="110" width="56" height="24" rx="6"/><path class="ln s" d="M52 118H108"/><path class="ln" d="M80 110C75 101 68 105 74 110M80 110C85 101 92 105 86 110"/><path class="gy2" d="M77 110h6v6h-6z"/>';
  } else {
    svg += '<ellipse class="ln s wf" cx="63" cy="133" rx="7.5" ry="5.5"/>';
    if (p === "wave") {
      svg +=
        '<g class="arm"><path class="ln" d="M104 122C116 120 124 110 122 97"/><circle class="ln s wf" cx="122" cy="93" r="6.5"/><circle class="gy2" cx="122" cy="95" r="2"/></g><path class="ln s" style="opacity:.4" d="M133 86q5 5 0 12M138 81q8 10 0 22"/>';
    } else {
      svg += '<ellipse class="ln s wf" cx="97" cy="133" rx="7.5" ry="5.5"/>';
    }
  }

  if (p === "sleep") {
    svg +=
      '<path class="z ln s" d="M118 46h9l-9 10h9"/><path class="z ln s" style="animation-delay:1.2s" d="M130 32h6l-6 7h6"/>';
  }

  return `${svg}</g></svg>`;
}
