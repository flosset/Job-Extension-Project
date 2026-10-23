// greenhouse-education.test.js — the Greenhouse Education widget (react-select blocks).
//
// The reported bug: pressing Fill on a Greenhouse application added THREE empty
// Education blocks (by clicking "Add another") and filled none of them.
//
// Root cause: react-select keeps the page's original <label for="school"> and
// replaces the input that label pointed at with its own, several wrappers
// deeper. The matcher credited a label only when its `for` matched the control's
// own id, so School/Degree/Discipline had NO readable label — the section's
// anchor never matched (so the existing block was never reused) and no field in
// a block was locatable (so nothing was filled).
//
// This suite pins both halves: the label rules that make such a widget readable,
// and the guard that stops the section engine cloning a block it cannot fill.
"use strict";
const { JSDOM } = require("jsdom");
const { CONTENT_SRC } = require("../_popup-source");

const SITE = "https://boards.greenhouse.io/acme/jobs/123";

let pass = 0;
let fail = 0;
function t(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(
    `${name.padEnd(58)}: ${detail === undefined ? "" : String(detail) + " "}${
      cond ? "PASS" : "FAIL"
    }`
  );
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OPTIONS = {
  school: ["State University", "Other College"],
  degree: ["Bachelor's Degree", "Master's Degree"],
  discipline: ["Computer Science", "Mathematics"]
};

/**
 * A Greenhouse-shaped Education section with ONE react-select block.
 * `labelKind` decides whether its labels are readable (the fix) or not (the
 * guard): "shell" = `for` -> the wrapper holding the control, "unreadable" =
 * `for` -> a different, real field (so the label must be ignored).
 */
function fixtureHtml(opts) {
  const kind = (opts && opts.labelKind) || "shell";

  const label = (style, id, text) => {
    if (style === "shell") return `<label for="${id}">${text}</label>`;
    if (style === "stale") return `<label for="gone-${id}">${text}</label>`;
    if (style === "unreadable") return `<label for="somewhere-else">${text}</label>`;
    return `<label>${text}</label>`;
  };

  const combo = (key, labelHtml, id) =>
    `<div class="field">
       ${labelHtml}
       <div class="select-shell"${id ? ` id="${id}"` : ""}>
         <div class="select__control" data-mock-combo="${key}">
           <div class="select__value-container">
             <div class="select__placeholder">Select...</div>
             <input class="select__input" role="combobox" />
           </div>
         </div>
         <div class="cb-menu"></div>
       </div>
     </div>`;

  const block = (index) => `
    <div class="education-block" id="education-${index}">
      ${combo("school", label(kind, "education-" + index + "-school", "School *"), "education-" + index + "-school")}
      ${combo("degree", `<label for="gone-education-${index}-degree">Degree *</label>`, "")}
      ${combo("discipline", `<label>Discipline *</label>`, "")}
      <div class="field">
        <label for="education-${index}-start">Start date year</label>
        <input id="education-${index}-start" name="start_year" />
      </div>
      <div class="field">
        <label for="education-${index}-end">End date year</label>
        <input id="education-${index}-end" name="end_year" />
      </div>
    </div>`;

  return `<!doctype html><html><body>
  <form id="application">
    ${kind === "unreadable" ? '<div id="somewhere-else"></div>' : ""}
    <h2>Education</h2>
    ${block(0)}
    <a href="#" id="add-another">Add another</a>
    <div class="row">
      <label for="fn">First Name</label><input id="fn" name="first_name" />
      <label for="ln">Last Name</label><input id="ln" name="last_name" />
    </div>
    <div class="application-questions"><label>Are you currently a student at an accredited college or university based in North America?<input></label></div>
  </form>
  <script>
    window.__addClicks = 0;
    window.__asyncOptions = ${opts && opts.asyncOptions ? "true" : "false"};
    window.__options = ${JSON.stringify(OPTIONS)};
    // A real widget renders its options when opened (delegated, so a cloned
    // block behaves too) and commits the one that is clicked.
    document.addEventListener("mousedown", function (e) {
      var control = e.target.closest ? e.target.closest("[data-mock-combo]") : null;
      if (!control) return;
      var menu = control.closest(".select-shell").querySelector(".cb-menu");
      if (menu.innerHTML) { menu.innerHTML = ""; return; }
      // An async/searchable picker shows nothing until it has been typed into.
      if (window.__asyncOptions) return;
      render(control, "");
    });
    document.addEventListener("input", function (e) {
      var control = e.target.closest ? e.target.closest("[data-mock-combo]") : null;
      if (!control) return;
      render(control, (e.target.value || "").toLowerCase());
    });
    function render(control, query) {
      var menu = control.closest(".select-shell").querySelector(".cb-menu");
      var list = (window.__options[control.getAttribute("data-mock-combo")] || [])
        .filter(function (text) {
          return !query || text.toLowerCase().indexOf(query) !== -1;
        });
      menu.innerHTML = list.map(function (text) {
        return '<div class="select__option">' + text + "</div>";
      }).join("");
    }
    document.addEventListener("click", function (e) {
      var option = e.target.closest ? e.target.closest(".select__option") : null;
      if (!option) return;
      var container = option.closest(".select-shell").querySelector(".select__value-container");
      var old = container.querySelector(".select__single-value");
      if (old) old.remove();
      var ph = container.querySelector(".select__placeholder");
      if (ph) ph.remove();
      var value = document.createElement("div");
      value.className = "select__single-value";
      value.textContent = option.textContent;
      container.insertBefore(value, container.firstChild);
    });
    // "Add another" clones the block exactly like the portal's own framework,
    // counting how many times it was asked to.
    document.getElementById("add-another").addEventListener("click", function (e) {
      e.preventDefault();
      if (Array.from(document.querySelectorAll('.education-block')).some(function (block) {
        return block.querySelectorAll('.select__single-value').length < 3 ||
          Array.from(block.querySelectorAll('input[name$="_year"]')).some(function (input) { return !input.value; });
      })) return;
      window.__addClicks++;
      var source = document.getElementById("education-0");
      var copy = source.cloneNode(true);
      copy.querySelectorAll('.select__single-value').forEach(function (el) { el.remove(); });
      copy.querySelectorAll('input').forEach(function (el) { el.value = ''; });
      copy.querySelectorAll('.cb-menu').forEach(function (el) { el.innerHTML = ''; });
      copy.id = "education-copy-" + window.__addClicks;
      // A real framework re-renders the block, so ids AND the labels that point
      // at them move together.
      copy.querySelectorAll("[id]").forEach(function (el) {
        el.id = el.id + "-c" + window.__addClicks;
      });
      copy.querySelectorAll("[for]").forEach(function (el) {
        el.setAttribute("for", el.getAttribute("for") + "-c" + window.__addClicks);
      });
      // Appended after the existing blocks, so block order matches entry order.
      source.parentElement.appendChild(copy);
    });
  </script>
</body></html>`;
}

/** Run the REAL content scripts against the fixture with `profile`. */
async function pageWith(profile, opts) {
  const store = { jobProfile: profile };
  const dom = new JSDOM(fixtureHtml(opts), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: SITE
  });
  const w = dom.window;
  w.Element.prototype.getClientRects = () => [{ width: 10, height: 10 }];
  const reports = [];
  w.chrome = {
    storage: {
      local: {
        get: async (key) =>
          typeof key === "string" ? { [key]: store[key] } : Object.assign({}, store),
        set: async () => {}
      }
    },
    runtime: {
      sendMessage: (message) => reports.push(message),
      onMessage: { addListener: () => {} }
    }
  };
  w.eval(CONTENT_SRC);
  await w.__jobAutofillRun;
  await sleep(150);
  const report = reports.find((m) => m.type === "JOB_AUTOFILL_RESULT") || {};
  return { w, d: w.document, report, JA: w.__JobAutofill, store };
}

const blockOf = (p, index) =>
  p.d.getElementById(index === 0 ? "education-0" : "education-copy-" + index);

/** The committed value of a dropdown inside a block ("School", "Degree", …). */
const comboValue = (p, index, position) => {
  const block = blockOf(p, index);
  if (!block) return "(no block)";
  const value = block.querySelectorAll(".select__single-value")[position];
  return value ? value.textContent : "";
};
const yearValue = (p, index, which) => {
  const block = blockOf(p, index);
  if (!block) return "(no block)";
  const el = block.querySelector('input[name="' + which + '_year"]');
  return el ? el.value : "(no input)";
};

const EDU = (school, degree, major, from, to) => ({ school, degree, major, from, to });
const FULL_NAME = { firstName: "Jane", lastName: "Doe" };

(async () => {
  const SECTION = (page) => page.JA.SECTIONS.education;

  // ---- A. the label rules that make a react-select widget readable --------
  const a = await pageWith(Object.assign({ educations: [EDU("State University", "Bachelor's Degree", "Computer Science", "2019", "2023")] }, FULL_NAME));
  const blocks = a.JA.sectionBlocks(SECTION(a));
  t("A: the Education block is found", blocks.length === 1, blocks.length);

  const signalOf = (selector) => a.JA.normalize(a.JA.getSignal(a.d.querySelector(selector)));
  const schoolInput = a.d.querySelector('[data-mock-combo="school"] .select__input');
  const degreeInput = a.d.querySelector('[data-mock-combo="degree"] .select__input');
  const disciplineInput = a.d.querySelector('[data-mock-combo="discipline"] .select__input');
  t("A: a `for` pointing at the control's wrapper names it", /school/.test(signalOf('[data-mock-combo="school"] .select__input')), signalOf('[data-mock-combo="school"] .select__input'));
  t("A: a stale `for` (its input was replaced) still names it", /degree/.test(a.JA.normalize(a.JA.getSignal(degreeInput))));
  t("A: a `for`-less label in a one-field container names it", /discipline/.test(a.JA.normalize(a.JA.getSignal(disciplineInput))));
  t("A: the label is found 4 wrappers down", !!a.JA.getSignal(schoolInput).match(/school/i));

  // The neighbouring-row guard: two fields in ONE row must not borrow labels.
  const lastSignal = a.JA.normalize(a.JA.getSignal(a.d.getElementById("ln")));
  t("A: a neighbour's label is NOT lent across", !/first name/.test(lastSignal), lastSignal);
  t("A: ...and its own label still is", /last name/.test(lastSignal));

  // ---- B. THE REPORTED BUG: one entry must reuse the existing block ------
  t("B: 'Add another' was NOT clicked", a.w.__addClicks === 0, a.w.__addClicks);
  t("B: no extra block exists", !a.d.getElementById("education-copy-1"));
  t("B: the section reports no problem", (a.report.sectionIssues || []).length === 0, JSON.stringify(a.report.sectionIssues));

  // ---- C. it fills the widget instead of giving up ----------------------
  t("C: School is committed", comboValue(a, 0, 0) === "State University", comboValue(a, 0, 0));
  t("C: Degree is committed", comboValue(a, 0, 1) === "Bachelor's Degree", comboValue(a, 0, 1));
  t("C: Discipline is committed", comboValue(a, 0, 2) === "Computer Science", comboValue(a, 0, 2));
  t("C: Start year is filled", yearValue(a, 0, "start") === "2019", yearValue(a, 0, "start"));
  t("C: End year is filled", yearValue(a, 0, "end") === "2023", yearValue(a, 0, "end"));
  t("C: the fill counted them", a.report.filled >= 5, a.report.filled);
  t("C: the neighbouring row filled correctly too", a.d.getElementById("fn").value === "Jane" && a.d.getElementById("ln").value === "Doe");

  // ---- D. a SEARCHABLE picker (Greenhouse's School) ---------------------
  // Its option list is empty until you type, which is why nothing used to fill.
  const d = await pageWith(Object.assign({ educations: [EDU("State University", "Bachelor's Degree", "Computer Science", "2019", "2023")] }, FULL_NAME), { asyncOptions: true });
  t("D: the async picker is still committed", comboValue(d, 0, 0) === "State University", comboValue(d, 0, 0));
  t("D: ...and the short lists too", comboValue(d, 0, 1) === "Bachelor's Degree" && comboValue(d, 0, 2) === "Computer Science", comboValue(d, 0, 1) + "/" + comboValue(d, 0, 2));
  t("D: no stray search text is left in the input", !d.d.querySelector('[data-mock-combo="school"] .select__input').value);
  t("D: still no extra blocks", d.w.__addClicks === 0, d.w.__addClicks);

  // ---- E. three entries: add exactly what is missing, fill all three ----
  const e = await pageWith(
    Object.assign({
      school: "Other College", degree: "Master's Degree", major: "Mathematics",
      educations: [
        EDU("State University", "Bachelor's Degree", "Computer Science", "2019", "2023"),
        EDU("Other College", "Master's Degree", "Mathematics", "2015", "2018"),
        EDU("State University", "Master's Degree", "Mathematics", "2011", "2014")
      ]
    }, FULL_NAME)
  );
  t("E: exactly two blocks were added", e.w.__addClicks === 2, e.w.__addClicks);
  t("E: three blocks exist", [0, 1, 2].every((i) => !!blockOf(e, i)));
  t("E: no fourth block", !blockOf(e, 3));
  t("E: each block got its own school", comboValue(e, 0, 0) === "State University" && comboValue(e, 1, 0) === "Other College", comboValue(e, 0, 0) + "/" + comboValue(e, 1, 0));
  t("E: each block got its own years", yearValue(e, 0, "start") === "2019" && yearValue(e, 1, "start") === "2015", yearValue(e, 0, "start") + "/" + yearValue(e, 1, "start"));
  t("E: all three blocks were filled", e.report.filled >= 12, e.report.filled);

  // ---- F. an unrecognisable widget is left ALONE and reported ----------
  const f = await pageWith(
    Object.assign({ educations: [EDU("State University", "Bachelor's Degree", "Computer Science", "2019", "2023")] }, FULL_NAME),
    { labelKind: "unreadable" }
  );
  t("F: nothing identifiable, so nothing is added", f.w.__addClicks === 0, f.w.__addClicks);
  t("F: no block was created", !f.d.getElementById("education-copy-1"));
  t("F: the section is reported as not filled", (f.report.sectionIssues || []).indexOf("education") !== -1, JSON.stringify(f.report.sectionIssues));
  t("F: nothing was written into the widget", comboValue(f, 0, 0) === "", JSON.stringify(comboValue(f, 0, 0)));
  t("F: the rest of the form still filled", f.d.getElementById("fn").value === "Jane");

  console.log(
    `\n${fail === 0 ? "GREENHOUSE-EDUCATION E2E PASS" : "GREENHOUSE-EDUCATION E2E FAIL"} (${pass} passed, ${fail} failed)`
  );
  process.exit(fail === 0 ? 0 : 1);
})();
