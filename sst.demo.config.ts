/// <reference path="./.sst/platform/config.d.ts" />

// Separate SST state: main's full-stack workflow cannot remove demo resources.
// This app references the existing HTTP API; it never owns its stage or workers.
export default $config({
  app() {
    return {
      name: "stack-and-scale-renewer-demo",
      home: "aws",
      removal: "retain",
      providers: { aws: { region: "us-west-2" } },
    };
  },
  async run() {
    const api = await aws.apigatewayv2.getApi({ apiId: "qtvfhy7r10" });
    if (
      api.protocolType !== "HTTP" ||
      api.executionArn !== "arn:aws:execute-api:us-west-2:562654496564:qtvfhy7r10"
    )
      throw new Error("Existing API is outside the approved account/region");
    const ledger = new sst.aws.Bucket("DemoSendLedger");
    const demo = new sst.aws.Function("RenewerDemo", {
      handler: "src/functions/demo.handler",
      runtime: "nodejs22.x",
      timeout: "10 seconds",
      memory: "256 MB",
      // Sender is reachable only via IAM-authorized direct invocation, never HTTP.
      environment: { RENEWER_SEND_LEDGER: ledger.name },
      permissions: [
        {
          actions: ["s3:PutObject"],
          resources: [$interpolate`${ledger.arn}/one-reviewed-test.json`],
        },
        {
          actions: ["ses:SendEmail"],
          resources: ["arn:aws:ses:us-west-2:562654496564:identity/fmruslanai@gmail.com"],
          conditions: [
            { test: "StringEquals", variable: "ses:FromAddress", values: ["fmruslanai@gmail.com"] },
            {
              test: "ForAllValues:StringEquals",
              variable: "ses:Recipients",
              values: ["fmruslanai@gmail.com"],
            },
            { test: "Null", variable: "ses:Recipients", values: ["false"] },
          ],
        },
      ],
      copyFiles: [
        { from: "src/renewal/demo-web", to: "demo-web" },
        {
          from: ".renewer-artifacts/demo-portfolio/verified-demo.json",
          to: "demo-data/verified-demo.json",
        },
      ],
    });
    const integration = new aws.apigatewayv2.Integration("DemoIntegration", {
      apiId: api.id,
      integrationType: "AWS_PROXY",
      integrationMethod: "POST",
      integrationUri: demo.arn,
      payloadFormatVersion: "2.0",
      timeoutMilliseconds: 10000,
    });
    for (const [routeKey, name] of [
      ["GET /", "Home"],
      ["GET /app.js", "Script"],
      ["GET /style.css", "Style"],
      ["GET /api/state", "State"],
      ["POST /api/draft", "Draft"],
      ["POST /api/send", "SendDisabled"],
    ] as const) {
      new aws.apigatewayv2.Route(`Demo${name}`, {
        apiId: api.id,
        routeKey,
        target: $interpolate`integrations/${integration.id}`,
      });
    }
    new aws.lambda.Permission("DemoApiInvoke", {
      action: "lambda:InvokeFunction",
      function: demo.name,
      principal: "apigateway.amazonaws.com",
      sourceArn: `${api.executionArn}/*/*`,
    });
    return { demo: api.apiEndpoint, publicSendingEnabled: false };
  },
});
