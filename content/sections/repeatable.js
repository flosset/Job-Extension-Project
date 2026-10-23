// repeatable.js — drives *repeatable* sections: groups of fields the form lets
// you add more of (Workday "Work Experience", education history, …).
//
// Strategy:
//   1. reuse the blocks already on the page and OVERWRITE their fields,
//   2. click "Add Another" when the profile has more entries than blocks,
//   3. count surplus blocks always, but delete them ONLY when the caller opts
//      in (`opts.trim`) — a parser leftover and a deliberately-added entry are
//      indistinguishable to us, so removal is never a silent default.
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});

  /**
   * Is any of `keywords` present in `node` — as a plain field OR as a custom
   * dropdown? findFieldByKeywords deliberately ignores combobox inputs (they are
   * not text fields), so a block built entirely from react-select widgets could
   * never be confirmed without also asking the combobox driver.
   */
  function matchesIn(node, keywords) {
    if (!keywords || !keywords.length) return false;
    if (JA.findFieldByKeywords && JA.findFieldByKeywords(node, keywords)) return true;
    return !!(
      JA.comboControlForKeywords &&
      JA.comboControlForKeywords(keywords, new Set(), node)
    );
  }

  /** Smallest ancestor of `field` that contains the section's other fields. */
  JA.smallestBlockFor = function (field, section) {
    const groups = section.confirm || [];
    const hasAll = (node) =>
      groups.length > 0 && groups.every((g) => matchesIn(node, g));

    let node = field.parentElement;
    let depth = 0;
    while (node && depth < 18) {
      if (hasAll(node)) return node;
      node = node.parentElement;
      depth++;
    }
    // Relaxed: any confirming group is enough.
    node = field.parentElement;
    depth = 0;
    while (node && depth < 12) {
      if (groups.some((g) => matchesIn(node, g))) return node;
      node = node.parentElement;
      depth++;
    }
    return null;
  };

  /** All repeated blocks of a section, in DOM order. */
  JA.sectionBlocks = function (section) {
    const blocks = [];
    // JA.queryAll so a section rendered inside an open shadow root is found too.
    const fields = JA.queryAll("input, textarea, select");
    for (const field of fields) {
      const signal = JA.normalize(JA.getSignal(field));
      if (!JA.matchesKeywords(signal, section.anchor)) continue;
      const block = JA.smallestBlockFor(field, section);
      if (block && blocks.indexOf(block) === -1) blocks.push(block);
    }
    return blocks;
  };

  /** Read a control's label text ("Delete", "Add Another", …). */
  function controlText(el) {
    return JA.normalize(
      el.textContent || el.value || el.getAttribute("aria-label") || ""
    );
  }

  /** Grow only an identified section; generic add controls need a local owner. */
  JA.clickSectionAdd = function (section) {
    const blocks = JA.sectionBlocks(section);
    const last = blocks.length ? blocks[blocks.length - 1] : null;
    if (!last) return false;
    const specific = (section.addButton || []).filter(word => !["add", "add another", "add more", "new"].includes(word));
    for (let scope = last.parentElement; scope; scope = JA.parentOrHost(scope)) {
      const buttons = JA.queryAll('button, [role="button"], a, input[type="button"]', scope)
        .filter(el => JA.isVisible(el) && el.getAttribute("aria-disabled") !== "true");
      let candidates = buttons.filter(el => JA.matchesKeywords(controlText(el), specific));
      const adjacent = scope.nextElementSibling;
      if (!candidates.length && adjacent && adjacent.matches('button,[role="button"],a,input[type="button"]') &&
          JA.isVisible(adjacent) && JA.matchesKeywords(controlText(adjacent), section.addButton || [])) {
        candidates = [adjacent];
      }
      if (!candidates.length && !scope.matches("html")) {
        const foreignSection = JA.fieldPool(scope).some(field => !blocks.some(block => block.contains(field)) &&
          Object.values(JA.SECTIONS || {}).some(other => other.anchor !== section.anchor &&
            JA.matchesKeywords(JA.normalize(JA.getSignal(field)), other.anchor)));
        if (!foreignSection) candidates = buttons.filter(el => {
          const owner = el.closest('section,fieldset,[role="group"]');
          return (!owner || owner.contains(last)) && JA.matchesKeywords(controlText(el), section.addButton || []);
        });
      }
      if (candidates.length === 1) { JA.mouseClick(candidates[0]); return true; }
      if (candidates.length > 1) return false;
    }
    return false;
  };

  /** Every confirmation dialog currently on the page. */
  function dialogsOnPage() {
    return Array.from(
      document.querySelectorAll('[role="dialog"], [role="alertdialog"]')
    );
  }

  /** A button is destructive when its text is about deleting/removing. */
  const DESTRUCTIVE = /(^| )(delete|delet|remove|remov)/;

  /** Words that prove a dialog really is a delete prompt ("deleted" counts). */
  const DELETE_PROMPT = /(^| )(delete|delet|remove|remov|are you sure|confirm)/;

  /**
   * Accept a confirmation dialog — but ONLY one that appeared *because of* the
   * click we just made, and only if it is actually about deleting.
   *
   * `before` is the dialog snapshot taken prior to the destructive click. An
   * unrelated modal that happens to be open (cookie consent, "Save and
   * continue?") is never in that diff, so it can never be clicked.
   */
  async function confirmDeletion(before, section) {
    const fresh = dialogsOnPage().filter((d) => before.indexOf(d) === -1);
    if (fresh.length === 0) return false;

    for (const dialog of fresh) {
      const text = JA.normalize(dialog.textContent || "");
      const aboutDelete = DELETE_PROMPT.test(text);
      const buttons = Array.from(
        dialog.querySelectorAll('button, [role="button"]')
      );

      // Prefer an explicitly destructive button…
      let target = buttons.find((b) => DESTRUCTIVE.test(controlText(b)));
      // …otherwise a generic yes/ok, but ONLY when the dialog is about deleting.
      if (!target && aboutDelete) {
        target = buttons.find((b) =>
          JA.matchesKeywords(controlText(b), section.confirmButton)
        );
      }
      if (!target) continue;
      if (!aboutDelete && !DESTRUCTIVE.test(controlText(target))) {
        continue; // not provably a delete prompt — leave it alone
      }

      JA.mouseClick(target);
      await JA.sleep(150);
      return true;
    }
    return false;
  }

  /**
   * Delete one block via its Delete control, then accept its confirmation
   * dialog if one appears. Returns true only when a delete control was found
   * and clicked — so callers can tell "removed" from "found nothing to remove".
   */
  JA.deleteSectionBlock = async function (block, section) {
    const before = dialogsOnPage();
    const candidates = Array.from(
      block.querySelectorAll('button, [role="button"], a')
    );
    for (const el of candidates) {
      if (!JA.matchesKeywords(controlText(el), section.deleteButton)) continue;
      JA.mouseClick(el);
      await JA.sleep(150);
      await confirmDeletion(before, section);
      return true;
    }
    return false;
  };

  /**
   * Fill one block from one entry; returns how many fields were set.
   * Each sub-field goes through the generic dispatcher, so a block can hold
   * text inputs, native <select>s or react-select comboboxes on any platform.
   * `used` is the run-wide ownership set: a field another pass already filled is
   * skipped, and anything this block fills is claimed, so a page-wide pass and
   * this section can never both write the same control.
   */
  async function fillBlock(block, entry, section, used) {
    let count = 0;
    const yearMode = section.dateFormat === "year";

    for (const key of Object.keys(section.fields)) {
      const value = entry[key];
      if (!value || typeof value !== "string") continue;

      // from/to: MM/YYYY for Workday roles, bare YYYY for education years.
      let text = value;
      if (key === "from" || key === "to") {
        text = yearMode ? JA.toYear(value) : JA.toMonthYear(value);
      }

      let ok = false;
      try {
        ok = JA.fillFieldByKeywords
          ? await JA.fillFieldByKeywords(block, section.fields[key], text, { used })
          : false;
      } catch (err) {
        ok = false;
      }
      if (ok) count++;
    }

    if (typeof entry.current === "boolean") {
      const box = JA.findFieldByKeywords(block, section.fields.current, {
        type: "checkbox",
        used
      });
      if (box) {
        try {
          JA.setCheckbox(box, entry.current);
          if (used) used.add(box);
          count++;
        } catch (err) {
          /* skip */
        }
      }
    }
    return count;
  }

  /**
   * Could we actually fill this block? Mirrors exactly what fillBlock uses, so
   * the answer is never optimistic: a block whose fields cannot be located is a
   * block we must not clone.
   */
  function blockLooksFillable(block, section) {
    if (!block) return false;
    return Object.keys(section.fields).some((key) =>
      matchesIn(block, section.fields[key])
    );
  }

  /** Grow the section until it has at least `want` blocks. */
  async function ensureBlocks(section, want) {
    let blocks = JA.sectionBlocks(section);

    // NEVER grow a section we can identify nothing in. A click here would be an
    // unverifiable mutation: we could not tell whether it created a block, and
    // blind "Add another" clicks are exactly how three empty Education blocks
    // appeared on a Greenhouse form. If a section really does render its first
    // block only after a click, the user makes that one click (or presses Fill
    // again once the form has rendered it) — we do not guess.
    if (blocks.length === 0) return blocks;

    // Nor grow a section whose blocks do not accept the section's own fields:
    // every click would leave another empty widget behind.
    if (!blockLooksFillable(blocks[0], section)) {
      return blocks;
    }

    let guard = 0;
    while (blocks.length < want && guard < want + 3) {
      guard++;
      if (!JA.clickSectionAdd(section)) break;
      const deadline = Date.now() + 1500;
      let grew = false;
      while (Date.now() < deadline) {
        await JA.sleep(80);
        const next = JA.sectionBlocks(section);
        if (next.length > blocks.length) {
          blocks = next;
          grew = true;
          break;
        }
      }
      if (!grew) break;
      // The block we just created must be one we can fill; otherwise the click
      // was wasted and repeating it only makes the mess bigger.
      if (!blockLooksFillable(blocks[blocks.length - 1], section)) break;
    }
    return blocks;
  }

  /**
   * Fill every entry into one repeatable section.
   *
   * Overwriting and adding are always safe — they only write the profile's own
   * values into blocks that already exist. Removing surplus blocks is NOT: a
   * resume-parser leftover and an entry the user deliberately added look
   * identical to us, so deletion happens only when the caller opts in.
   *
   * Returns { filled, removed, surplus }.
   */
  async function fillSection(section, entries, used, opts) {
    if (!section || entries.length === 0) {
      return { filled: 0, removed: 0, surplus: 0, skipped: false };
    }

    const trim = !!(opts && opts.trim);
    const blocks = await ensureBlocks(section, entries.length);

    let filled = 0;
    for (let i = 0; i < entries.length; i++) {
      if (!blocks[i]) continue;
      filled += await fillBlock(blocks[i], entries[i], section, used);
    }

    // Surplus blocks beyond the profile's entries: always counted, deleted
    // only on request.
    let removed = 0;
    let surplus = 0;
    for (let i = blocks.length - 1; i >= entries.length; i--) {
      const extra = JA.sectionBlocks(section)[i];
      if (!extra) continue;
      surplus++;
      if (!trim) continue;
      if (await JA.deleteSectionBlock(extra, section)) removed++;
    }

    if (used) {
      for (const block of blocks) {
        for (const el of block.querySelectorAll("input, textarea, select")) {
          used.add(el);
        }
      }
    }
    return { filled, removed, surplus, skipped: filled === 0 };
  }

  /**
   * Exposed so a LEARNED widget definition can be replayed by this same,
   * already-guarded engine: it takes a SECTIONS-shaped spec plus the entries to
   * write, and refuses to grow or mutate anything it cannot verify.
   */
  JA.fillSectionBlocks = fillSection;

  /** Which stored profile array feeds which section definition. */
  const SECTION_ENTRIES = [
    { section: "workExperience", profile: "workExperiences" },
    { section: "education", profile: "educations" }
  ];

  /** Human names for the report ("could not fill education"). */
  const SECTION_LABEL = {
    workExperience: "work experience",
    education: "education"
  };

  /** An entry counts as real if any of its fields holds text. */
  function hasContent(entry) {
    return (
      entry &&
      typeof entry === "object" &&
      Object.keys(entry).some(
        (k) => typeof entry[k] === "string" && entry[k].trim() !== ""
      )
    );
  }

  /**
   * Replay the profile's repeatable sections (Work Experience, Education):
   * reuse + overwrite existing blocks, and add more when the profile has more
   * entries. Surplus blocks are only DELETED when `opts.trim` is set.
   * Returns { filled, removed, surplus }.
   */
  JA.fillRepeatableSections = async function (profile, used, opts) {
    const total = { filled: 0, removed: 0, surplus: 0, unfilled: [] };
    for (const mapping of SECTION_ENTRIES) {
      const section = JA.SECTIONS[mapping.section];
      const raw = profile[mapping.profile];
      const entries = Array.isArray(raw) ? raw.filter(hasContent) : [];
      if (entries.length === 0) continue;
      try {
        const part = await fillSection(section, entries, used, opts);
        total.filled += part.filled;
        total.removed += part.removed;
        total.surplus += part.surplus;
        // A section the fill could not address at all is reported, not hidden:
        // an empty "Education" block the user cannot explain is worse than being
        // told the widget was not recognised.
        if (part.skipped) total.unfilled.push(SECTION_LABEL[mapping.section]);
      } catch (err) {
        /* one stubborn section must not abort the others */
        total.unfilled.push(SECTION_LABEL[mapping.section]);
      }
    }
    return total;
  };
})();
