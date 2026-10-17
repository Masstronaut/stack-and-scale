import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { getHealth } from "../lib/health.ts";

export const handler: APIGatewayProxyHandlerV2 = async () => {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(getHealth()),
  };
};
