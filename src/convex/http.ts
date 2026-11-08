// HTTP routes registered by Convex Auth for this deployment.
import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { oauthCallback } from "./meta";

const http = httpRouter();

auth.addHttpRoutes(http);

// Meta Login callback; OAuth state one-time binding prevents cross-client mix-ups.
http.route({ path: "/meta/oauth/callback", method: "GET", handler: oauthCallback });

export default http;
