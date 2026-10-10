"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const files = fs.readdirSync(__dirname)
  .filter((file) => /\.test\.js$/.test(file)).sort();
const dir = path.join(__dirname, ".last-run");
fs.mkdirSync(dir, { recursive: true });
Promise.all(files.map((file) => new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(__dirname, file)], { cwd: __dirname });
  let out = "", err = "";
  const timer = setTimeout(() => child.kill(), 120000);
  child.stdout.on("data", (data) => { out += data; });
  child.stderr.on("data", (data) => { err += data; });
  child.on("error", (error) => { err += error.message; });
  child.on("close", (code) => {
    clearTimeout(timer);
    fs.writeFileSync(path.join(dir, file.replace(/\.js$/, ".out.txt")), out);
    fs.writeFileSync(path.join(dir, file.replace(/\.js$/, ".err.txt")), err);
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