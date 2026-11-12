import { mkdir, readFile, writeFile } from "node:fs/promises";

const files = [
  ["/", "text/html; charset=utf-8", "web/index.html"],
  ["/equipa", "text/html; charset=utf-8", "worker/staff.html"],
  ["/style.css", "text/css; charset=utf-8", "web/style.css"],
  ["/booking.js", "text/javascript; charset=utf-8", "worker/booking.js"],
  ["/staff.js", "text/javascript; charset=utf-8", "worker/staff.js"],
  ["/pek-logo.png", "image/png", "web/pek-logo.png"],
  ["/jc-web-solutions.png", "image/png", "web/jc-web-solutions.png"]
];
const assetEntries = await Promise.all(files.map(async ([path, type, source]) => {
  const data = await readFile(source);
  const body = type === "image/png"
    ? "Uint8Array.from(atob(" + JSON.stringify(data.toString("base64")) + "), c => c.charCodeAt(0))"
    : JSON.stringify(data.toString("utf8"));
  return JSON.stringify(path) + ":[" + JSON.stringify(type) + "," + body + "]";
}));
const catalog = await readFile("worker/catalog.js", "utf8");
const team = await readFile("worker/team.js", "utf8");
const worker = await readFile("worker/index.js", "utf8");
await mkdir("dist/server", { recursive: true });
await writeFile("dist/server/index.js",
  "const assets = {" + assetEntries.join(",\n") + "};\n" +
  catalog + "\n" + team + "\n" + worker.replace(/^import .*;\r?\n/gm, ""));
