// 对比仓库受控副本与游戏目录的文件差异
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REPO = "C:/Users/Hui/Documents/Workspace/Ah/addon-auctionator";
const GAME = "C:/Program Files (x86)/World of Warcraft/_forever_/Interface/AddOns/Auctionator";

function walk(root, base = "", out = []) {
  for (const e of fs.readdirSync(path.join(root, base), { withFileTypes: true })) {
    const rel = base ? base + "/" + e.name : e.name;
    if (e.isDirectory()) walk(root, rel, out);
    else out.push(rel);
  }
  return out;
}
const md5 = (p) => crypto.createHash("md5").update(fs.readFileSync(p)).digest("hex").slice(0, 10);

const repoFiles = new Set(walk(REPO));
const gameFiles = new Set(walk(GAME));
const onlyRepo = [...repoFiles].filter((f) => !gameFiles.has(f));
const onlyGame = [...gameFiles].filter((f) => !repoFiles.has(f));
const diff = [];
for (const f of repoFiles) {
  if (!gameFiles.has(f)) continue;
  if (md5(path.join(REPO, f)) !== md5(path.join(GAME, f))) diff.push(f);
}
console.log("only in repo:", onlyRepo.length);
onlyRepo.forEach((f) => console.log("  +", f));
console.log("only in game:", onlyGame.length);
onlyGame.forEach((f) => console.log("  -", f));
console.log("content differs:", diff.length);
diff.forEach((f) => console.log("  ~", f));
