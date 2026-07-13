// niceeval 报告的渐进增强 runtime:纯 vanilla JS、零依赖、IIFE、幂等。
// 只作用于 .nre DOM 与 data-nre-* 属性;三个行为——表格排序、行过滤、SVG 点 tooltip。
// 静态 HTML 无 JS 时内容完整可读是硬约束:排序有数据侧预排、tooltip 退化为原生
// <title>、过滤输入框静默无功能。全部经 document 级事件委托绑定,重复注入本文件
// 只在首次生效(window.__nreEnhanced 守卫),DOM 被搬动(如 view 把 <template> 内容
// 摆进报告槽)也无需重新绑定。

(function () {
  "use strict";
  if (typeof window === "undefined" || window.__nreEnhanced) return;
  window.__nreEnhanced = true;

  function closest(target, selector) {
    return target && target.closest ? target.closest(selector) : null;
  }

  // ───────────────────────── 排序:th[data-nre-sort] ─────────────────────────
  // 点击按该列排序 tbody 行(td/th 的 data-sort-value,数值优先、退回字符串;
  // 空值恒沉底),再点反向;方向指示由 th 上的 nre-sort-asc / nre-sort-desc 类驱动。

  function sortValue(row, index) {
    var cell = row.cells[index];
    if (!cell) return "";
    var v = cell.getAttribute("data-sort-value");
    return v !== null ? v : cell.textContent.trim();
  }

  document.addEventListener("click", function (e) {
    var th = closest(e.target, ".nre table th[data-nre-sort]");
    if (!th) return;
    var table = th.closest("table");
    var tbody = table && table.tBodies[0];
    if (!tbody) return;
    var index = Array.prototype.indexOf.call(th.parentNode.children, th);
    var dir = th.classList.contains("nre-sort-asc") ? "desc" : "asc";
    var siblings = th.parentNode.querySelectorAll("th[data-nre-sort]");
    for (var i = 0; i < siblings.length; i++) siblings[i].classList.remove("nre-sort-asc", "nre-sort-desc");
    th.classList.add(dir === "asc" ? "nre-sort-asc" : "nre-sort-desc");

    var rows = Array.prototype.slice.call(tbody.rows);
    rows.sort(function (a, b) {
      var va = sortValue(a, index);
      var vb = sortValue(b, index);
      // 空值 = 缺数据:恒沉底,与「缺数据不编 0」同一姿势
      if (va === "" && vb === "") return 0;
      if (va === "") return 1;
      if (vb === "") return -1;
      var na = Number(va);
      var nb = Number(vb);
      var out;
      if (!isNaN(na) && !isNaN(nb)) out = na - nb;
      else out = String(va).localeCompare(String(vb));
      return dir === "asc" ? out : -out;
    });
    for (var u = 0; u < rows.length; u++) tbody.appendChild(rows[u]);
  });

  // ───────────────────────── 过滤:input[data-nre-filter] ─────────────────────────
  // 对同容器内的表格行做 textContent 匹配,不匹配者加隐藏类(样式在 styles.css)。

  document.addEventListener("input", function (e) {
    var input = closest(e.target, "input[data-nre-filter]");
    if (!input) return;
    var scope = input.parentElement;
    var table = scope ? scope.querySelector("table") : null;
    if (!table || !table.tBodies[0]) return;
    var query = input.value.trim().toLowerCase();
    var rows = table.tBodies[0].rows;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var hide = query !== "" && row.textContent.toLowerCase().indexOf(query) === -1;
      row.classList.toggle("nre-row-hidden", hide);
    }
  });

  // ExperimentList 的 web 面以原生 details 表达「八列主行 + 展开明细」，不是 table/tbody。
  // 单独按 summary 的列排序、按整条 details 文本过滤；无 JS 时保持数据侧成功率降序。
  document.addEventListener("click", function (e) {
    var control = closest(e.target, "[data-nre-experiment-sort]");
    if (!control) return;
    var board = control.closest(".nre-experiment-table");
    if (!board) return;
    var index = Number(control.getAttribute("data-nre-experiment-sort"));
    var dir = control.classList.contains("nre-sort-asc") ? "desc" : "asc";
    var controls = board.querySelectorAll("[data-nre-experiment-sort]");
    for (var i = 0; i < controls.length; i++) controls[i].classList.remove("nre-sort-asc", "nre-sort-desc");
    control.classList.add(dir === "asc" ? "nre-sort-asc" : "nre-sort-desc");
    var entries = Array.prototype.slice.call(board.querySelectorAll(":scope > .nre-experiment-entry"));
    entries.sort(function (a, b) {
      var ac = a.querySelector(".nre-experiment-summary").children[index];
      var bc = b.querySelector(".nre-experiment-summary").children[index];
      var av = ac ? ac.getAttribute("data-sort-value") || ac.textContent.trim() : "";
      var bv = bc ? bc.getAttribute("data-sort-value") || bc.textContent.trim() : "";
      if (av === "" && bv === "") return 0;
      if (av === "") return 1;
      if (bv === "") return -1;
      var an = Number(av), bn = Number(bv);
      var out = !isNaN(an) && !isNaN(bn) ? an - bn : String(av).localeCompare(String(bv));
      return dir === "asc" ? out : -out;
    });
    for (var j = 0; j < entries.length; j++) board.appendChild(entries[j]);
  });

  document.addEventListener("input", function (e) {
    var input = closest(e.target, "input[data-nre-experiment-filter]");
    if (!input) return;
    var scope = input.parentElement;
    var entries = scope ? scope.querySelectorAll(".nre-experiment-entry") : [];
    var query = input.value.trim().toLowerCase();
    for (var i = 0; i < entries.length; i++) {
      entries[i].classList.toggle("nre-row-hidden", query !== "" && entries[i].textContent.toLowerCase().indexOf(query) === -1);
    }
  });

  // ───────────────────────── tooltip:.nre-scatter-point / .nre-line-point ─────────────────────────
  // 首次 hover 时把点内 <title> 的内容搬进 data-nre-title(避免与原生 tooltip 重影),
  // 渲染样式化 tooltip div(定位在点上方,挂在所属 figure 里)。无 JS 时 <title> 原样生效。

  var tooltip = null;

  function hideTooltip() {
    if (tooltip && tooltip.parentNode) tooltip.parentNode.removeChild(tooltip);
    tooltip = null;
  }

  function tooltipText(point) {
    var text = point.getAttribute("data-nre-title");
    if (text === null) {
      var title = point.querySelector("title");
      text = title ? title.textContent : "";
      if (title && title.parentNode) title.parentNode.removeChild(title);
      point.setAttribute("data-nre-title", text);
    }
    return text;
  }

  document.addEventListener("mouseover", function (e) {
    var point = closest(e.target, ".nre-scatter-point, .nre-line-point");
    if (!point) return;
    var text = tooltipText(point);
    if (!text) return;
    var figure = point.closest("figure") || document.body;
    hideTooltip();
    tooltip = document.createElement("div");
    tooltip.className = "nre-tooltip";
    var lines = text.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = document.createElement(i === 0 ? "b" : "div");
      if (i > 0) line.className = "nre-tooltip-meta";
      line.textContent = lines[i];
      tooltip.appendChild(line);
    }
    if (getComputedStyle(figure).position === "static") figure.style.position = "relative";
    figure.appendChild(tooltip);
    var pointBox = point.getBoundingClientRect();
    var figureBox = figure.getBoundingClientRect();
    tooltip.style.left = pointBox.left + pointBox.width / 2 - figureBox.left + "px";
    tooltip.style.top = pointBox.top - figureBox.top + "px";
  });

  document.addEventListener("mouseout", function (e) {
    var point = closest(e.target, ".nre-scatter-point, .nre-line-point");
    if (!point) return;
    // 移入 tooltip 自身不算离开(pointer-events: none 下 relatedTarget 不会是它,防御性判断)
    if (e.relatedTarget && point.contains(e.relatedTarget)) return;
    hideTooltip();
  });
})();
