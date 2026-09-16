# AES Coordinator Quarto Site

This is a local-only Quarto website for processing AES instructor submission JSON files.

## Files

- `_quarto.yml` — Quarto website configuration
- `index.qmd` — main page
- `app.js` — JSON parsing, Detailed View construction, and Planning View derivation
- `styles.css` — page and table styling

## Run locally

Open PowerShell in this folder and run:

```powershell
quarto preview
```

Your browser should open the local site automatically.

## Current workflow

1. Upload one or more instructor `.json` submission files.
2. The browser constructs the Detailed View.
3. If the instructor estimated more students than they named, placeholder student slots are added as `No student information`.
4. The Planning View is derived from the Detailed View.

No uploaded file is sent to a server by this site.
