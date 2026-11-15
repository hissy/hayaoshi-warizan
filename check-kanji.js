"use strict";
/**
 * Extract kanji from user-visible UI strings in index.html and check
 * they are all in the 学年別漢字配当表 for elementary grades 1–4
 * (小学校学習指導要領 平成29年告示 / 2020施行).
 */
const fs = require("fs");
const path = require("path");

const GRADE1 = "一右雨円王音下火花貝学気九休玉金空月犬見五口校左三山子四糸字耳七車手十出女小上森人水正生青夕石赤千川先早草足村大男竹中虫町天田土二日入年白八百文木本名目立力林六";
const GRADE2 = "引羽雲園遠何科夏家歌画回会海絵外角楽活間丸岩顔汽記帰弓牛魚京強教近兄形計元言原戸古午後語工公広交光考行高黄合谷国黒今才細作算止市矢姉思紙寺自時室社弱首秋週春書少場色食心新親図数西声星晴切雪船線前組走多太体台地池知茶昼長鳥朝直通弟店点電刀冬当東答頭同道読内南肉馬売買麦半番父風分聞米歩母方北毎妹万明鳴毛門夜野友用曜来里理話";
const GRADE3 = "悪安暗医委意育員院飲運泳駅央横屋温化荷界開階寒感漢館岸起期客究急級宮球去橋業曲局銀区苦具君係軽血決研県庫湖向幸港号根祭皿仕死使始指歯詩次事持式実写者主守取酒受州拾終習集住重宿所暑助昭消商章勝乗植申身神真深進世整昔全相送想息速族他打対待代第題炭短談着注柱丁帳調追定庭笛鉄転都度投豆島湯登等動童農波配倍箱畑発反坂板皮悲美鼻筆氷表秒病品負部服福物平返勉放味命面問役薬由油有遊予羊洋葉陽様落流旅両緑礼列練路和";
const GRADE4 = "愛案以衣位茨印英栄媛塩岡億加果貨課芽賀改械害街各覚潟完官管関観願岐希季旗器機議求泣給挙漁共協鏡競極熊訓軍郡群径景芸欠結建健験固功好香候康佐差菜最埼材崎昨札刷察参産散残氏司試児治滋辞鹿失借種周祝順初松笑唱焼照城縄臣信井成省清静席積折節説浅戦選然争倉巣束側続卒孫帯隊達単置仲沖兆低底的典伝徒努灯働特徳栃奈梨熱念敗梅博阪飯飛必票標不夫付府阜富副兵別辺変便包法望牧末満未民無約勇要養浴利陸良料量輪類令冷例連老労録";

function uniqueChars(s) {
  return Array.from(new Set(Array.from(s)));
}

const counts = { 1: GRADE1.length, 2: GRADE2.length, 3: GRADE3.length, 4: GRADE4.length };
if (counts[1] !== 80 || counts[2] !== 160 || counts[3] !== 200 || counts[4] !== 202) {
  console.error("FAIL: grade list counts", counts);
  process.exit(1);
}
const ALLOWED = new Set(uniqueChars(GRADE1 + GRADE2 + GRADE4 + GRADE3));
if (ALLOWED.size !== 642) {
  console.error("FAIL: unique grade 1-4 count", ALLOWED.size);
  process.exit(1);
}

const GRADE_OF = new Map();
[GRADE1, GRADE2, GRADE3, GRADE4].forEach((list, i) => {
  for (const ch of list) GRADE_OF.set(ch, i + 1);
});

const htmlPath = path.join(__dirname, "index.html");
const html = fs.readFileSync(htmlPath, "utf8");

function stripBlocks(src, tag) {
  const re = new RegExp("<" + tag + "\\b[^>]*>[\\s\\S]*?<\\/" + tag + ">", "gi");
  return src.replace(re, "\n");
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function hasJapanese(s) {
  return /[\u3040-\u30ff\u4e00-\u9fff]/.test(s);
}

function kanjiIn(s) {
  return s.match(/[\u4e00-\u9fff]/g) || [];
}

const visible = [];

// Attributes that can appear on screen or to assistive tech
const attrRe = /\s(?:aria-label|aria-description|aria-roledescription|title|alt|placeholder|aria-valuetext)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
let m;
const htmlNoScriptStyle = stripBlocks(stripBlocks(html, "style"), "script");
while ((m = attrRe.exec(htmlNoScriptStyle))) {
  const val = decodeEntities(m[1] != null ? m[1] : m[2]);
  if (hasJapanese(val)) visible.push({ source: "attr", text: val });
}

// <title>
const titleM = html.match(/<title>([^<]*)<\/title>/i);
if (titleM && hasJapanese(titleM[1])) visible.push({ source: "title", text: decodeEntities(titleM[1]) });

// Text nodes outside script/style (including ruby base; skip <rt> furigana which is kana)
let body = htmlNoScriptStyle.replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, "");
body = body.replace(/<!--[\s\S]*?-->/g, "");
body = body.replace(/<[^>]+>/g, "\n");
for (const line of body.split(/\n+/)) {
  const text = decodeEntities(line).replace(/\s+/g, " ").trim();
  if (text && hasJapanese(text)) visible.push({ source: "html", text });
}

// JS string literals (UI copy lives here)
const scriptM = html.match(/<script>([\s\S]*?)<\/script>/);
if (scriptM) {
  const code = scriptM[1]
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1");
  const strRe = /(["'])((?:\\.|.)*?)(\1)/g;
  let sm;
  while ((sm = strRe.exec(code))) {
    const raw = sm[2].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    // Skip selectors / CSS-ish / pure ASCII identifiers
    if (!hasJapanese(raw)) continue;
    visible.push({ source: "js", text: raw });
  }
}

const violations = [];
const used = new Map(); // kanji -> examples
for (const item of visible) {
  for (const k of kanjiIn(item.text)) {
    if (!used.has(k)) used.set(k, []);
    if (used.get(k).length < 3) used.get(k).push(item);
    if (!ALLOWED.has(k)) {
      violations.push({ kanji: k, grade: GRADE_OF.get(k) || "outside 小1-小6", text: item.text, source: item.source });
    }
  }
}

console.log("User-visible strings with Japanese:", visible.length);
console.log("Kanji used (" + used.size + "): " + Array.from(used.keys()).sort().join("") );
for (const [k, examples] of [...used.entries()].sort((a, b) => a[0].localeCompare(b[0], "ja"))) {
  const g = GRADE_OF.get(k);
  console.log("  " + k + "  小" + g + "  e.g. " + examples[0].text.replace(/\s+/g, " ").slice(0, 60));
}

if (violations.length) {
  console.error("\nVIOLATIONS (" + violations.length + "):");
  for (const v of violations) {
    console.error("  " + v.kanji + " (" + v.grade + ") in [" + v.source + "] " + v.text.replace(/\s+/g, " ").slice(0, 80));
  }
  process.exit(1);
}

console.log("\nOK: every visible kanji is in the grade 1-4 学年別漢字配当表 (商 is 小3).");

// Reverse check: hiragana spellings that should be kanji because every
// character is taught by the end of grade 4. Intentionally NOT listed
// (grade 5+ / outside the list / particles / natural okurigana):
//   わり算・わられる・わる (割=小6), あまり (余=小5), せいかい→正かい (解=小5),
//   正かいりつ (率=小5), かんたん (簡=小6), ふつう (普は配当外), むずかしい (難=小6),
//   おつかれさま (疲は配当外), さがして (探=小6), こえる (超は配当外),
//   ちょうせん (挑は配当外), もどる (戻は配当外), すばらしい (素=小5),
//   早おし (押は配当外), ちがう (違は配当外).
const HIRAGANA_TO_KANJI = {
  "なかまはずれ": "仲間外れ",
  "なかま": "仲間",
  "はずれ": "外れ",
  "わりざん": "わり算",
  "はやおし": "早おし",
  "はやさ": "速さ",
  "はやい": "早い",
  "はやく": "早く",
  "あそびかた": "遊び方",
  "えらぼう": "選ぼう",
  "えらべます": "選べます",
  "えらぶ": "選ぶ",
  "こたえ": "答え",
  "もんだい": "問題",
  "せいかいりつ": "正かいりつ",
  "せいかい": "正かい",
  "つぎへ": "次へ",
  "つぎの": "次の",
  "つぎ": "次",
  "さいこうてん": "最高点",
  "さいこう": "最高",
  "さいだいれんさ": "最大連続",
  "さいだい": "最大",
  "れんさ": "連続",
  "たいせつ": "大切",
  "ぜんぶ": "全部",
  "とくてん": "点",
  "ばいすう": "倍数",
  "ばいすると": "倍すると",
  "のこりじかん": "残り時間",
  "ごうけいじかん": "合計時間",
  "じかんぎれ": "時間切れ",
  "じかん": "時間",
  "びょう": "秒",
  "わりきれます": "わり切れます",
  "けっかをみる": "結果を見る",
  "けっか": "結果",
  "もういちど": "もう一度",
  "いちど": "一度",
  "ひとつ": "一つ",
  "いちばん": "一番",
  "はじめて": "初めて",
  "もとの": "元の",
  "ざんねん": "残念",
  "せつめい": "説明",
  "おちついて": "落ち着いて",
  "よくできた": "良くできた",
  "でてくる": "出て来る",
  "けいさん": "計算",
  "すうじ": "数字",
  "おわる": "終わる",
  "おわり": "終わり",
  "あたらしい": "新しい",
  "おなじ": "同じ",
  "たかい": "高い",
  "すこし": "少し",
  "よんで": "読んで",
  "しき": "式",
  "てん": "点",
  "おと": "音",
  "こたえかた": "答え方",
  "いじょう": "以上",
  "つかえます": "使えます",
  "わりすすめて": "わり進めて",
  "わりすすめる": "わり進める",
  "きをつけて": "気を付けて",
  "なまえをかえる": "名前を変える",
  "なまえ": "名前",
  "あたらしく": "新しく",
  "つくれません": "作れません",
  "つくる": "作る",
  "かえる": "変える",
  "けしますか": "消しますか",
  "けします": "消します",
  "けす": "消す",
  "ほんとうに": "本当に",
  "ほんとう": "本当",
  "のこして": "残して",
  "いれて": "入れて",
  "きろく": "記録",
  "わかれます": "分かれます",
  "あそぶ": "遊ぶ",
  "みため": "見た目"
};


const joinedHits = [];
const keys = Object.keys(HIRAGANA_TO_KANJI).sort(function (a, b) { return b.length - a.length; });
for (const item of visible) {
  // Strip tags in JS strings so ruby markup does not hide leftover kana
  const plain = item.text.replace(/<[^>]+>/g, "");
  for (const hira of keys) {
    if (plain.indexOf(hira) !== -1) {
      joinedHits.push({
        hira: hira,
        kanji: HIRAGANA_TO_KANJI[hira],
        source: item.source,
        text: plain
      });
    }
  }
}

if (joinedHits.length) {
  console.error("\nHIRAGANA THAT SHOULD BE KANJI (" + joinedHits.length + "):");
  for (const h of joinedHits) {
    console.error("  " + h.hira + " → " + h.kanji + "  [" + h.source + "] " + h.text.replace(/\s+/g, " ").slice(0, 80));
  }
  process.exit(1);
}

console.log("OK: no leftover hiragana that should be written in grade 1-4 kanji.");
