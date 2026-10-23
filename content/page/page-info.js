// page-info.js — reads WHAT JOB this page is about (company + role), so the
// application tracker can log it and warn about a repeat application.
//
// Deliberately conservative. A wrong company is worse than no company: two
// unrelated Greenhouse postings would both be attributed to "greenhouse" and the
// duplicate warning would fire on every one of them. So when only the ATS
// hostname is available we return NO company and let the log fall back to the
// posting URL, which is always right.
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});

  /** Segments of a page title that name the BOARD, not the employer. */
  const VENDOR_WORDS = [
    "greenhouse", "lever", "workday", "myworkdayjobs", "icims", "taleo",
    "successfactors", "smartrecruiters", "workable", "jobvite", "ashby",
    "recruitee", "bamboohr", "breezy", "jazzhr", "ultipro", "personio",
    "applicantstack", "recruiterbox", "jobs", "job", "careers", "career",
    "apply", "application", "hiring", "job application", "openings", "position"
  ];

  const MAX = 120;

  /** Trim, collapse whitespace and cap — titles can be enormous. */
  function clean(text) {
    return String(text == null ? "" : text)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX);
  }

  function isVendor(text) {
    const key = JA.normalize(text);
    if (!key) return true;
    return VENDOR_WORDS.indexOf(key) !== -1;
  }

  /** The schema.org JobPosting block, when the board publishes one. */
  function jobPosting() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      let data = null;
      try {
        data = JSON.parse(script.textContent || "");
      } catch (err) {
        continue; // A malformed block must not stop the scan.
      }
      const found = findPosting(data, 0);
      if (found) return found;
    }
    return null;
  }

  /** Depth-limited hunt for a JobPosting anywhere in the JSON-LD graph. */
  function findPosting(node, depth) {
    if (!node || typeof node !== "object" || depth > 4) return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = findPosting(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    const type = node["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.indexOf("JobPosting") !== -1) return node;
    for (const key of ["@graph", "itemListElement", "item", "mainEntity"]) {
      const found = findPosting(node[key], depth + 1);
      if (found) return found;
    }
    return null;
  }

  /** Split "Role - Company | Board" into its parts, ignoring vendor segments. */
  function splitTitle(title) {
    const text = clean(title);
    if (!text) return { role: "", company: "" };

    // "Role at Company" / "Role @ Company" first: unambiguous.
    const at = text.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
    if (at) {
      const company = clean(at[2].replace(/\s*[|–—-]\s*.*$/, ""));
      return { role: clean(at[1]), company: isVendor(company) ? "" : company };
    }

    const lever = /(^|\.)lever\.co$/i.test(location.hostname) && text.match(/^(.+?) - (.+)$/);
    if (lever) return { company: clean(lever[1]), role: clean(lever[2]) };

    const parts = text
      .split(/\s+[|–—-]\s+/)
      .map(clean)
      .filter(Boolean);
    // A title that is only the board's own name ("Careers") is not a job title.
    if (parts.length === 1) {
      return { role: isVendor(parts[0]) ? "" : parts[0], company: "" };
    }

    const meaningful = parts.filter((part) => !isVendor(part));
    // The company is the LAST segment that is not the board's own name, so
    // "… | Greenhouse" can never become the employer.
    let company = "";
    for (let i = parts.length - 1; i >= 1; i--) {
      if (!isVendor(parts[i])) {
        company = parts[i];
        break;
      }
    }
    return { role: meaningful[0] || parts[0], company: company === parts[0] ? "" : company };
  }

  /** <meta property="og:title">-style content, if present. */
  function metaContent(property) {
    const node = document.querySelector('meta[property="' + property + '"]');
    return node && node.content ? clean(node.content) : "";
  }

  /** First <h1>/[role=heading] that reads like a job title, not a button. */
  function headingRole(company) {
    const nodes = document.querySelectorAll('.posting-headline h2, .posting-header h2, .job-details__title, [data-automation-id="jobPostingHeader"], h1, [role="heading"]');
    for (const node of nodes) {
      if (!JA.isVisible(node)) continue;
      const text = clean(node.textContent);
      if (JA.normalize(text) === JA.normalize(company)) continue;
      if (text.length < 3 || text.length > 90) continue;
      if (/^(apply|apply now|sign in|log in|login|search|results|home)$/i.test(text)) continue;
      if (isVendor(text)) continue;
      return text;
    }
    return "";
  }

  /** A heading/class on the page that names the company outright. */
  function labelledCompany() {
    const nodes = document.querySelectorAll(
      '[class*="company" i], [class*="employer" i], [data-company]'
    );
    for (const node of nodes) {
      if (!JA.isVisible(node)) continue;
      if (node.tagName === "INPUT" || node.tagName === "SELECT") continue;
      const text = clean(node.textContent);
      if (text.length < 2 || text.length > 80) continue;
      if (isVendor(text)) continue;
      return text;
    }
    return "";
  }

  /**
   * The employer's logo alt text: "Acme logo" -> "Acme". Only an image that
   * actually says "logo" is used, so a random alt ("Team photo") cannot become
   * the company name, and a board's own logo ("Greenhouse") is rejected like any
   * other vendor word.
   */
  function logoCompany() {
    for (const image of document.querySelectorAll("img[alt]")) {
      const alt = clean(image.getAttribute("alt"));
      if (!alt || alt.length > 60) continue;
      if (!/\blogos?\b/i.test(alt)) continue;
      const stripped = alt
        .replace(/\blogos?\b/gi, "")
        .replace(/\b(company|official|website|home)\b/gi, "")
        .replace(/[\s\-–—|,.]+/g, " ")
        .trim();
      if (stripped.length >= 2 && stripped.length <= 60 && !isVendor(stripped)) {
        return stripped;
      }
    }
    return "";
  }

  /**
   * A trailing site word is not part of a company name: "NVIDIA Careers",
   * "Acme Job Board" and "Globex Careers Site" all name the company first.
   */
  function stripSiteWords(text) {
    let out = clean(text);
    if (!out) return "";
    const tails = [
      "careers site", "career site", "careers portal", "career portal",
      "job board", "job search", "careers", "career", "jobs", "job",
      "hiring", "recruitment", "recruiting", "talent", "site", "portal"
    ];
    let changed = true;
    while (changed) {
      changed = false;
      for (const tail of tails) {
        const pattern = new RegExp("\\s+" + tail.replace(/ /g, "\\s+") + "\\s*$", "i");
        if (pattern.test(out)) {
          out = out.replace(pattern, "").trim();
          changed = true;
        }
      }
    }
    return out;
  }

  // Hosts where the employer is named in the URL itself, and where that is
  // reliable enough to use as a LAST resort. `host` reads the tenant subdomain
  // (nvidia.wd5.myworkdayjobs.com); `path` reads the first path segment
  // (job-boards.greenhouse.io/acme/jobs/1).
  const TENANT_HOSTS = [
    { re: /(^|\.)myworkdayjobs\.com$/i, from: "host" },
    { re: /(^|\.)myworkday\.com$/i, from: "host" },
    { re: /(^|\.)workday\.com$/i, from: "host" },
    { re: /(^|\.)taleo\.net$/i, from: "host" },
    { re: /(^|\.)icims\.com$/i, from: "host" },
    { re: /(^|\.)bamboohr\.com$/i, from: "host" },
    { re: /(^|\.)breezy\.hr$/i, from: "host" },
    { re: /(^|\.)recruitee\.com$/i, from: "host" },
    { re: /(^|\.)applytojob\.com$/i, from: "host" },
    { re: /(^|\.)jazzhr\.com$/i, from: "host" },
    { re: /(^|\.)recruiterbox\.com$/i, from: "host" },
    { re: /(^|\.)teamtailor\.com$/i, from: "host" },
    { re: /(^|\.)applicantstack\.com$/i, from: "host" },
    { re: /(^|\.)ultipro\.com$/i, from: "host" },
    { re: /(^|\.)personio\.com$/i, from: "host" },
    { re: /(^|\.)successfactors\.(com|eu)$/i, from: "host" },
    { re: /(^|\.)sapsf\.(com|eu)$/i, from: "host" },
    { re: /(^|\.)greenhouse\.io$/i, from: "path" },
    { re: /(^|\.)lever\.co$/i, from: "path" },
    { re: /(^|\.)workable\.com$/i, from: "path" },
    { re: /(^|\.)smartrecruiters\.com$/i, from: "path" },
    { re: /(^|\.)ashbyhq\.com$/i, from: "path" },
    { re: /(^|\.)jobvite\.com$/i, from: "path" }
  ];

  /** URL words that are structures, not employers. */
  const RESERVED_URL_WORDS = [
    "www", "web", "jobs", "job", "jobboard", "careers", "career", "apply",
    "application", "applications", "app", "embed", "board", "boards", "portal",
    "search", "login", "signin", "register", "profile", "account", "external",
    "internal", "corporate", "home", "index", "en", "us", "uk", "eu", "v1", "v2",
    "api", "ats", "static", "assets", "media", "talent", "hiring", "recruiting",
    "recruitment", "sites", "site", "pages", "page", "view", "openings",
    "jobsearch", "careersection", "jobapp", "candidate", "my"
  ];

  /**
   * The employer's own identifier from the URL, for the boards that put it there.
   *
   * Only alphabetic tokens survive: a token with a digit is a tenant
   * environment or an id ("career5", "wd5"), not a company. This is the LAST
   * resort — it is only reached when the page itself named nothing.
   */
  function companyFromUrl() {
    let url = null;
    try {
      url = new URL(location.href);
    } catch (err) {
      return "";
    }
    const host = String(url.hostname || "").toLowerCase();
    // Workday tenants can be shared HR systems. Corroborate the site's name
    // with its employer privacy domain before falling back to a tenant name.
    if (/(^|\.)myworkdayjobs\.com$/i.test(host)) {
      const tokens = url.pathname.toLowerCase().split(/[^a-z0-9]+/);
      for (const link of document.querySelectorAll('a[href]')) {
        if (!/privacy/i.test(link.textContent || "")) continue;
        try {
          const employer = new URL(link.href).hostname.split('.').slice(-2)[0];
          if (employer && !isVendor(employer) && tokens.includes(employer)) {
            return employer.length <= 4 ? employer.toUpperCase() : employer[0].toUpperCase() + employer.slice(1);
          }
        } catch (err) { /* an invalid link is not employer evidence */ }
      }
    }
    let source = "";
    for (const rule of TENANT_HOSTS) {
      if (!rule.re.test(host)) continue;
      source = rule.from === "host"
        ? host.split(".")[0]
        : url.pathname.split("/").filter(Boolean)[0] || "";
      break;
    }
    if (!source) return "";
    try {
      source = decodeURIComponent(source);
    } catch (err) {
      /* keep the raw text */
    }
    const words = source
      .toLowerCase()
      .split(/[-_.+]+/)
      .map((word) => word.replace(/[^a-z0-9]/g, ""))
      .filter((word) => /^[a-z]{2,}$/.test(word))
      .filter((word) => RESERVED_URL_WORDS.indexOf(word) === -1);
    if (words.length === 0) return "";
    return words
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
      .slice(0, 80);
  }

  /**
   * What this page is an application for.
   *
   * Returns null inside a subframe: the top frame owns the posting, and asking
   * an embedded ATS widget would only yield its own noise.
   */
  JA.pageInfo = function () {
    try {
      if (window.top !== window) return null;
    } catch (err) {
      return null; // cross-origin window access — this frame is not the top one
    }

    const posting = jobPosting();
    const org = posting && posting.hiringOrganization
      ? posting.hiringOrganization.name || posting.hiringOrganization
      : "";
    const title = posting ? posting.title || posting.name || "" : "";

    const fromTitle = splitTitle(document.title);
    const ogTitle = metaContent("og:title");
    const fromOg = splitTitle(ogTitle);

    // Every candidate is filtered as we go, so a board's own name ("Greenhouse")
    // is SKIPPED rather than stopping the chain — otherwise a page that names
    // only the vendor would end up with no company at all, even when its logo
    // alt text names the employer.
    const candidates = [
      clean(typeof org === "string" ? org : ""),
      stripSiteWords(metaContent("og:site_name")),
      logoCompany(),
      stripSiteWords(labelledCompany()),
      stripSiteWords(fromOg.company),
      stripSiteWords(fromTitle.company),
      // LAST resort: the board's own URL. For Workday (nvidia.wd5…), Taleo,
      // iCIMS and BambooHR the tenant subdomain IS the employer; for
      // Greenhouse/Lever/Workable/Ashby it is the first path segment. Structure
      // words and anything containing a digit ("wd5", "career5") are rejected,
      // so a guess can never become a bogus company that fires false duplicate
      // warnings — and the field is editable in any case.
      companyFromUrl()
    ];
    const company = candidates.find((value) => value && !isVendor(value)) || "";

    // og:title is a better guess than the <title> tag, which often carries the
    // board's own suffix ("Careers", "Jobs at …").
    const role =
      clean(typeof title === "string" ? title : "") ||
      headingRole(company) ||
      fromOg.role ||
      fromTitle.role;

    return {
      company,
      role,
      url: location.href,
      host: location.hostname,
      // JSON-LD is authoritative; anything else is a guess about a title string.
      confident: !!posting
    };
  };


  /**
   * The current page's host, lowercased. Used to scope a learned widget to the
   * site it was taught on, by both the learning and the replay side.
   */
  JA.pageHost = function () {
    return String((window.location && window.location.host) || "").toLowerCase();
  };
})();
