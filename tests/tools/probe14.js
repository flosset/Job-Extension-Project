// probe14.js — step-by-step state dump for the completion model.
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = require("../_popup-source").POPUP_JS;

const dom = new JSDOM(
  `<!doctype html><html><body><div id="status"></div><ul id="unfilledList"></ul>
   <button id="saveBtn"></button><button id="fillBtn"></button>
   <button id="addSnippetBtn"></button><button id="addExpBtn"></button>
   <button id="addEduBtn"></button><input id="resumeFile" />
   <button id="clearResumeBtn"></button></body></html>`,
  { runScripts: "dangerously", pretendToBeVisual: true }
);
const { window } = dom;
window.chrome = {
  storage: { local: { get: async () => ({}), set: async () => {} } },
  runtime: { onMessage: { addListener: () => {} }, sendMessage: () => {} },
  tabs: { query: async () => [] },
  scripting: { executeScript: async () => [] }
};
window.eval(SRC + "\n; window.__test = { aggregate, setStatus };");

const agg = window.__test.aggregate;
const statusEl = () => window.document.getElementById("status");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const show = (label) =>
  console.log(
    `${label.padEnd(28)} status=${JSON.stringify(statusEl().textContent)} active=${agg.active} frames=${
      agg.results ? agg.results.frames : "-"
    } expected=${agg.expected}`
  );

(async () => {
  console.log("setStatus type:", typeof window.__test.setStatus);
  show("initial");
  agg.start();
  show("after start");
  agg.setExpected(3);
  show("after setExpected(3)");
  agg.add({ status: "ok", filled: 1 });
  show("after add 1");
  agg.add({ status: "ok", filled: 2 });
  show("after add 2");
  await sleep(600);
  show("after 600ms");
  agg.add({ status: "ok", filled: 4 });
  show("after add 3");
  await sleep(450);
  show("after grace");
})();
