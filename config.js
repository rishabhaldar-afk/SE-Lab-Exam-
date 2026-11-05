/** Exam settings. Edit this file before exam day. See README.md. */
export const CONFIG = {
  /** Shown on the gate and the report. */
  EXAM_TITLE: "Software Engineering Lab Exam",
  COURSE: "Software Engineering",
  /** Length of a sitting, in minutes. The clock starts at the first successful gate entry. */
  EXAM_DURATION_MIN: 120,
  /** Optional absolute close time as an ISO string, or null. The earlier deadline wins. */
  EXAM_CLOSES_AT: null,
  /** Counted incidents before the screen locks for the invigilator. */
  MAX_VIOLATIONS: 3,
  /**
   * Questions are handed out on paper. Students type their question number at
   * sign-in; it must be 1 to QUESTION_COUNT.
   */
  QUESTION_COUNT: 25,
  /**
   * PBKDF2-SHA256 of the invigilator PIN. The scaffold PIN is lab-invigilator.
   * Replace this with the output of tools/make-hash.mjs before a real exam.
   */
  INVIGILATOR_PIN_HASH: {
    kdf: "PBKDF2-SHA256",
    iter: 310000,
    salt: "VFsxc8pFiY6/Qt3cIm/s2A==",
    hash: "f98b9096f95ff017c89204f1628dcbbee8f305c11c31c49c995fcae24bf622f0",
  },
  /** Wall-clock limit for one continuous Python run. */
  RUN_TIMEOUT_MS: 5000,
  /** Stdout plus stderr cap for one run. The worker is terminated past this. */
  OUTPUT_LIMIT_BYTES: 200000,
  /**
   * Google sign-in. Paste the OAuth client ID from docs/GOOGLE_SETUP.md.
   * Empty: students type their name and email instead.
   */
  GOOGLE_CLIENT_ID: "20808194343-mhfavftb3h5fdrtm6nbpjofdl01ohff2.apps.googleusercontent.com",
  /** Only Google accounts of this domain may sign in. Empty allows any Google account. */
  GOOGLE_ALLOWED_DOMAIN: "karunya.edu.in",
  /** Only postMessage peer for the diagram editor. */
  DRAWIO_ORIGIN: "https://embed.diagrams.net",
  /**
   * Applied after normalizeReg (trim, uppercase, remove spaces).
   * Change this to your college register-number format.
   */
  REGNO_PATTERN: "^[A-Z0-9][A-Z0-9/-]{2,31}$",
  BUILD_ID: "2026-11-02.1",
  CONFIG_VERSION: 1,
};
