// HTTP routes registered by Convex Auth for this deployment.
import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { oauthCallback } from "./meta";
import { handleMcp, handleMcpGet } from "./metaMcp";

const http = httpRouter();

auth.addHttpRoutes(http);

// Meta Login callback; OAuth state one-time binding prevents cross-client mix-ups.
http.route({ path: "/meta/oauth/callback", method: "GET", handler: oauthCallback });
// Remote MCP: credential guarded, disabled unless META_MCP_ENABLED=true.
http.route({ path: "/mcp", method: "POST", handler: handleMcp });
http.route({ path: "/mcp", method: "GET", handler: handleMcpGet });

export default http;
