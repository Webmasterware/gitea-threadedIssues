(() => {
  // --- Guards --------------------------------------------------------------
  const isIssueLikePage = () => /\/[^\/]+\/[^\/]+\/issues\/\d+/.test(location.pathname);
  if (!isIssueLikePage()) return;

  const boot = () => {
    if (document.getElementById("threaded-issues-controls")) return;

    const timeline = findTimelineContainer();
    if (!timeline) return;

    initThreading(timeline);
  };

  // Observe timeline for changes
  const mo = new MutationObserver(() => boot());
  const observeTarget = document.querySelector(".ui.timeline") || document.documentElement;
  mo.observe(observeTarget, { childList: true, subtree: true });
  boot();

  // --- Helpers -------------------------------------------------------------
  function findTimelineContainer() {
    const anyItem = document.querySelector(".timeline-item.comment[id^='issuecomment-'], .timeline-item.event[id^='issuecomment-']");
    if (!anyItem) return null;

    let el = anyItem.parentElement;
    for (let i = 0; i < 6 && el; i++) {
      const directItems = Array.from(el.children).filter(c => c.classList && c.classList.contains("timeline-item"));
      if (directItems.length >= 2) return el;
      el = el.parentElement;
    }
    return anyItem.parentElement;
  }

  function getCommentId(el) {
    return el && el.id && el.id.startsWith("issuecomment-") ? el.id : null;
  }

  function isThreadableCommentId(id) {
    return typeof id === "string" && (id.startsWith("issuecomment-") || id.startsWith("issue-"));
  }

  function isEventNode(node) {
    return !!(node && node.classList && node.classList.contains("timeline-item") && node.classList.contains("event"));
  }

  function getOrigIndex(node) {
    return Number.parseInt(node?.dataset?._tiOrigIndex ?? "999999", 10);
  }

  function getRawTextForCommentId(commentId) {
    const raw = document.getElementById(`${commentId}-raw`);
    return raw ? (raw.textContent || "") : "";
  }

  function parseReplyTo(rawText) {
    const lines = rawText.split("\n").map(l => l.trim());
    const first = lines.find(l => l.length > 0) || "";
    const m = first.match(/^\^reply-to:\s*(#?issuecomment-\d+)\s*$/i);
    if (!m) return null;
    const ref = m[1].startsWith("#") ? m[1].slice(1) : m[1];
    return ref;
  }

  function findEditorTextarea() {
    // Target only the main comment form, not edit textareas elsewhere
    return document.querySelector("#comment-form textarea[name='content'], #comment-form textarea");
  }

  function scrollToEditor() {
    const ta = findEditorTextarea();
    if (!ta) return null;
    ta.scrollIntoView({ behavior: "smooth", block: "center" });
    ta.focus();
    return ta;
  }

  // --- Main ---------------------------------------------------------------
  function initThreading(timeline) {
    const controls = document.createElement("div");
    controls.className = "threaded-issues-controls";
    controls.id = "threaded-issues-controls";

    const btnThread = mkBtn("Threaded", () => setMode("threaded"));
    btnThread.classList.add("threaded-issues-btn-thread");
    const btnFlat = mkBtn("Flat", () => setMode("flat"));
    btnFlat.classList.add("threaded-issues-btn-flat");
    const btnEvents = mkBtn("Toggle events", () => toggleEvents());
    const status = document.createElement("span");
    status.className = "muted";

    controls.append(btnThread, btnFlat, btnEvents, status);

    timeline.parentElement.insertBefore(controls, timeline);

    const btnPrev = mkBtn("▲ Prev Root", () => navRoot(-1));
    const btnNext = mkBtn("▼ Next Root", () => navRoot(1));
    controls.insertBefore(btnNext, status);
    controls.insertBefore(btnPrev, btnNext);

    const origChildren = Array.from(timeline.children);
    origChildren.forEach((n, i) => {
      if (n.nodeType === 1) n.dataset._tiOrigIndex = String(i);
    });

    const originalNodes = Array.from(timeline.children).filter(n => n.classList && n.classList.contains("timeline-item"));
    const originalOrderIds = originalNodes.map(n => n.dataset._tiOrig = (n.dataset._tiOrig || cryptoRandomId()));

    const keyMode = "threadedIssues.mode";
    const keyEvents = "threadedIssues.hideEvents";

    if (!localStorage.getItem(keyMode)) localStorage.setItem(keyMode, "threaded");
    if (!localStorage.getItem(keyEvents)) localStorage.setItem(keyEvents, "1");

    const initialMode = localStorage.getItem(keyMode) || "threaded";
    let hideEvents = (localStorage.getItem(keyEvents) ?? "1") === "1";
    let currentMode = initialMode;

    const keyCollapsed = "threadedIssues.collapsed";
    let collapsedIds = new Set(JSON.parse(localStorage.getItem(keyCollapsed) || "[]"));

    let mapParent = new Map();
    let mapChildren = new Map();

    if (hideEvents) document.documentElement.classList.add("threaded-issues-hide-events");

    enhanceReplyButtons(timeline);

    updateEventsButtonLabel();

    setMode(initialMode);

    function navRoot(dir) {
      if (currentMode !== "threaded") return;
      const comments = Array.from(timeline.querySelectorAll(".timeline-item.comment"));
      const roots = comments.filter(c =>
        !c.classList.contains("ti-hidden-child") &&
        (!c.className.match(/ti-indent-[1-9]/))
      );

      if (!roots.length) return;

      const center = window.scrollY + (window.innerHeight / 3);
      let closestIdx = -1;
      let minDiff = Infinity;

      roots.forEach((r, i) => {
        const rect = r.getBoundingClientRect();
        const absTop = window.scrollY + rect.top;
        const diff = absTop - center;
        if (Math.abs(diff) < minDiff) {
          minDiff = Math.abs(diff);
          closestIdx = i;
        }
      });

      let nextIdx = closestIdx + dir;

      if (nextIdx < 0) nextIdx = 0;
      if (nextIdx >= roots.length) nextIdx = roots.length - 1;

      const target = roots[nextIdx];
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }

    function setMode(mode) {
      localStorage.setItem(keyMode, mode);
      currentMode = mode;
      if (mode === "threaded") {
        document.documentElement.classList.add("threaded-issues-threaded");
        applyThreadedOrder();
        status.textContent = "Threaded view";
        updateModeButtons();
        renderCollapse();
      } else {
        document.documentElement.classList.remove("threaded-issues-threaded");
        restoreFlatOrder();
        status.textContent = "Flat view";
        timeline.querySelectorAll(".ti-hidden-child").forEach(el => el.classList.remove("ti-hidden-child"));
        timeline.querySelectorAll(".is-collapsed").forEach(el => el.classList.remove("is-collapsed"));
      }
      updateModeButtons();
    }

    function toggleEvents() {
      setHideEvents(!hideEvents);
    }

    function setHideEvents(nextHidden) {
      hideEvents = nextHidden;
      if (hideEvents) {
        document.documentElement.classList.add("threaded-issues-hide-events");
        localStorage.setItem(keyEvents, "1");
        status.textContent = "Events hidden";
      } else {
        document.documentElement.classList.remove("threaded-issues-hide-events");
        localStorage.setItem(keyEvents, "0");
        status.textContent = "Events shown";
      }
      updateEventsButtonLabel();
      setMode(currentMode);
    }

    function updateEventsButtonLabel() {
      btnEvents.textContent = hideEvents ? "Show events" : "Hide events";
    }

    function updateModeButtons() {
      btnThread.classList.toggle("is-active", currentMode === "threaded");
      btnFlat.classList.toggle("is-active", currentMode === "flat");
    }

    function restoreFlatOrder() {
      removeEventPlaceholders(timeline);
      const kids = Array.from(timeline.children);

      kids.forEach(n => n.classList?.remove("ti-indent-1", "ti-indent-2", "ti-indent-3", "ti-indent-4"));

      kids.sort((a, b) => {
        const ai = getOrigIndex(a);
        const bi = getOrigIndex(b);
        return ai - bi;
      });

      const frag = document.createDocumentFragment();
      const withPlaceholders = addEventPlaceholders(kids, hideEvents);
      withPlaceholders.forEach(n => frag.appendChild(n));
      timeline.appendChild(frag);
    }

    function applyThreadedOrder() {
      removeEventPlaceholders(timeline);
      const direct = Array.from(timeline.children);

      const commentNodes = direct.filter(n =>
        n.classList?.contains("timeline-item") &&
        n.classList.contains("comment") &&
        !n.classList.contains("form") &&
        isThreadableCommentId(n.id || "")
      );

      const eventNodes = direct.filter(n => isEventNode(n));

      const otherNodes = direct.filter(n => !commentNodes.includes(n) && !eventNodes.includes(n));

      if (!commentNodes.length) return;
      const nodesById = new Map();
      const parentById = new Map();

      for (const n of commentNodes) {
        const cid = n.id;
        nodesById.set(cid, n);

        const raw = document.getElementById(`${cid}-raw`)?.textContent || "";
        const parent = parseReplyTo(raw);
        if (parent && parent !== cid) parentById.set(cid, parent);
      }

      mapChildren.clear();
      mapParent = parentById;

      for (const [child, parent] of parentById.entries()) {
        if (!mapChildren.has(parent)) mapChildren.set(parent, []);
        mapChildren.get(parent).push(child);
      }

      const domIndex = new Map(commentNodes.map((n, i) => [n.id, i]));
      const sortByDom = (a, b) => (domIndex.get(a) ?? 0) - (domIndex.get(b) ?? 0);
      for (const arr of mapChildren.values()) arr.sort(sortByDom);

      const roots = [];
      for (const cid of nodesById.keys()) {
        const p = parentById.get(cid);
        if (!p || !nodesById.has(p)) roots.push(cid);
      }
      roots.sort(sortByDom);

      const ordered = [];
      const depthById = new Map();

      const visited = new Set();
      const dfs = (cid, depth) => {
        if (visited.has(cid)) return;
        visited.add(cid);
        ordered.push(cid);
        depthById.set(cid, Math.min(depth, 4));
        for (const kid of (mapChildren.get(cid) || [])) dfs(kid, depth + 1);
      };
      roots.forEach(r => dfs(r, 0));

      const frag = document.createDocumentFragment();
      const orderedEventNodes = eventNodes
        .slice()
        .sort((a, b) => getOrigIndex(a) - getOrigIndex(b));

      const threadedWithEvents = [];
      let evIdx = 0;
      for (const cid of ordered) {
        const n = nodesById.get(cid);
        if (!n) continue;
        const commentIdx = getOrigIndex(n);

        while (evIdx < orderedEventNodes.length && getOrigIndex(orderedEventNodes[evIdx]) <= commentIdx) {
          threadedWithEvents.push(orderedEventNodes[evIdx]);
          evIdx += 1;
        }

        n.classList.remove("ti-indent-1", "ti-indent-2", "ti-indent-3", "ti-indent-4");
        const d = depthById.get(cid) || 0;
        if (d > 0) n.classList.add(`ti-indent-${d}`);
        threadedWithEvents.push(n);
      }

      while (evIdx < orderedEventNodes.length) {
        threadedWithEvents.push(orderedEventNodes[evIdx]);
        evIdx += 1;
      }

      const withPlaceholders = addEventPlaceholders(threadedWithEvents, hideEvents);
      withPlaceholders.forEach(n => frag.appendChild(n));

      otherNodes.forEach(n => frag.appendChild(n));

      timeline.appendChild(frag);

      injectToggles();
    }

    function injectToggles() {
      for (const [pid, kids] of mapChildren.entries()) {
        if (!kids || kids.length === 0) continue;
        const el = document.getElementById(pid);
        if (!el) continue;

        const header = el.querySelector(".comment-header-left");
        if (!header) continue;

        if (header.querySelector(".ti-toggle")) continue;

        const toggle = document.createElement("button");
        toggle.className = "ti-toggle";
        toggle.type = "button";
        toggle.textContent = collapsedIds.has(pid) ? "[+]" : "[-]";
        toggle.onclick = (e) => {
          e.stopPropagation();
          toggleThread(pid);
        };

        header.prepend(toggle);

        let summary = el.querySelector(".ti-collapsed-summary");
        if (!summary) {
          summary = document.createElement("div");
          summary.className = "ti-collapsed-summary";
          const body = el.querySelector(".comment-body");
          if (body) {
            // Insert summary as first child of comment-body, not before it.
            // Inserting before comment-body breaks Gitea's expected DOM structure
            // where .comment-header.nextElementSibling should be the content container.
            body.insertBefore(summary, body.firstChild);
          }
        }
      }
    }

    function toggleThread(pid) {
      if (collapsedIds.has(pid)) {
        collapsedIds.delete(pid);
      } else {
        collapsedIds.add(pid);
      }
      localStorage.setItem(keyCollapsed, JSON.stringify(Array.from(collapsedIds)));
      renderCollapse();
    }

    function renderCollapse() {
      if (currentMode !== "threaded") return;

      for (const [pid, kids] of mapChildren.entries()) {
        const el = document.getElementById(pid);
        if (!el) continue;

        const isCollapsed = collapsedIds.has(pid);
        const toggle = el.querySelector(".ti-toggle");
        if (toggle) toggle.textContent = isCollapsed ? "[+]" : "[-]";

        if (isCollapsed) {
          el.classList.add("is-collapsed");
          updateSummary(pid, kids);
        } else {
          el.classList.remove("is-collapsed");
        }
      }

      const allComments = Array.from(timeline.querySelectorAll(".timeline-item.comment[id^='issuecomment-'], .timeline-item.comment[id^='issue-']"));

      for (const el of allComments) {
        const cid = el.id;
        let hidden = false;
        let p = mapParent.get(cid);
        const seen = new Set();
        while (p && !seen.has(p)) {
          seen.add(p);
          if (collapsedIds.has(p)) {
            hidden = true;
            break;
          }
          p = mapParent.get(p);
        }

        if (hidden) el.classList.add("ti-hidden-child");
        else el.classList.remove("ti-hidden-child");
      }
    }

    function updateSummary(pid, kids) {
      const el = document.getElementById(pid);
      if (!el) return;
      const summary = el.querySelector(".ti-collapsed-summary");
      if (!summary) return;

      const count = countDescendants(pid);

      const firstChildId = kids[0];
      let preview = "";
      if (firstChildId) {
        const raw = getRawTextForCommentId(firstChildId);
        let clean = raw.replace(/^\^reply-to:.*$/m, '').trim();
        clean = clean.replace(/<[^>]*>/g, "");
        preview = clean.slice(0, 80).replace(/\s+/g, ' ');
        if (clean.length > 80) preview += "...";

      }

      summary.innerHTML = "";
      const strong = document.createElement("strong");
      strong.textContent = `${count} replies hidden`;
      summary.appendChild(strong);

      if (firstChildId) {
        summary.appendChild(document.createTextNode(" "));
        const span = document.createElement("span");
        span.className = "ti-child-preview-text";

        const cEl = document.getElementById(firstChildId);
        const author = cEl?.querySelector(".author")?.textContent?.trim() || "???";
        span.textContent = `(${author}: ${preview})`;
        summary.appendChild(span);
      }
    }

    function countDescendants(pid) {
      let c = 0;
      const q = [pid];
      const visited = new Set();
      while (q.length) {
        const curr = q.pop();
        if (visited.has(curr)) continue;
        visited.add(curr);
        const ks = mapChildren.get(curr) || [];
        c += ks.length;
        for (const k of ks) q.push(k);
      }
      return c;
    }

    function removeEventPlaceholders(timelineEl) {
      timelineEl.querySelectorAll(".threaded-issues-event-placeholder").forEach(n => n.remove());
    }

    function addEventPlaceholders(nodes, shouldHideEvents) {
      if (!shouldHideEvents) return nodes;
      const out = [];
      for (let i = 0; i < nodes.length; i += 1) {
        const n = nodes[i];
        if (isEventNode(n)) {
          if (i === 0 || !isEventNode(nodes[i - 1])) {
            let count = 1;
            for (let j = i + 1; j < nodes.length && isEventNode(nodes[j]); j += 1) {
              count += 1;
            }
            out.push(createEventPlaceholder(count));
          }
          out.push(n);
        } else {
          out.push(n);
        }
      }
      return out;
    }

    function createEventPlaceholder(count) {
      const wrap = document.createElement("div");
      wrap.className = "timeline-item threaded-issues-event-placeholder";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "threaded-issues-event-toggle";
      btn.textContent = count > 1 ? `Show ${count} events` : "Show event";
      btn.addEventListener("click", () => setHideEvents(false));
      wrap.appendChild(btn);
      return wrap;
    }


    function enhanceReplyButtons(timelineEl) {
      const comments = Array.from(timelineEl.querySelectorAll(".timeline-item.comment[id^='issuecomment-']"));
      for (const c of comments) {
        const cid = getCommentId(c);
        if (!cid) continue;

        const actions = c.querySelector(".comment-header-right.actions");
        if (!actions) continue;

        if (actions.querySelector(`[data-threaded-reply-for='${cid}']`)) continue;

        const a = document.createElement("a");
        a.href = "javascript:void(0)";
        a.textContent = "Reply (threaded)";
        a.style.marginLeft = "8px";
        a.dataset.threadedReplyFor = cid;

        a.addEventListener("click", () => {
          const ta = scrollToEditor();
          if (!ta) return;

          const marker = `^reply-to: #${cid}\n\n`;
          const cur = ta.value || "";
          // Replace existing ^reply-to: line if present, otherwise prepend
          if (cur.trim().startsWith("^reply-to:")) {
            ta.value = cur.replace(/^\^reply-to:.*\n*/, marker);
          } else {
            ta.value = marker + cur;
          }
        });

        actions.appendChild(a);
      }
    }

    function mkBtn(label, fn) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", fn);
      return b;
    }

    function cryptoRandomId() {
      try {
        const a = new Uint32Array(2);
        crypto.getRandomValues(a);
        return `${a[0].toString(16)}${a[1].toString(16)}`;
      } catch {
        return String(Math.random()).slice(2);
      }
    }
  }
})();
