import type { NextConfig } from "next";

// Exported as static files and published on GitHub Pages. The pages use none of the server
// features (no API routes, middleware or server actions), and OpenAlex is queried directly from
// the user's browser, so plain files are enough.
// Dynamic routes can't be used, so who to show is passed in the query (src/lib/routes.ts).
//
// basePath: GitHub Pages serves the site under the repository name
// (https://<user>.github.io/<repo>/). That prefix is baked in at export time, so the workflow
// passes it in as PAGES_BASE_PATH. It stays empty for local exports.
//
// trailingSlash: export in the shape/index.html form. Static hosting reads a directory's
// index.html, so without this form /shape/ cannot be reached.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: process.env.PAGES_BASE_PATH ?? "",
};

export default nextConfig;
