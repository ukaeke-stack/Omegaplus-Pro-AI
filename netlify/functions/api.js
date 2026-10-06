import serverless from "serverless-http";

// server.js already contains the Vercel-safe listener guard. Set the same
// runtime flag before importing it so Netlify does not open a local port.
process.env.VERCEL = process.env.VERCEL || "1";

const { default: app } = await import("../../server.js");

export const handler = serverless(app);
