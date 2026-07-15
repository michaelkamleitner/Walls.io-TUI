/*
 * Default layout — responsive masonry grid.
 *
 * Pipeline: wall-client.js → sorted Post[] → render to <div id="feed"> →
 * masonry-layout positions the cards into columns → imagesLoaded re-runs
 * layout() once each post image has known dimensions.
 *
 * Column count is purely CSS-driven (see styles.css → .grid-sizer media
 * queries). Masonry reads the sizer width on every layout(), so resizing
 * the window reflows automatically — no breakpoint logic in JS.
 */
(() => {
  const $feed = document.getElementById('feed');

  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Human-readable "5 minutes ago" formatting comes from the client so
  // every layout uses the same rules (see CUSTOMIZE.md → Timestamps).
  const relativeTime = createWallClient.relativeTime;

  // ---- Masonry instance --------------------------------------------------
  // One long-lived instance; we re-feed it items on every `change`.
  const masonry = new Masonry($feed, {
    itemSelector:    '.grid-item',
    columnWidth:     '.grid-sizer',
    gutter:          16,
    percentPosition: true,
    transitionDuration: 0,   // snap; the wall updates frequently
    initLayout:      false,
  });

  // Re-layout when any image finishes loading (or fails). Without this,
  // masonry positions cards based on their initial (zero-height) image
  // boxes and they overlap once images arrive.
  function relayoutOnImages() {
    imagesLoaded($feed).on('progress', () => masonry.layout());
  }

  // CTA parsing + URL safety live in wall-client.js — see CUSTOMIZE.md.
  function renderCta(post) {
    const cta = client.parseCta(post);
    if (!cta) return '';
    return `<a class="cta-button" href="${escapeHtml(cta.link)}" target="_blank" rel="noopener">${escapeHtml(cta.label)}</a>`;
  }

  function renderPost(post) {
    const card = document.createElement('div');
    card.className = 'grid-item';
    card.dataset.id = post.id;
    if (post.is_pinned) card.classList.add('pinned');

    const ts    = post.external_created || Date.now();
    const tsAbs = new Date(ts).toLocaleString();
    const tsRel = relativeTime(ts);
    const tsAttrs = `data-iso="${escapeHtml(new Date(ts).toISOString())}" title="${escapeHtml(tsAbs)}"`;
    const postLink = client.safeUrl(post.post_link);
    const tsHtml = postLink
      ? `<a class="timestamp" href="${escapeHtml(postLink)}" target="_blank" rel="noopener" ${tsAttrs}>${escapeHtml(tsRel)}</a>`
      : `<span class="timestamp" ${tsAttrs}>${escapeHtml(tsRel)}</span>`;

    const authorName = post.external_fullname || post.external_name || '';
    const avatarUrl  = post.external_image || post.external_image_unique_id
      ? client.imageUrl(post, { field: 'external_image', w: 80, h: 80 })
      : '';
    const avatarInner = avatarUrl
      ? `<img class="avatar" loading="lazy" decoding="async" alt="" src="${escapeHtml(avatarUrl)}">`
      : `<span class="avatar avatar--placeholder" aria-hidden="true">${escapeHtml((authorName[0] || '?').toUpperCase())}</span>`;
    const userLink = client.safeUrl(post.external_user_link);
    const avatarHtml = userLink
      ? `<a class="avatar-link" href="${escapeHtml(userLink)}" target="_blank" rel="noopener" aria-label="${escapeHtml(authorName)}">${avatarInner}</a>`
      : avatarInner;
    const nameHtml = userLink
      ? `<a class="author" href="${escapeHtml(userLink)}" target="_blank" rel="noopener">${escapeHtml(authorName)}</a>`
      : `<span class="author">${escapeHtml(authorName)}</span>`;

    card.innerHTML = `
      <div class="meta">
        ${avatarHtml}
        <div class="meta-text">
          ${nameHtml}
          <div class="meta-sub">
            <span class="type">${escapeHtml(post.type)}${post.sub_type ? ' · ' + escapeHtml(post.sub_type) : ''}</span>
            · ${tsHtml}
          </div>
        </div>
      </div>
      <div class="comment">${createWallClient.truncateComment(post.html_comment || post.comment || '', postLink)}</div>
      ${post.post_image
        ? `<div><img class="checkin-image" loading="lazy" decoding="async" alt="${escapeHtml(post.post_image_alt_text || '')}" src="${escapeHtml(client.imageUrl(post, { w: 600 }))}"></div>`
        : ''}
      ${renderCta(post)}
    `;
    return card;
  }

  // Map of post id → { el, html } where `html` is the rendered outerHTML
  // we last committed for this card. Diff-by-output means we don't have to
  // maintain an allowlist of fields that affect rendering — any change in
  // renderPost()'s template is automatically picked up — and we still skip
  // the DOM swap (and image flash + masonry reflow) when nothing changed.
  const cards = new Map();

  function render(posts) {
    const wantedIds = new Set(posts.map(p => String(p.id)));

    // 1. Remove cards that no longer appear in the sorted list.
    for (const [id, entry] of cards) {
      if (!wantedIds.has(id)) {
        entry.el.remove();
        cards.delete(id);
      }
    }

    // 2. Insert new cards, rebuild changed ones, and move them into the
    //    correct order. The .grid-sizer must stay first; use it as the
    //    moving anchor.
    let prev = $feed.querySelector('.grid-sizer');
    for (const post of posts) {
      const id    = String(post.id);
      const fresh = renderPost(post);
      const html  = fresh.outerHTML;
      let entry = cards.get(id);
      if (!entry) {
        entry = { el: fresh, html };
        cards.set(id, entry);
      } else if (entry.html !== html) {
        entry.el.replaceWith(fresh);
        entry.el   = fresh;
        entry.html = html;
      }
      const el = entry.el;
      if (el.previousElementSibling !== prev) {
        prev.after(el);
      }
      prev = el;
    }

    masonry.reloadItems();
    masonry.layout();
    relayoutOnImages();
  }

  // Refresh relative timestamps every 30s so "Just now" rolls over to
  // "1 minute ago" without needing a new server message.
  setInterval(() => {
    for (const el of $feed.querySelectorAll('.timestamp[data-iso]')) {
      el.textContent = relativeTime(el.dataset.iso);
    }
  }, 30_000);

  // ---- Wire up to the data client ----------------------------------------
  // Wall config lives here so a layout can target a different wall just by
  // editing this file. `?id=<wallId>` in the URL overrides the default at
  // load time, which is handy for previewing other walls without editing.
  const DEFAULT_WALL_ID = 186670;
  const wallId = Number(new URLSearchParams(location.search).get('id'))
              || DEFAULT_WALL_ID;
  const client = window.createWallClient({
    wallId,
    rankField: 'weight',  // matches wallOptions.rankingMode
  });
  client.on('change', render);
  client.start();

  // ---- Infinite scroll --------------------------------------------------
  // Watch a 1 px sentinel below the feed. When it scrolls within 600 px of
  // the viewport, ask the client for the next page (30) of older posts.
  // The client's in-flight guard suppresses duplicate requests, and the
  // sentinel observer is disconnected once history is exhausted. Slideshow
  // / single-post layouts must NOT wire this up — see CUSTOMIZE.md.
  const $sentinel = document.getElementById('feed-sentinel');
  const $status   = document.getElementById('feed-status');
  const setStatus = (text) => { if ($status) $status.textContent = text; };

  if ($sentinel && 'IntersectionObserver' in window) {
    // While a page is in flight we *unobserve* the sentinel: short feeds
    // would otherwise sit permanently inside the 600 px root-margin and
    // burst-request pages until exhaustion. After each page we re-observe
    // on the next frame, which lets the new cards extend the document and
    // push the sentinel back out of view before the next intersection
    // check fires.
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        if (!client.canLoadOlder) continue;
        io.unobserve($sentinel);
        // `loadOlder` returns false when there's no cursor yet (the
        // broadcaster's initial snapshot hasn't arrived). In that case
        // we never emitted, so `older-loaded` will never re-observe;
        // hook the next `change` event to retry, then bail.
        if (!client.loadOlder(30)) {
          let off;
          const onChange = () => { off?.(); io.observe($sentinel); };
          off = client.on('change', onChange);
          return;
        }
        setStatus('Loading older posts…');
      }
    }, { rootMargin: '600px 0px' });
    io.observe($sentinel);

    client.on('older-loaded', ({ exhausted }) => {
      if (exhausted) {
        setStatus('End of feed.');
        io.disconnect();
        return;
      }
      setStatus('');
      requestAnimationFrame(() => io.observe($sentinel));
    });
  }

  // Expose for DevTools poking.
  window._wall = client;
  window._masonry = masonry;
})();
