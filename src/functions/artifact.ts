import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

const s3 = new S3Client({});

// Same gate as the writers: without the bucket there is nothing to share.
const bucketName = (): string => process.env.ARTIFACTS_BUCKET ?? "";

/**
 * Only artifact keys may be shared through presigned URLs. Reject anything
 * that is not an `artifacts/` key and any traversal attempt so the bucket
 * stays private while the dashboard can still link artifacts.
 */
export const validateArtifactKey = (key: string | undefined): string | undefined => {
  if (key === undefined || key === "" || key.includes("..")) return undefined;
  return key.startsWith("artifacts/") ? key : undefined;
};

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const headers = { "content-type": "application/json" };
  const key = validateArtifactKey(event.queryStringParameters?.key);
  if (key === undefined) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "invalid artifact key" }),
    };
  }
  const bucket = bucketName();
  if (bucket === "") {
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: "artifact sink not configured" }),
    };
  }
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: 3600,
  });
  return { statusCode: 200, headers, body: JSON.stringify({ url }) };
};
