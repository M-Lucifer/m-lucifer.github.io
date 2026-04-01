(function mirrorRuntime() {
  var noticeId = "mirror-offline-notice";
  var styleId = "mirror-offline-style";

  function ensureStyles() {
    if (document.getElementById(styleId)) {
      return;
    }

    var style = document.createElement("style");
    style.id = styleId;
    style.textContent = [
      "#" + noticeId + " {",
      "position: fixed;",
      "right: 20px;",
      "bottom: 20px;",
      "max-width: min(420px, calc(100vw - 32px));",
      "padding: 14px 16px;",
      "border-radius: 18px;",
      "background: rgba(17, 14, 11, 0.92);",
      "color: #f6f0e4;",
      "font: 500 14px/1.55 'Segoe UI', Helvetica, Arial, sans-serif;",
      "box-shadow: 0 18px 48px rgba(0, 0, 0, 0.24);",
      "opacity: 0;",
      "transform: translateY(8px);",
      "pointer-events: none;",
      "transition: opacity 180ms ease, transform 180ms ease;",
      "z-index: 2147483647;",
      "}",
      "#" + noticeId + ".is-visible { opacity: 1; transform: translateY(0); }",
      ".mirror-current-section { font-weight: 700 !important; opacity: 1 !important; }",
      ".mirror-dialog-open { overflow: hidden; }",
    ].join("");
    document.head.appendChild(style);
  }

  function getNotice() {
    ensureStyles();
    var existing = document.getElementById(noticeId);
    if (existing) {
      return existing;
    }
    var node = document.createElement("div");
    node.id = noticeId;
    document.body.appendChild(node);
    return node;
  }

  var noticeTimer = 0;
  function showNotice(message) {
    var node = getNotice();
    node.textContent = message;
    node.classList.add("is-visible");
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(function () {
      node.classList.remove("is-visible");
    }, 3200);
  }

  function toUrl(input) {
    try {
      return new URL(input, window.location.href);
    } catch {
      return null;
    }
  }

  function isRemoteHttp(url) {
    return Boolean(
      url &&
        /^https?:$/i.test(url.protocol) &&
        url.origin !== window.location.origin,
    );
  }

  function getTemplateRootPathname() {
    var pathname = (window.location.pathname || "").replace(/\\/g, "/");
    var pageKind = window.__winter26TemplatePage || "winter";
    var suffixes =
      pageKind === "key"
        ? ["/editions/winter2026/key/index.html", "/editions/winter2026/key/"]
        : pageKind === "winter"
          ? ["/editions/winter2026/index.html", "/editions/winter2026/"]
          : ["/index.html"];

    for (var index = 0; index < suffixes.length; index += 1) {
      var suffix = suffixes[index];
      if (pathname.toLowerCase().endsWith(suffix.toLowerCase())) {
        return pathname.slice(0, pathname.length - suffix.length) || "/";
      }
    }

    return pathname;
  }

  function normalizeTemplatePath(url) {
    if (!url) {
      return "";
    }

    var pathname = (url.pathname || "").replace(/\\/g, "/");

    if (url.protocol === "file:") {
      var templateRoot = getTemplateRootPathname().replace(/\\/g, "/");
      if (
        templateRoot &&
        templateRoot !== "/" &&
        pathname.toLowerCase().indexOf(templateRoot.toLowerCase()) === 0
      ) {
        pathname = pathname.slice(templateRoot.length) || "/";
      }
    }

    if (!pathname.startsWith("/")) {
      pathname = "/" + pathname;
    }

    pathname = pathname.replace(/\/index\.html$/i, "/");
    pathname = pathname.replace(/\/+/g, "/");

    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }

    return pathname || "/";
  }

  function isAllowedTemplatePath(url) {
    var pathname = normalizeTemplatePath(url);
    return (
      pathname === "/" ||
      pathname === "/editions/winter2026" ||
      pathname === "/editions/winter2026/key" ||
      pathname === "/mirror-runtime.js" ||
      pathname === "/editions/mud_normal.webp" ||
      pathname.startsWith("/mirror-assets/") ||
      pathname.startsWith("/vendor/")
    );
  }

  function isBlockedLocalNavigation(url) {
    return Boolean(
      url &&
        url.origin === window.location.origin &&
        !isAllowedTemplatePath(url),
    );
  }

  function blockRemoteRequest(url) {
    console.warn("[mirror] blocked external request:", url);
    showNotice("External network requests are disabled in the offline mirror.");
  }

  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  if (nativeFetch) {
    window.fetch = function patchedFetch(input, init) {
      var rawUrl = typeof input === "string" ? input : input && input.url;
      var url = toUrl(rawUrl);
      if (isRemoteHttp(url)) {
        blockRemoteRequest(url.href);
        return Promise.resolve(
          new Response(null, {
            status: 204,
            statusText: "Blocked by offline mirror",
          }),
        );
      }
      return nativeFetch(input, init);
    };
  }

  if (navigator.sendBeacon) {
    var nativeSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function patchedSendBeacon(rawUrl, body) {
      var url = toUrl(String(rawUrl || ""));
      if (isRemoteHttp(url)) {
        blockRemoteRequest(url.href);
        return false;
      }
      return nativeSendBeacon(rawUrl, body);
    };
  }

  if (window.EventSource) {
    var NativeEventSource = window.EventSource;
    window.EventSource = function PatchedEventSource(rawUrl, config) {
      var url = toUrl(String(rawUrl || ""));
      if (isRemoteHttp(url)) {
        blockRemoteRequest(url.href);
        throw new Error("Blocked by offline mirror");
      }
      return new NativeEventSource(rawUrl, config);
    };
    window.EventSource.prototype = NativeEventSource.prototype;
  }

  if (window.open) {
    var nativeOpen = window.open.bind(window);
    window.open = function patchedOpen(rawUrl, target, features) {
      var url = rawUrl == null ? null : toUrl(String(rawUrl));
      if (isRemoteHttp(url)) {
        blockRemoteRequest(url.href);
        return null;
      }
      if (isBlockedLocalNavigation(url)) {
        showNotice("This destination is not included in the offline Winter '26 template.");
        return null;
      }
      return nativeOpen(rawUrl, target, features);
    };
  }

  if (window.XMLHttpRequest) {
    var originalOpen = XMLHttpRequest.prototype.open;
    var originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
      var resolved = toUrl(String(url));
      this.__mirrorBlocked = isRemoteHttp(resolved);
      this.__mirrorBlockedUrl = resolved ? resolved.href : String(url);
      return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function patchedSend() {
      if (this.__mirrorBlocked) {
        blockRemoteRequest(this.__mirrorBlockedUrl);
        this.abort();
        return;
      }
      return originalSend.apply(this, arguments);
    };
  }

  function openToggleTarget(target) {
    if (!target) {
      return;
    }
    target.hidden = false;
    target.setAttribute("aria-hidden", "false");
    target.classList.remove("hidden");
  }

  function closeToggleTarget(target) {
    if (!target) {
      return;
    }
    target.hidden = true;
    target.setAttribute("aria-hidden", "true");
    target.classList.add("hidden");
  }

  function toggleTargetState(control, target) {
    if (!control || !target) {
      return;
    }
    var expanded = control.getAttribute("aria-expanded") === "true";
    control.setAttribute("aria-expanded", expanded ? "false" : "true");
    if (expanded) {
      closeToggleTarget(target);
    } else {
      openToggleTarget(target);
    }
  }

  function setupExpandable(buttonId, panelId) {
    var button = document.getElementById(buttonId);
    var panel = document.getElementById(panelId);
    if (!button || !panel) {
      return;
    }
    if (!button.hasAttribute("aria-expanded")) {
      button.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
    }
    if (panel.hidden === false) {
      panel.setAttribute("aria-hidden", "false");
    }
    button.addEventListener("click", function (event) {
      event.preventDefault();
      toggleTargetState(button, panel);
    });
  }

  function scrollToAnchor(hash) {
    if (!hash || hash === "#") {
      return false;
    }
    var target = document.getElementById(hash.slice(1));
    if (!target) {
      return false;
    }
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", hash);
    return true;
  }

  function handleAnchorClick(event) {
    var anchor = event.target && event.target.closest("a[href]");
    if (!anchor) {
      return;
    }

    var href = anchor.getAttribute("href") || "";
    if (
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("javascript:")
    ) {
      return;
    }

    var url = toUrl(href);
    if (anchor.dataset.mirrorExternal === "true" || isRemoteHttp(url)) {
      event.preventDefault();
      showNotice("This external destination is not mirrored locally.");
      return;
    }

    if (isBlockedLocalNavigation(url)) {
      event.preventDefault();
      showNotice("This destination is not included in the offline Winter '26 template.");
      return;
    }

    if (
      url &&
      url.origin === window.location.origin &&
      url.pathname === window.location.pathname &&
      url.hash
    ) {
      event.preventDefault();
      scrollToAnchor(url.hash);
    }
  }

  function handleFormSubmit(event) {
    var form = event.target;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }
    var action = form.getAttribute("action") || window.location.href;
    var url = toUrl(action);
    if (form.dataset.mirrorExternal === "true" || isRemoteHttp(url)) {
      event.preventDefault();
      showNotice("Form submission is disabled in the offline mirror.");
      return;
    }

    if (isBlockedLocalNavigation(url)) {
      event.preventDefault();
      showNotice("This form target is not included in the offline Winter '26 template.");
    }
  }

  function setupScrollSpy() {
    var navLinks = Array.prototype.slice.call(
      document.querySelectorAll('a[href^="#"], a[href*="/editions/"][href*="#"]'),
    );
    var sectionIds = [];
    navLinks.forEach(function (link) {
      var href = link.getAttribute("href") || "";
      var hash = href.indexOf("#") >= 0 ? href.slice(href.indexOf("#")) : "";
      if (!hash || hash.length <= 1) {
        return;
      }
      var id = hash.slice(1);
      if (sectionIds.indexOf(id) === -1 && document.getElementById(id)) {
        sectionIds.push(id);
      }
    });

    if (!sectionIds.length || !("IntersectionObserver" in window)) {
      return;
    }

    var activeId = "";
    function applyActive(id) {
      if (!id || activeId === id) {
        return;
      }
      activeId = id;
      navLinks.forEach(function (link) {
        var href = link.getAttribute("href") || "";
        var match = href.indexOf("#" + id) >= 0;
        link.classList.toggle("mirror-current-section", match);
        if (match) {
          link.setAttribute("aria-current", "location");
        } else {
          link.removeAttribute("aria-current");
        }
      });
    }

    var observer = new IntersectionObserver(
      function (entries) {
        var visible = entries
          .filter(function (entry) {
            return entry.isIntersecting;
          })
          .sort(function (a, b) {
            return b.intersectionRatio - a.intersectionRatio;
          });
        if (visible.length) {
          applyActive(visible[0].target.id);
        }
      },
      {
        rootMargin: "-20% 0px -55% 0px",
        threshold: [0.1, 0.25, 0.5],
      },
    );

    sectionIds.forEach(function (id) {
      var target = document.getElementById(id);
      if (target) {
        observer.observe(target);
      }
    });

    if (window.location.hash) {
      applyActive(window.location.hash.slice(1));
    }
  }

  function setupVideoHydration() {
    var seen = new WeakSet();
    function activateVideo(video) {
      if (!video || seen.has(video)) {
        return;
      }

      if (video.dataset && video.dataset.src && !video.getAttribute("src")) {
        video.setAttribute("src", video.dataset.src);
      }

      Array.prototype.forEach.call(video.querySelectorAll("source[data-src]"), function (source) {
        if (!source.getAttribute("src")) {
          source.setAttribute("src", source.dataset.src);
        }
      });

      if (typeof video.load === "function") {
        video.load();
      }

      if (video.muted && typeof video.play === "function") {
        video.play().catch(function () {});
      }

      seen.add(video);
    }

    var videos = Array.prototype.slice.call(
      document.querySelectorAll("video, video[data-src], video source[data-src]"),
    );

    if (!videos.length) {
      return;
    }

    if (!("IntersectionObserver" in window)) {
      videos.forEach(function (node) {
        activateVideo(node.tagName === "VIDEO" ? node : node.closest("video"));
      });
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            activateVideo(entry.target);
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "300px 0px", threshold: 0.01 },
    );

    videos.forEach(function (node) {
      var video = node.tagName === "VIDEO" ? node : node.closest("video");
      if (video) {
        observer.observe(video);
      }
    });
  }

  function setupFallbackDialogs() {
    document.addEventListener("click", function (event) {
      var control = event.target && event.target.closest("[aria-controls],[data-target]");
      if (!control) {
        return;
      }
      var targetId =
        control.getAttribute("aria-controls") ||
        (control.getAttribute("data-target") || "").replace(/^#/, "");
      if (!targetId) {
        return;
      }
      var target = document.getElementById(targetId);
      if (!target) {
        return;
      }
      var isDialogLike =
        target.getAttribute("role") === "dialog" ||
        target.getAttribute("aria-modal") === "true" ||
        /modal|dialog/i.test(target.id) ||
        /modal|dialog/i.test(target.className);
      if (!isDialogLike) {
        return;
      }
      event.preventDefault();
      var hidden =
        target.hidden ||
        target.getAttribute("aria-hidden") === "true" ||
        window.getComputedStyle(target).display === "none";
      if (hidden) {
        openToggleTarget(target);
        document.documentElement.classList.add("mirror-dialog-open");
      } else {
        closeToggleTarget(target);
        document.documentElement.classList.remove("mirror-dialog-open");
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") {
        return;
      }
      Array.prototype.forEach.call(
        document.querySelectorAll('[role="dialog"], [aria-modal="true"]'),
        function (dialog) {
          closeToggleTarget(dialog);
        },
      );
      document.documentElement.classList.remove("mirror-dialog-open");
    });
  }

  function setupCarouselHints() {
    Array.prototype.forEach.call(
      document.querySelectorAll(
        '[id*="carousel"], [class*="carousel"], [class*="snap-"], [style*="overflow-x"]',
      ),
      function (node) {
        if (!(node instanceof HTMLElement)) {
          return;
        }
        if (node.scrollWidth > node.clientWidth) {
          node.style.scrollBehavior = node.style.scrollBehavior || "smooth";
          if (!node.style.scrollSnapType && /snap/i.test(node.className)) {
            node.style.scrollSnapType = "x mandatory";
          }
        }
      },
    );
  }

  setupExpandable("all-editions-dropdown-button", "all-editions-dropdown-expandable-section");
  setupExpandable(
    "mobile-all-editions-dropdown-button",
    "mobile-all-editions-dropdown-expandable-section",
  );

  document.addEventListener("click", handleAnchorClick, true);
  document.addEventListener("submit", handleFormSubmit, true);
  window.addEventListener("hashchange", function () {
    if (window.location.hash) {
      scrollToAnchor(window.location.hash);
    }
  });

  if (window.location.hash) {
    window.setTimeout(function () {
      scrollToAnchor(window.location.hash);
    }, 60);
  }

  setupScrollSpy();
  setupVideoHydration();
  setupFallbackDialogs();
  setupCarouselHints();
})();
