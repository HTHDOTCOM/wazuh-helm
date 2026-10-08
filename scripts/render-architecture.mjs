#!/usr/bin/env node
// Render the editable Mermaid sources, then build a self-contained HTML and PDF.
// Dependencies live outside the checkout; see docs/architecture-printing.md.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modules = process.env.DOCS_NODE_MODULES;
if (!modules || !path.isAbsolute(modules)) {
  throw new Error('Set DOCS_NODE_MODULES to the absolute temporary node_modules path.');
}
const { default: puppeteer } = await import(pathToFileURL(path.join(modules, 'puppeteer-core/lib/esm/puppeteer/puppeteer-core.js')));
const sources = path.join(root, 'docs/diagrams/architecture');
const assets = path.join(root, 'docs/assets/architecture');
await fs.mkdir(assets, { recursive: true });

const server = http.createServer(async (request, response) => {
  try {
    if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html><body></body></html>');
      return;
    }
    const target = path.resolve(modules, '.' + decodeURIComponent(request.url.split('?')[0]));
    if (!target.startsWith(path.resolve(modules) + path.sep)) {
      response.writeHead(403).end();
      return;
    }
    response.setHeader('Content-Type', target.endsWith('.mjs') || target.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    response.end(await fs.readFile(target));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await puppeteer.launch({
    executablePath: process.env.DOCS_CHROMIUM || '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    headless: true,
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 1000 });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async () => {
    const { default: mermaid } = await import('/mermaid/dist/mermaid.esm.mjs');
    window.mermaid = mermaid;
    mermaid.initialize({
      startOnLoad: false, securityLevel: 'strict', theme: 'base', htmlLabels: false,
      fontFamily: 'Arial, Helvetica, sans-serif',
      themeVariables: {
        background: '#ffffff', primaryColor: '#ffffff', primaryTextColor: '#111827',
        primaryBorderColor: '#374151', secondaryColor: '#ffffff', tertiaryColor: '#ffffff',
        lineColor: '#374151', textColor: '#111827', mainBkg: '#ffffff',
        clusterBkg: '#ffffff', clusterBorder: '#64748b', edgeLabelBackground: '#ffffff',
        actorBkg: '#ffffff', actorBorder: '#374151', actorTextColor: '#111827',
        actorLineColor: '#64748b', signalColor: '#374151', signalTextColor: '#111827',
        labelBoxBkgColor: '#ffffff', labelBoxBorderColor: '#374151',
        labelTextColor: '#111827', noteBkgColor: '#ffffff', noteTextColor: '#111827',
        fontSize: '18px',
      },
      flowchart: { htmlLabels: false, curve: 'linear', padding: 16, nodeSpacing: 25, rankSpacing: 38, wrappingWidth: 190 },
      sequence: { useMaxWidth: true, wrap: true, width: 130, actorFontSize: 16, messageFontSize: 16, noteFontSize: 16 },
    });
  });
  for (const filename of (await fs.readdir(sources)).filter(name => name.endsWith('.mmd')).sort()) {
    const source = await fs.readFile(path.join(sources, filename), 'utf8');
    const svg = await page.evaluate(async ({ text, id }) => {
      document.body.replaceChildren();
      const { svg } = await window.mermaid.render(id, text);
      const container = document.createElement('div');
      container.innerHTML = svg;
      const node = container.querySelector('svg');
      if (!node || node.querySelector('foreignObject')) throw new Error('Expected a native SVG diagram');
      for (const label of node.querySelectorAll('.edgeLabel rect.background')) {
        label.setAttribute('style', 'fill: #ffffff; opacity: 1;');
      }
      const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      const [x, y, width, height] = node.getAttribute('viewBox').split(/\s+/);
      background.setAttribute('x', x);
      background.setAttribute('y', y);
      background.setAttribute('width', width);
      background.setAttribute('height', height);
      background.setAttribute('fill', '#ffffff');
      node.insertBefore(background, node.firstChild);
      node.setAttribute('style', 'background: #ffffff;');
      node.setAttribute('role', 'img');
      return new XMLSerializer().serializeToString(node);
    }, { text: source, id: 'wazuh-diagram-' + filename.replace('.mmd', '') });
    await fs.writeFile(path.join(assets, filename.replace('.mmd', '.svg')), svg + '\n');
    console.log(`Rendered ${filename}`);
  }

  const result = spawnSync('pandoc', ['--from=gfm', '--to=html5', 'docs/architecture.md'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'Pandoc failed');
  let content = result.stdout;
  for (const image of [...content.matchAll(/<img src="(assets\/architecture\/[^"<>]+\.svg)"[^>]*>/g)]) {
    const svg = await fs.readFile(path.join(root, 'docs', image[1]), 'utf8');
    const embedded = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
    content = content.replace(image[0], image[0].replace(image[1], embedded));
  }
  if (/<img src="(?!data:image\/svg\+xml;base64,)/.test(content)) throw new Error('Unexpected image: HTML must embed every diagram.');
  content = content.replace(/href="(?!https?:|#)([^"<>]+)"/g, (_, target) => {
    const relative = path.posix.normalize(path.posix.join('docs', target));
    return `href="https://github.com/HTHDOTCOM/wazuh-helm/blob/main/${relative}"`;
  });
  const css = await fs.readFile(path.join(root, 'docs/architecture-print.css'), 'utf8');
  const html = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>Wazuh Helm architecture and Wazuh 5 changes</title><style>${css}</style></head><body><main>${content}</main></body></html>\n`;
  await fs.writeFile(path.join(root, 'docs/architecture-print.html'), html);
  const printPage = await browser.newPage();
  await printPage.setContent(html, { waitUntil: 'load' });
  await printPage.evaluate(() => document.fonts.ready);
  await printPage.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
  await printPage.pdf({
    path: path.join(root, 'docs/architecture-print.pdf'),
    preferCSSPageSize: true, printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: '<div style="font:9px Arial;width:100%;text-align:center;color:#475569">Wazuh Helm architecture · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  });
  console.log('Built standalone HTML and A4 PDF');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
