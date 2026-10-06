const { JSDOM } = require("jsdom");
const dom = new JSDOM('<input type="file" id="f">');
const f = dom.window.document.getElementById("f");
try {
  f.value = "x";
  console.log("jsdom did NOT throw when setting file input value; value =", JSON.stringify(f.value));
} catch (e) {
  console.log("jsdom threw:", e.name, "-", e.message);
}
