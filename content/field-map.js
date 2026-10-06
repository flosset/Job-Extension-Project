// field-map.js — pure data for field matching (no logic, no DOM access).
// Shares the window.__JobAutofill namespace with the other injected content
// scripts; loaded first so the others can read these tables.
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});

  // Pass 1 — ordered, case-insensitive attribute selectors. Earlier entries
  // have priority; the first visible, empty, fillable match wins.
  JA.ATTRIBUTE_SELECTORS = {
    firstName: [
      'input[autocomplete="given-name" i]',
      'input[name="first" i]',
      'input[id="first" i]',
      'input[name="first_name" i]',
      'input[name="firstname" i]',
      'input[name="given_name" i]',
      'input[name="fname" i]',
      'input[placeholder*="first" i]'
    ],
    lastName: [
      'input[autocomplete="family-name" i]',
      'input[name="last" i]',
      'input[id="last" i]',
      'input[name="last_name" i]',
      'input[name="lastname" i]',
      'input[name="family_name" i]',
      'input[name="surname" i]',
      'input[name="lname" i]',
      'input[placeholder*="last" i]'
    ],
    email: [
      'input[type="email" i]',
      'input[autocomplete="email" i]',
      'input[name*="email" i]',
      'input[id*="email" i]',
      'input[name*="e-mail" i]'
    ],
    phone: [
      'input[type="tel" i]',
      'input[autocomplete="tel" i]',
      'input[name*="phone" i]',
      'input[id*="phone" i]',
      'input[name*="mobile" i]',
      'input[name="tel" i]',
      'input[id="tel" i]'
    ],
    linkedin: [
      'input[name*="linkedin" i]',
      'input[id*="linkedin" i]',
      'input[placeholder*="linkedin" i]'
    ],
    github: [
      'input[name*="github" i]',
      'input[id*="github" i]',
      'input[placeholder*="github" i]'
    ],
    portfolio: [
      'input[name*="portfolio" i]',
      'input[id*="portfolio" i]',
      'input[name*="website" i]',
      'input[id*="website" i]',
      'input[name="personal_site" i]',
      'input[placeholder*="portfolio" i]',
      'input[placeholder*="website" i]'
    ],
    resume: [
      'textarea[name*="summary" i]',
      'textarea[id*="summary" i]',
      'textarea[name*="bio" i]',
      'textarea[id*="bio" i]',
      'textarea[name*="about" i]',
      'textarea[name*="cover" i]',
      'textarea[id*="cover" i]',
      'textarea[placeholder*="summary" i]',
      'textarea[placeholder*="about" i]'
    ],
    // --- Standard ATS details ---------------------------------------------
    address: [
      'input[autocomplete="street-address" i]',
      'input[name="address" i]',
      'input[id="address" i]',
      'input[name*="street" i]',
      'input[id*="street" i]',
      'input[name*="address1" i]',
      'input[name*="address_1" i]',
      'input[placeholder*="street" i]'
    ],
    city: [
      'input[autocomplete="address-level2" i]',
      'input[name*="city" i]',
      'input[id*="city" i]',
      'input[name*="town" i]',
      'input[placeholder*="city" i]'
    ],
    state: [
      'input[autocomplete="address-level1" i]',
      'input[name="state" i]',
      'input[id="state" i]',
      'input[name="state_province" i]',
      'input[name="address_state" i]',
      'input[name*="province" i]',
      'input[name*="region" i]'
    ],
    zip: [
      'input[autocomplete="postal-code" i]',
      'input[name*="zip" i]',
      'input[id*="zip" i]',
      'input[name*="postal" i]',
      'input[placeholder*="postal" i]'
    ],
    country: [
      'input[autocomplete="country" i]',
      'input[autocomplete="country-name" i]',
      'input[name*="country" i]',
      'input[id*="country" i]'
    ],
    currentCompany: [
      'input[autocomplete="organization" i]',
      'input[name*="company" i]',
      'input[id*="company" i]',
      'input[name*="employer" i]',
      'input[name*="organization" i]'
    ],
    currentTitle: [
      'input[autocomplete="organization-title" i]',
      'input[name*="jobtitle" i]',
      'input[name*="job_title" i]',
      'input[name*="position" i]',
      'input[name*="title" i]',
      'input[id*="title" i]'
    ],
    school: [
      'input[name*="school" i]',
      'input[id*="school" i]',
      'input[name*="university" i]',
      'input[name*="college" i]',
      'input[name*="institution" i]'
    ],
    degree: [
      'input[name*="degree" i]',
      'input[id*="degree" i]',
      'input[name*="qualification" i]'
    ],
    major: [
      'input[name*="major" i]',
      'input[id*="major" i]',
      'input[name*="field_of_study" i]',
      'input[name*="discipline" i]'
    ],
    graduationDate: [
      'input[name*="graduation" i]',
      'input[id*="graduation" i]',
      'input[name*="grad_date" i]',
      'input[name*="gradyear" i]',
      'input[name*="grad_year" i]'
    ],
    startDate: [
      'input[name*="startdate" i]',
      'input[name*="start_date" i]',
      'input[name*="available_date" i]',
      'input[name*="earliest" i]'
    ],
    yearsExperience: [
      'input[name*="years" i]',
      'input[id*="years" i]',
      'input[name*="experience_years" i]',
      'input[name*="yoe" i]'
    ],
    noticePeriod: [
      'input[name*="notice" i]',
      'input[id*="notice" i]',
      'input[name*="availability" i]'
    ],
    desiredSalary: [
      'input[name*="salary" i]',
      'input[id*="salary" i]',
      'input[name*="compensation" i]',
      'input[name*="expected_pay" i]'
    ],
    preferredLocation: [
      'input[name*="preferred_location" i]',
      'input[name*="work_location" i]',
      'input[name*="desired_location" i]',
      'input[id*="preferredlocation" i]'
    ],
    // Single-field "Full Name" (Lever and many smaller boards). Kept last so a
    // dedicated First/Last field always wins; the value is derived from
    // first + last at fill time unless the profile sets an explicit override.
    // Only exact/anchored selectors here — a loose name*="name" would match
    // "firstName", "lastName" and "company name".
    fullName: [
      'input[autocomplete="name" i]',
      'input[name="name" i]',
      'input[id="name" i]',
      'input[name*="fullname" i]',
      'input[id*="fullname" i]',
      'input[name*="full_name" i]',
      'input[placeholder*="full name" i]'
    ]
  };

  // Select-tag category — self-identification (EEO) dropdowns. Matched by
  // attribute selectors first, then by label keywords; the specific <option>
  // is then chosen by fuzzy-matching the stored value against the option text.
  JA.SELECT_SELECTORS = {
    gender: [
      'select[name*="gender" i]',
      'select[id*="gender" i]',
      'select[name*="sex" i]',
      'select[id*="sex" i]',
      'select[autocomplete="sex" i]'
    ],
    race: [
      'select[name*="race" i]',
      'select[id*="race" i]',
      'select[name*="ethnic" i]',
      'select[id*="ethnic" i]'
    ],
    veteran: [
      'select[name*="veteran" i]',
      'select[id*="veteran" i]',
      'select[name*="military" i]'
    ],
    disability: [
      'select[name*="disab" i]',
      'select[id*="disab" i]',
      'select[name*="handicap" i]'
    ],
    // Binary work-eligibility questions. Usually radio pairs, but some portals
    // render them as <select>, so they are covered here too.
    workAuthorized: [
      'select[name*="authoriz" i]',
      'select[id*="authoriz" i]',
      'select[name*="eligible" i]',
      'select[id*="eligible" i]',
      'select[name*="work" i]'
    ],
    sponsorship: [
      'select[name*="sponsor" i]',
      'select[id*="sponsor" i]',
      'select[name*="visa" i]',
      'select[id*="visa" i]'
    ]
  };

  // Pass 2 — keyword fallback for portals whose inputs have meaningless
  // name/id values (e.g. name="field_22"). Matched against the element's
  // visible label, aria-label/labelledby, placeholder, name, id, autocomplete.
  JA.KEYWORDS = {
    firstName: ["first name", "given name", "fname", "firstname"],
    lastName: ["last name", "family name", "surname", "lname", "lastname"],
    email: ["email", "e mail"],
    phone: ["phone", "mobile", "telephone", "cell phone", "contact number", "tel"],
    linkedin: ["linkedin", "linked in"],
    github: ["github", "git hub"],
    portfolio: ["portfolio", "website", "personal website", "web site", "personal site"],
    resume: [
      "summary",
      "bio",
      "biography",
      "about you",
      "about me",
      "objective",
      "professional summary",
      "describe yourself"
    ],
    // Self-identification (EEO) dropdowns — matched against <select> labels.
    gender: ["gender", "sex"],
    race: ["race", "ethnicity", "ethnic background"],
    veteran: ["veteran", "military status"],
    disability: ["disability", "disabled", "handicap"],
    // Binary work-eligibility questions (native <select> / custom dropdowns).
    workAuthorized: [
      "legally authorized to work",
      "authorized to work",
      "work authorization",
      "eligible to work",
      "right to work"
    ],
    sponsorship: [
      "require sponsorship",
      "need sponsorship",
      "visa sponsorship",
      "require a visa",
      "sponsorship"
    ],
    // --- Standard ATS details ---------------------------------------------
    address: [
      "street address",
      "address line",
      "mailing address",
      "home address",
      "address 1",
      "address1",
      "street"
    ],
    city: ["city", "town", "location city", "current city", "city of residence"],
    state: ["state", "province", "region"],
    zip: ["zip", "postal code", "postcode", "zip code"],
    country: ["country"],
    currentCompany: ["current company", "company", "employer", "organization"],
    currentTitle: ["job title", "current title", "position", "role"],
    school: ["school", "university", "college", "institution"],
    degree: ["degree", "qualification", "education level"],
    major: ["major", "field of study", "discipline"],
    graduationDate: [
      "graduation date",
      "graduation year",
      "graduation",
      "grad date",
      "grad year",
      "grad"
    ],
    startDate: ["start date", "available date", "earliest start", "earliest"],
    yearsExperience: [
      "years of experience",
      "years experience",
      "experience years"
    ],
    noticePeriod: ["notice period", "notice", "availability"],
    desiredSalary: [
      "desired salary",
      "expected salary",
      "salary",
      "compensation"
    ],
    preferredLocation: [
      "preferred location",
      "work location",
      "desired location",
      "location preference"
    ],
    // Deliberately NOT a bare "name" keyword — that would match the signal of
    // every "First Name" / "Company Name" field. Attribute selectors above
    // carry the single-field "Full Name" case.
    fullName: ["full name", "fullname", "legal name"]
  };

  // Radio-button groups — the tedious Yes/No questions ("legally authorized to
  // work?", "require sponsorship?") are almost always paired <input
  // type="radio">. Matched by the group's *question* text, then the chosen
  // option's own label ("Yes"/"No").
  JA.RADIO_KEYWORDS = {
    workAuthorized: [
      "legally authorized to work",
      "authorized to work",
      "work authorization",
      "eligible to work",
      "right to work"
    ],
    sponsorship: [
      "require sponsorship",
      "need sponsorship",
      "visa sponsorship",
      "require a visa",
      "now or in the future require sponsorship"
    ]
  };

  // Yes/No answers are matched through the same VALUE_SYNONYMS table above
  // (keys "yes" / "no"), so every widget type shares ONE token source. Every
  // match is polarity-gated in dom-utils (JA.pickPolaritySafe), which is what
  // makes loose tokens such as "authorized" safe to list at all.

  // Resume / CV file drop zones. Browser file-path reads are blocked, but a
  // file the user handed to the extension IS injectable via a DataTransfer.
  JA.FILE_KEYWORDS = [
    "resume",
    "cv",
    "curriculum vitae",
    "attach",
    "upload"
  ];

  // File inputs to leave alone. A cover letter is a different document, so the
  // stored resume must never be dropped into its slot.
  JA.FILE_EXCLUDE_KEYWORDS = ["cover letter", "cover", "transcript"];

  // A phone EXTENSION is not a phone number. Listed here (with the rest of the
  // matcher data) so every context has it: the page-wide matcher must never pour
  // a whole phone number into an extension box.
  JA.PHONE_EXTENSION_KEYWORDS = ["extension", "ext", "extn"];

  // Where a generated cover letter goes. Deliberately NOT part of the profile
  // keys: a letter is composed per application, so nothing fills these boxes
  // during an ordinary fill — the user asks for it explicitly.
  JA.COVER_LETTER_KEYWORDS = [
    "cover letter",
    "covering letter",
    "letter of interest",
    "letter of motivation",
    "motivation letter",
    "why do you want to work",
    "why are you interested",
    "anything else you",
    "additional information"
  ];

  // Stored self-identification value (normalised) → extra tokens to look for
  // in the dropdown's option text (case-insensitive, whole-word). Lets the
  // value "Male" match an option reading "Man", and "Prefer not to say" match
  // an option reading "Decline to self-identify". Keys must be the normalised
  // (lowercase, space-separated) stored string.
  JA.VALUE_SYNONYMS = {
    // Gender
    male: ["man"],
    female: ["woman"],
    "non binary": ["nonbinary", "genderqueer", "gender diverse", "gender variant"],
    // Race / ethnicity
    "american indian or alaska native": ["american indian", "alaska native", "native american"],
    asian: ["asian"],
    "black or african american": ["black", "african american"],
    "hispanic or latino": ["hispanic", "latino", "latina", "latinx"],
    "native hawaiian or other pacific islander": ["native hawaiian", "pacific islander"],
    white: ["caucasian"],
    "two or more races": ["two or more", "multiracial", "mixed", "more than one race"],
    // Veteran status. Only genuine synonyms for the *protected veteran*
    // classification — the VEVRAA sub-categories ("active duty", "reserve",
    // "national guard") are DIFFERENT answers, so matching onto them would
    // mis-state the user's status. Such forms are left unanswered instead.
    "i am a protected veteran": [
      "am a protected veteran",
      "protected veteran"
    ],
    "i am not a protected veteran": [
      "am not a protected veteran",
      "not a protected veteran",
      "not protected"
    ],
    // Disability status
    "yes i have a disability": ["yes", "have a disability"],
    "no i do not have a disability": ["no", "do not have a disability", "don t have a disability"],
    // Shared decline option
    "prefer not to say": [
      "prefer not",
      "decline",
      "do not wish",
      "don t wish",
      "not to disclose",
      "do not want",
      "no answer",
      "choose not",
      "wish to answer"
    ],
    // Binary answers (radio / native select / custom dropdown). These loose
    // token lists are safe because every match is polarity-gated in
    // dom-utils (JA.pickPolaritySafe): "Yes" can never land on a negated
    // option, and an ambiguous form is left blank rather than mis-answered.
    yes: [
      "yes", "y", "true", "authorized", "i am authorized",
      "i will require", "i do require", "i require sponsorship"
    ],
    no: [
      "no", "n", "false", "not authorized", "i am not authorized",
      "i do not require", "i will not require"
    ],
    // Country wording variants (the phone widget shows "🇺🇸 United States +1").
    "united states": ["us", "usa", "united states of america", "u s", "u s a"],
    usa: ["united states", "us"],
    us: ["united states", "usa"],
    // Degrees — portal dropdowns read "Bachelor's Degree", "Master's Degree" …
    bs: ["bachelor", "bachelors", "bachelor of science"],
    "b s": ["bachelor"],
    ba: ["bachelor", "bachelor of arts"],
    bachelor: ["bachelor", "b s", "bs"],
    "bachelor s": ["bachelor"],
    "bachelor s degree": ["bachelor"],
    ms: ["master", "masters", "master of science"],
    "m s": ["master"],
    ma: ["master", "master of arts"],
    mba: ["master", "business administration"],
    master: ["master", "m s", "ms"],
    "master s": ["master"],
    "master s degree": ["master"],
    phd: ["doctorate", "doctoral", "doctor of philosophy"],
    doctorate: ["phd", "doctoral"],
    associate: ["associate", "associates"],
    "high school": ["high school", "secondary school", "ged"]
  };

  // US state abbreviations ↔ full names, so a stored "TX" matches a dropdown
  // that lists "Texas" (and vice-versa).
  JA.STATE_ABBR = {
    al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas",
    ca: "california", co: "colorado", ct: "connecticut", de: "delaware",
    fl: "florida", ga: "georgia", hi: "hawaii", id: "idaho",
    il: "illinois", in: "indiana", ia: "iowa", ks: "kansas",
    ky: "kentucky", la: "louisiana", me: "maine", md: "maryland",
    ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi",
    mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada",
    nh: "new hampshire", nj: "new jersey", nm: "new mexico", ny: "new york",
    nc: "north carolina", nd: "north dakota", oh: "ohio", ok: "oklahoma",
    or: "oregon", pa: "pennsylvania", ri: "rhode island", sc: "south carolina",
    sd: "south dakota", tn: "tennessee", tx: "texas", ut: "utah",
    vt: "vermont", va: "virginia", wa: "washington", wv: "west virginia",
    wi: "wisconsin", wy: "wyoming", dc: "district of columbia"
  };

  // Repeatable sections — groups of fields the form lets you add more of
  // (Workday "Work Experience", education history, …). Each sub-field is
  // matched by label keywords, so no portal-specific ids are needed.
  JA.SECTIONS = {
    workExperience: {
      // A "block" is found by its Title field, then confirmed by the presence
      // of a Company field plus a From/Description field in the same ancestor.
      anchor: ["job title", "title", "position"],
      confirm: [
        ["company", "employer", "organization"],
        ["from", "start date", "role description", "description"]
      ],
      fields: {
        title: ["job title", "title", "position"],
        company: ["company", "employer", "organization"],
        location: ["location", "city", "region"],
        from: ["from", "start date", "start"],
        to: ["to", "end date", "end"],
        description: ["role description", "description", "responsibilities", "duties"],
        current: ["currently work", "i currently", "current position"]
      },
      addButton: ["add another", "add"],
      deleteButton: ["delete", "remove"],
      confirmButton: ["delete", "confirm", "yes", "ok"],
      dateFormat: "month-year"
    },

    education: {
      anchor: ["school or university", "school", "university"],
      confirm: [["degree"], ["from", "to", "gpa", "overall result"]],
      fields: {
        school: ["school or university", "school", "university", "institution", "college"],
        degree: ["degree"],
        major: ["field of study", "major", "discipline"],
        gpa: ["overall result", "gpa", "result", "grade"],
        from: ["from", "start"],
        to: ["to actual or expected", "to", "end"]
      },
      addButton: ["add another", "add"],
      deleteButton: ["delete", "remove"],
      confirmButton: ["delete", "confirm", "yes", "ok"],
      dateFormat: "year"
    }
  };

  // Input types we must never write text into. Setting .value on a file input
  // throws InvalidStateError, and the rest are non-textual controls.
  JA.NON_TEXT_INPUT_TYPES = [
    "file",
    "hidden",
    "checkbox",
    "radio",
    "submit",
    "button",
    "reset",
    "image",
    "range",
    "color"
  ];
})();
