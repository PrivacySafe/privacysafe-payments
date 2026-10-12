// @license magnet:?xt=urn:btih:0b31508aeb0634b347b8270c7bee4d411b5d4109&dn=agpl-3.0.txt AGPL-3.0-or-later
/*
 * SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Front page behaviour.
 *
 * Share (header and below the videos): where the device has a share sheet (phones, and
 * desktop browsers that support it) the button opens it, which reaches every installed
 * app, Instagram and TikTok included. Otherwise it opens a small menu: X, Telegram and
 * email links, and for Instagram and TikTok, which have no web share link, it copies
 * the page link and opens the site so it can be pasted into a post.
 *
 * Menu: the header menu is a <details> element, so it opens and closes without
 * JavaScript. This only adds closing it on Escape, on an outside click, and after a link.
 */

(function () {
  "use strict";

  var url = location.origin + "/";
  var title = "Exclusive PrivacySafe Communities";
  var text = "John Kiriakou's Secret Agent Club: pay directly on Solana and unlock a private community, built on PrivacySafe.";
  var links = {
    x: "https://x.com/intent/post?text=" + encodeURIComponent(text) + "&url=" + encodeURIComponent(url),
    telegram: "https://t.me/share/url?url=" + encodeURIComponent(url) + "&text=" + encodeURIComponent(text),
    email: "mailto:?subject=" + encodeURIComponent(title) + "&body=" + encodeURIComponent(text + "\n\n" + url)
  };
  var sites = { instagram: "https://www.instagram.com/", tiktok: "https://www.tiktok.com/upload" };

  function copy() {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(url).then(function () { return true; }, function () { return false; });
    }
    return Promise.resolve(false);
  }

  var roots = document.querySelectorAll(".share");
  var closers = [];

  Array.prototype.forEach.call(roots, function (root) {
    var button = root.querySelector(".share-toggle");
    var menu = root.querySelector(".share-menu");
    var status = root.querySelector(".share-status");

    function say(message) {
      status.textContent = "";
      window.setTimeout(function () { status.textContent = message; }, 50);
    }
    function setOpen(open) {
      menu.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
    }
    closers.push(function (event, viaKey) {
      if (menu.hidden) return;
      if (event && root.contains(event.target)) return;
      setOpen(false);
      if (viaKey) button.focus();
    });

    Array.prototype.forEach.call(menu.querySelectorAll("[data-share]"), function (item) {
      var kind = item.getAttribute("data-share");
      if (links[kind]) item.href = links[kind];
      if (kind === "copy" || sites[kind]) {
        item.addEventListener("click", function () {
          copy().then(function (ok) {
            if (kind === "copy") {
              say(ok ? "Link copied." : "Copy this link: " + url);
              return;
            }
            var name = kind === "instagram" ? "Instagram" : "TikTok";
            say(ok ? "Link copied. Paste it into your " + name + " post." : "Copy this link for " + name + ": " + url);
            window.open(sites[kind], "_blank", "noopener,noreferrer");
          });
        });
      }
    });

    button.addEventListener("click", function () {
      if (navigator.share) {
        navigator.share({ title: title, text: text, url: url }).catch(function () {});
        return;
      }
      var opening = menu.hidden;
      closers.forEach(function (close) { close(); });
      setOpen(opening);
      if (opening) {
        var first = menu.querySelector("[data-share]");
        if (first) first.focus();
      }
    });

    root.hidden = false;
  });

  var nav = document.querySelector("details.menu");
  if (nav) {
    var summary = nav.querySelector("summary");
    closers.push(function (event, viaKey) {
      if (!nav.open) return;
      if (event && nav.contains(event.target)) return;
      nav.open = false;
      if (viaKey) summary.focus();
    });
    Array.prototype.forEach.call(nav.querySelectorAll(".menu-panel a"), function (a) {
      a.addEventListener("click", function () { nav.open = false; });
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    closers.forEach(function (close) { close(null, true); });
  });
  document.addEventListener("click", function (event) {
    closers.forEach(function (close) { close(event, false); });
  });
})();
// @license-end
