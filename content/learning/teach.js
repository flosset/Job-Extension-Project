// Explicit teaching uses exact field identities; existing automatic learners stay independent.
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});
  const SH = window.JOB_AUTOFILL_SHARED;
  const PANEL = "__jaTeach";
  const clean = (text) => String(text || "").replace(/\s+/g, " ").replace(/\s*\*+\s*$/, "").trim();
  const pagePath = () => location.pathname + location.search + location.hash;
  const same = (a, b) => a.label === b.label && a.context === b.context && a.type === b.type;

  function inPanel(el) {
    for (let node = el; node; node = JA.parentOrHost(node)) if (node.id === PANEL) return true;
    return false;
  }

  function groupName(node) {
    const labelled = node.getAttribute("aria-labelledby");
    const by = labelled ? labelled.split(/\s+/).map((id) => JA.rootOf(node).getElementById(id)?.textContent || "").join(" ") : "";
    const legend = Array.from(node.children).find((el) => el.tagName === "LEGEND");
    if (node.matches('fieldset,section,[role="group"],[role="region"],form')) {
      const name = clean(by || node.getAttribute("aria-label") || legend?.textContent);
      if (name) return name;
    }
    const heading = Array.from(node.children).find((el) => el.matches('h1,h2,h3,h4,h5,h6,[role="heading"]'));
    const first = node.querySelector("input,textarea,select");
    return heading && first && (heading.compareDocumentPosition(first) & 4) ? clean(heading.textContent) : "";
  }

  function describe(el) {
    if (!el || inPanel(el) || !JA.isFillable(el)) return null;
    const combo = el.matches('[class*="select__control"]');
    if (combo && (el.getAttribute("aria-disabled") === "true" || JA.comboInput(el)?.disabled)) return null;
    if (!combo && el.tagName === "INPUT" && JA.isComboboxInput(el)) return null;
    const type = combo ? "combo" : el.tagName === "TEXTAREA" ? "textarea" : el.tagName === "SELECT" ? "select" : el.type;
    if (!["text", "email", "tel", "url", "number", "date", "month", "search", "textarea", "select", "combo"].includes(type) || el.multiple) return null;
    if (combo && (el.querySelector('[class*="multi-value"], [class*="multiValue"]') || !JA.comboInput(el))) return null;
    const nativeLabel = el.labels?.[0]?.cloneNode(true);
    nativeLabel?.querySelectorAll("input,textarea,select").forEach((control) => control.remove());
    const label = clean(combo ? JA.comboLabel(el) : el.getAttribute("aria-label") || nativeLabel?.textContent || JA.labelTextFor(el));
    if (label.length > 120 || !SH.teachLabelAllowed(label)) return null;
    const names = [];
    for (let node = JA.parentOrHost(el); node && node !== document.body; node = JA.parentOrHost(node)) {
      const name = groupName(node);
      if (name) names.unshift(name);
    }
    const context = JSON.stringify(names);
    return context.length <= 600 ? { label, context, type } : null;
  }

  function fields(root) {
    return JA.queryAll('input,textarea,select,[class*="select__control"]', root || document).filter((el) => describe(el));
  }

  function match(controls) {
    const pool = fields().map((el) => ({ el, identity: describe(el) }));
    const result = new Map();
    for (const key of Object.keys(controls)) {
      const found = pool.filter((item) => same(item.identity, controls[key]));
      if (found.length !== 1 || Array.from(result.values()).includes(found[0].el)) return null;
      result.set(key, found[0].el);
    }
    return result;
  }

  function valueOf(el) {
    if (el.matches('[class*="select__control"]')) return clean(JA.comboValueEl(el)?.textContent);
    if (el.tagName === "SELECT") return JA.isSelectEmpty(el) ? "" : clean(el.options[el.selectedIndex]?.textContent);
    return String(el.value || "");
  }

  JA.replayTaught = async function (recipe, profile, used) {
    const taught = recipe.taught;
    if (recipe.host !== JA.pageHost() || (taught.scope === "page" && taught.path !== pagePath())) return { filled: 0 };
    if (!match(taught.controls)) return { filled: 0, issue: "fields changed or match more than one section; teach again" };
    const values = JA.recipeInternals.entryFor(recipe.rows[0], profile);
    let filled = 0;
    let issue = "";
    for (const key of Object.keys(taught.controls)) {
      const resolved = match(taught.controls);
      const el = resolved && resolved.get(key);
      if (!el) { issue = "the form changed during filling; teach again"; break; }
      if (used.has(el)) { issue = "another saved mapping already uses this field"; continue; }
      used.add(el);
      const value = values[key];
      if (!value) { issue = "a selected profile value is empty"; continue; }
      if (valueOf(el)) continue; // A taught mapping must preserve an answer already on the page.
      let ok = false;
      if (taught.controls[key].type === "combo") {
        ok = await JA.chooseComboControl(el, value, used);
        const current = match(taught.controls)?.get(key);
        if (current) used.add(current);
        const committed = current && JA.comboValueEl(current);
        ok = ok && !!committed && !!JA.matchOptionElement([committed], value);
      } else {
        const option = el.tagName === "SELECT" ? JA.findOptionForValue(el, value) : null;
        ok = JA.assignFieldValue(el, value);
        const current = match(taught.controls)?.get(key);
        if (current) used.add(current);
        ok = ok && !!current && (option ? current.value === option.value : current.value === value) && (!current.validity || current.validity.valid);
      }
      if (ok) filled++;
      else issue = "a field did not retain the selected value; review it on the page";
    }
    return { filled, issue };
  };

  JA.startTeaching = async function () {
    if (!fields().length) return false;
    if (JA.cancelTeaching) JA.cancelTeaching();
    document.getElementById(PANEL)?.remove();
    const data = await chrome.storage.local.get(SH.keys.profile);
    const profile = data[SH.keys.profile] || {};
    const host = document.createElement("div");
    host.id = PANEL;
    host.style.cssText = "all:initial;position:fixed;right:16px;top:16px;width:min(430px,calc(100vw - 32px));z-index:2147483647";
    // The website must not read profile previews or change reviewed values.
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = ":host{color-scheme:light}*{box-sizing:border-box}section{font:14px/1.45 system-ui;color:#172033;background:#fff;border:2px solid #475569;border-radius:12px;padding:16px;box-shadow:0 8px 32px #0005;max-height:85vh;overflow:auto}h2{font-size:18px;margin:0 0 8px}button,input,select,textarea{font:inherit}button{cursor:pointer;padding:7px;margin:4px 6px 4px 0}input,select,textarea{display:block;width:100%;margin:4px 0 8px;padding:6px}textarea{min-height:60px}fieldset{margin:10px 0;padding:8px;border:1px solid #94a3b8}p{margin:8px 0}small{display:block;color:#475569}:focus-visible{outline:3px solid #2563eb}";
    root.append(style);
    const panel = document.createElement("section");
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", "Teach fields");
    root.append(panel);
    const make = (tag, text, parent = panel) => {
      const node = document.createElement(tag);
      if (text) node.textContent = text;
      parent.append(node);
      return node;
    };
    const button = (text, action, parent) => {
      const node = make("button", text, parent);
      node.type = "button";
      node.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); action(); });
      return node;
    };
    make("h2", "Teach a field or section");
    make("p", "Click a field to select it, or focus it and press F8. Repeat to exclude it. Review values below before saving.");
    make("small", "Text fields and single-choice dropdowns are supported. Files, consent, sensitive identity fields and action buttons are excluded.");
    const nameLabel = make("label", "Name for this saved section");
    const name = make("input", "", nameLabel);
    name.maxLength = 60;
    const scopeLabel = make("label", "Where to reuse it");
    const scope = make("select", "", scopeLabel);
    for (const [value, text] of [["page", "Only this application page"], ["site", "Other pages on " + JA.pageHost()]]) {
      const option = make("option", text, scope); option.value = value;
    }
    make("small", "Whole-site reuse may include other companies on this job board. Matching section labels and field types are still required.");
    const list = make("div");
    const note = make("p", "No fields selected yet.");
    note.setAttribute("role", "status");
    note.setAttribute("aria-live", "polite");
    const selected = new Map();
    const outlines = new Map();
    let saving = false;
    let closed = false;

    function restore(el) {
      const old = outlines.get(el);
      if (!old) return;
      for (const [property, value, priority] of old) {
        if (value) el.style.setProperty(property, value, priority);
        else el.style.removeProperty(property);
      }
      outlines.delete(el);
    }
    function remove(el) {
      restore(el); selected.delete(el); render();
    }
    function add(el) {
      if (selected.has(el) || !describe(el)) return;
      if (selected.size >= 20) { note.textContent = "Select at most 20 fields at a time."; return; }
      outlines.set(el, ["outline", "outline-offset"].map((key) => [key, el.style.getPropertyValue(key), el.style.getPropertyPriority(key)]));
      el.style.setProperty("outline", "3px solid #2563eb", "important");
      el.style.setProperty("outline-offset", "3px", "important");
      selected.set(el, { identity: describe(el), source: "literal", value: valueOf(el) });
      if (!name.value) name.value = describe(el).label.slice(0, 60);
    }
    function render() {
      list.replaceChildren();
      for (const [el, item] of selected) {
        const row = make("fieldset", "", list);
        make("legend", item.identity.label, row);
        make("small", JSON.parse(item.identity.context).join(" > ") || "No section label", row);
        const sourceLabel = make("label", "Value source", row);
        const source = make("select", "", sourceLabel);
        const literal = make("option", "Keep this exact answer", source); literal.value = "literal";
        for (const key of Object.keys(JA.KEYWORDS || {}).filter((key) => SH.teachLabelAllowed(key))) {
          const option = make("option", "My profile: " + key.replace(/([A-Z])/g, " $1").toLowerCase(), source);
          option.value = key;
        }
        source.value = item.source;
        const valueLabel = make("label", "Answer to remember", row);
        const input = make("textarea", "", valueLabel);
        input.value = item.source === "literal" ? item.value : profile[item.source] || ""; input.maxLength = 500;
        input.disabled = item.source !== "literal";
        input.addEventListener("input", () => { item.value = input.value; });
        source.addEventListener("change", () => {
          item.source = source.value;
          input.disabled = item.source !== "literal";
          input.value = item.source === "literal" ? item.value : profile[item.source] || "";
        });
        button("Remove " + item.identity.label, () => remove(el), row);
      }
      note.textContent = selected.size + " field(s) selected. Nothing saved yet.";
    }
    function pick(event) {
      if (event.composedPath().includes(host)) return;
      const path = event.composedPath();
      const el = fields().find((field) => path.includes(field) || path.some((node) => node.nodeType === 1 && node.tagName === "LABEL" && node.control === field));
      event.preventDefault(); event.stopImmediatePropagation();
      if (saving) return;
      if (!el) { note.textContent = "Select a labeled text field or a single-choice dropdown. Page actions are disabled while teaching."; return; }
      if (selected.has(el)) remove(el);
      else { add(el); render(); }
    }
    function keydown(event) {
      if (event.key === "F8" && event.type === "keydown") {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!saving) {
          const el = fields().find((field) => event.composedPath().includes(field));
          if (el) { if (selected.has(el)) remove(el); else { add(el); render(); } }
        }
      }
      if (event.key === "Escape" && !saving) { event.preventDefault(); cleanup(); }
      if (event.key === "Enter" && !(event.composedPath().includes(host) && event.composedPath()[0].tagName === "BUTTON")) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }
    function preventSubmit(event) { event.preventDefault(); event.stopImmediatePropagation(); }
    function preventPagePress(event) { if (!event.composedPath().includes(host)) preventSubmit(event); }
    function cleanup() {
      closed = true;
      for (const el of outlines.keys()) restore(el);
      document.removeEventListener("click", pick, true);
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("keyup", keydown, true);
      document.removeEventListener("pointerdown", preventPagePress, true);
      document.removeEventListener("mousedown", preventPagePress, true);
      document.removeEventListener("submit", preventSubmit, true);
      chrome.storage.onChanged?.removeListener(onStorage);
      host.remove();
      if (JA.cancelTeaching === cleanup) delete JA.cancelTeaching;
    }
    function onStorage(changes, area) {
      if (area === "local" && (changes[SH.keys.profile] || changes[SH.keys.profiles])) cleanup();
    }
    button("Add nearby section", () => {
      if (saving) return;
      const first = selected.keys().next().value;
      if (!first) { note.textContent = "Select one field first."; return; }
      for (let node = JA.parentOrHost(first); node && !node.matches("body,html,form"); node = JA.parentOrHost(node)) {
        const nearby = fields(node);
        if (nearby.length >= 2 && nearby.length <= 20) {
          nearby.forEach(add); render(); return;
        }
      }
      note.textContent = "No nearby group found. Select the other fields individually.";
    });
    const saveButton = button("Save taught fields", async () => {
      if (saving) return;
      if (!selected.size) { note.textContent = "Select at least one field."; return; }
      const id = SH.newId();
      const controls = {}, mapping = {}, row = {};
      let index = 0;
      for (const [el, item] of Array.from(selected).sort(([, a], [, b]) => JSON.stringify(a.identity).localeCompare(JSON.stringify(b.identity)))) {
        if (!el.isConnected || !describe(el) || !same(describe(el), item.identity)) {
          note.textContent = "The page changed. Cancel and select the fields again."; return;
        }
        const key = "field" + index++;
        controls[key] = item.identity;
        mapping[key] = [item.identity.label];
        row[key] = item.source === "literal" ? { source: "literal", value: item.value } : { source: "profile", key: item.source };
        if (item.source === "literal" && (!item.value.trim() || item.value.length > 500 || /[\r\n]/.test(item.value))) {
          note.textContent = "Give each literal answer 1–500 characters on one line. Long application-specific text belongs in the answer bank."; return;
        }
      }
      if (!match(controls)) { note.textContent = "These labels identify more than one field. This mapping cannot be saved safely."; return; }
      const raw = { host: JA.pageHost(), name: name.value || "Taught fields", anchor: ["taught " + id],
        fields: mapping, rows: [row], taught: { scope: scope.value, path: pagePath(), controls } };
      const recipe = SH.sanitizeRecipes({ items: [{ ...raw, id, createdAt: Date.now() }] }).items[0];
      if (!recipe) { note.textContent = "These fields could not be saved. Review the selected fields and values."; return; }
      saving = true; saveButton.disabled = true;
      try {
        const data = await chrome.storage.local.get(SH.keys.recipes);
        if (closed) return;
        const state = SH.sanitizeRecipes(data[SH.keys.recipes]);
        const existing = state.items.findIndex((item) => item.host === recipe.host && JSON.stringify(item.taught) === JSON.stringify(recipe.taught));
        if (existing >= 0) {
          recipe.id = state.items[existing].id;
          recipe.anchor = state.items[existing].anchor;
          recipe.createdAt = state.items[existing].createdAt;
          state.items[existing] = recipe;
        } else {
          if (state.items.length >= SH.maxRecipes) throw new Error("limit");
          state.items.push(recipe);
        }
        await chrome.storage.local.set({ [SH.keys.recipes]: state });
        cleanup();
        panel.replaceChildren();
        make("h2", "Taught fields saved");
        make("p", "Use Fill Application to replay them. You can edit or forget them in the profile editor's saved widgets.");
        button("Close", () => host.remove());
        document.documentElement.append(host);
      } catch (err) {
        note.textContent = err.message === "limit" ? "Saved widget limit reached. Forget an old widget in the profile editor first." : "Could not save. Your selection is still here; try again.";
      } finally { saving = false; saveButton.disabled = false; }
    });
    button("Cancel", () => { if (!saving) cleanup(); });
    JA.cancelTeaching = cleanup;
    document.documentElement.append(host);
    document.addEventListener("click", pick, true);
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("keyup", keydown, true);
    document.addEventListener("pointerdown", preventPagePress, true);
    document.addEventListener("mousedown", preventPagePress, true);
    document.addEventListener("submit", preventSubmit, true);
    chrome.storage.onChanged?.addListener(onStorage);
    name.focus();
    return true;
  };

  JA.teaching = { describe, fields, match };
})();
