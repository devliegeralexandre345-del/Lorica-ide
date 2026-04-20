// src/components/previews/HtmlPreview.jsx
import React, { useMemo, useState, useRef, useEffect } from 'react';
import { RefreshCw, ExternalLink, Monitor, Smartphone, Tablet } from 'lucide-react';

const DEVICE_PRESETS = {
  desktop: { label: 'Desktop', icon: Monitor, width: null,  height: null },
  tablet:  { label: 'Tablet',  icon: Tablet,  width: 768,   height: 1024 },
  mobile:  { label: 'Mobile',  icon: Smartphone, width: 375, height: 667 },
};

export default function HtmlPreview({ file }) {
  const [device, setDevice] = useState('desktop');
  const [refreshKey, setRefreshKey] = useState(0);
  const iframeRef = useRef(null);

  // Rewrite relative paths (src=, href=) to tauri's asset protocol so images,
  // CSS, JS siblings of the HTML file resolve correctly inside the iframe.
  const srcDoc = useMemo(() => {
    if (!file?.content) return '';
    const dir = (file.path || '').replace(/[\\/][^\\/]*$/, '');
    const assetBase = `https://asset.localhost/${encodeURIComponent(dir.replace(/\\/g, '/'))}/`;

    // Inject <base> so relative URLs (./style.css, img.png, etc.) resolve.
    let html = file.content;
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, (m) => `${m}\n<base href="${assetBase}">`);
    } else if (/<html[^>]*>/i.test(html)) {
      html = html.replace(/<html[^>]*>/i, (m) => `${m}\n<head><base href="${assetBase}"></head>`);
    } else {
      html = `<!doctype html><html><head><base href="${assetBase}"></head><body>${html}</body></html>`;
    }
    return html;
  }, [file?.content, file?.path, refreshKey]);

  const preset = DEVICE_PRESETS[device];

  return (
    <div className="h-full w-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-lorica-border bg-lorica-surface/30">
        {Object.entries(DEVICE_PRESETS).map(([id, p]) => {
          const Icon = p.icon;
          return (
            <button
              key={id}
              onClick={() => setDevice(id)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors ${
                device === id
                  ? 'bg-lorica-accent/20 text-lorica-accent'
                  : 'text-lorica-textDim hover:text-lorica-text hover:bg-lorica-panel/50'
              }`}
              title={p.label}
            >
              <Icon size={11} />
              {p.width && <span>{p.width}×{p.height}</span>}
            </button>
          );
        })}
        <div className="flex-1" />
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          className="p-1 text-lorica-textDim hover:text-lorica-text rounded"
          title="Rafraîchir"
        >
          <RefreshCw size={12} />
        </button>
        <button
          onClick={() => {
            const blob = new Blob([srcDoc], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
            // Revoke after the new window has had time to fetch the URL.
            // Without this each "Open in browser" click leaks a Blob.
            setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 60_000);
          }}
          className="p-1 text-lorica-textDim hover:text-lorica-text rounded"
          title="Ouvrir dans le navigateur"
        >
          <ExternalLink size={12} />
        </button>
      </div>

      {/* Iframe */}
      <div
        className="flex-1 overflow-auto flex items-start justify-center p-3"
        style={{ background: 'var(--color-panel)' }}
      >
        {/*
          SECURITY: do NOT set allow-same-origin together with
          allow-scripts. The combo effectively disables the sandbox —
          the iframe could read cookies / localStorage / IndexedDB of
          the Lorica app origin. We keep scripts + forms + popups for
          developer convenience (interactive HTML previews) but the
          frame stays in a null origin so it can't reach Lorica state
          or the vault.
        */}
        <iframe
          ref={iframeRef}
          key={refreshKey}
          srcDoc={srcDoc}
          title={file.name}
          sandbox="allow-scripts allow-forms allow-popups"
          referrerPolicy="no-referrer"
          className="bg-white border border-lorica-border rounded shadow-lg"
          style={{
            width: preset.width ? `${preset.width}px` : '100%',
            height: preset.height ? `${preset.height}px` : '100%',
            maxWidth: '100%',
          }}
        />
      </div>
    </div>
  );
}
