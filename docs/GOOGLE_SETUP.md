# Google sign-in, the Google Form, and checking reports

Students sign in with their college Google account, sit the exam, and download a sealed PDF. They upload that PDF to a Google Form. You check each PDF with the verify tool.

## Part 1. Google sign-in (done)

`config.js` already holds the OAuth Client ID, so the sign-in page shows **Sign in with Google** and accepts only `karunya.edu.in` accounts. The name and email come from Google.

To use the exam from another address, add it in Google Cloud Console under the client's **Authorized JavaScript origins**, without a path:

- `https://YOUR-GITHUB-USERNAME.github.io` once the site is published
- `http://localhost:8000` and `http://127.0.0.1:8000` for trying it with `npm run serve`

If the Cloud project's app is **External**, set it to **In production** (Audience → Publish app); in **Testing**, only listed test users can sign in. To turn Google sign-in off, set `GOOGLE_CLIENT_ID` to `""`; students then type name and email.

## Part 1b. Sign students out of Google on lab PCs

The exam never keeps a sign-in: each time the page opens, the student must sign in again, and Google's automatic sign-in is turned off. But Chrome itself stays signed in to the student's Google account until it is signed out, and a web page cannot do that when a tab closes. On shared lab PCs:

- **After submitting**, the receipt screen has **Back to main page**, which returns to the sign-in page for the next student. Every sign-in opens Google's account chooser, so the next student picks their own account instead of the previous one.
- **Automatically, whenever Chrome closes** (once per lab PC, about a minute):
  1. In Chrome, open `chrome://settings/content/siteData` (Settings → Privacy and security → Third-party cookies or Site data).
  2. Turn on **Clear cookies and site data when you close all windows** (on some versions: **Delete data that sites have saved to your device when you close all windows**).
  3. Under **Allowed to save data on your device** (or **Sites that can always use cookies**), click **Add** and enter `https://rishabhaldar-afk.github.io`. This keeps the exam's saved work, so a student whose browser closes by accident can sign in again and resume.
  4. In Edge, the same setting is under Settings → Privacy, search, and services → **Choose what to clear every time you close the browser** → **Cookies and other site data**, with the exam site added under **Don't clear**.

  With this on, closing all Chrome windows signs every Google account out of that PC. Closing just one tab does not; the account chooser covers that case.

## Part 2. The Google Form

1. Open <https://forms.google.com/> and create a form, for example "Lab exam submission".
2. Add questions:
   - **Register number** (short answer, required).
   - **Receipt code** (short answer, required). Description: "The code on your receipt screen, for example 5C53-F362-8AC0."
   - **Report** (File upload, required): allow only **PDF**, 1 file, maximum size 10 MB.
   - If several faculty share one form, add **Faculty** (drop-down, required) with each name. Or make one form per faculty.
3. In **Settings → Responses**, turn on **Collect email addresses** (Verified) and **Limit to 1 response**. File upload already requires the student to sign in with Google.
4. Uploaded files land in a Drive folder owned by the form's owner. To give another faculty member access, share that folder or add them as an editor of the form. With one form per faculty, each faculty member owns their own folder.

## Part 3. In the lab

- When a student submits, the receipt screen shows a code such as `5C53-F362-8AC0`. Each student writes that code on the attendance sheet next to their signature, and the invigilator glances at the screen to confirm it.
- The receipt is a fingerprint of the student's actual work. A changed or rebuilt PDF has a different code, so the code on paper is what makes the PDF hard to forge.

## Part 4. Checking the uploaded PDFs

1. In the form's **Responses**, open the uploads folder in Drive and download it.
2. From a computer with this project:
   ```bash
   node tools/summarize.mjs path/to/folder > results.csv
   ```
   The CSV has one row per PDF, with the `receipt` and an `integrity` column:
   - `OK`: the file is exactly what the exam produced.
   - `EDITED`: the pages or the file were changed after the exam (opened in a PDF editor, re-saved, or modified).
   - `TAMPERED`: the data sealed inside does not match its receipt.
3. Compare each `receipt` with the code on the attendance sheet. A mismatch means the PDF is not the one made in the lab.

To check a single file:

```bash
node tools/verify-submission.mjs report.pdf
```

## What the seal can and cannot do

- Any change to a downloaded PDF, even re-saving it, shows as `EDITED`.
- A change to the data inside it shows as `TAMPERED`.
- The exam runs in the student's browser and its code is public, so a determined student could build a fake PDF that passes both checks. It would not have the receipt code written on the attendance sheet in the lab. Always compare receipts.
