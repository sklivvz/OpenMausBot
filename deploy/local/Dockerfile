ARG BASE_IMAGE=ghcr.io/milind-soni/openmausbot:latest
FROM ${BASE_IMAGE}
USER root
ARG ENGINES="@anthropic-ai/claude-code @openai/codex"
RUN if [ -n "$ENGINES" ]; then npm install -g $ENGINES; fi
# Grok Build from xAI's own installer, pinned and installed the same way as
# the Cloud image (the Dockerfile's cloud-home target); it signs in from the
# app with a device code into ~/.grok on the data volume. GROK_VERSION= leaves
# it out.
ARG GROK_VERSION=1.0.41
RUN if [ -n "$GROK_VERSION" ]; then \
      mkdir -p /tmp/grok-install \
      && curl -fsSL https://x.ai/cli/install.sh -o /tmp/grok-install/install.sh \
      && HOME=/tmp/grok-install PATH="/tmp/grok-install/.grok/bin:$PATH" bash /tmp/grok-install/install.sh "$GROK_VERSION" \
      && install -m 0755 "$(readlink -f /tmp/grok-install/.grok/bin/grok)" /usr/local/bin/grok \
      && HOME=/tmp/grok-install grok --version | grep -qF "grok $GROK_VERSION " \
      && rm -rf /tmp/grok-install; \
    fi
# Gemini CLI. Stable channel of @google/gemini-cli; the command is `gemini`.
# GEMINI_CLI_VERSION= (empty) leaves it out.
ARG GEMINI_CLI_VERSION=0.64.0
RUN if [ -n "$GEMINI_CLI_VERSION" ]; then \
      HOME=/tmp/omb-build-home npm install -g "@google/gemini-cli@${GEMINI_CLI_VERSION}" \
      && gemini --version | grep -qF "$GEMINI_CLI_VERSION" \
      && rm -rf /tmp/omb-build-home /tmp/node-compile-cache; \
    fi
# Perplexity CLI. Official release binary, checksum checked, installed as `pplx`.
# PPLX_TAG= (empty) leaves it out. Tag is the GitHub release, for example v0.2.3.
COPY install-pplx.sh /tmp/install-pplx.sh
ARG PPLX_TAG=v0.2.3
RUN if [ -n "$PPLX_TAG" ]; then sh /tmp/install-pplx.sh "$PPLX_TAG"; fi \
    && rm -f /tmp/install-pplx.sh
COPY --chmod=0555 attention-scan /usr/local/bin/attention-scan
COPY --chmod=0555 attention-scan-next /usr/local/bin/attention-scan-next
COPY --chmod=0555 task-queue /usr/local/bin/task-queue
COPY --chmod=0555 operations-queue /usr/local/bin/operations-queue
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils python3 python-is-python3 ripgrep \
    && rm -rf /var/lib/apt/lists/*
COPY --chmod=0555 design-export /usr/local/bin/design-export
COPY --chmod=0555 claude-design-mcp.cjs /usr/local/bin/claude-design-mcp
COPY --chmod=0555 claude-with-artifacts /usr/local/bin/claude-with-artifacts
COPY --chmod=0555 work-review-mcp.cjs /usr/local/bin/work-review-mcp
COPY --chmod=0555 marketing-calendar-audit /usr/local/bin/marketing-calendar-audit
COPY --chmod=0555 newsletter-template-preflight /usr/local/bin/newsletter-template-preflight
COPY --chmod=0555 newsletter-template-prepare /usr/local/bin/newsletter-template-prepare
COPY --chmod=0555 slop-detector-mcp.cjs /usr/local/bin/slop-detector-mcp
COPY --chmod=0555 keila-drafts-mcp.cjs /usr/local/bin/keila-drafts-mcp
COPY --chmod=0555 review-packet-mcp.cjs /usr/local/bin/review-packet-mcp
COPY --chmod=0555 execution-tools-mcp.cjs /usr/local/bin/execution-tools-mcp
COPY --chmod=0555 assembled-output-verify /usr/local/bin/assembled-output-verify
USER maus
