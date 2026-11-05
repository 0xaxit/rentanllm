/** Public R2 bucket that hosts ral (node agent) builds and the install script. */
export const NODE_RELEASES_URL =
  "https://pub-f673ac09098c4d75afafeea51e907fa0.r2.dev";

/** One-line install for the seller node agent (Linux and macOS, x64 and arm64). */
export const NODE_INSTALL_COMMAND = `curl -fsSL ${NODE_RELEASES_URL}/install.sh | sh`;
