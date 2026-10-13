import type { Plugin } from "vite";

/**
 * Fresh's dev server hands every request a stub connection ("localhost"), so
 * the API cannot see who is calling and /payments would go out without a
 * shopperIP. Deployed, Render's proxy sets X-Forwarded-For; this gives the dev
 * server the same header from the socket, unless something in front already
 * set one. Fresh rebuilds the Request from rawHeaders, and Deno's rawHeaders
 * is a getter returning a fresh copy, so a push is lost: it is redefined.
 */
export function devClientAddress(): Plugin {
  return {
    name: "adyen-suite:dev-client-address",
    apply: "serve",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const address = req.socket.remoteAddress;
        if (address && !req.headers["x-forwarded-for"]) {
          Object.defineProperty(req, "rawHeaders", {
            value: [...req.rawHeaders, "X-Forwarded-For", address],
          });
        }
        next();
      });
    },
  };
}
