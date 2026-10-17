// Regenerates the CATALOG block inside pay-per-crawl.js from the core catalog.
//   node nginx/gen-catalog.mjs
import fs from "node:fs";
import { SHIPPED_CATALOG } from "../packages/core/src/index.js";

const file = new URL("./pay-per-crawl.js", import.meta.url);
const src = fs.readFileSync(file, "utf8");
const rows = SHIPPED_CATALOG.map((e) => "  " + JSON.stringify([e.name, e.class, e.match, e.verify || []]) + ",").join("\n");
const out = src.replace(/\/\/ BEGIN CATALOG\n[\s\S]*?\/\/ END CATALOG/, `// BEGIN CATALOG\nvar CATALOG = [\n${rows}\n];\n// END CATALOG`);
fs.writeFileSync(file, out);
console.log("catalog entries:", SHIPPED_CATALOG.length);
