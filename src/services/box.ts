import { Context, Effect } from "effect";
import type { BoxError } from "./errors.ts";

export interface FileRef {
  readonly id: string;
  readonly name: string;
}

export interface BoxServiceShape {
  /** All documents currently stored in box. */
  readonly listAllFiles: () => Effect.Effect<readonly FileRef[], BoxError>;

  /** Plain-text extraction of a stored document (LLM-ready). */
  readonly getFileText: (fileId: string) => Effect.Effect<string, BoxError>;

  /** Merge key/value metadata into a file's existing box metadata. */
  readonly updateFileMetadata: (
    fileId: string,
    metadata: Readonly<Record<string, string>>,
  ) => Effect.Effect<void, BoxError>;

  /** Store a new text document in box and return its id. */
  readonly uploadFile: (
    name: string,
    content: string,
  ) => Effect.Effect<{ readonly fileId: string }, BoxError>;
}

export class BoxService extends Context.Service<BoxService, BoxServiceShape>()("BoxService") {}

/**
 * Stub implementation. Real version should build on the authenticated Box
 * client in `src/lib/box.ts` (CCG auth already works there):
 * - listAllFiles: paginate `files.search` or folder listings
 * - getFileText: download + extract text (pdf/docx parsing, box "text
 *   representations" API)
 * - updateFileMetadata: box metadata templates (create a "contractInfo"
 *   template, then set `expirationDate` etc.)
 * - uploadFile: `client.uploads` with the "sales outputs" folder id from
 *   configuration
 */
export const BoxServiceStub: BoxServiceShape = {
  listAllFiles: () => Effect.succeed([]),
  getFileText: () => Effect.succeed(""),
  updateFileMetadata: () => Effect.void,
  uploadFile: () => Effect.succeed({ fileId: "stub-file-id" }),
};
