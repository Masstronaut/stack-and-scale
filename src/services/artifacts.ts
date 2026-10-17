import { Context, Effect } from "effect";
import type { ArtifactsError } from "./errors.ts";

export interface ArtifactRef {
  readonly key: string;
  readonly bucket: string;
}

export interface ArtifactsServiceShape {
  /**
   * Store a run artifact under an opaque key (e.g.
   * "artifacts/<contractFileId>/sales-deck.html"). Returns the key and the
   * sink that accepted it; an empty `bucket` means the sink is disabled and
   * the write was skipped.
   */
  readonly putArtifact: (
    key: string,
    content: string | Uint8Array,
    contentType: string,
  ) => Effect.Effect<ArtifactRef, ArtifactsError>;
}

export class ArtifactsService extends Context.Service<ArtifactsService, ArtifactsServiceShape>()(
  "ArtifactsService",
) {}

/**
 * Stub implementation. Real version should PUT to the artifacts S3 bucket
 * (`@aws-sdk/client-s3`) named by `ARTIFACTS_BUCKET`, treating an unset or
 * empty bucket as "artifact sink disabled" (gate-style: skip with a log).
 */
export const ArtifactsServiceStub: ArtifactsServiceShape = {
  putArtifact: (key) => Effect.succeed({ key, bucket: "stub-bucket" }),
};
