import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
export const TEST_ADDRESS = "fmruslanai@gmail.com";
export interface TestEmail {
  subject: string;
  body: string;
}
export interface SendService {
  sendOnce: (email: TestEmail, customerId: string) => Promise<string>;
}
const digest = (email: TestEmail) =>
  createHash("sha256").update(JSON.stringify(email)).digest("hex");
export function issuePreviewToken(
  key: string,
  portfolioId: string,
  customerId: string,
  email: TestEmail,
  now = Date.now(),
) {
  const data = Buffer.from(
    JSON.stringify({
      portfolioId,
      customerId,
      digest: digest(email),
      expires: now + 15 * 60 * 1000,
      nonce: randomBytes(16).toString("hex"),
    }),
  ).toString("base64url");
  return data + "." + createHmac("sha256", key).update(data).digest("hex");
}
export function verifyPreviewToken(
  token: unknown,
  key: string,
  portfolioId: string,
  customerId: string,
  email: TestEmail,
  now = Date.now(),
) {
  if (typeof token !== "string" || token.length > 2048) return false;
  const [data, signature, ...extra] = token.split(".");
  if (extra.length || !data || !signature || !/^[a-f0-9]{64}$/.test(signature)) return false;
  if (
    !timingSafeEqual(Buffer.from(signature, "hex"), createHmac("sha256", key).update(data).digest())
  )
    return false;
  try {
    const p = JSON.parse(Buffer.from(data, "base64url").toString());
    return (
      p.portfolioId === portfolioId &&
      p.customerId === customerId &&
      p.digest === digest(email) &&
      Number.isFinite(p.expires) &&
      p.expires > now &&
      p.expires <= now + 15 * 60 * 1000
    );
  } catch {
    return false;
  }
}
