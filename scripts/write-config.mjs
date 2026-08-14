import fs from "node:fs/promises";

const token = process.env.MAPBOX_TOKEN ?? "";
if (!token.startsWith("pk.")) {
  throw new Error("MAPBOX_TOKEN must be a public Mapbox token beginning with pk.");
}

await fs.writeFile("public/config.json", JSON.stringify({ mapboxToken: token }));
console.log("Wrote the public runtime map configuration.");
