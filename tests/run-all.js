"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const TESTS_DIR = __dirname;

/**
 * Every suite under tests/, at any depth, as a "group/name.test.js" path. The
 * suites are grouped by area, so discovery has to walk the folders; helper
 * files never end in .test.js and are ignored.
 */
const findSuites = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.name !== "node_modules" && entry.name !== ".last-run")
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return findSuites(full);
      return /\.test\.js$/.test(entry.name)
        ? [path.relative(TESTS_DIR, full).split(path.sep).join("/")]
        : [];
    });

const files = findSuites(TESTS_DIR).sort();
if (files.length === 0) {
  console.error("no *.test.js files found under " + TESTS_DIR);
  process.exit(1);
}

// ".last-run" captures keep a flat, unique name per suite (group__name).
const flatName = (file) => file.replace(/[\\/]/g, "__");
const dir = path.join(TESTS_DIR, ".last-run");
fs.mkdirSync(dir, { recursive: true });

Promise.all(files.map((file) => new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(TESTS_DIR, file)], { cwd: TESTS_DIR });
  let out = "", err = "";
  const timer = setTimeout(() => child.kill(), 120000);
  child.stdout.on("data", (data) => { out += data; });
  child.stderr.on("data", (data) => { err += data; });
  child.on("error", (error) => { err += error.message; });
  child.on("close", (code) => {
    clearTimeout(timer);
    fs.writeFileSync(path.join(dir, flatName(file).replace(/\.js$/, ".out.txt")), out);
    fs.writeFileSync(path.join(dir, flatName(file).replace(/\.js$/, ".err.txt")), err);
    const ok = code === 0 && !/FAIL/.test(out) && /PASS/.test(out);
    console.log(`${ok ? "PASS" : "FAIL"} ${file}`);
    if (!ok) console.error(out + err);
    resolve(ok);
  });
}))).then((results) => {
  const ok = results.every(Boolean);
  console.log(`${ok ? "ALL GREEN" : "FAILURES"}: ${files.length} suites`);
  process.exitCode = ok ? 0 : 1;
});
