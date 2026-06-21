import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import mermaid from "mermaid";

mermaid.initialize({ startOnLoad: false, theme: "neutral" });

const md = new MarkdownIt({ html: false, linkify: true, breaks: false }).use(anchor as any);

const defaultFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]!;
  if (token.info?.trim() === "mermaid") {
    const id = `m-${Math.random().toString(36).slice(2)}`;
    return `<div class="mermaid-block" data-id="${id}">${escapeHtml(token.content)}</div>`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export function renderMarkdown(body: string): string {
  return md.render(stripFrontMatter(body));
}

export function stripFrontMatter(body: string): string {
  return body.replace(/^---\n[\s\S]*?\n---\n/, "");
}

export async function postRenderMermaid(root: HTMLElement): Promise<void> {
  const nodes = root.querySelectorAll<HTMLDivElement>(".mermaid-block");
  for (const n of Array.from(nodes)) {
    const id = n.dataset.id!;
    try {
      const { svg } = await mermaid.render(id, n.textContent ?? "");
      n.innerHTML = svg;
    } catch (e: any) {
      n.innerHTML = `<pre style="color: var(--bad)">mermaid: ${escapeHtml(String(e?.message ?? e))}</pre>`;
    }
  }
}
