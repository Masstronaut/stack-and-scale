import { BoxApiError, type BoxClient, type MetadataFull } from "box-node-sdk";
import { readByteStream, stringToByteStream } from "box-node-sdk/internal";
import { Effect } from "effect";
import { createBoxClient } from "../lib/box.ts";
import type { BoxServiceShape, FileRef } from "./box.ts";
import { BoxError } from "./errors.ts";

const FOLDER_PAGE_LIMIT = 1000;
const METADATA_SCOPE = "global";
const METADATA_TEMPLATE = "properties";
const TEXT_REPRESENTATION_HINT = "[extracted_text]";
const REPRESENTATION_POLLS = 10;
const REPRESENTATION_POLL_MS = 1_000;

// Reuse one authenticated client per lambda invocation container.
let clientPromise: Promise<BoxClient> | undefined;
const getClient = (): Promise<BoxClient> => (clientPromise ??= createBoxClient());

const rootFolderId = () => process.env.BOX_ROOT_FOLDER_ID ?? "0";

// Generated outputs (e.g. sales notes) land in their own folder when one is
// configured, defaulting to the scan root.
const outputFolderId = () =>
  process.env.BOX_OUTPUT_FOLDER_ID ?? process.env.BOX_ROOT_FOLDER_ID ?? "0";

const attempt = <A>(run: () => Promise<A>): Effect.Effect<A, BoxError> =>
  Effect.tryPromise({ try: run, catch: (cause) => new BoxError({ cause }) });

const isNotFound = (error: unknown): boolean =>
  error instanceof BoxApiError && error.responseInfo.statusCode === 404;

const toProperties = (instance: MetadataFull): Record<string, string> => {
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(instance.extraData ?? {})) {
    if (!key.startsWith("$") && typeof value === "string") data[key] = value;
  }
  return data;
};

const isPlainTextField = (name: string): boolean => /\.(txt|md|csv)$/i.test(name);

/**
 * Fetch the extracted-text representation for binary documents (pdf, docx,
 * ...). Polls until Box finishes generating it; returns undefined when the
 * representation is unavailable so callers can fall back to a raw download.
 */
const readExtractedText = async (
  client: BoxClient,
  fileId: string,
): Promise<string | undefined> => {
  for (let poll = 0; poll < REPRESENTATION_POLLS; poll++) {
    const file = await client.files.getFileById(fileId, {
      queryParams: { fields: ["representations"] },
      headers: { xRepHints: TEXT_REPRESENTATION_HINT },
    });
    const representation = file.representations?.entries?.find(
      (entry) => entry.representation === "extracted_text",
    );
    const state = representation?.status?.state;
    if (state === "error") return undefined;
    if (state === "success" || state === "viewable") {
      const url = representation?.properties?.url;
      const token = await client.auth.retrieveToken();
      if (!url || !token.accessToken) return undefined;
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${token.accessToken}` },
      });
      return response.ok ? await response.text() : undefined;
    }
    await new Promise((resolve) => setTimeout(resolve, REPRESENTATION_POLL_MS));
  }
  return undefined;
};

const downloadText = async (client: BoxClient, fileId: string): Promise<string> => {
  const stream = await client.downloads.downloadFile(fileId);
  if (!stream) throw new Error(`box returned no download stream for file ${fileId}`);
  return (await readByteStream(stream)).toString("utf8");
};

export const BoxServiceLive: BoxServiceShape = {
  listAllFiles: () =>
    attempt(async () => {
      const client = await getClient();
      const files: FileRef[] = [];
      let folderIds = [rootFolderId()];
      while (folderIds.length > 0) {
        const level = folderIds;
        folderIds = [];
        for (const folderId of level) {
          for (let offset = 0; ; offset += FOLDER_PAGE_LIMIT) {
            const page = await client.folders.getFolderItems(folderId, {
              queryParams: { limit: FOLDER_PAGE_LIMIT, offset },
            });
            for (const entry of page.entries ?? []) {
              if (entry.type === "file" && entry.id) {
                files.push({ id: entry.id, name: entry.name ?? "" });
              } else if (entry.type === "folder" && entry.id) {
                folderIds.push(entry.id);
              }
            }
            if ((page.entries?.length ?? 0) < FOLDER_PAGE_LIMIT) break;
          }
        }
      }
      return files;
    }),

  getFileText: (fileId) =>
    attempt(async () => {
      const client = await getClient();
      const file = await client.files.getFileById(fileId, { queryParams: { fields: ["name"] } });
      if (isPlainTextField(file.name ?? "")) return downloadText(client, fileId);
      try {
        const text = await readExtractedText(client, fileId);
        if (text !== undefined) return text;
      } catch {
        // fall back to a raw download when representations are unavailable
      }
      return downloadText(client, fileId);
    }),

  getFileMetadata: (fileId) =>
    attempt(async () => {
      const client = await getClient();
      try {
        return toProperties(
          await client.fileMetadata.getFileMetadataById(fileId, METADATA_SCOPE, METADATA_TEMPLATE),
        );
      } catch (error) {
        if (isNotFound(error)) return {};
        throw error;
      }
    }),

  updateFileMetadata: (fileId, metadata) =>
    attempt(async () => {
      const client = await getClient();
      let current: Record<string, string> = {};
      let instanceExists = true;
      try {
        current = toProperties(
          await client.fileMetadata.getFileMetadataById(fileId, METADATA_SCOPE, METADATA_TEMPLATE),
        );
      } catch (error) {
        if (!isNotFound(error)) throw error;
        instanceExists = false;
      }
      const changes = Object.entries(metadata).filter(([key, value]) => current[key] !== value);
      if (changes.length === 0) return;
      if (!instanceExists) {
        await client.fileMetadata.createFileMetadataById(
          fileId,
          METADATA_SCOPE,
          METADATA_TEMPLATE,
          Object.fromEntries(changes),
        );
        return;
      }
      await client.fileMetadata.updateFileMetadataById(
        fileId,
        METADATA_SCOPE,
        METADATA_TEMPLATE,
        changes.map(([key, value]) => ({
          op: key in current ? "replace" : "add",
          path: `/${key}`,
          value,
        })),
      );
    }),

  uploadFile: (name, content) =>
    attempt(async () => {
      const client = await getClient();
      const files = await client.uploads.uploadFile({
        attributes: { name, parent: { id: outputFolderId() } },
        file: stringToByteStream(content),
      });
      const fileId = files.entries?.[0]?.id;
      if (!fileId) throw new Error(`box upload of ${name} returned no file id`);
      return { fileId };
    }),
};
