// Crawler-only HTML shell. Normal browsers keep the React SPA untouched.
// The shell mirrors the same title, description, canonical and internal links
// already sent in <head>, so search engines see crawlable content without
// cloaking or a second source of truth.

const BOT_RE =
  /googlebot|google-inspectiontool|bingbot|bingpreview|yandex|duckduckbot|baiduspider|applebot|twitterbot|facebookexternalhit|facebookcatalog|linkedinbot|slackbot|discordbot|whatsapp|telegrambot|pinterest|redditbot|embedly|quora link preview|outbrain|vkshare|skypeuripreview|nuzzel|bitlybot|tumblr|w3c_validator/i;

export function isSeoShellRequest(req) {
  if (process.env.SEO_SHELL_ENABLED === "false") return false;
  if (process.env.SEO_SHELL_DEBUG === "1" && req.query.seo === "1") return true;
  if (process.env.SEO_SHELL_BOTS_ONLY === "false") return true;
  const ua = String(req.get("user-agent") || "");
  if (BOT_RE.test(ua)) return true;
  const host = String(req.hostname || "");
  return req.query.seo === "1" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host);
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHref(value) {
  const href = String(value || "").trim();
  if (!href) return "";
  if (href.startsWith("/") || /^https?:\/\//i.test(href)) return esc(href);
  return "";
}

function link(href, text, className = "") {
  const h = safeHref(href);
  if (!h) return esc(text);
  return `<a${className ? ` class="${esc(className)}"` : ""} href="${h}">${esc(text)}</a>`;
}

function cardList(items) {
  if (!items || !items.length) return "";
  return `<ul class="seo-grid">${items
    .map(
      (item) => `<li class="seo-card">
  ${item.thumbnail ? `<img src="${esc(item.thumbnail)}" alt="${esc(item.title)}" width="320" height="180" loading="lazy" decoding="async">` : ""}
  <h3>${link(item.href, item.title)}</h3>
  ${item.category ? `<p class="seo-meta">${link(`/category/${encodeURIComponent(item.category)}`, item.category)}</p>` : ""}
</li>`,
    )
    .join("")}</ul>`;
}

function categoryList(categories) {
  if (!categories || !categories.length) return "";
  return `<ul class="seo-inline-list">${categories
    .map(
      (category) =>
        `<li>${link(`/category/${encodeURIComponent(category.slug || category.name)}`, category.name)}</li>`,
    )
    .join("")}</ul>`;
}

export function renderSeoShell({
  pageType = "page",
  brand = "HDPORNFORYOU",
  title = "",
  description = "",
  canonical = "",
  status = 200,
  heading = "",
  video = null,
  items = [],
  categories = [],
  tags = [],
  staticTitle = "",
  staticDescription = "",
  page = 1,
  totalPages = 1,
  prev = null,
  next = null,
}) {
  const h1 = heading || staticTitle || title || brand;
  const nav = [
    link("/", "Home"),
    link("/explore", "Explore"),
    link("/trending", "Trending"),
    link("/latest", "Latest"),
    link("/search", "Search"),
  ].join(" ");

  let body = "";
  if (pageType === "watch" && video) {
    body = `<article>
  <h1>${esc(video.title || h1)}</h1>
  <p>${esc(description)}</p>
  ${video.thumbnail ? `<img src="${esc(video.thumbnail)}" alt="${esc(video.title || "")}" width="960" height="540" loading="eager" decoding="async">` : ""}
  <p class="seo-meta">
    ${video.category ? `Category: ${link(`/category/${encodeURIComponent(video.category)}`, video.category)}` : ""}
    ${video.duration ? ` &middot; Duration: ${esc(video.duration)}` : ""}
    ${video.views ? ` &middot; Views: ${esc(video.views)}` : ""}
  </p>
  ${tags.length ? `<p class="seo-meta">Tags: ${tags.map((tag) => link(`/tags/${encodeURIComponent(tag.slug || tag)}`, tag.name || tag)).join(" ")}</p>` : ""}
  <p>${link(canonical, `Watch ${video.title || "this video"} on ${brand}`)}</p>
</article>`;
    if (items.length) body += `<section><h2>Related videos</h2>${cardList(items)}</section>`;
  } else if (pageType === "notfound" || status === 404) {
    body = `<section>
  <h1>${esc(h1)}</h1>
  <p>${esc(description || "The page you requested could not be found.")}</p>
  <p>${link("/", "Go to the homepage")} &middot; ${link("/explore", "Browse categories")} &middot; ${link("/latest", "Latest videos")}</p>
</section>`;
  } else if (pageType === "explore") {
    body = `<section>
  <h1>${esc(h1)}</h1>
  <p>${esc(description)}</p>
  ${categoryList(categories)}
</section>${items.length ? `<section><h2>Videos</h2>${cardList(items)}</section>` : ""}`;
  } else if (pageType === "category" || pageType === "tag" || pageType === "search") {
    body = `<section>
  <h1>${esc(h1)}</h1>
  <p>${esc(description)}</p>
  ${items.length ? cardList(items) : `<p>${link("/explore", "Browse all categories")} or ${link("/latest", "see the latest videos")}.</p>`}
</section>`;
  } else if (pageType === "static" || pageType === "account" || pageType === "setup") {
    body = `<section>
  <h1>${esc(staticTitle || h1)}</h1>
  <p>${esc(staticDescription || description)}</p>
</section>`;
  } else {
    body = `<section>
  <h1>${esc(h1)}</h1>
  <p>${esc(description)}</p>
  ${items.length ? cardList(items) : ""}
  ${categories.length ? `<h2>Categories</h2>${categoryList(categories)}` : ""}
</section>`;
  }

  const pagination =
    page > 1 || next
      ? `<nav class="seo-pagination" aria-label="Pagination">
  ${prev ? link(prev, "Previous page") : ""}
  <span>Page ${esc(page)}${totalPages > 1 ? ` of ${esc(totalPages)}` : ""}</span>
  ${next ? link(next, "Next page") : ""}
</nav>`
      : "";

  return `<div id="seo-shell" data-seo-shell="1">
<style>
#seo-shell{max-width:1100px;margin:0 auto;padding:24px;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#111;background:#fff;line-height:1.5}
#seo-shell a{color:#0b57d0;text-decoration:none}
#seo-shell header{display:flex;flex-wrap:wrap;gap:16px;align-items:center;border-bottom:1px solid #ddd;padding-bottom:12px;margin-bottom:20px}
#seo-shell nav a{margin-right:12px}
#seo-shell .seo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;padding:0;list-style:none}
#seo-shell .seo-card img{width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;border-radius:8px;background:#eee}
#seo-shell .seo-meta{color:#555;font-size:14px}
#seo-shell .seo-inline-list{display:flex;flex-wrap:wrap;gap:8px 16px;padding:0;list-style:none}
#seo-shell .seo-pagination{display:flex;gap:12px;align-items:center;margin-top:20px}
#seo-shell footer{border-top:1px solid #ddd;margin-top:28px;padding-top:12px;font-size:14px;color:#555}
</style>
<header>
  <strong>${link("/", brand)}</strong>
  <nav aria-label="Primary">${nav}</nav>
</header>
<main>${body}</main>
${pagination}
<footer>
  <p>${esc(brand)} &mdash; 18+ only. All videos are embedded via Eporner; no files are hosted. All models are 18+.</p>
  <p>${link("/about", "About")} &middot; ${link("/contact", "Contact")} &middot; ${link("/privacy", "Privacy")} &middot; ${link("/terms", "Terms")} &middot; ${link("/dmca", "DMCA")} &middot; ${link("/2257", "2257")}</p>
</footer>
<script>
  // Once React has mounted, remove the crawler shell so a rendering bot sees
  // the same DOM as a browser. Non-rendering bots keep the shell.
  document.addEventListener("DOMContentLoaded", function () {
    var root = document.getElementById("root");
    var shell = document.getElementById("seo-shell");
    if (!root || !shell) return;
    if (root.childElementCount > 0) { shell.remove(); return; }
    if (window.MutationObserver) {
      var observer = new MutationObserver(function () {
        if (root.childElementCount > 0) { shell.remove(); observer.disconnect(); }
      });
      observer.observe(root, { childList: true });
    }
  });
</script>
</div>`;
}

export function injectSeoShell(html, shell) {
  if (!shell) return html;
  const rootRe = /<div\s+id=["']root["']\s*>\s*<\/div>/i;
  if (rootRe.test(html)) {
    return html.replace(rootRe, `${shell}\n    <div id="root"></div>`);
  }
  const scriptRe = /<script\s+type=["']module["'][^>]*src=["'][^"']*["'][^>]*><\/script>/i;
  if (scriptRe.test(html)) return html.replace(scriptRe, `${shell}\n    $&`);
  return html.replace("</body>", `${shell}\n</body>`);
}
