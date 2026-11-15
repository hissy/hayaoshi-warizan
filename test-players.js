#!/usr/bin/env node
"use strict";
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

const engStart = html.indexOf("/* --- ENGINE START --- */");
const engEnd = html.indexOf("/* --- ENGINE END --- */");
if (engStart < 0 || engEnd < 0) throw new Error("engine markers missing");
const engineSrc = html.slice(engStart, engEnd + "/* --- ENGINE END --- */".length);

const uiStart = html.lastIndexOf("<script>");
const uiEnd = html.lastIndexOf("</script>");
const ui = html.slice(uiStart + 8, uiEnd);
const from = ui.indexOf("var STORAGE_KEY");
const to = ui.indexOf("function showScreen");
if (from < 0 || to < 0) throw new Error("could not slice storage functions");
const storageSrc = ui.slice(from, to);

const store = new Map();
const localStorage = {
  getItem(k) { return store.has(k) ? store.get(k) : null; },
  setItem(k, v) { store.set(k, String(v)); },
  removeItem(k) { store.delete(k); }
};

const ctx = { window: {}, localStorage, console, Date, Math, Number, Array, JSON, String, Object };
vm.createContext(ctx);
vm.runInContext(engineSrc + "\n; var H = window.Hayaoshi;\n" + storageSrc, ctx);

function fail(msg) { console.error("FAIL:", msg); process.exit(1); }
function assert(cond, msg) { if (!cond) fail(msg); }

// --- migrate v2 into プレイヤー1 ---
store.clear();
localStorage.setItem("hayaoshi-warizan-v2", JSON.stringify({
  best: { 1: 1234, 5: 800 },
  cleared: { 1: true, 5: true },
  unlocked: 6,
  sound: false,
  answerFormat: "decimal"
}));
const migrated = ctx.loadRoot();
assert(migrated.version === 3, "version 3");
assert(migrated.sound === false, "sound migrated");
assert(migrated.players.length === 1, "one player");
assert(migrated.players[0].name === "プレイヤー1", "default name");
assert(migrated.players[0].unlocked === ctx.H.LEVEL_COUNT, "every level is open after migrate");
assert(migrated.players[0].best[1] === 1234 && migrated.players[0].best[5] === 800, "bests migrated");
assert(migrated.players[0].cleared[1] && migrated.players[0].cleared[5], "cleared migrated");
assert(migrated.players[0].answerFormat === "decimal", "answerFormat migrated");
assert(migrated.currentId === migrated.players[0].id, "currentId");
assert(localStorage.getItem("hayaoshi-warizan-v3"), "v3 persisted");

// --- isolation + remember current ---
const p2 = ctx.makePlayer("たろう", "🐱", "#FF8A4C", null, "p2");
migrated.players.push(p2);
migrated.currentId = "p2";
ctx.saveRoot(migrated);

let view = ctx.loadStore();
assert(view.player.name === "たろう", "loadStore uses current");
assert(view.unlocked === ctx.H.LEVEL_COUNT && !view.best[1], "p2 starts with every level open");
assert(view.sound === false, "sound is global");

ctx.saveStore({ unlocked: 3, best: { 1: 500 }, cleared: { 1: true }, answerFormat: "remainder" });

const root = ctx.loadRoot();
const a = ctx.findPlayer(root, "p1");
const b = ctx.findPlayer(root, "p2");
assert(a.unlocked === ctx.H.LEVEL_COUNT && a.best[1] === 1234 && a.answerFormat === "decimal", "p1 unchanged after p2 play");
assert(b.unlocked === ctx.H.LEVEL_COUNT && b.best[1] === 500 && b.cleared[1] === true, "p2 progress saved without a lock");
assert(root.currentId === "p2", "remembers last player");

root.currentId = a.id;
ctx.saveRoot(root);
view = ctx.loadStore();
assert(view.unlocked === ctx.H.LEVEL_COUNT && view.best[1] === 1234 && view.answerFormat === "decimal", "switching back restores p1");

assert(ctx.answerFormatForLevel(1, "decimal") === "remainder", "L1 ignores decimal");
assert(ctx.answerFormatForLevel(14, "decimal") === "remainder", "L14 ignores decimal");
assert(ctx.answerFormatForLevel(15, "decimal") === "decimal", "L15 uses decimal");
assert(ctx.answerFormatForLevel(20, "remainder") === "remainder", "L20 can stay remainder");
assert(ctx.answerFormatForLevel(20, "decimal") === "decimal", "L20 uses decimal");

// cannot logically represent delete-last here without UI, but filter safety:
root.players = [a];
root.currentId = a.id;
ctx.saveRoot(root);
assert(ctx.loadRoot().players.length === 1, "one player remains");

console.log("OK: v2 migrates into プレイヤー1; every level stays open; progress and answer-mode stay per player; decimal applies from L15.");
