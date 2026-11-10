import app from "./app";
import { env } from "./config/env";

const server = app.listen(env.PORT, "0.0.0.0", () => {
  console.log(`SmartCare API running on port ${env.PORT}`);
});

process.on("SIGINT", () => {
  server.close(() => {
    console.log("SmartCare API server stopped.");
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  server.close(() => {
    console.log("SmartCare API server stopped.");
    process.exit(0);
  });
});
