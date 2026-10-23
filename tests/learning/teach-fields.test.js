"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { APP_DIR, CONTENT_SCRIPTS, POPUP_JS } = require("../_popup-source");
const source = CONTENT_SCRIPTS.filter((file) => file !== "content/autofill.js")
  .map((file) => fs.readFileSync(path.join(APP_DIR, file), "utf8")).join("\n");
const fixture = `<!doctype html><body><form>
  <fieldset id="applicant"><legend>Applicant</legend>
    <label>Name<input id="appName"></label><label>Email<input id="appEmail" type="email"></label>
  </fieldset>
  <fieldset id="contact"><legend>Emergency contact</legend>
    <label>Name<input id="refName" value="Reference Person" style="outline:1px dotted red!important"></label>
    <label>Email<input id="refEmail" type="email" value="ref@example.com"></label>
    <label>Contact method<select id="method"><option value="">Choose</option><option value="email">Email</option></select></label>
  </fieldset>
  <label>Resume<input id="resume" type="file" required></label>
  <label>Password<input id="secret" type="password"></label>
  <label>Gender<input id="gender"></label>
  <button id="submit" type="submit">Submit Application</button>
</form></body>`;

function open() {
  const dom = new JSDOM(fixture, { runScripts: "dangerously", pretendToBeVisual: true, url: "https://boards.example.com/jobs/one" });
  const w = dom.window;
  let teachingRoot;
  const attachShadow = w.Element.prototype.attachShadow;
  w.Element.prototype.attachShadow = function (options) {
    const root = attachShadow.call(this, options);
    if (this.id === "__jaTeach") teachingRoot = root;
    return root;
  };
  w.Element.prototype.getClientRects = () => [{ width: 10, height: 10 }];
  const store = { jobProfile: { email: "profile@example.com" } };
  const listeners = new Set();
  let failWrite = false;
  w.chrome = { storage: {
    local: {
      get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, store[key]])),
      set: async (data) => { if (failWrite) throw new Error("quota"); Object.assign(store, data); }
    },
    onChanged: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) }
  } };
  w.eval(source);
  return { w, d: w.document, JA: w.__JobAutofill, SH: w.JOB_AUTOFILL_SHARED, store, listeners,
    get root() { return teachingRoot; },
    failWrites: (value) => { failWrite = value; } };
}
const click = (p, el) => el.dispatchEvent(new p.w.MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
const panel = (p) => p.root;
function press(p, text) {
  const button = Array.from(panel(p).querySelectorAll("button")).find((el) => el.textContent === text);
  assert(button, text + " exists"); click(p, button);
}
async function settle() { await new Promise((resolve) => setTimeout(resolve, 0)); }

(async () => {
  const p = open();
  try {
    assert.strictEqual(p.JA.teaching.describe(p.d.getElementById("resume")), null);
    assert.strictEqual(p.JA.teaching.describe(p.d.getElementById("secret")), null);
    assert.strictEqual(p.JA.teaching.describe(p.d.getElementById("gender")), null);
    assert.notStrictEqual(p.JA.teaching.describe(p.d.getElementById("appName")).context,
      p.JA.teaching.describe(p.d.getElementById("refName")).context, "same labels retain distinct section identities");
    await p.JA.startTeaching();
    assert.strictEqual(p.d.getElementById("__jaTeach").shadowRoot, null, "the website cannot read profile previews from the teaching panel");
    let actions = 0;
    p.d.getElementById("submit").addEventListener("click", () => actions++);
    click(p, p.d.getElementById("submit"));
    assert.strictEqual(actions, 0, "teaching never forwards an action click");
    click(p, p.d.getElementById("refName"));
    press(p, "Add nearby section");
    assert.strictEqual(panel(p).querySelectorAll("fieldset").length, 3);
    press(p, "Remove Contact method");
    assert.strictEqual(panel(p).querySelectorAll("fieldset").length, 2);
    const sourceSelect = panel(p).querySelectorAll("fieldset select")[1];
    sourceSelect.value = "email";
    sourceSelect.dispatchEvent(new p.w.Event("change"));
    assert.strictEqual(panel(p).querySelectorAll("textarea")[1].value, "profile@example.com", "profile choice previews the actual profile value");
    press(p, "Save taught fields"); await settle();
    assert.strictEqual(p.store.jobRecipes.items.length, 1);
    assert.strictEqual(p.store.jobRecipes.items[0].taught.scope, "page", "page-only reuse is the default");
    assert.strictEqual(p.listeners.size, 0, "save removes storage listeners");
    assert.strictEqual(p.d.getElementById("refName").style.getPropertyValue("outline"), "1px dotted red");
    assert.strictEqual(p.d.getElementById("refName").style.getPropertyPriority("outline"), "important");
    assert(panel(p).textContent.includes("Taught fields saved")); press(p, "Close");

    const recipe = p.store.jobRecipes.items[0];
    p.d.getElementById("refName").replaceWith(p.d.getElementById("refName").cloneNode(true));
    const clear = () => { p.d.getElementById("refName").value = ""; p.d.getElementById("refEmail").value = ""; };
    clear();
    const used = new Set();
    const replay = await p.JA.fillLearnedWidgets({ email: "fresh@example.com" }, used);
    assert.strictEqual(replay.filled, 2);
    assert.strictEqual(p.d.getElementById("refName").value, "Reference Person");
    assert.strictEqual(p.d.getElementById("refEmail").value, "fresh@example.com");
    assert.strictEqual(p.d.getElementById("appName").value, "", "applicant Name is never mistaken for contact Name");
    assert.strictEqual(p.d.getElementById("appEmail").value, "");
    assert.strictEqual(used.size, 2);

    clear(); p.w.history.pushState({}, "", "/jobs/two");
    assert.strictEqual((await p.JA.fillLearnedWidgets({ email: "fresh@example.com" }, new Set())).filled, 0, "page-scoped answers stay on their page");
    p.w.history.pushState({}, "", "/jobs/one");
    p.d.getElementById("refEmail").type = "text";
    assert.strictEqual((await p.JA.fillLearnedWidgets({ email: "fresh@example.com" }, new Set())).filled, 0, "changed control types prevent replay before any writes");
    assert.strictEqual(p.d.getElementById("refName").value, "");
    p.d.getElementById("refEmail").type = "email";
    const twin = p.d.getElementById("contact").cloneNode(true);
    p.d.querySelector("form").append(twin);
    const ambiguous = await p.JA.fillLearnedWidgets({ email: "fresh@example.com" }, new Set());
    assert.strictEqual(ambiguous.filled, 0);
    assert(ambiguous.issues[0].includes("more than one section"));
    assert.strictEqual(p.d.getElementById("refName").value, "", "ambiguity prevents all writes");
    twin.remove();
    p.d.querySelector("#contact legend").textContent = "Different section";
    assert.strictEqual((await p.JA.fillLearnedWidgets({ email: "fresh@example.com" }, new Set())).filled, 0);
    p.d.querySelector("#contact legend").textContent = "Emergency contact";
    p.d.getElementById("refName").value = "Already entered";
    await p.JA.fillLearnedWidgets({ email: "fresh@example.com" }, new Set());
    assert.strictEqual(p.d.getElementById("refName").value, "Already entered", "existing answers are preserved");

    const malformed = JSON.parse(JSON.stringify(recipe));
    malformed.taught.controls.field0.type = "file";
    assert.strictEqual(p.SH.sanitizeRecipes({ items: [malformed] }).items.length, 0, "bad metadata is rejected without legacy fallback");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(p.SH.sanitizeRecipes({ items: [recipe] }).items[0].taught)), JSON.parse(JSON.stringify(recipe.taught)), "teaching metadata survives export sanitization");
    p.w.eval(POPUP_JS + "\nwindow.backupTest = { buildExportText, parseImportRecords };");
    const imported = p.w.backupTest.parseImportRecords(p.w.backupTest.buildExportText({ email: "qa@example.com" }, { items: [recipe] }));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(imported.widgets[0].taught)), JSON.parse(JSON.stringify(recipe.taught)), "actual backup and import preserve the complete mapping");
  } finally { p.w.close(); }

  const q = open();
  try {
    await q.JA.startTeaching(); click(q, q.d.getElementById("refEmail"));
    panel(q).querySelector("select").value = "site";
    q.failWrites(true); press(q, "Save taught fields"); await settle();
    assert(!q.store.jobRecipes, "failed saves never claim success");
    assert(panel(q).textContent.includes("Could not save"));
    q.failWrites(false); press(q, "Save taught fields"); await settle();
    assert.strictEqual(q.store.jobRecipes.items[0].taught.scope, "site"); press(q, "Close");
    q.w.history.pushState({}, "", "/jobs/two");
    q.d.getElementById("refEmail").value = "";
    assert.strictEqual((await q.JA.fillLearnedWidgets({}, new Set())).filled, 1, "explicit whole-site reuse works on another path");
    await q.JA.startTeaching(); click(q, q.d.getElementById("refName"));
    for (const listener of q.listeners) listener({ jobProfile: { newValue: {} } }, "local");
    assert(!q.d.getElementById("__jaTeach"), "profile changes cancel stale teaching sessions");
    assert.strictEqual(q.listeners.size, 0);
    await q.JA.startTeaching(); click(q, q.d.getElementById("refName")); press(q, "Cancel");
    assert.strictEqual(q.d.getElementById("refName").style.getPropertyValue("outline"), "1px dotted red");

    q.d.getElementById("method").value = "email";
    await q.JA.startTeaching();
    q.d.getElementById("method").dispatchEvent(new q.w.KeyboardEvent("keydown", { key: "F8", bubbles: true, cancelable: true }));
    assert.strictEqual(panel(q).querySelectorAll("fieldset").length, 1, "keyboard users can select fields");
    press(q, "Save taught fields"); await settle(); press(q, "Close");
    q.d.getElementById("method").value = "";
    assert.strictEqual((await q.JA.fillLearnedWidgets({}, new Set())).filled, 1);
    assert.strictEqual(q.d.getElementById("method").value, "email", "single-field native dropdowns replay their visible answer");
    const count = q.store.jobRecipes.items.length;
    const oldId = q.store.jobRecipes.items[0].id;
    q.d.getElementById("refEmail").value = "updated@example.com";
    await q.JA.startTeaching(); click(q, q.d.getElementById("refEmail"));
    panel(q).querySelector("select").value = "site";
    press(q, "Save taught fields"); await settle(); press(q, "Close");
    assert.strictEqual(q.store.jobRecipes.items.length, count, "teaching the same mapping updates rather than duplicates it");
    assert.strictEqual(q.store.jobRecipes.items[0].id, oldId);
    assert.strictEqual(q.store.jobRecipes.items[0].rows[0].field0.value, "updated@example.com");
  } finally { q.w.close(); }

  const r = open();
  try {
    const wrapper = r.d.createElement("fieldset");
    wrapper.innerHTML = '<legend>Contact preferences</legend><label for="channel">Channel</label><div class="select__control"><input id="channel" role="combobox" readonly aria-expanded="false"><div class="select__single-value">Email</div></div><div class="menu"></div>';
    r.d.querySelector("form").append(wrapper);
    const control = wrapper.querySelector(".select__control");
    control.addEventListener("mousedown", () => {
      const menu = wrapper.querySelector(".menu");
      menu.innerHTML = '<div class="select__option" role="option">Email</div>';
      r.d.getElementById("channel").setAttribute("aria-expanded", "true");
      menu.firstChild.addEventListener("click", () => {
        const value = r.d.createElement("div"); value.className = "select__single-value"; value.textContent = "Email";
        control.append(value); menu.replaceChildren();
        r.d.getElementById("channel").setAttribute("aria-expanded", "false");
      });
    });
    await r.JA.startTeaching(); click(r, r.d.getElementById("channel"));
    press(r, "Save taught fields"); await settle(); press(r, "Close");
    control.querySelector(".select__single-value").remove();
    assert.strictEqual((await r.JA.fillLearnedWidgets({}, new Set())).filled, 1);
    assert.strictEqual(control.querySelector(".select__single-value").textContent, "Email", "custom dropdown replay uses the exact selected control and verifies its committed value");

    r.store.jobRecipes = { items: [] };
    await r.JA.startTeaching(); click(r, r.d.getElementById("refName"));
    press(r, "Save taught fields"); await settle(); press(r, "Close");
    const name = r.d.getElementById("refName"); name.value = "";
    name.addEventListener("change", () => { name.value = ""; });
    const rejected = await r.JA.fillLearnedWidgets({}, new Set());
    assert.strictEqual(rejected.filled, 0, "framework-rejected writes are not reported as filled");
    assert(rejected.issues[0].includes("did not retain"));
  } finally { r.w.close(); }
  console.log("PASS explicit teaching, exact replay, scope, ambiguity and storage safety");
})().catch((error) => { console.error(error); process.exitCode = 1; });
