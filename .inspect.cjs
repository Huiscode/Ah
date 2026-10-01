const fs = require("fs");
const c = fs.readFileSync(".bs.html", "utf8");
const liRegex = /<li id="r-\d+" class="cr-row">([\s\S]*?)<\/li>/g;
let count = 0, failed = 0;
let m;
while ((m = liRegex.exec(c)) !== null) {
  count++;
  const block = m[1];
  const outMatch = block.match(/<a href="\/zh-cn\/item\/(\d+)" class="cr-made">[\s\S]*?<span class="cr-name[^"]*">([^<]+)<\/span><\/a>/);
  if (!outMatch) { failed++; if (failed <= 2) console.log("FAIL:", block.slice(0,300)); }
}
console.log("total:", count, "failed:", failed);
