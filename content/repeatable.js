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

  /** Smallest ancestor of `field` that contains the section's other fields. */
  JA.smallestBlockFor = function (field, section) {
    const groups = section.confirm || [];
    const hasAll = (node) =>
      groups.length > 0 && groups.every((g) => !!JA.findFieldByKeywords(node, g));

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
      if (groups.some((g) => JA.findFieldByKeywords(node, g))) return node;
      node = node.parentElement;
      depth++;
    }
    return null;
  };

  /** All repeated blocks of a section, in DOM order. */
  JA.sectionBlocks = function (section) {
    const blocks = [];
    const fields = document.querySelectorAll("input, textarea, select");
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

  /** Click the section's add button. Prefers "add another" over bare "add",
   *  and prefers a button that sits AFTER the section's own blocks so each
   *  section uses its own "Add Another". */
  JA.clickSectionAdd = function (section) {
    const buttons = Array.from(
      document.querySelectorAll('button, [role="button"], a, input[type="button"]')
    ).filter((el) => !el.disabled && el.getAttribute("aria-disabled") !== "true");

    const pick = (keywords) =>
      buttons.filter((el) => JA.matchesKeywords(controlText(el), keywords));

    const blocks = JA.sectionBlocks(section);
    const last = blocks.length ? blocks[blocks.length - 1] : null;
    const choose = (list) => {
      if (!list.length) return null;
      if (last) {
        // DOCUMENT_POSITION_FOLLOWING (4): the button comes after the block.
        const after = list.find((el) => last.compareDocumentPosition(el) & 4);
        if (after) return after;
      }
      return list[0];
    };

    const button =
      choose(pick(["add another"])) || choose(pick(section.addButton));
    if (!button) return false;
    JA.mouseClick(button);
    return true;
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
   */
  async function fillBlock(block, entry, section) {
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
          ? await JA.fillFieldByKeywords(block, section.fields[key], text)
          : false;
      } catch (err) {
        ok = false;
      }
      if (ok) count++;
    }

    if (typeof entry.current === "boolean") {
      const box = JA.findFieldByKeywords(block, section.fields.current, {
        type: "checkbox"
      });
      if (box) {
        try {
          JA.setCheckbox(box, entry.current);
          count++;
        } catch (err) {
          /* skip */
        }
      }
    }
    return count;
  }

  /** Grow the section until it has at least `want` blocks. */
  async function ensureBlocks(section, want) {
    let blocks = JA.sectionBlocks(section);
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
      return { filled: 0, removed: 0, surplus: 0 };
    }

    const trim = !!(opts && opts.trim);
    const blocks = await ensureBlocks(section, entries.length);

    let filled = 0;
    for (let i = 0; i < entries.length; i++) {
      if (!blocks[i]) continue;
      filled += await fillBlock(blocks[i], entries[i], section);
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
    return { filled, removed, surplus };
  }

  /** Which stored profile array feeds which section definition. */
  const SECTION_ENTRIES = [
    { section: "workExperience", profile: "workExperiences" },
    { section: "education", profile: "educations" }
  ];

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
    const total = { filled: 0, removed: 0, surplus: 0 };
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
      } catch (err) {
        /* one stubborn section must not abort the others */
      }
    }
    return total;
  };
})();
