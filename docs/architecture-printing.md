# Printing and updating the architecture document

Download [architecture-print.pdf](architecture-print.pdf) for an A4 document,
or download [architecture-print.html](architecture-print.html) and open it in a
browser. The HTML embeds every diagram and its styles, so it works offline.
Both use white backgrounds, dark text and vector diagrams. Browser print
settings should use A4 paper, 100% scale and the document's default margins.

The [Markdown document](architecture.md) displays the same generated SVG images,
which keep a white background in GitHub's dark theme. The runtime architecture
is split into traffic and supporting-resource diagrams to keep it legible.

Edit the Markdown text and the relevant [Mermaid source](diagrams/architecture)
before regenerating. Do not edit generated SVG, HTML or PDF files by hand.
Commit the sources and regenerated artifacts together.

## Regenerate

The renderer needs Node.js, Pandoc and Chromium. Install its JavaScript packages
in a temporary directory, keeping chart dependencies unchanged:

```bash
cd /workspace/wazuh-helm
docs_tools=$(mktemp -d /tmp/wazuh-docs.XXXXXX)
npm install --prefix "$docs_tools" --ignore-scripts --no-audit --no-fund \
  mermaid@11.12.0 puppeteer-core@24.24.1
DOCS_NODE_MODULES="$docs_tools/node_modules" \
  DOCS_CHROMIUM=/usr/bin/chromium node scripts/render-architecture.mjs
git diff --check
```

Adjust the checkout and Chromium paths for another machine. Chromium runs
headlessly with its sandbox disabled for the Codex container; render only these
trusted repository sources. The module server listens on loopback and shuts
down when rendering finishes. Nothing is fetched from a CDN while rendering.

Review the generated PDF for readable labels, unclipped diagrams and sensible
page breaks before publishing. The PDF covers the whole architecture document,
including the Wazuh 5 RC comparison and remaining implementation work.
