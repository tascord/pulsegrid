import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

function copyStaticStyles(targetDoc: Document) {
  // Clone bundler-injected <style> tags and stylesheet <link>s so Tailwind /
  // component CSS applies in the detached window. Tag clones with a marker so
  // re-syncs don't duplicate them.
  const targetHead = targetDoc.head;
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
    if (node.hasAttribute('data-popout-cloned')) return;
    // Skip the live theme/custom css nodes — those are synced separately by id.
    if (node instanceof HTMLStyleElement && (node.id === 'pg-theme-css' || node.id === 'pg-custom-css')) return;
    const clone = node.cloneNode(true) as HTMLElement;
    clone.setAttribute('data-popout-cloned', 'true');
    targetHead.appendChild(clone);
  });

  // Live theme + custom CSS overlays: mirror by id so updates propagate.
  for (const id of ['pg-theme-css', 'pg-custom-css']) {
    const src = document.getElementById(id) as HTMLStyleElement | null;
    if (!src) continue;
    let dest = targetDoc.getElementById(id) as HTMLStyleElement | null;
    if (!dest) {
      dest = targetDoc.createElement('style');
      dest.id = id;
      targetHead.appendChild(dest);
    }
    if (dest.textContent !== src.textContent) dest.textContent = src.textContent || '';
  }

  // Google-font <link>s added at runtime carry data-font.
  document.querySelectorAll('link[data-font]').forEach((node) => {
    const link = node as HTMLLinkElement;
    if (targetDoc.querySelector(`link[data-font="${link.dataset.font}"]`)) return;
    const clone = link.cloneNode(true) as HTMLElement;
    clone.setAttribute('data-popout-cloned', 'true');
    targetHead.appendChild(clone);
  });
}

function syncRootVars(targetDoc: Document) {
  const src = document.documentElement;
  const dest = targetDoc.documentElement;
  dest.style.cssText = src.style.cssText;
  if (src.dataset.theme) dest.dataset.theme = src.dataset.theme;
  if (src.dataset.fx) dest.dataset.fx = src.dataset.fx;
  dest.style.colorScheme = src.style.colorScheme;
}

interface InspectorPopoutWindowProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Opens a detached browser window and portals `children` into it. The main
 * window keeps all audio/state singletons, so the popout is a live view —
 * closing either side docks back inline via `onClose`.
 */
export const InspectorPopoutWindow: React.FC<InspectorPopoutWindowProps> = ({
  title,
  onClose,
  children,
}) => {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const winRef = useRef<Window | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const win = window.open('', 'pulsegrid-inspector', 'width=980,height=760,menubar=no,toolbar=no,location=no');
    if (!win) {
      onCloseRef.current();
      return;
    }
    winRef.current = win;

    win.document.title = title;
    // Base layout so the portal fills the window and matches the app theme.
    const style = win.document.createElement('style');
    style.setAttribute('data-popout-cloned', 'true');
    style.textContent = `
      html, body { height: 100%; margin: 0; }
      body { background: var(--pg-bg, #111519); color: var(--pg-text, #e8edf0);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
      #popout-root { height: 100vh; width: 100vw; display: flex; flex-direction: column; }
    `;
    win.document.head.appendChild(style);
    copyStaticStyles(win.document);
    syncRootVars(win.document);

    const root = win.document.createElement('div');
    root.id = 'popout-root';
    win.document.body.appendChild(root);
    setContainer(root);

    // Keep CSS vars / theme overlays in sync when the main window theme changes.
    const observer = new MutationObserver(() => {
      if (winRef.current && !winRef.current.closed) {
        syncRootVars(winRef.current.document);
        copyStaticStyles(winRef.current.document);
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'data-theme', 'data-fx'],
    });
    const themeCss = document.getElementById('pg-theme-css');
    const customCss = document.getElementById('pg-custom-css');
    if (themeCss) observer.observe(themeCss, { characterData: true, childList: true, subtree: true });
    if (customCss) observer.observe(customCss, { characterData: true, childList: true, subtree: true });

    const poll = window.setInterval(() => {
      if (win.closed) {
        window.clearInterval(poll);
        onCloseRef.current();
      }
    }, 400);
    const handleBeforeUnload = () => onCloseRef.current();
    win.addEventListener('beforeunload', handleBeforeUnload);

    // Focus the new window (may be blocked by the browser — harmless).
    try {
      win.focus();
    } catch {}

    return () => {
      window.clearInterval(poll);
      observer.disconnect();
      try {
        win.removeEventListener('beforeunload', handleBeforeUnload);
      } catch {}
      setContainer(null);
      if (!win.closed) win.close();
      winRef.current = null;
    };
    // Open once per mount; title updates separately below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (winRef.current && !winRef.current.closed) {
      winRef.current.document.title = title;
      syncRootVars(winRef.current.document);
    }
  }, [title]);

  if (!container) return null;
  return createPortal(children, container);
};
