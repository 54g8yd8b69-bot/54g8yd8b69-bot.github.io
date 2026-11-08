# Editing the Guide Card catalogue

All records live in **`guide-card.json`**. You can add or change records without touching any code.

**On GitHub:** open `guide-card/data/guide-card.json`, click the pencil icon, make your change, then commit. The *Build Guide Card* action checks the file and rebuilds the app. If something is wrong, for example a missing comma, an unknown type or a related id that doesn't exist, the action turns red and its log lists each problem. Nothing goes live until it passes.

**On a computer:** edit the file, then run `python3 guide-card/tools/build.py`. It prints the same problem list, or writes `guide-card/index.html`.

## Adding a record

Copy an existing record of the same kind, paste it after any `},`, and change the values. A minimal guideline looks like this:

```json
{
 "id": "bsp-example",
 "title": "Official title exactly as published",
 "short": "Short title shown in lists",
 "publisher": "British Society of Periodontology",
 "year": 2026,
 "type": "guideline",
 "specialties": ["perio"],
 "topic": "Periodontitis treatment",
 "group": "Treatment & referral",
 "aliases": ["words people might search for", "abbreviations", "US spellings"],
 "jurisdiction": "UK",
 "useWhen": "you are planning non-surgical periodontal therapy.",
 "url": "https://www.bsperio.org.uk/…",
 "checked": "2026-11-08"
},
```

The rules from the original specification still apply:

- Only use URLs, dates, editions and status that you have seen on the source itself.
- Don't copy a society hub page into many records.
- Leave out `status` if the publisher doesn't state one.
- Put anything you can't verify in `pending`, not `refs`.

## Fields

| Field | Required | What it is |
|---|---|---|
| `id` | yes | Stable identifier: lower-case letters, numbers and hyphens. Never change it once published, because shared links and pins use it. |
| `title` | yes | Official title. |
| `short` | yes | Short title for lists. |
| `publisher` | yes | Issuing body, or the authors for original publications. |
| `year` | | Publication year (number). Leave it out if the publisher doesn't give one. |
| `edition` | | Edition or update wording, e.g. `"Updated 2021"`. |
| `type` | yes | `guideline`, `consensus`, `standard`, `commissioning`, `classification`, `tool`, `prom`, `technical` or `training`. |
| `measure` | for classifications | `screening`, `diagnosis`, `severity`, `risk`, `complexity`, `outcome`, `descriptive` or `performance`. |
| `specialties` | yes | List. The **first** decides which Library section it appears in. Codes are listed in `vocab.specialties`. |
| `topic` | yes | Free-text topic. |
| `group` | in grouped sections | Topic sub-group inside the section. It must be one of that section's `groups` (see `sections` near the top of the file). The build tells you the choices. |
| `population` | | e.g. `"Children & adolescents 7–17"`. |
| `aliases` | yes | Search words: synonyms, abbreviations, US spellings, eponyms. |
| `jurisdiction` | yes | Provenance: `UK`, `ENG` (England only), `SCO`, `LOCAL`, `EUR`, `INTL`, `US`, `GB`, or `RES` (original publication). An English policy must be `ENG`, never `SCO`. |
| `nation` | for `LOCAL` | `"Scotland"`, `"Wales"`, `"Northern Ireland"` or `"England"`. |
| `ukRelevance` | | Note on how it applies in the UK, kept separate from provenance. |
| `status` | | `current`, `archived`, `superseded`, `proposed` or `historical`, but only if the publisher states it. |
| `useWhen` | yes | Finishes the sentence "Use this when …". |
| `url` | yes | Primary link (https). Link the document itself rather than a hub page. |
| `links` | | Extra links: `[{"label": "Summary PDF", "url": "https://…"}]`. |
| `parts` | | Chapters or parts: `[{"label": "Part 1", "url": "https://…"}]`. The `url` is optional. |
| `related` | | Ids of related records. Each id must exist. |
| `access` | | `"restricted"` for paid standards. |
| `note` | | Short note shown in the details. |
| `keyPoints` | | List of short points. |
| `tool` | | Opens a built-in tool: `iotn`, `bsp`, `bpe`, `mronj`, `anticoag` or `rdiotn`. |
| `checked` | yes | Date you last checked the source, `YYYY-MM-DD`. Update it whenever you re-check. |
| `recheckBy` | | Override the automatic re-check date (normally `checked` + 12 months). |
| `reviewNote` | | Set this when the publisher says the document is being revised. The record is then flagged **Under review** and this text is shown. Remove it when the new edition is out. |
| `suiteLinks` | | Buttons to other Notile apps: `[{"label": "Design it in Chrome Card", "path": "/chrome-card/"}]`. A DentalAudit link can start an audit from a template, e.g. `"/dentalaudit/#/create?template=bpe"` (templates: radiographs, antimicrobial, medical-history, bpe, consent, rubber-dam, implant-torque). |

Other parts of the file:

- `recheckMonths` sets how long a record stays current before it is flagged **Re-check due**.
- `sections` sets the Library sections, which specialties they hold and their topic groups. To add a new topic group, add its name to the section's `groups`.
- `defaultPins` sets the quick links a new user starts with: `r:<record id>` or `t:<tool id>`.
- `pending` holds requested items that haven't been verified yet, shown on the About page.
- `vocab` holds the labels for each code.

## Monthly link check

The *Guide Card link check* action runs on the 1st of each month and writes `link-report.md` in this folder. You can also run it from the Actions tab, or locally with `python3 guide-card/tools/check_links.py`.

The report groups links as follows:

- **Broken**: the action turns red and GitHub emails you.
- **Moved**: the link now redirects somewhere new.
- **Content changed**: the page or PDF differs from last month, which may mean a new edition.
- **Unconfirmed**: the publisher blocked the automated check. This doesn't mean the link is dead.
