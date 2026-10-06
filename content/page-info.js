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
  function headingRole() {
    const nodes = document.querySelectorAll("h1, [role='heading']");
    for (const node of nodes) {
      const text = clean(node.textContent);
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
      if (node.tagName === "INPUT" || node.tagName === "SELECT") continue;
      const text = clean(node.textContent);
      if (text.length < 2 || text.length > 80) continue;
      if (isVendor(text)) continue;
      return text;
    }
    return "";
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

    const company =
      clean(typeof org === "string" ? org : "") ||
      metaContent("og:site_name") ||
      labelledCompany() ||
      fromOg.company ||
      fromTitle.company;

    // og:title is a better guess than the <title> tag, which often carries the
    // board's own suffix ("Careers", "Jobs at …").
    const role =
      clean(typeof title === "string" ? title : "") ||
      headingRole() ||
      fromOg.role ||
      fromTitle.role;

    return {
      company: isVendor(company) ? "" : company,
      role,
      url: location.href,
      host: location.hostname,
      // JSON-LD is authoritative; anything else is a guess about a title string.
      confident: !!posting
    };
  };
})();