// End-to-end test for ADDRESS-style fields that are dropdowns:
//   country  â€” native <select> whose option is "ðŸ‡ºðŸ‡¸ United States +1"
//   state    â€” react-select whose options are full names ("Texas")
//   location â€” Places-style text input labelled "Location (City)"
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const APP = "g:\\Programming\\Job Extension Project";
const SOURCE = require("./_popup-source").CONTENT_SCRIPTS
  .map((f) => fs.readFileSync(path.join(APP, f), "utf8"))
  .join("\n");
const html = `<!doctype html><html><body>
  <label for="country_code">Country*</label>
  <select id="country_code" name="country">
    <option value="">Select...</option>
    <option value="US">ðŸ‡ºðŸ‡¸ United States +1</option>
    <option value="CA">Canada +1</option>
    <option value="GB">United Kingdom +44</option>
  </select>

  <label for="phone">Phone*</label>
  <input type="tel" id="phone" name="phone" />

  <label for="location_city">Location (City)*</label>
  <input type="text" id="location_city" name="location" />

  <label id="cb-state-label">What U.S State do you currently reside in?*</label>
  <div class="select__control" data-mock-combo="state">
    <div class="select__value-container">
      <div class="select__placeholder">Select...</div>
      <input class="select__input" role="combobox" aria-labelledby="cb-state-label" readonly />
    </div>
  </div>
  <div class="cb-menu"></div>

  <script>
    var options = ['California', 'Texas', 'New York', 'Washington'];
    document.querySelectorAll('[data-mock-combo]').forEach(function (control) {
      control.addEventListener('mousedown', function () {
        var menu = control.parentElement.querySelector('.cb-menu');
        var input = control.querySelector('.select__input');
        if (menu.innerHTML) { menu.innerHTML = ''; if (input) input.setAttribute('aria-expanded', 'false'); return; }
        menu.innerHTML = options.map(function (c) {
          return '<div class="select__option">' + c + '</div>';
        }).join('');
        if (input) input.setAttribute('aria-expanded', 'true');
      });
    });
    document.addEventListener('click', function (e) {
      var option = e.target.closest ? e.target.closest('.select__option') : null;
      if (!option) return;
      var menu = option.closest('.cb-menu');
      var container = menu.parentElement.querySelector('.select__value-container');
      var ph = container.querySelector('.select__placeholder'); if (ph) ph.remove();
      var ex = container.querySelector('.select__single-value'); if (ex) ex.remove();
      var v = document.createElement('div');
      v.className = 'select__single-value';
      v.textContent = option.textContent;
      container.insertBefore(v, container.firstChild);
    });
  </script>
</body></html>`;

const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
const { window } = dom;
const { document } = window;
window.Element.prototype.getClientRects = () => [{ width: 10, height: 10 }];
window.Element.prototype.getBoundingClientRect = () => ({ width: 10, height: 10, top: 0, left: 0 });

window.chrome = {
  storage: {
    local: {
      get: async () => ({
        jobProfile: {
          phone: "+1 555 111 1111",
          country: "United States",
          state: "TX",
          city: "Austin"
        }
      })
    }
  },
  runtime: { sendMessage: () => {} }
};

window.eval(SOURCE);

(async () => { await Promise.race([window.__jobAutofillRun, new Promise((r) => setTimeout(r, 15000))]);
  const countrySel = document.getElementById("country_code");
  const countryText = countrySel.options[countrySel.selectedIndex].textContent;
  const countryVal = countrySel.value;
  const location = document.getElementById("location_city").value;
  const stateLabel = document.getElementById("cb-state-label");
  const stateControl = stateLabel.parentElement.querySelector(".select__control");
  const stateVal = stateControl.querySelector(".select__single-value");
  const stateText = stateVal ? stateVal.textContent : "(empty)";
  const phone = document.getElementById("phone").value;

  console.log("\n--- RESULT ---");
  const checks = [
    ["country select value   ", countryVal, "US"],
    ["country option text    ", countryText, "ðŸ‡ºðŸ‡¸ United States +1"],
    ["location (city) input  ", location, "Austin"],
    ["state combo (TXâ†’Texas) ", stateText, "Texas"],
    ["phone                  ", phone, "+1 555 111 1111"]
  ];
  let ok = true;
  for (const [name, got, want] of checks) {
    const pass = got === want;
    ok = ok && pass;
    console.log(`${name}: ${JSON.stringify(got)} ${pass ? "PASS" : "FAIL (want " + JSON.stringify(want) + ")"}`);
  }
  console.log("\n" + (ok ? "ADDRESS-DROPDOWN E2E PASS" : "ADDRESS-DROPDOWN E2E FAIL"));
  process.exit(ok ? 0 : 1);
})();
