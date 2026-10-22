#!/usr/bin/env bash
# Install QQbot-MCP locally (no DSH / no service registration).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="${INSTALL_DIR:-/opt/qqbot-mcp}"
BIN_PATH="${BIN_PATH:-/usr/local/bin/qqbot-mcp}"
ENV_FILE="${ENV_FILE:-/etc/qqbot-mcp.env}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"

case "${INSTALL_DIR}" in
  ""|"/"|".") echo "error: refusing unsafe INSTALL_DIR='${INSTALL_DIR}'" >&2; exit 1 ;;
esac
if [[ "${INSTALL_DIR}" != /* || "${BIN_PATH}" != /* || "${ENV_FILE}" != /* ]]; then
  echo "error: INSTALL_DIR, BIN_PATH and ENV_FILE must be absolute paths" >&2
  exit 1
fi

if [[ -z "${NODE_BIN}" ]]; then
  echo "error: node not found in PATH" >&2
  exit 1
fi

NODE_MAJOR="$("${NODE_BIN}" -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 22 )); then
  echo "error: Node.js >= 22 is required (found $("${NODE_BIN}" --version))" >&2
  exit 1
fi

if [[ ! -f "${ROOT}/dist/cli.js" || ! -f "${ROOT}/dist/server.js" ]]; then
  echo "error: dist/cli.js or dist/server.js not found; run 'npm run build' first" >&2
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "error: run with sudo (needs ${INSTALL_DIR}, ${BIN_PATH}, ${ENV_FILE})" >&2
  exit 1
fi

echo "Installing to ${INSTALL_DIR}"
install -d -m 755 "${INSTALL_DIR}"
rm -rf "${INSTALL_DIR}/dist" "${INSTALL_DIR}/docs" "${INSTALL_DIR}/catalog" "${INSTALL_DIR}/examples"
cp -a "${ROOT}/dist" "${INSTALL_DIR}/dist"
cp -a "${ROOT}/docs" "${INSTALL_DIR}/docs"
cp -a "${ROOT}/catalog" "${INSTALL_DIR}/catalog"
cp -a "${ROOT}/examples" "${INSTALL_DIR}/examples"
install -m 644 "${ROOT}/package.json" "${INSTALL_DIR}/package.json"
install -m 644 "${ROOT}/README.md" "${INSTALL_DIR}/README.md"
install -m 644 "${ROOT}/LICENSE" "${INSTALL_DIR}/LICENSE"
install -m 644 "${ROOT}/.env.example" "${INSTALL_DIR}/.env.example"
if [[ -f "${ROOT}/pnpm-lock.yaml" ]]; then
  install -m 644 "${ROOT}/pnpm-lock.yaml" "${INSTALL_DIR}/pnpm-lock.yaml"
fi

echo "Installing production dependencies"
(
  cd "${INSTALL_DIR}"
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install --prod --ignore-scripts --fetch-timeout 180000
  elif command -v npm >/dev/null 2>&1; then
    npm install --omit=dev --ignore-scripts --no-audit --no-fund
  else
    echo "error: neither pnpm nor npm found" >&2
    exit 1
  fi
)

install -d -m 700 /srv/qqbot-files /var/lib/qqbot-mcp/downloads

echo "Writing ${BIN_PATH}"
cat > "${BIN_PATH}.tmp" <<EOF
#!/bin/sh
# Load the 600-permission env file unless the caller opts out.
if [ -z "\${QQBOT_MCP_SKIP_ENV_FILE:-}" ] && [ -r "${ENV_FILE}" ]; then
  set -a
  . "${ENV_FILE}"
  set +a
fi
exec "${NODE_BIN}" "${INSTALL_DIR}/dist/cli.js" "\$@"
EOF
chmod 755 "${BIN_PATH}.tmp"
mv "${BIN_PATH}.tmp" "${BIN_PATH}"

if [[ -f "${ENV_FILE}" ]]; then
  echo "Keeping existing ${ENV_FILE} (not overwritten)"
else
  install -m 600 "${ROOT}/deploy/qqbot-mcp.env.example" "${ENV_FILE}"
  echo "Created ${ENV_FILE} with docs mode; edit it to add credentials."
fi

echo
echo "Installed:"
echo "  binary : ${BIN_PATH}"
echo "  program: ${INSTALL_DIR}"
echo "  env    : ${ENV_FILE} (600)"
echo
echo "Next:"
echo "  sudo editor ${ENV_FILE}"
echo "  # set QQBOT_APP_ID / QQBOT_APP_SECRET / QQBOT_MCP_MODE=read"
echo "  ${BIN_PATH}          # 交互式 CLI"
echo "  ${BIN_PATH} --mcp    # stdio MCP Server，供 Agent 连接"
