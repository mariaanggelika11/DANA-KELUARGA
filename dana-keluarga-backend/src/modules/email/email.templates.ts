const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
const URL_PATTERN = /https?:\/\/\S+/g;

// Bodies are the same plain-text messages shown in the in-app inbox; the first link becomes a button.
export function renderEmail(subject: string, body: string) {
  const link = body.match(URL_PATTERN)?.[0];
  const text = body
    .replace(URL_PATTERN, "")
    .replace(/\s+/g, " ")
    .replace(/[\s:.]+$/, ".")
    .trim();
  const button = link
    ? `<p style="margin:24px 0 0"><a href="${escapeHtml(link)}" style="background:#0f766e;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">Buka Dana Keluarga</a></p>`
    : "";
  const html = `<!doctype html><html lang="id"><body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,sans-serif;color:#18181b">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px">
<h1 style="font-size:18px;margin:0 0 16px">${escapeHtml(subject)}</h1>
<p style="font-size:15px;line-height:1.6;margin:0">${escapeHtml(text)}</p>${button}
<p style="font-size:12px;color:#71717a;margin:24px 0 0">Email ini dikirim otomatis oleh Dana Keluarga.</p>
</div></body></html>`;
  return { html, text: body };
}
