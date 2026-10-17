// One-off check: confirm the CCG credentials can see the enterprise's mock
// documents. Prints file metadata (id, name, size) only - never content.
import { BoxCcgAuth, BoxClient, CcgConfig } from "box-node-sdk";

const clientId = process.env.BOX_CLIENT_ID;
const clientSecret = process.env.BOX_CLIENT_SECRET;
const enterpriseId = process.env.BOX_ENTERPRISE_ID;
if (!clientId || !clientSecret || !enterpriseId) {
  console.error("BOX_CLIENT_ID / BOX_CLIENT_SECRET / BOX_ENTERPRISE_ID must be set");
  process.exit(1);
}

const client = new BoxClient({
  auth: new BoxCcgAuth({
    config: new CcgConfig({ clientId, clientSecret, enterpriseId }),
  }),
});

interface Entry {
  type: string;
  id: string;
  name?: string;
  size?: number;
}

const folders: string[] = [];
const files: Entry[] = [];
const MAX_DEPTH = 3;

async function walk(folderId: string, name: string, depth: number): Promise<void> {
  if (depth > MAX_DEPTH) return;
  const items = (await client.folders.getFolderItems(folderId, {
    queryParams: { fields: ["name", "size", "type"], limit: 1000 },
  })) as { entries?: Entry[]; total_count?: number };
  console.log(
    `folder /${name} (id ${folderId}): ${items.total_count ?? items.entries?.length ?? 0} items`,
  );
  for (const entry of items.entries ?? []) {
    if (entry.type === "folder") {
      folders.push(entry.id);
      await walk(entry.id, `${name}/${entry.name}`, depth + 1);
    } else if (entry.type === "file") {
      files.push(entry);
    }
  }
}

try {
  await walk("0", "", 0);
} catch (error) {
  console.error("failed to walk the enterprise root:", error);
  process.exit(1);
}

const empty = files.filter((f) => !f.size);
console.log("\n=== summary ===");
console.log(`folders scanned : ${folders.length}`);
console.log(`files found     : ${files.length}`);
console.log(`zero-byte files : ${empty.length}`);
console.log("\nsample files (id, name, size):");
for (const f of files.slice(0, 15)) {
  console.log(`  ${f.id}  ${f.name}  ${f.size ?? 0} bytes`);
}
if (files.length === 0 || empty.length === files.length) {
  console.error("\nFAIL: no files with content found");
  process.exit(1);
}
console.log("\nPASS: box credentials can access stored documents with content");
