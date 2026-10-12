// @license magnet:?xt=urn:btih:0b31508aeb0634b347b8270c7bee4d411b5d4109&dn=agpl-3.0.txt AGPL-3.0-or-later
/**
 * Image lightbox, shared with ivycyber.com
 *
 * Copyright (C) 2026 Ivy Cyber LLC
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public
 * License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

(function () {
  "use strict";

  var CLOSE_MS = 200;
  var links = document.querySelectorAll(".photo-inset, .zoom-thumb");
  if (!links.length) {
    return;
  }

  var overlay = null;
  var image = null;
  var caption = null;
  var closeButton = null;
  var opener = null;

  function build() {
    overlay = document.createElement("div");
    overlay.className = "lightbox";
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "lightbox-caption");

    var figure = document.createElement("figure");
    figure.className = "lightbox-figure";

    image = document.createElement("img");
    image.className = "lightbox-image";
    image.alt = "";

    caption = document.createElement("figcaption");
    caption.className = "lightbox-caption";
    caption.id = "lightbox-caption";

    closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "lightbox-close";
    closeButton.textContent = "Close";

    figure.appendChild(image);
    figure.appendChild(caption);
    overlay.appendChild(closeButton);
    overlay.appendChild(figure);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", function (event) {
      if (event.target === overlay || event.target === figure) {
        close();
      }
    });
    closeButton.addEventListener("click", close);
  }

  function onKeydown(event) {
    if (event.key === "Escape") {
      close();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      closeButton.focus();
    }
  }

  function open(link) {
    if (!overlay) {
      build();
    }

    var thumb = link.querySelector("img");
    opener = link;

    image.src = link.href;
    caption.textContent = thumb ? thumb.alt : "";

    overlay.hidden = false;
    document.documentElement.classList.add("lightbox-open");
    document.addEventListener("keydown", onKeydown);

    window.requestAnimationFrame(function () {
      overlay.classList.add("is-open");
    });

    closeButton.focus();
  }

  function close() {
    if (!overlay || overlay.hidden) {
      return;
    }

    overlay.classList.remove("is-open");
    document.removeEventListener("keydown", onKeydown);
    document.documentElement.classList.remove("lightbox-open");

    if (opener) {
      opener.focus();
      opener = null;
    }

    window.setTimeout(function () {
      overlay.hidden = true;
      image.removeAttribute("src");
    }, CLOSE_MS);
  }

  function onLinkClick(event) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    open(event.currentTarget);
  }

  for (var i = 0; i < links.length; i++) {
    links[i].addEventListener("click", onLinkClick);
  }
})();
// @license-end
