import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Effect } from "effect";
import type { ArtifactRef, ArtifactsServiceShape } from "./artifacts.ts";
import { ArtifactsError } from "./errors.ts";

const s3 = new S3Client({});

// Gate-style like the box write gate: with no bucket configured the artifact
// sink is disabled and writes are logged + skipped instead of attempted.
const bucketName = (): string => process.env.ARTIFACTS_BUCKET ?? "";

export const ArtifactsServiceLive: ArtifactsServiceShape = {
  putArtifact: (key, content, contentType) =>
    Effect.suspend(() => {
      const bucket = bucketName();
      if (bucket === "") {
        console.log(`artifacts sink disabled (ARTIFACTS_BUCKET unset), skipping ${key}`);
        return Effect.succeed<ArtifactRef>({ key, bucket: "" });
      }
      return Effect.tryPromise({
        try: async () => {
          await s3.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: key,
              Body: content,
              ContentType: contentType,
            }),
          );
          return { key, bucket } satisfies ArtifactRef;
        },
        catch: (cause) => new ArtifactsError({ cause }),
      });
    }),

  getArtifact: (key) =>
    Effect.suspend(() => {
      const bucket = bucketName();
      if (bucket === "") {
        return Effect.fail(
          new ArtifactsError({
            cause: new Error(`ARTIFACTS_BUCKET is not set, cannot read ${key}`),
          }),
        );
      }
      return Effect.tryPromise({
        try: async () => {
          const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
          const body = await response.Body?.transformToString();
          if (body === undefined) throw new Error(`artifact ${key} returned no body`);
          return body;
        },
        catch: (cause) => new ArtifactsError({ cause }),
      });
    }),
};
