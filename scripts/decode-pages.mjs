// Decode RSC payload for all downloaded profession pages.
// Reads .tmp-page-<slug>.html, writes .tmp-probe-<slug>-decoded.txt
import fs from "node:fs";

const slugs = ["blacksmithing", "enchanting", "engineering", "leatherworking", "tailoring", "cooking", "fishing", "first-aid", "camping"];
for (const s of slugs) {
  const html = fs.readFileSync(`.tmp-page-${s}.html`, "utf8");
  const re = /self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)<\/script>/g;
  let m;
  let decoded = "";
  while ((m = re.exec(html)) !== null) {
    try {
      decoded += JSON.parse('"' + m[1] + '"');
    } catch (e) {
      console.log(s, "block parse err", e.message.slice(0, 60));
    }
  }
  fs.writeFileSync(`.tmp-probe-${s}-decoded.txt`, decoded);
  console.log(s, "decoded", decoded.length);
}
