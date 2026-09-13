(function () {
  const pageKey = "notes:" + window.location.href;
  const sidebarKey = "sidebarOpen:" + window.location.href;

  const COLORS = ["#fff6b7", "#ffb3ba", "#bae1ff", "#baffc9", "#ffdfba", "#e0bbff"];
  const MINI_SIZE = 22;
  const MIN_SIDEBAR_WIDTH = 180;
  const MAX_SIDEBAR_WIDTH = 500;
  const DEFAULT_SIDEBAR_WIDTH = 280;

  let sidebarHost = null;
  let sidebarShadow = null;
  let sidebarOpen = false;
  let sidebarWidth = DEFAULT_SIDEBAR_WIDTH;
  let notes = []; // in-memory source of truth; storage is just where it's persisted

  init();

  function init() {
    chrome.storage.local.get(["sidebarWidth"], (res) => {
      if (res.sidebarWidth) sidebarWidth = res.sidebarWidth;
      createFab();
      loadNotes();
      chrome.storage.local.get([sidebarKey], (res2) => {
        if (res2[sidebarKey]) showSidebar();
      });
    });
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === "add-note") addNewNote({ x: 100, y: 100 });
      if (msg.action === "toggle-sidebar") toggleSidebar();
    });
    document.addEventListener("mouseup", handleTextSelection);
    document.addEventListener("selectionchange", handleSelectionChange);
  }

  // ---------- Floating action button ----------

  function createFab() {
    const fab = document.createElement("div");
    fab.id = "sticky-notes-fab";
    fab.textContent = "📝";
    document.body.appendChild(fab);
    fab.addEventListener("click", () => addNewNote({ x: 100, y: 100 }));
  }

  // ---------- Storage ----------

  function getAllNotes(cb) {
    cb(notes);
  }

  function saveNote(data) {
    const idx = notes.findIndex((n) => n.id === data.id);
    if (idx >= 0) notes[idx] = data;
    else notes.push(data);
    chrome.storage.local.set({ [pageKey]: notes }, refreshSidebarList);
  }

  function deleteNote(id) {
    removeHighlight(id);
    notes = notes.filter((n) => n.id !== id);
    chrome.storage.local.set({ [pageKey]: notes }, refreshSidebarList);
  }

  function removeHighlight(noteId) {
    document.querySelectorAll(`mark[data-note-id="${noteId}"]`).forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    });
  }

  function loadNotes() {
    chrome.storage.local.get([pageKey], (result) => {
      notes = result[pageKey] || [];
      notes.forEach((n) => {
        createNoteElement(n);
        if (n.anchor) {
          const range = reanchor(n.anchor);
          if (range) highlightRange(range, n.id);
        }
      });
      refreshSidebarList();
    });
  }

  // ---------- Creating notes ----------

  function addNewNote(overrides = {}) {
    const data = Object.assign(
      {
        id: crypto.randomUUID(),
        x: 100,
        y: 100,
        width: 200,
        height: 140,
        text: "",
        color: COLORS[0],
        minimized: false,
      },
      overrides
    );
    createNoteElement(data);
    saveNote(data);
    return data;
  }

  function createNoteElement(data) {
    const host = document.createElement("div");
    host.className = "sticky-note-host";
    host.dataset.id = data.id;
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: "open" });
    renderNote(shadow, host, data);
    return host;
  }

  function removeNoteHost(host) {
    if (host._resizeObserver) {
      host._resizeObserver.disconnect();
      host._resizeObserver = null;
    }
    host.remove();
  }

  function applyHostGeometry(host, data) {
    host.style.position = "absolute";
    host.style.zIndex = "2147483646";
    host.style.left = (data.x + (sidebarOpen ? sidebarWidth : 0)) + "px";
    host.style.top = data.y + "px";

    if (data.minimized) {
      host.style.width = MINI_SIZE + "px";
      host.style.height = MINI_SIZE + "px";
      host.style.resize = "none";
      host.style.overflow = "visible";
    } else {
      host.style.width = (data.width || 200) + "px";
      host.style.height = (data.height || 140) + "px";
      host.style.resize = "both";
      host.style.overflow = "hidden";
    }
  }

  function renderNote(shadow, host, data) {
    if (host._resizeObserver) {
      host._resizeObserver.disconnect();
      host._resizeObserver = null;
    }

    applyHostGeometry(host, data);

    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .note {
          width: 100%; height: 100%; box-sizing: border-box;
          border: 1px solid rgba(0,0,0,0.15);
          box-shadow: 0 4px 12px rgba(0,0,0,0.2); border-radius: 4px;
          display: flex; flex-direction: column;
          font-family: sans-serif;
        }
        .header {
          cursor: move; display: flex; justify-content: flex-end;
          gap: 6px; padding: 4px 6px;
        }
        .header span { cursor: pointer; font-weight: bold; color: #555; font-size: 13px; }
        .text-area {
          flex: 1; width: 100%; box-sizing: border-box; padding: 6px;
          border: none; background: transparent; resize: none; outline: none;
          font-family: inherit; font-size: 14px;
        }
        .footer {
          display: flex; align-items: center; justify-content: flex-end;
          padding: 4px 6px; gap: 6px; border-top: 1px solid rgba(0,0,0,0.08);
        }
        select { font-size: 11px; }
        .colors { display: flex; gap: 4px; }
        .swatch {
          width: 14px; height: 14px; border-radius: 50%;
          border: 1px solid rgba(0,0,0,0.2); cursor: pointer;
        }
        .mini {
          width: 100%; height: 100%; border-radius: 50%; cursor: pointer;
          border: 2px solid rgba(0,0,0,0.2); box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          box-sizing: border-box;
        }
      </style>
      ${data.minimized ? miniMarkup(data) : fullMarkup(data)}
    `;

    if (data.minimized) {
      shadow.querySelector(".mini").addEventListener("click", () => {
        data.minimized = false;
        saveNote(data);
        renderNote(shadow, host, data);
      });
      return;
    }

    const textarea = shadow.querySelector(".text-area");
    textarea.value = data.text || "";
    textarea.addEventListener("input", () => {
      data.text = textarea.value;
      saveNote(data);
    });

    shadow.querySelector(".close").addEventListener("click", () => {
        removeNoteHost(host);
        deleteNote(data.id);
        removeSidebarItem(data.id);
    });

    shadow.querySelector(".minimize").addEventListener("click", () => {
      data.minimized = true;
      saveNote(data);
      renderNote(shadow, host, data);
    });

    shadow.querySelectorAll(".swatch").forEach((sw) => {
      sw.addEventListener("click", () => {
        data.color = sw.dataset.color;
        shadow.querySelector(".note").style.background = data.color;
        saveNote(data);
      });
    });

    makeDraggable(host, shadow.querySelector(".header"), data);

    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      data.width = Math.round(width);
      data.height = Math.round(height);
      saveNote(data);
    });
    resizeObserver.observe(host);
    host._resizeObserver = resizeObserver;
  }

  function fullMarkup(data) {
    return `
      <div class="note" style="background:${data.color}">
        <div class="header">
          <span class="minimize" title="Minimize">➖</span>
          <span class="close" title="Delete">✕</span>
        </div>
        <textarea class="text-area" placeholder="Write a note..."></textarea>
        <div class="footer">
          <div class="colors">
            ${COLORS.map((c) => `<span class="swatch" data-color="${c}" style="background:${c}"></span>`).join("")}
          </div>
        </div>
      </div>
    `;
  }

  function miniMarkup(data) {
    return `<div class="mini" style="background:${data.color}"></div>`;
  }

  // ---------- Dragging ----------

  function makeDraggable(host, handle, data) {
    let offsetX, offsetY, dragging = false;

    handle.addEventListener("mousedown", (e) => {
        if (e.target.closest(".close, .minimize")) return;
        dragging = true;
        offsetX = e.pageX - host.offsetLeft;
        offsetY = e.pageY - host.offsetTop;
    });

    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const x = e.pageX - offsetX;
      const y = e.pageY - offsetY;
      host.style.left = x + "px";
      host.style.top = y + "px";
      data.x = x - (sidebarOpen ? sidebarWidth : 0);
      data.y = y;
    });

    document.addEventListener("mouseup", () => {
      if (dragging) saveNote(data);
      dragging = false;
    });
  }

  // ---------- Text highlighting ----------

  function handleTextSelection(e) {
    const selection = window.getSelection();
    const text = selection.toString().trim();
    if (text.length === 0) return;
    showAddHighlightButton(selection);
  }

  function handleSelectionChange() {
    const btn = document.getElementById("sticky-highlight-btn");
    if (!btn) return;
    const text = window.getSelection().toString().trim();
    if (text.length === 0) removeExistingButton();
  }

  function showAddHighlightButton(selection) {
    removeExistingButton();

    const range = selection.getRangeAt(0).cloneRange();
    const rects = range.getClientRects();
    const anchorRect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    const btnX = anchorRect.right + window.scrollX;
    const btnY = anchorRect.bottom + window.scrollY;

    const btn = document.createElement("div");
    btn.id = "sticky-highlight-btn";
    btn.textContent = "+ Note";
    btn.style.cssText = `
      position: absolute; left: ${btnX}px; top: ${btnY + 6}px;
      background: #333; color: #fff; padding: 4px 8px;
      border-radius: 4px; font-size: 12px; cursor: pointer;
      z-index: 2147483647;
    `;

    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const anchor = buildAnchor(range);
      const id = crypto.randomUUID();
      addNewNote({ id, x: btnX, y: btnY + 30, anchor });
      highlightRange(range, id);
      removeExistingButton();
      window.getSelection().removeAllRanges();
    });

    document.body.appendChild(btn);
  }

  function removeExistingButton() {
    const existing = document.getElementById("sticky-highlight-btn");
    if (existing) existing.remove();
  }

  function buildAnchor(range) {
    const exact = range.toString();
    const CONTEXT_LEN = 32;
    const fullText = document.body.innerText;
    const idx = fullText.indexOf(exact);
    const prefix = idx > 0 ? fullText.slice(Math.max(0, idx - CONTEXT_LEN), idx) : "";
    const suffix = idx >= 0 ? fullText.slice(idx + exact.length, idx + exact.length + CONTEXT_LEN) : "";
    return { exact, prefix, suffix };
  }

function highlightRange(range, noteId) {
  const segments = getTextNodeSegments(range);
  const marks = [];

  segments.forEach(({ node, start, end }) => {
    if (start >= end) return;
    const segRange = document.createRange();
    segRange.setStart(node, start);
    segRange.setEnd(node, end);

    const mark = document.createElement("mark");
    mark.dataset.noteId = noteId;
    mark.style.cssText = "background: #ffe066; cursor: pointer;";
    try {
      segRange.surroundContents(mark);
      marks.push(mark);
    } catch (e) {
      console.warn("Could not wrap a text segment for highlight.", e);
    }
  });

  marks.forEach((mark) => {
    mark.addEventListener("click", () => {
      const host = document.querySelector(`.sticky-note-host[data-id="${noteId}"]`);
      if (host) host.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });

  return marks;
}

function getTextNodeSegments(range) {
  const segments = [];
  const root = range.commonAncestorContainer;

  // If the whole selection sits inside one text node, that node IS the
  // common ancestor. A TreeWalker never visits its own root, only
  // descendants, so it would find nothing here — handle it directly.
  if (root.nodeType === Node.TEXT_NODE) {
    const start = root === range.startContainer ? range.startOffset : 0;
    const end = root === range.endContainer ? range.endOffset : root.textContent.length;
    segments.push({ node: root, start, end });
    return segments;
  }

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    }
  );
  let node;
  while ((node = walker.nextNode())) {
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.textContent.length;
    segments.push({ node, start, end });
  }
  return segments;
}

  function reanchor(anchor) {
    const fullText = document.body.innerText;
    const searchTarget = anchor.prefix + anchor.exact + anchor.suffix;
    let idx = fullText.indexOf(searchTarget);
    let matchStart;

    if (idx >= 0) {
      matchStart = idx + anchor.prefix.length;
    } else {
      idx = fullText.indexOf(anchor.exact);
      if (idx === -1) return null;
      matchStart = idx;
    }

    return findRangeForTextOffset(matchStart, anchor.exact.length);
  }

  function findRangeForTextOffset(start, length) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node, currentOffset = 0;
    let startNode, startNodeOffset, endNode, endNodeOffset;

    while ((node = walker.nextNode())) {
      const nodeLength = node.textContent.length;

      if (startNode === undefined && currentOffset + nodeLength > start) {
        startNode = node;
        startNodeOffset = start - currentOffset;
      }
      if (startNode !== undefined && currentOffset + nodeLength >= start + length) {
        endNode = node;
        endNodeOffset = start + length - currentOffset;
        break;
      }
      currentOffset += nodeLength;
    }

    if (!startNode || !endNode) return null;

    const range = document.createRange();
    range.setStart(startNode, startNodeOffset);
    range.setEnd(endNode, endNodeOffset);
    return range;
  }

  // ---------- Sidebar ----------

  function shiftNoteHosts(deltaPx) {
    document.querySelectorAll(".sticky-note-host").forEach((host) => {
      const current = parseFloat(host.style.left) || 0;
      host.style.left = (current + deltaPx) + "px";
    });
  }

  function toggleSidebar() {
    chrome.storage.local.get([sidebarKey], (res) => {
      const isOpen = !!res[sidebarKey];
      if (isOpen) {
        hideSidebar();
        chrome.storage.local.set({ [sidebarKey]: false });
      } else {
        showSidebar();
        chrome.storage.local.set({ [sidebarKey]: true });
      }
    });
  }

  function showSidebar() {
    document.body.style.transition = "margin-left 0.2s ease";
    document.body.style.marginLeft = sidebarWidth + "px";

    if (!sidebarOpen) {
      sidebarOpen = true;
      shiftNoteHosts(sidebarWidth);
    }

    if (sidebarHost) {
      sidebarHost.style.width = sidebarWidth + "px";
      sidebarHost.style.display = "block";
      refreshSidebarList();
      return;
    }

    sidebarHost = document.createElement("div");
    sidebarHost.id = "sticky-notes-sidebar-host";
    sidebarHost.style.cssText = `
      position: fixed; top: 0; left: 0; width: ${sidebarWidth}px; height: 100%;
      z-index: 2147483645;
    `;
    document.body.appendChild(sidebarHost);

    sidebarShadow = sidebarHost.attachShadow({ mode: "open" });
    sidebarShadow.innerHTML = `
      <style>
        :host { all: initial; }
        .panel {
            position: relative;
            width: 100%; height: 100%; box-sizing: border-box;
            background: #fafafa; border-right: 1px solid #ddd;
            display: flex; flex-direction: column; font-family: sans-serif;
        }
        .add-btn {
          margin: 8px; padding: 8px; cursor: pointer;
          background: #ffd93d; border: none; border-radius: 4px; font-size: 13px;
        }
        .search {
          margin: 0 8px 8px; padding: 6px; border: 1px solid #ccc; border-radius: 4px;
        }
        .list { flex: 1; overflow-y: auto; }
        .item {
          margin: 0 8px 8px; padding: 8px; background: #fff;
          border-radius: 4px; font-size: 13px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          display: flex; align-items: center; gap: 8px;
        }
        .item-text {
          flex: 1; cursor: pointer; overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap;
        }
        .item-close {
          cursor: pointer; color: #999; font-weight: bold; flex-shrink: 0;
        }
        .item-close:hover { color: #c00; }
        .empty { margin: 8px; color: #888; font-size: 13px; }
        .resize-handle {
          position: absolute; top: 0; right: 0; width: 6px; height: 100%;
          cursor: ew-resize;
        }
        .resize-handle:hover { background: rgba(0,0,0,0.08); }
      </style>
      <div class="panel">
        <button class="add-btn">+ Add note</button>
        <input class="search" placeholder="Search notes..." />
        <div class="list"></div>
        <div class="resize-handle"></div>
      </div>
    `;

    sidebarShadow.querySelector(".add-btn").addEventListener("click", () => {
      addNewNote({ x: 120, y: 120 });
    });
    sidebarShadow.querySelector(".search").addEventListener("input", refreshSidebarList);

    makeSidebarResizable();
    refreshSidebarList();
  }

  function makeSidebarResizable() {
    const handle = sidebarShadow.querySelector(".resize-handle");
    let resizing = false;

    handle.addEventListener("mousedown", (e) => {
      resizing = true;
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!resizing) return;
      const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, e.clientX));
      const delta = newWidth - sidebarWidth;
      if (delta === 0) return;

      sidebarWidth = newWidth;
      sidebarHost.style.width = sidebarWidth + "px";
      document.body.style.marginLeft = sidebarWidth + "px";
      if (sidebarOpen) shiftNoteHosts(delta);
    });

    document.addEventListener("mouseup", () => {
      if (!resizing) return;
      resizing = false;
      chrome.storage.local.set({ sidebarWidth });
    });
  }

  function hideSidebar() {
    if (sidebarHost) sidebarHost.style.display = "none";
    document.body.style.marginLeft = "";

    if (sidebarOpen) {
      sidebarOpen = false;
      shiftNoteHosts(-sidebarWidth);
    }
  }

  function removeSidebarItem(id) {
    if (!sidebarShadow) return;
    const item = sidebarShadow.querySelector(`.item[data-id="${id}"]`);
    if (item) item.remove();
}

  function refreshSidebarList() {
    if (!sidebarShadow) return;

    const searchInput = sidebarShadow.querySelector(".search");
    const term = (searchInput?.value || "").toLowerCase();

    getAllNotes((notes) => {
      const listEl = sidebarShadow.querySelector(".list");
      const filtered = notes.filter((n) => (n.text || "").toLowerCase().includes(term));

      if (filtered.length === 0) {
        listEl.innerHTML = `<div class="empty">No notes yet</div>`;
        return;
      }

      listEl.innerHTML = filtered
        .map(
          (n) => `
        <div class="item" data-id="${n.id}" style="border-left:4px solid ${n.color}">
          <span class="item-text">${escapeHtml((n.text || "(empty note)").slice(0, 60))}</span>
          <span class="item-close" data-id="${n.id}" title="Delete">✕</span>
        </div>
      `
        )
        .join("");

      listEl.querySelectorAll(".item-text").forEach((textEl) => {
        textEl.addEventListener("click", () => {
          const id = textEl.closest(".item").dataset.id;
          const host = document.querySelector(`.sticky-note-host[data-id="${id}"]`);
          if (!host) return;

          getAllNotes((all) => {
            const data = all.find((n) => n.id === id);
            if (data && data.minimized) {
              data.minimized = false;
              saveNote(data);
              renderNote(host.shadowRoot, host, data);
            }
            host.scrollIntoView({ behavior: "smooth", block: "center" });
          });
        });
      });

      listEl.querySelectorAll(".item-close").forEach((closeEl) => {
        closeEl.addEventListener("click", (e) => {
          e.stopPropagation();
          const id = closeEl.dataset.id;
          const host = document.querySelector(`.sticky-note-host[data-id="${id}"]`);
          if (host) removeNoteHost(host);
          deleteNote(id);
        });
      });
    });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
})();