// lib/miya-deep-apps.ts
// G12：Miya 深入 App —— 按 FLOT 自定义 App 格式（entryHtml + manifest + 权限）
// 接入七个轻 App：备忘 / 待办 / 健康 / 云盘 / 浏览器 / 外卖 / 相册。
// 购物（Shopping App）、小说（书房阅读）、短信（聊天 App）已有实现，不重复建设。
// 全部走 CustomAppRunner 沙盒与宿主桥（AiPhone.*），数据存本机 kv / 媒体库，
// 不依赖任何私有后端。首次启动自动安装并摆上桌面，重复安装自动跳过。

import { kvGet, kvSet } from "@/lib/kv-db";
import {
  CUSTOM_APP_PLACE_DESKTOP_EVENT,
  installCustomApp,
  loadInstalledCustomApps,
} from "@/lib/custom-app-storage";
import type { CustomAppManifest, CustomAppPermission } from "@/lib/custom-app-types";

// ── 首次安装标记（存在即不再扫描）──
const MIYA_DEEP_APPS_FLAG = "miya_deep_apps_installed_v1";

type MiyaDeepAppDef = {
  appId: string;
  name: string;
  description: string;
  emoji: string;
  bg: string;
  permissions: CustomAppPermission[];
  network?: CustomAppManifest["network"];
  entryHtml: string;
};

// ── 共享小工具 ──

function emojiIconDataUrl(emoji: string, bg: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="22" fill="${bg}"/><text x="48" y="55" font-size="44" text-anchor="middle" dominant-baseline="middle" font-family="system-ui, sans-serif">${emoji}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const DEEP_CSS = `<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 14px 12px calc(18px + env(safe-area-inset-bottom, 0px)); font-family: system-ui, -apple-system, "PingFang SC", sans-serif; font-size: 13px; background: #f6f2ea; color: #453f34; }
  .deep-head { font-size: 16px; font-weight: 700; margin: 2px 2px 12px; display: flex; align-items: center; gap: 8px; }
  .deep-head small { font-size: 11px; color: #8d8272; font-weight: 400; }
  .card { background: #fffdf8; border: 1px solid #e7dfd0; border-radius: 14px; padding: 12px; margin-bottom: 10px; }
  .row-input { display: flex; gap: 8px; }
  input, textarea, select { flex: 1; min-width: 0; border: 1px solid #e0d8c8; border-radius: 10px; padding: 9px 10px; font-size: 13px; background: #faf7f0; color: #453f34; outline: none; }
  input:focus, textarea:focus { border-color: #6f8f7a; }
  textarea { width: 100%; resize: vertical; min-height: 90px; display: block; }
  button { border: none; border-radius: 10px; padding: 9px 14px; font-size: 13px; cursor: pointer; background: #efe9dd; color: #453f34; }
  button:active { opacity: 0.85; }
  .primary { background: #6f8f7a; color: #fff; }
  .danger { background: #f6e3e0; color: #b0564a; padding: 5px 10px; font-size: 12px; }
  .ghost { background: none; padding: 5px 8px; font-size: 12px; color: #8d8272; }
  .item { display: flex; align-items: center; gap: 10px; }
  .item-text { flex: 1; min-width: 0; line-height: 1.6; word-break: break-all; }
  .item-done .item-text { color: #8d8272; text-decoration: line-through; }
  .item-ops { display: flex; gap: 6px; flex: 0 0 auto; }
  .empty { text-align: center; color: #8d8272; padding: 26px 10px; line-height: 1.7; }
  .meta { font-size: 11px; color: #8d8272; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .stat { text-align: center; padding: 12px 6px; }
  .stat b { display: block; font-size: 20px; color: #6f8f7a; margin-bottom: 2px; }
  .tag { display: inline-block; background: #eef3ef; color: #6f8f7a; border-radius: 999px; padding: 2px 10px; font-size: 11px; margin-left: 8px; }
  .tabs { display: flex; gap: 6px; margin-bottom: 10px; }
  .tab { border-radius: 999px; padding: 6px 14px; font-size: 12px; background: #efe9dd; color: #8d8272; }
  .tab.on { background: #6f8f7a; color: #fff; }
  .photo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .photo { position: relative; border-radius: 10px; overflow: hidden; aspect-ratio: 1; background: #efe9dd; }
  .photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .photo button { position: absolute; right: 4px; top: 4px; width: 20px; height: 20px; padding: 0; border-radius: 50%; background: rgba(69,63,52,0.7); color: #fff; font-size: 11px; line-height: 1; }
</style>`;

// 外层模板：body + 兼容桥的初始化脚本（内层 JS 统一走字符串拼接，避免嵌套模板字面量）
function appShell(title: string, sub: string, bodyHtml: string, js: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${DEEP_CSS}</head><body>
<div class="deep-head">${title}<small>${sub}</small></div>
${bodyHtml}
<script>(function(){
  function api(){ return window.AiPhoneApp || window.AiPhone; }
  function toast(msg){ try { api().ui.toast(String(msg)); } catch (e) {} }
  function fail(err){ toast((err && err.message) ? err.message : '操作失败，稍后再试'); }
  function el(id){ return document.getElementById(id); }
${js}
})();</script></body></html>`;
}

// ── 1. 备忘 ──

const MEMO_HTML = appShell(
  "备忘", "随手记，本机保存",
  `<div class="card row-input"><input id="memo-input" placeholder="记点什么…" maxlength="200"><button id="memo-add" class="primary">记下</button></div><div id="memo-list"></div>`,
  `
  var db = api().db;
  async function load() {
    var rows = await db.list('memos');
    rows.sort(function(a, b){ return (b.pinned?1:0)-(a.pinned?1:0) || String(b.createdAt).localeCompare(String(a.createdAt)); });
    var box = el('memo-list');
    box.innerHTML = '';
    if (!rows.length) { box.innerHTML = '<div class="empty">还没有备忘，上面记一条。</div>'; return; }
    rows.forEach(function(row){
      var card = document.createElement('div'); card.className = 'card item';
      var text = document.createElement('div'); text.className = 'item-text'; text.textContent = row.text || '';
      var ops = document.createElement('div'); ops.className = 'item-ops';
      var pin = document.createElement('button'); pin.className = 'ghost'; pin.textContent = row.pinned ? '已置顶' : '置顶';
      pin.onclick = function(){ db.update('memos', row.id, { pinned: !row.pinned }).then(load).catch(fail); };
      var del = document.createElement('button'); del.className = 'danger'; del.textContent = '删除';
      del.onclick = function(){ db.delete('memos', row.id).then(load).catch(fail); };
      ops.appendChild(pin); ops.appendChild(del);
      card.appendChild(text); card.appendChild(ops); box.appendChild(card);
    });
  }
  el('memo-add').onclick = function(){
    var input = el('memo-input');
    var text = input.value.trim();
    if (!text) { toast('先写点内容'); return; }
    db.create('memos', { text: text }).then(function(){ input.value = ''; load(); }).catch(fail);
  };
  el('memo-input').addEventListener('keydown', function(e){ if (e.key === 'Enter') el('memo-add').click(); });
  load().catch(fail);
`);

// ── 2. 待办 ──

const TODO_HTML = appShell(
  "待办", "勾掉一件是一件",
  `<div class="card row-input"><input id="todo-input" placeholder="今天要做什么？" maxlength="200"><button id="todo-add" class="primary">添加</button></div>
   <div class="tabs" id="todo-tabs">
     <button class="tab on" data-f="all">全部</button><button class="tab" data-f="open">未完成</button><button class="tab" data-f="done">已完成</button>
   </div>
   <div id="todo-list"></div>`,
  `
  var db = api().db;
  var filter = 'all';
  async function load() {
    var rows = await db.list('todos');
    var open = rows.filter(function(r){ return !r.done; });
    el('todo-tabs').querySelectorAll('.tab').forEach(function(t){
      if (t.dataset.f === 'open') t.textContent = '未完成 ' + open.length;
    });
    if (filter === 'open') rows = rows.filter(function(r){ return !r.done; });
    if (filter === 'done') rows = rows.filter(function(r){ return r.done; });
    var box = el('todo-list');
    box.innerHTML = '';
    if (!rows.length) { box.innerHTML = '<div class="empty">' + (filter === 'all' ? '没有待办，先加一条。' : '这里空空的。') + '</div>'; return; }
    rows.forEach(function(row){
      var card = document.createElement('div'); card.className = 'card item' + (row.done ? ' item-done' : '');
      var check = document.createElement('button'); check.className = row.done ? 'primary' : 'ghost'; check.textContent = row.done ? '✓' : '○';
      check.onclick = function(){ db.update('todos', row.id, { done: !row.done }).then(load).catch(fail); };
      var text = document.createElement('div'); text.className = 'item-text'; text.textContent = row.text || '';
      var del = document.createElement('button'); del.className = 'danger'; del.textContent = '删除';
      del.onclick = function(){ db.delete('todos', row.id).then(load).catch(fail); };
      card.appendChild(check); card.appendChild(text); card.appendChild(del);
      box.appendChild(card);
    });
  }
  el('todo-tabs').addEventListener('click', function(e){
    var t = e.target.closest('.tab'); if (!t) return;
    filter = t.dataset.f;
    el('todo-tabs').querySelectorAll('.tab').forEach(function(x){ x.classList.toggle('on', x === t); });
    load().catch(fail);
  });
  el('todo-add').onclick = function(){
    var input = el('todo-input');
    var text = input.value.trim();
    if (!text) { toast('先写要做什么'); return; }
    db.create('todos', { text: text, done: false }).then(function(){ input.value = ''; load(); }).catch(fail);
  };
  el('todo-input').addEventListener('keydown', function(e){ if (e.key === 'Enter') el('todo-add').click(); });
  load().catch(fail);
`);

// ── 3. 健康 ──

const HEALTH_HTML = appShell(
  "健康", "喝水 · 睡眠 · 步数",
  `<div class="card" id="today-card"><div class="grid3">
     <div class="stat"><b id="h-water">0</b>喝水（杯）<div style="margin-top:8px"><button class="ghost" id="h-water-minus">−</button> <button class="primary" id="h-water-plus">+1</button></div></div>
     <div class="stat"><b id="h-sleep">0</b>睡眠（小时）<div style="margin-top:8px"><button class="ghost" id="h-sleep-minus">−</button> <button class="primary" id="h-sleep-plus">+0.5</button></div></div>
     <div class="stat"><b id="h-steps">0</b>步行（千步）<div style="margin-top:8px"><button class="ghost" id="h-steps-minus">−</button> <button class="primary" id="h-steps-plus">+1</button></div></div>
   </div></div>
   <div class="card"><b>最近 7 天</b><div id="h-history" style="margin-top:8px"></div></div>`,
  `
  var db = api().db;
  function todayKey(){ var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
  async function loadAll() {
    var rows = await db.list('records');
    var today = rows.filter(function(r){ return r.date === todayKey(); })[0] || null;
    el('h-water').textContent = today ? Number(today.water || 0) : 0;
    el('h-sleep').textContent = today ? Number(today.sleep || 0) : 0;
    el('h-steps').textContent = today ? Number(today.steps || 0) : 0;
    var box = el('h-history');
    var recent = rows.slice().sort(function(a,b){ return String(b.date).localeCompare(String(a.date)); }).slice(0, 7);
    if (!recent.length) { box.innerHTML = '<div class="meta">还没有记录，今天先记一笔。</div>'; return; }
    box.innerHTML = '';
    recent.forEach(function(r){
      var line = document.createElement('div'); line.className = 'item'; line.style.padding = '6px 0';
      line.innerHTML = '<span class="item-text">' + r.date + '</span><span class="meta">水 ' + Number(r.water||0) + ' 杯 · 睡 ' + Number(r.sleep||0) + ' 小时 · 走 ' + Number(r.steps||0) + ' 千步</span>';
      box.appendChild(line);
    });
  }
  function bump(field, delta, step) {
    return function(){
      db.list('records').then(function(rows){
        var today = rows.filter(function(r){ return r.date === todayKey(); })[0];
        var next = Math.max(0, Number((today ? today[field] : 0) || 0) + delta * step);
        if (next > 500) next = 500;
        if (today) return db.update('records', today.id, (function(){ var p = {}; p[field] = next; return p; })());
        var data = { date: todayKey(), water: 0, sleep: 0, steps: 0 };
        data[field] = next;
        return db.create('records', data);
      }).then(loadAll).catch(fail);
    };
  }
  el('h-water-plus').onclick = bump('water', 1, 1); el('h-water-minus').onclick = bump('water', -1, 1);
  el('h-sleep-plus').onclick = bump('sleep', 1, 0.5); el('h-sleep-minus').onclick = bump('sleep', -1, 0.5);
  el('h-steps-plus').onclick = bump('steps', 1, 1); el('h-steps-minus').onclick = bump('steps', -1, 1);
  loadAll().catch(fail);
`);

// ── 4. 云盘（本机轻量版：文本文件柜）──

const DRIVE_HTML = appShell(
  "云盘", "本机小云盘 · 文本文件",
  `<div class="card">
     <input id="f-name" placeholder="文件名，比如：灵感.txt" style="margin-bottom:8px">
     <textarea id="f-content" placeholder="内容…"></textarea>
     <div style="margin-top:8px; text-align:right"><button id="f-save" class="primary">存入云盘</button></div>
   </div>
   <div class="card"><b>我的文件 <span id="f-usage" class="meta"></span></b><div id="f-list" style="margin-top:8px"></div></div>`,
  `
  var db = api().db;
  async function load() {
    var rows = await db.list('files');
    var total = 0;
    var box = el('f-list');
    box.innerHTML = '';
    if (!rows.length) { box.innerHTML = '<div class="meta">云盘还是空的，存一个文件试试。</div>'; }
    rows.forEach(function(row){
      var content = String(row.content || '');
      total += content.length;
      var card = document.createElement('div'); card.className = 'item'; card.style.padding = '8px 0';
      var text = document.createElement('div'); text.className = 'item-text';
      text.textContent = (row.name || '未命名') + '（' + content.length + ' 字）';
      var ops = document.createElement('div'); ops.className = 'item-ops';
      var view = document.createElement('button'); view.className = 'ghost'; view.textContent = '查看';
      view.onclick = function(){ el('f-content').value = content; el('f-name').value = row.name || ''; toast('已打开到上方编辑区，改动后点「存入云盘」会另存一份'); };
      var del = document.createElement('button'); del.className = 'danger'; del.textContent = '删除';
      del.onclick = function(){ db.delete('files', row.id).then(load).catch(fail); };
      ops.appendChild(view); ops.appendChild(del);
      card.appendChild(text); card.appendChild(ops); box.appendChild(card);
    });
    el('f-usage').textContent = '共 ' + rows.length + ' 个 · ' + total + ' 字（存在本机）';
  }
  el('f-save').onclick = function(){
    var name = el('f-name').value.trim();
    var content = el('f-content').value;
    if (!name) { toast('先给文件起个名'); return; }
    db.create('files', { name: name, content: content }).then(function(){ el('f-name').value = ''; el('f-content').value = ''; load(); toast('已存入云盘'); }).catch(fail);
  };
  load().catch(fail);
`);

// ── 5. 浏览器（极简阅读模式，白名单 + 代理）──

const BROWSER_HTML = appShell(
  "浏览器", "阅读模式 · 白名单站点",
  `<div class="card row-input"><input id="b-url" placeholder="https://example.com" value="https://example.com"><button id="b-go" class="primary">打开</button></div>
   <div class="card"><b>书签</b><div id="b-marks" style="margin-top:8px"></div></div>
   <div class="card" id="b-page" style="display:none"><b id="b-title"></b><div id="b-meta" class="meta" style="margin:4px 0 8px"></div><div id="b-text" style="line-height:1.8; word-break:break-word; white-space:pre-wrap; max-height:60vh; overflow:auto"></div></div>`,
  `
  var db = api().db;
  var DEFAULT_MARKS = [
    { title: 'Example Domain', url: 'https://example.com' },
    { title: 'IANA 保留域名', url: 'https://www.iana.org/domains/reserved' },
    { title: 'httpbin JSON 测试', url: 'https://httpbin.org/json' }
  ];
  function stripTags(html) {
    var text = String(html || '');
    text = text.replace(/<script[\\s\\S]*?<\\/script>/gi, ' ').replace(/<style[\\s\\S]*?<\\/style>/gi, ' ');
    text = text.replace(/<[^>]+>/g, ' ');
    return text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\\s+/g, ' ').trim();
  }
  async function openUrl(url) {
    url = String(url || '').trim();
    if (!/^https?:\\/\\//.test(url)) { toast('要 http(s) 开头的完整地址'); return; }
    var page = el('b-page'); page.style.display = 'block';
    el('b-title').textContent = '正在打开…';
    el('b-text').textContent = '';
    el('b-meta').textContent = url;
    try {
      var res = await api().network.fetch({ url: url, method: 'GET', proxy: true, timeoutMs: 15000 });
      if (!res || res.ok !== true) { throw new Error('HTTP ' + (res && res.status) + '（站点没响应或地址不对）'); }
      var text = res.text || '';
      el('b-title').textContent = (res.headers && (res.headers.title || res.headers['x-title'])) || url.replace(/^https?:\\/\\//, '').slice(0, 40);
      var shown = stripTags(text).slice(0, 1600) || '（这个页面没有可读文本，可能是接口或二进制内容）';
      if (text.slice(0, 1) === '{' || res.headers && String(res.headers['content-type'] || '').indexOf('json') >= 0) {
        try { shown = JSON.stringify(JSON.parse(text), null, 2).slice(0, 1600); } catch (e) {}
      }
      el('b-text').textContent = shown;
    } catch (err) {
      el('b-title').textContent = '没打开';
      el('b-text').textContent = (err && err.message) ? err.message : '网络请求失败';
      toast('打开失败：' + ((err && err.message) || '网络不可用'));
    }
  }
  async function loadMarks() {
    var rows = await db.list('bookmarks');
    if (!rows.length) {
      for (var i = 0; i < DEFAULT_MARKS.length; i++) await db.create('bookmarks', DEFAULT_MARKS[i]);
      rows = await db.list('bookmarks');
    }
    var box = el('b-marks'); box.innerHTML = '';
    rows.forEach(function(row){
      var line = document.createElement('div'); line.className = 'item'; line.style.padding = '6px 0';
      var open = document.createElement('button'); open.className = 'primary'; open.style.fontSize = '12px'; open.textContent = row.title || row.url;
      open.onclick = function(){ el('b-url').value = row.url; openUrl(row.url); };
      var del = document.createElement('button'); del.className = 'danger'; del.textContent = '移除';
      del.onclick = function(){ db.delete('bookmarks', row.id).then(loadMarks).catch(fail); };
      line.appendChild(open); line.appendChild(del);
      box.appendChild(line);
    });
  }
  el('b-go').onclick = function(){ openUrl(el('b-url').value); };
  el('b-url').addEventListener('keydown', function(e){ if (e.key === 'Enter') el('b-go').click(); });
  var addMark = document.createElement('button');
  addMark.className = 'ghost'; addMark.textContent = '＋ 把当前地址加书签';
  addMark.style.marginTop = '8px';
  addMark.onclick = function(){
    var url = el('b-url').value.trim();
    if (!/^https?:\\/\\//.test(url)) { toast('先打开一个页面再加书签'); return; }
    db.create('bookmarks', { title: url.replace(/^https?:\\/\\//, '').slice(0, 24), url: url }).then(function(){ loadMarks(); toast('已加书签'); }).catch(fail);
  };
  el('b-marks').appendChild(addMark);
  loadMarks().catch(fail);
`);

// ── 6. 外卖（模拟点单 + 统一钱包）──

const TAKEOUT_HTML = appShell(
  "外卖", "模拟点单 · 统一钱包支付",
  `<div class="card" id="t-balance" style="display:flex; justify-content:space-between"><b>钱包余额</b><span id="t-money">…</span></div>
   <div id="t-menu"></div>
   <div class="card"><b>购物车 <span id="t-cart-count" class="meta"></span></b><div id="t-cart" style="margin:8px 0"></div>
     <div style="display:flex; justify-content:space-between; align-items:center"><span>合计 <b id="t-total">¥0.00</b></span><button id="t-order" class="primary">下单</button></div>
   </div>
   <div class="card"><b>订单</b><div id="t-orders" style="margin-top:8px"></div></div>`,
  `
  var db = api().db;
  var MENU = [
    { shop: '巷口面馆', items: [ { name: '葱油拌面', price: 12 }, { name: '酸汤馄饨', price: 14 }, { name: '小笼包', price: 10 }, { name: '紫菜汤', price: 5 } ] },
    { shop: '南洋小馆', items: [ { name: '海南鸡饭', price: 22 }, { name: '咖喱牛腩饭', price: 24 }, { name: '柠檬茶', price: 8 }, { name: '芒果糯米糍', price: 9 } ] },
    { shop: '深夜食堂', items: [ { name: '肥牛丼', price: 21 }, { name: '玉子烧', price: 7 }, { name: '味噌汤', price: 5 }, { name: '梅子饭团', price: 6 } ] }
  ];
  var cart = {};
  function money(n){ return '¥' + Number(n).toFixed(2); }
  function total(){ var sum = 0; for (var k in cart) sum += cart[k].price * cart[k].count; return sum; }
  function renderCart() {
    var box = el('t-cart'); box.innerHTML = '';
    var names = Object.keys(cart);
    el('t-cart-count').textContent = names.length ? '（' + names.length + ' 样）' : '';
    el('t-total').textContent = money(total());
    if (!names.length) { box.innerHTML = '<div class="meta">还没有点单，上面挑几样。</div>'; return; }
    names.forEach(function(k){
      var it = cart[k];
      var line = document.createElement('div'); line.className = 'item'; line.style.padding = '4px 0';
      line.innerHTML = '<span class="item-text">' + it.name + ' ' + money(it.price) + '</span>';
      var minus = document.createElement('button'); minus.className = 'ghost'; minus.textContent = '−';
      minus.onclick = function(){ it.count -= 1; if (it.count <= 0) delete cart[k]; renderCart(); };
      var count = document.createElement('span'); count.textContent = '×' + it.count; count.style.margin = '0 6px';
      var plus = document.createElement('button'); plus.className = 'ghost'; plus.textContent = '＋';
      plus.onclick = function(){ it.count += 1; renderCart(); };
      line.appendChild(minus); line.appendChild(count); line.appendChild(plus);
      box.appendChild(line);
    });
  }
  function renderMenu() {
    var box = el('t-menu'); box.innerHTML = '';
    MENU.forEach(function(shop){
      var card = document.createElement('div'); card.className = 'card';
      card.innerHTML = '<b>' + shop.shop + '</b>';
      var grid = document.createElement('div'); grid.className = 'grid2'; grid.style.marginTop = '8px';
      shop.items.forEach(function(item){
        var one = document.createElement('div');
        one.className = 'card'; one.style.margin = '0'; one.style.padding = '10px';
        one.innerHTML = '<div>' + item.name + '</div><div class="meta" style="margin:2px 0 6px">' + money(item.price) + '</div>';
        var add = document.createElement('button'); add.className = 'primary'; add.style.width = '100%'; add.textContent = '来一份';
        add.onclick = function(){
          var key = shop.shop + '/' + item.name;
          if (!cart[key]) cart[key] = { name: item.name, shop: shop.shop, price: item.price, count: 0 };
          cart[key].count += 1; renderCart();
        };
        one.appendChild(add); grid.appendChild(one);
      });
      card.appendChild(grid); box.appendChild(card);
    });
  }
  var STATUS = ['商家接单中', '骑手已取餐', '配送中…', '已送达'];
  function refreshOrders() {
    db.list('orders').then(function(rows){
      var box = el('t-orders'); box.innerHTML = '';
      if (!rows.length) { box.innerHTML = '<div class="meta">还没有订单。</div>'; return; }
      rows.slice(0, 6).forEach(function(row){
        var names = (row.items || []).map(function(i){ return i.name + '×' + i.count; }).join('、');
        var line = document.createElement('div'); line.className = 'item'; line.style.padding = '6px 0';
        line.innerHTML = '<span class="item-text">' + names + ' ' + money(row.amount) + '</span><span class="meta">' + (STATUS[row.stage] || '已完成') + '</span>';
        box.appendChild(line);
      });
    }).catch(function(){});
  }
  el('t-order').onclick = function(){
    var names = Object.keys(cart);
    if (!names.length) { toast('先点几样再下单'); return; }
    var items = names.map(function(k){ return cart[k]; });
    var amount = total();
    api().wallet.pay({ amount: amount, title: '外卖订单', detail: 'Miya 外卖：' + items.map(function(i){ return i.name; }).join('、'), category: '外卖' }).then(function(res){
      if (!res || res.ok !== true) { throw new Error((res && res.error) || '支付失败'); }
      cart = {}; renderCart();
      return db.create('orders', { items: items, amount: amount, stage: 0, paidAt: new Date().toISOString() }).then(function(order){
        toast('支付成功，商家接单中');
        refreshOrders();
        var stage = 0;
        var timer = setInterval(function(){
          stage += 1;
          db.update('orders', order.id, { stage: stage }).then(function(){ refreshOrders(); if (stage >= STATUS.length - 1) clearInterval(timer); }).catch(function(){ clearInterval(timer); });
          if (stage < STATUS.length - 1) toast(STATUS[stage]);
        }, 8000);
        return api().wallet.get();
      });
    }).then(function(w){
      if (w && typeof w.balance === 'number') el('t-money').textContent = money(w.balance);
    }).catch(function(err){ toast((err && err.message) || '支付失败'); });
  };
  api().wallet.get().then(function(w){
    el('t-money').textContent = w && typeof w.balance === 'number' ? money(w.balance) : '（读取失败）';
  }).catch(function(err){ el('t-money').textContent = '（未授权读取）'; });
  renderMenu(); renderCart(); refreshOrders();
`);

// ── 7. 相册（本机媒体库）──

const ALBUM_HTML = appShell(
  "相册", "本机相册 · 添加后存在媒体库",
  `<div class="card row-input"><button id="p-add" class="primary" style="flex:1">＋ 添加照片</button></div>
   <div class="card"><b>照片 <span id="p-count" class="meta"></span></b><div id="p-grid" class="photo-grid" style="margin-top:8px"></div></div>`,
  `
  var db = api().db;
  async function load() {
    var rows = await db.list('photos');
    el('p-count').textContent = '（' + rows.length + ' 张）';
    var box = el('p-grid'); box.innerHTML = '';
    if (!rows.length) { box.innerHTML = '<div class="meta" style="grid-column:1/-1">还没有照片，点上面的按钮从设备里挑几张。</div>'; return; }
    rows.slice(0, 30).forEach(function(row){
      var cell = document.createElement('div'); cell.className = 'photo';
      var img = document.createElement('img'); img.alt = '照片'; img.loading = 'lazy';
      api().media.get({ ref: row.ref }).then(function(res){ if (res && res.dataUrl) img.src = res.dataUrl; }).catch(function(){ cell.style.opacity = '0.4'; });
      var del = document.createElement('button'); del.textContent = '×';
      del.onclick = function(){
        db.delete('photos', row.id).then(function(){ try { api().media.delete({ ref: row.ref }); } catch (e) {} load(); }).catch(fail);
      };
      cell.appendChild(img); cell.appendChild(del); box.appendChild(cell);
    });
  }
  el('p-add').onclick = function(){
    api().media.pick({ accept: 'image/*', multiple: true, limit: 9 }).then(function(res){
      if (!res || res.canceled || !res.files || !res.files.length) return;
      var chain = Promise.resolve();
      res.files.forEach(function(file){
        chain = chain.then(function(){
          return api().media.put({ dataUrl: file.dataUrl }).then(function(stored){
            return db.create('photos', { ref: stored.ref, name: file.name || '照片' });
          });
        });
      });
      chain.then(load).catch(fail);
    }).catch(fail);
  };
  load().catch(fail);
`);

// ── 七个 App 的定义清单 ──

const MIYA_DEEP_APPS: MiyaDeepAppDef[] = [
  {
    appId: "miya_memo",
    name: "备忘",
    description: "随手备忘：置顶、删除，数据只存本机。",
    emoji: "📝",
    bg: "#6f8f7a",
    permissions: ["app.data.read", "app.data.write", "ui.toast"],
    entryHtml: MEMO_HTML,
  },
  {
    appId: "miya_todo",
    name: "待办",
    description: "轻量待办清单：添加、勾选完成、按状态筛选。",
    emoji: "☑️",
    bg: "#5b8fb9",
    permissions: ["app.data.read", "app.data.write", "ui.toast"],
    entryHtml: TODO_HTML,
  },
  {
    appId: "miya_health",
    name: "健康",
    description: "每天记喝水、睡眠、步数，看最近 7 天。",
    emoji: "❤️",
    bg: "#c9705f",
    permissions: ["app.data.read", "app.data.write", "ui.toast"],
    entryHtml: HEALTH_HTML,
  },
  {
    appId: "miya_drive",
    name: "云盘",
    description: "本机轻量云盘：文本文件的新建、查看与删除。",
    emoji: "☁️",
    bg: "#a8b8c8",
    permissions: ["app.data.read", "app.data.write", "ui.toast"],
    entryHtml: DRIVE_HTML,
  },
  {
    appId: "miya_browser",
    name: "浏览器",
    description: "极简阅读模式浏览器：白名单站点 + 书签。",
    emoji: "🧭",
    bg: "#45a8a0",
    permissions: ["app.data.read", "app.data.write", "network.fetch", "ui.toast"],
    network: { allowedDomains: ["example.com", "www.iana.org", "httpbin.org"], mode: "proxy" },
    entryHtml: BROWSER_HTML,
  },
  {
    appId: "miya_takeout",
    name: "外卖",
    description: "模拟外卖点单：统一钱包支付、订单状态推进。",
    emoji: "🛵",
    bg: "#bf6080",
    permissions: ["app.data.read", "app.data.write", "wallet.read", "wallet.pay", "ui.toast"],
    entryHtml: TAKEOUT_HTML,
  },
  {
    appId: "miya_album",
    name: "相册",
    description: "本机相册：从设备挑照片，存进媒体库。",
    emoji: "🖼️",
    bg: "#9580b0",
    permissions: ["media.pick", "app.data.read", "app.data.write", "ui.toast"],
    entryHtml: ALBUM_HTML,
  },
];

// ── 首次启动安装 ──

export function ensureMiyaDeepAppsInstalled(): void {
  if (typeof window === "undefined") return;
  if (kvGet(MIYA_DEEP_APPS_FLAG) === "1") return;
  kvSet(MIYA_DEEP_APPS_FLAG, "1");

  const installedIds = new Set(loadInstalledCustomApps().map(app => app.id));
  const now = new Date().toISOString();
  for (const def of MIYA_DEEP_APPS) {
    if (installedIds.has(def.appId)) continue;
    try {
      installCustomApp({
        id: def.appId,
        name: def.name,
        version: "1.0.0",
        author: "Miya",
        description: def.description,
        iconDataUrl: emojiIconDataUrl(def.emoji, def.bg),
        entryHtml: def.entryHtml,
        permissions: def.permissions,
        manifest: {
          id: def.appId,
          name: def.name,
          version: "1.0.0",
          author: "Miya",
          description: def.description,
          permissions: def.permissions,
          primaryTags: ["miya"],
          network: def.network,
        },
        assets: {},
        installedAt: now,
        updatedAt: now,
      });
      window.dispatchEvent(new CustomEvent(CUSTOM_APP_PLACE_DESKTOP_EVENT, { detail: { appId: def.appId } }));
    } catch {
      // 单个 App 安装失败（如 id 冲突）不阻塞其余 App
    }
  }
}
