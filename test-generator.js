"use strict";
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const htmlPath = path.join(__dirname, "index.html");
const html = fs.readFileSync(htmlPath, "utf8");
const m = html.match(/\/\* --- ENGINE START --- \*\/([\s\S]*?)\/\* --- ENGINE END --- \*\//);
if (!m) {
  console.error("FAIL: engine markers not found");
  process.exit(1);
}

const ctx = { console, module: { exports: {} }, exports: {}, Math };
ctx.global = ctx;
ctx.window = undefined;
ctx.document = undefined;
vm.createContext(ctx);
vm.runInContext(m[1], ctx, { filename: "engine.js" });
const H = ctx.module.exports && ctx.module.exports.generateQuestion
  ? ctx.module.exports
  : ctx.Hayaoshi;
if (!H || !H.generateQuestion || !H.LEVELS) {
  console.error("FAIL: Hayaoshi API not exported", Object.keys(ctx));
  process.exit(1);
}

const LEVELS = H.LEVELS;
const N = 1000;
let failed = 0;

function fail(msg) {
  console.error("FAIL: " + msg);
  failed++;
}

if (LEVELS.length !== 20) fail("expected 20 levels, got " + LEVELS.length);
if (LEVELS[0].timeLimit < 19) fail("L1 time should be ~20s, got " + LEVELS[0].timeLimit);
if (LEVELS[19].timeLimit > 6) fail("L20 time should be ~5-6s, got " + LEVELS[19].timeLimit);
if (H.DECIMAL_UNLOCK_LEVEL !== 15) fail("decimal answers should start at level 15");

console.log("Level table:");
console.log("Lv  秒  あまり  倍数                          わられる≤  わる≤   商の範囲  はずれ");
for (const lv of LEVELS) {
  const rem = lv.remainChance === 0 ? "なし" : lv.remainChance.toFixed(2);
  const fac = lv.factors.filter((f) => f > 1).join(",");
  console.log(
    String(lv.id).padStart(2) + "  " +
    String(lv.timeLimit).padStart(2) + "  " +
    rem.padEnd(6) + " " +
    fac.padEnd(29) + " " +
    String(lv.maxDividend).padStart(6) + "    " +
    String(lv.maxDivisor).padStart(4) + "   " +
    (lv.qMin + "–" + lv.qMax).padEnd(8) + " " +
    lv.trap
  );
}

for (let i = 1; i < LEVELS.length; i++) {
  const a = LEVELS[i - 1], b = LEVELS[i];
  if (b.timeLimit > a.timeLimit) fail("time increased L" + a.id + " " + a.timeLimit + " → L" + b.id + " " + b.timeLimit);
  if (b.remainChance < a.remainChance - 1e-9) fail("remainChance dropped L" + a.id + " → L" + b.id);
  if (b.maxDividend < a.maxDividend) fail("maxDividend dropped L" + a.id + " → L" + b.id);
  if (b.maxDivisor < a.maxDivisor) fail("maxDivisor dropped L" + a.id + " → L" + b.id);
  if (b.qMax < a.qMax) fail("qMax dropped L" + a.id + " → L" + b.id);
}

const l1f = new Set(LEVELS[0].factors);
if (![...l1f].every((f) => [1, 2, 4, 8].includes(f))) fail("L1 factors should be 2-powers only: " + [...l1f]);
if (LEVELS[0].remainChance !== 0) fail("L1 should have no remainders");
if (!LEVELS[19].factors.includes(16) && !LEVELS[19].factors.includes(25)) fail("L20 should include large factors");
if (LEVELS[19].maxDividend < 1800) fail("L20 should allow numbers like 1800÷32");

function checkCommon(q, lv, i, format) {
  const err = H.validateQuestion(q);
  if (err) return "validate: " + err;
  if (q.level !== lv.id && q.difficulty !== lv.id) return "level mismatch " + q.level;
  if (q.base.dividend > lv.maxDividend) return "dividend " + q.base.dividend;
  if (q.base.divisor > lv.maxDivisor) return "divisor " + q.base.divisor;
  const allowed = new Set(lv.factors);
  if (!allowed.has(q.baseFactor)) return "baseFactor " + q.baseFactor + " not in pool";
  for (const c of q.choices) {
    if (!c.isOdd) {
      if (c.fd !== c.fm) return "correct unequal factors";
      if (!allowed.has(c.fd)) return "correct factor " + c.fd;
    }
    if (!Number.isInteger(c.dividend) || !Number.isInteger(c.divisor)) return "non-int " + c.text;
  }
  if (lv.remainChance === 0 && format !== "decimal" && (q.hasRemainder || q.core.r !== 0)) {
    return "unexpected remainder";
  }
  if (lv.trap === "obvious" && format !== "decimal") {
    const trap = q.choices.find((c) => c.isOdd);
    if (trap.dividend % trap.divisor !== 0) return "obvious trap not exact";
    const tq = trap.dividend / trap.divisor;
    if (Math.abs(tq - q.core.q) < 2) return "obvious trap too close " + tq;
  }
  if (format === "decimal") {
    if (!H.isTerminating(q.base.dividend, q.base.divisor)) return "base non-terminating";
    for (const c of q.choices) {
      if (!H.isTerminating(c.dividend, c.divisor)) return "choice non-terminating " + c.text;
    }
    const dec = H.formatDecimal(q.base.dividend, q.base.divisor);
    if (/\.\d*333|\.\d*666/.test(dec)) return "looks repeating " + dec;
    for (const c of q.choices) {
      const d = H.formatDecimal(c.dividend, c.divisor);
      const same = d === dec;
      if (c.isOdd && same) return "trap same decimal " + d;
      if (!c.isOdd && !same) return "correct different decimal " + d + " vs " + dec;
    }
    if (q.format !== "decimal") return "format flag missing";
  }
  return null;
}

const samples = {};
const oddPos = {};

console.log("\nRemainder mode: 1000 questions × 20 levels...");
for (const lv of LEVELS) {
  oddPos[lv.id] = [0, 0, 0, 0];
  samples[lv.id] = [];
  for (let i = 0; i < N; i++) {
    let q;
    try {
      q = H.generateQuestion(lv.id);
    } catch (e) {
      fail("L" + lv.id + " #" + i + " threw " + (e && e.stack || e));
      continue;
    }
    const err = checkCommon(q, lv, i, "remainder");
    if (err) {
      fail("L" + lv.id + " #" + i + " " + err);
      if (failed < 8) console.error(JSON.stringify({
        base: q && q.base, core: q && q.core, choices: q && q.choices, format: q && q.format
      }));
      continue;
    }
    oddPos[lv.id][q.oddIndex]++;
    if (i < 1) {
      samples[lv.id].push({
        base: q.base.text,
        core: q.core.text,
        rem: q.hasRemainder,
        showQR: q.showQR,
        choices: q.choices.map((c) => c.text + (c.isOdd ? " (X)" : ""))
      });
    }
  }
}

console.log("\nDecimal mode: 1000 questions × levels 15–20...");
const decSamples = {};
for (const lv of LEVELS.filter((l) => l.id >= H.DECIMAL_UNLOCK_LEVEL)) {
  decSamples[lv.id] = [];
  for (let i = 0; i < N; i++) {
    let q;
    try {
      q = H.generateQuestion(lv.id, Math.random, { format: "decimal" });
    } catch (e) {
      fail("decimal L" + lv.id + " #" + i + " threw " + (e && e.stack || e));
      continue;
    }
    const err = checkCommon(q, lv, i, "decimal");
    if (err) {
      fail("decimal L" + lv.id + " #" + i + " " + err);
      if (failed < 12) console.error(JSON.stringify({
        base: q && q.base, core: q && q.core,
        dec: q && H.formatDecimal(q.base.dividend, q.base.divisor),
        choices: q && q.choices
      }));
      continue;
    }
    if (i < 1) {
      decSamples[lv.id].push({
        base: q.base.text + "=" + H.formatDecimal(q.base.dividend, q.base.divisor),
        core: q.core.text + "=" + H.formatDecimal(q.core.dividend, q.core.divisor),
        choices: q.choices.map((c) => c.text + "=" + H.formatDecimal(c.dividend, c.divisor) + (c.isOdd ? " (X)" : ""))
      });
    }
  }
}

console.log("\nRemainder samples:");
console.log(JSON.stringify(samples, null, 2));
console.log("\nDecimal samples:");
console.log(JSON.stringify(decSamples, null, 2));
console.log("Odd-index (L1, L10, L20):", oddPos[1], oddPos[10], oddPos[20]);

if (failed) {
  console.error("\nFAILED: " + failed + " issues");
  process.exit(1);
}
console.log("\nOK: 20 levels, time limits non-increasing, " + N + " remainder questions × 20 and " + N + " decimal questions × 6 all valid.");
