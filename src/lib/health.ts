export interface HealthStatus {
  status: "ok";
  service: string;
  stage: string;
  timestamp: string;
}

export function getHealth(): HealthStatus {
  return {
    status: "ok",
    service: "stack-and-scale",
    stage: process.env.SST_STAGE ?? "local",
    timestamp: new Date().toISOString(),
  };
}
