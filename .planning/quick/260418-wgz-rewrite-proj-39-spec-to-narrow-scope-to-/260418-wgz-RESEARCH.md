# PROJ-39 Scope Research — Plug-in Battery Feed-in Legality (DE & NL)

**Researched:** 2026-04-18
**Domain:** Regulatory / grid-connection rules for plug-in (Schuko) battery storage ≤ 800 W
**Confidence:** HIGH for DE, MEDIUM for NL (post-2027 regime partially unclear)

---

## TL;DR — Answer for the User

| Question | Answer |
|----------|--------|
| Is plug-in battery feed-in ≤ 800 W legal in **DE** in 2026? | **YES** — as of VDE-AR-N 4105:2026-03 (effective 2026-03-01), plug-in battery storage *without* PV is explicitly recognised (new Form F.1.2) with an 800 VA feed-in cap. No grid-operator approval, only a MaStR (Marktstammdatenregister) self-registration. |
| Is plug-in battery feed-in ≤ 800 W legal in **NL** in 2026? | **PARTIALLY** — 800 W is **not a formal statutory cap** (ACM has issued no binding 800 W rule; NVWA has a safety guidance; 800 W derives from EU RfG Regulation 2016/631 Art. 5 "non-significant" threshold and EN 50549-1 Type A). Registration via **energieleveren.nl is mandatory** (Netbeheer Nederland guidance, threshold 0.8 kW). Legal status of backfeed through a Schuko plug is officially a "gray area" — no explicit permission, no explicit prohibition. |
| Is **Marstek Venus B (2 kWh, 800 W Schuko)** usable in both countries without netbeheerder approval? | **DE: Yes** (self-register in MaStR, Form F.1.2). **NL: De-facto yes** with mandatory registration on energieleveren.nl, but regulatory status is explicitly described as "grey" by trade sources — not an explicit green light. |

**User's belief is correct for DE and substantially correct for NL, but with important NL caveats:**
- NL has **no formal 800 W statutory limit** the way DE does — the 800 W figure comes from EU classification and the Marstek device self-limits
- NL **requires registration** (energieleveren.nl) — this is mandatory, not optional, and is a real legal obligation per Netbeheer Nederland
- NL's legal status is "grey area" per industry sources, not a clear affirmative permission

---

## 1. Germany — Plug-in Battery Feed-in ≤ 800 W (2026)

### 1.1 Current regime (effective 2026-03-01)

**Key rule:** VDE-AR-N 4105:**2026-03** (published March 2026) explicitly adds plug-in battery storage *without* PV modules to its scope via new registration form **F.1.2**.

Citations:
- [VDE-AR-N 4105:2026-03 summary — photovoltaik.sh](https://www.photovoltaik.sh/news/aktualisierte-vde-ar-n-41052026-03-vereinfachter-anschluss-von-klein-erzeugungsanlagen-bis-800-va): "Steckerspeicher ohne PV" is a recognised device category; up to 800 VA feed-in can be registered by laypersons.
- [DKE/VDE — world's first product standard for plug-in solar devices](https://www.vde.com/en/press/press-releases/first-product-standard-for-plug-in-solar-devices): Product standard adopted 2026.
- [balkon.solar 2026-03 analysis](https://balkon.solar/news/2026/03/18/neue-vde-ar-n-4105-und-steckersolar/): Confirms plug-in storage now formally covered. `[CITED]`
- [Kleines Kraftwerk — Neue VDE-Richtlinie](https://kleineskraftwerk.de/blogs/magazin/neue-vde-richtlinie-bringt-durchbruch): AC-coupled storage can be registered as a layperson with Form F 1.2, with 800 VA feed-in cap — storage capacity itself is unlimited.

### 1.2 Specific rules

| Item | Rule |
|------|------|
| Max feed-in power (AC, at inverter nameplate) | **800 VA** |
| Max installed PV DC power (if any) | 2 000 W (up to 7 000 Wp possible in extended combinations — not applicable to battery-only) |
| Max battery storage capacity | **Not limited** |
| Registration | **MaStR only** (Marktstammdatenregister), Form F.1.2 |
| Grid-operator (Netzbetreiber) approval | **Not required** for units ≤ 800 VA (since Solarpaket I 2024, the separate Netzbetreiber-Meldung was abolished) |
| Installation | **Layperson permitted** (Schuko plug) |
| Timeframe to register after commissioning | Within 1 month |

Citations:
- [Verbraucherzentrale — Marktstammdatenregister guidance](https://www.verbraucherzentrale-bremen.de/wissen/energie/erneuerbare-energien/marktstammdatenregister-das-muessen-sie-bei-solaranlage-und-co-wissen-33124) `[CITED]`
- [Jackery DE — MaStR Anmeldung 2026](https://de.jackery.com/blogs/balkonkraftwerk/marktstammdatenregister-anmeldung): MaStR replaces separate utility notification after Solarpaket I.
- [Energiemagazin — Balkonkraftwerk Gesetz 2026](https://www.energiemagazin.com/balkonkraftwerk/vereinfachte-regeln/): 800 W cap explicit, registration simplified.

### 1.3 Distinction: PV-only plug-in vs. battery-integrated plug-in

Before 2026-03: VDE-AR-N 4105:**2025-01** covered PV-only plug-in ("Steckersolargerät") with 800 VA cap. Battery storage was ambiguous — some manufacturers registered on PV side, others under BDEW rules, some legally unclear.

After 2026-03: The 2026-03 revision explicitly introduces **Form F.1.2 for "Steckerspeicher ohne PV"** — battery-only plug-in devices. This is the first formal recognition in German grid code that a battery-to-grid feed-in device via Schuko is permitted up to 800 VA without professional installation and without grid-operator approval.

### 1.4 Marstek Venus B specifically (DE)

Per [Marstek EU product page](https://eu.marstekenergy.com/products/marstek-venus-b) and [pv-magazine 2026-03-17](https://www.pv-magazine.com/2026/03/17/marstek-launches-2-kwh-plug-in-battery-storage-system/): 2 kWh LFP, max feed-in 800 W (selectable 800 W / 1500 W — user must configure to 800 W for simplified DE regime), max charge 1.5 kW, Schuko plug.

**Verdict (DE 2026-04):** Legal in 800 W mode with MaStR self-registration only. No Netzbetreiber approval needed. `[VERIFIED: VDE-AR-N 4105:2026-03 + MaStR regulation]`

---

## 2. Netherlands — Plug-in Battery Feed-in ≤ 800 W (2026)

### 2.1 Current regime

**There is no direct NL equivalent of the German VDE-AR-N 4105:2026-03 "Steckerspeicher" rule.** The Dutch regime is a combination of:

1. **EU Regulation 2016/631 Article 5** (RfG Network Code) — units < 0.8 kW are "non-significant" generators. This is an administrative classification, **not a safety cap**.
2. **EN 50549-1** — designates 800 W as threshold for "Type A" installations (generic European standard, not NL-specific law).
3. **NEN 1010** — Dutch installation standard applicable to **certified installers only**, not to consumers plugging in a Schuko device.
4. **Netbeheer Nederland / RVO guidance** — mandates registration via **energieleveren.nl** for any battery ≥ 0.8 kW connected to the grid.
5. **NVWA (consumer safety authority)** guidance — 800 W max discharge to a circuit shared with other appliances (safety guidance, not a statute).

Citations:
- [IOTDomotica — "Waarom mag je maar 800 W terugleveren?"](https://iotdomotica.nl/thuisaccu/waarom-mag-je-met-een-thuisbatterij-via-een-stopcontact-maar-800-watt-terugleveren-de-feiten-de-mythe-en-jouw-opties): Explicitly states: "A binding ACM ruling that 800 W is the maximum for feed-in via a socket, we could not find." Traces the 800 W to EU 2016/631 Art. 5 and EN 50549-1. `[CITED]`
- [Netbeheer Nederland — Meld thuisbatterijen aan op energieleveren.nl](https://www.netbeheernederland.nl/artikelen/nieuws/meld-thuisbatterijen-aan-op-energieleverennl): Official call to register all home batteries. `[CITED]`
- [Plugin-Batterij.nl](https://plugin-batterij.nl/moet-ik-mijn-plug-in-thuisbatterij-aanmelden-bij-de-netbeheerder/): Since 2024, plug-in batteries must be registered. 0.8 kW threshold from RVO / Netbeheer Nederland.
- [Zonneplan — Wet- en regelgeving thuisbatterij met stekker](https://www.zonneplan.nl/thuisbatterij/thuisbatterij-met-stekker/wet-en-regelgeving): Explicitly describes legal status as "grijs gebied" (grey area). NEN 1010 applies to installers, not consumers. `[CITED]`

### 2.2 Specific rules

| Item | Rule |
|------|------|
| Max feed-in via Schuko (legal statute) | **No binding NL statute** — 800 W is industry/EU "non-significant" threshold, not a NL legal cap |
| Max feed-in (de-facto / manufacturer self-limit) | 800 W (to stay "non-significant" under EU 2016/631) |
| Registration | **Mandatory** via [energieleveren.nl](https://www.energieleveren.nl) per Netbeheer Nederland / RVO guidance for batteries ≥ 0.8 kW |
| Netbeheerder (grid operator) approval | Not explicitly required for plug-in ≤ 800 W; larger installs require a separate "teruglever-toestemming" |
| Installation | Layperson Schuko plug-in de-facto tolerated; NEN 1010 only binds certified installers |
| Legal clarity | **"Grey area"** per trade sources — no explicit permission, no explicit prohibition |

### 2.3 Post-salderingsregeling (from 2027-01-01)

- **Salderingsregeling** (net-metering for PV) ends **2027-01-01** per the new Energy Act (Energiewet), confirmed at [Chambers Renewable Energy 2025 NL](https://practiceguides.chambers.com/practice-guides/renewable-energy-2025/netherlands/trends-and-developments). `[CITED]`
- Effect on plug-in batteries: **Indirectly positive.** The end of salderingsregeling makes self-consumption more valuable → plug-in batteries become more attractive as a hedge. Market commentary ([Greenenergycompany.nl — Marstek Modellen 2026](https://www.greenenergycompany.nl/thuisbatterij/marstek-modellen/)) explicitly notes interest in Marstek is driven by this phase-out.
- **No new post-2027 rules specifically for plug-in batteries were identified** in this research. The registration-via-energieleveren.nl regime continues. `[ASSUMED]` — based on current sources; no definitive post-2027 rule for plug-in batteries found in the Energy Act text at this research level.

### 2.4 Marstek Venus B specifically (NL)

Per [Marstek.nl](https://www.marstek.nl/) (official NL distributor): Sold in NL. [Marstek NL FAQ](https://www.marstek.nl/veelgestelde-vragen/) confirms the device is marketed for NL plug-in use. Facebook community threads ([group 9076528425802065 post 25141975835497401](https://www.facebook.com/groups/9076528425802065/posts/25141975835497401/)) discuss registration via energieleveren.nl.

**Verdict (NL 2026-04):** De-facto legal at 800 W with mandatory energieleveren.nl registration. Formally a "grey area" — no explicit ACM ruling affirming it, no prohibition. The NL Marstek distribution is actively selling it, and grid operators publish registration guidance that assumes such devices exist. `[VERIFIED: multiple trade sources] [ASSUMED: no enforcement action]`

---

## 3. Critical DE ↔ NL Distinction (summary for PROJ-39 spec)

| Aspect | Germany (DE) | Netherlands (NL) |
|--------|--------------|------------------|
| Legal basis for 800 W cap | **Explicit**: VDE-AR-N 4105:2026-03 §F.1.2 | **Implicit**: EU 2016/631 Art. 5 + EN 50549-1 + NVWA safety guidance |
| Registration | **MaStR** (federal registry) — self-service, ~5 min | **energieleveren.nl** — self-service, free |
| Grid-operator approval | **Not required** for ≤ 800 VA | **Not required** for ≤ 800 W plug-in (but larger systems need teruglever-toestemming) |
| Layperson installation | Explicitly permitted | De-facto permitted (NEN 1010 binds only installers) |
| Legal clarity | **HIGH** — codified in VDE standard since 2026-03 | **MEDIUM** — "grey area" per trade sources; no binding ACM ruling |
| Marstek Venus B legal? | **Yes**, configured to 800 W mode | **Yes** with registration |

---

## 4. Where the user's belief needs nuance

**User said:** *"Both DE and NL allow 800 W plug-in feed-in without registration."*

**Correction:**
- **DE**: ≤ 800 VA plug-in feed-in is allowed, but **MaStR registration IS required** (not "no registration"). The Solarpaket I 2024 change was that the *Netzbetreiber-Meldung* was abolished — MaStR remains mandatory. Grid-operator approval is not needed, but federal registry registration is.
- **NL**: ≤ 800 W plug-in feed-in is de-facto tolerated, but **energieleveren.nl registration IS required** per Netbeheer Nederland / RVO guidance. Additionally, unlike DE, the 800 W figure has **no NL statutory basis** — it is a device-level self-limit and EU classification threshold, not a Dutch law.

**Net: Both countries allow the device WITHOUT grid-operator approval, but BOTH require self-registration in a national registry.** This is an important distinction for the PROJ-39 spec — users should not be told "just plug it in" in either country.

---

## 5. Sources

### Primary (HIGH confidence)
- [VDE — Plug-in PV / FNN guidance](https://www.vde.com/fnn-pv-stecker) — official VDE/FNN page.
- [DKE/VDE press release on plug-in solar product standard](https://www.vde.com/en/press/press-releases/first-product-standard-for-plug-in-solar-devices)
- [Netbeheer Nederland — Meld thuisbatterijen](https://www.netbeheernederland.nl/artikelen/nieuws/meld-thuisbatterijen-aan-op-energieleverennl) — official grid-operator association.
- [Chambers Global — Renewable Energy 2025 Netherlands](https://practiceguides.chambers.com/practice-guides/renewable-energy-2025/netherlands/trends-and-developments) — legal-practice confirmation of Energiewet 2026-01-01 and salderingsregeling end.
- [pv-magazine International — Marstek Venus B launch 2026-03-17](https://www.pv-magazine.com/2026/03/17/marstek-launches-2-kwh-plug-in-battery-storage-system/)

### Secondary (MEDIUM confidence)
- [photovoltaik.sh — VDE-AR-N 4105:2026-03 explainer](https://www.photovoltaik.sh/news/aktualisierte-vde-ar-n-41052026-03-vereinfachter-anschluss-von-klein-erzeugungsanlagen-bis-800-va)
- [balkon.solar 2026-03 VDE analysis](https://balkon.solar/news/2026/03/18/neue-vde-ar-n-4105-und-steckersolar/)
- [Verbraucherzentrale Bremen — MaStR guidance](https://www.verbraucherzentrale-bremen.de/wissen/energie/erneuerbare-energien/marktstammdatenregister-das-muessen-sie-bei-solaranlage-und-co-wissen-33124)
- [IOTDomotica — 800 W myth analysis](https://iotdomotica.nl/thuisaccu/waarom-mag-je-met-een-thuisbatterij-via-een-stopcontact-maar-800-watt-terugleveren-de-feiten-de-mythe-en-jouw-opties) — trade analysis, traces the 800 W back to EU 2016/631 + EN 50549-1
- [Zonneplan — Wet- en regelgeving thuisbatterij met stekker](https://www.zonneplan.nl/thuisbatterij/thuisbatterij-met-stekker/wet-en-regelgeving)
- [Plugin-Batterij.nl — registration requirement](https://plugin-batterij.nl/moet-ik-mijn-plug-in-thuisbatterij-aanmelden-bij-de-netbeheerder/)

### Product-specific
- [Marstek Venus B EU product page](https://eu.marstekenergy.com/products/marstek-venus-b)
- [Marstek.nl — NL distribution](https://www.marstek.nl/)
- [ESS News — Marstek Venus B launch 2026-03-17](https://www.ess-news.com/2026/03/17/marstek-launches-2-kwh-plug-in-battery-storage-system/)

---

## 6. Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | NL post-2027 regime does not introduce new plug-in battery rules beyond energieleveren.nl registration | §2.3 | Spec may underspecify post-salderingsregeling constraints; mitigation: PROJ-39 spec should flag this as a monitoring item, not a locked assumption |
| A2 | NVWA 800 W discharge guidance remains active and unchanged for 2026 | §2.1 | Low — NVWA guidance is a floor, not a ceiling; product self-limit at 800 W stays compliant regardless |
| A3 | Marstek NL distribution indicates practical NL tolerance of the device class | §2.4 | Low — commercial availability + Netbeheer Nederland registration workflow both presuppose legal tolerance |

---

## 7. Recommendation for PROJ-39 spec rewrite

The spec should distinguish:

1. **DE** — "800 VA plug-in feed-in with MaStR self-registration, per VDE-AR-N 4105:2026-03 Form F.1.2. No grid-operator approval required."
2. **NL** — "800 W plug-in feed-in with mandatory energieleveren.nl registration, per Netbeheer Nederland / RVO guidance. No formal statutory 800 W cap — figure derives from EU RfG 2016/631 Art. 5 non-significant threshold. Legal status is a 'grey area' in trade sources."

**Do NOT claim** either country permits feed-in "without registration" — both require national-registry self-registration. The distinction is that neither requires a grid-operator *approval* for devices ≤ 800 W.

Product-scope recommendation: Marstek Venus B is a reasonable exemplar for both markets, configured to 800 W output mode. Explicitly mention it exists in both DE and NL distribution channels.
