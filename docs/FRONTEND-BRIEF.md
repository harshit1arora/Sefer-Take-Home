# Sefer Entry Hub

Redesign the frontend for **Sefer — Customs Entry Automation**, using the two attached screenshots of Sefer's actual website as the primary visual reference.

**The goal is to make this look like an internal product built by Sefer's existing team, not a generic AI SaaS dashboard.** Match the brand, typography, spacing, colors and understated enterprise aesthetic in the screenshots.

### 1. Visual direction — follow the references closely

- Minimalist, premium B2B enterprise design.
- White backgrounds, deep navy typography, subtle blue-gray borders and restrained muted-blue accents.
- Large, clean sans-serif headings with generous whitespace.
- Small uppercase, letter-spaced section labels in muted blue-gray.
- Thin dividers, understated rounded corners and very subtle shadows.
- Use the screenshots' restrained visual language. Avoid excessive cards, gradients, colorful badges, glassmorphism, glowing effects, dark dashboards and oversized rounded containers.
- Use a clean font such as Inter or a similar modern sans-serif.
- Maintain the same polished, editorial feeling as Sefer's marketing site while making the application practical and information-dense enough for customs brokers.

### 2. Application layout

Build a functional, responsive single-page application called **Sefer Entry Workspace**.

**Top navigation**
- Sefer wordmark on the left.
- Shipment Workspace, Shipments and Activity navigation in the center.
- A restrained profile/settings area on the right.
- White background, dark navy text and a subtle bottom border.
- Compact height; do not recreate the marketing site's giant hero header inside the application.

**Page introduction**
- Small uppercase label: `CUSTOMS ENTRY WORKSPACE`
- Heading: `Turn shipping documents into an entry.`
- Supporting text explaining that Sefer extracts shipment information, reconciles documents and prepares an entry for broker review.
- Primary action: `New shipment`.

**Main workspace**
Use a compact, responsive four-step workflow:
1. Upload the commercial invoice, packing list and bill of lading using a drag-and-drop PDF area. Show uploaded filename, document type and file size.
2. Show the extracted shipment overview and editable invoice-line table after the service responds.
3. Keep conflicts, missing information, valuation questions and explicit broker approvals together in a prominent review section.
4. Show the generated XML draft, backend-confirmed validation results, and download action. Keep readiness blockers visible; do not imply official-schema validation or customs acceptance unless confirmed.

The compact step indicator should reflect actual uploaded, processing, review and XML state. Before upload, show the upload area and a short workflow description. Avoid a separate processing-status panel and oversized validation dashboard. Keep the layout responsive and preserve existing API and PDF behavior.

**Review and reconciliation**
Below the main workspace, add a section titled `Review before filing`.

Show missing information, document inconsistencies and broker-review questions as clean rows with severity labels. Each issue should explain what needs attention and, where appropriate, provide an action to review or edit the relevant field.

**XML output**
Add a section titled `Entry XML`.

- Display generated XML in a readable monospace code panel.
- Provide Copy XML and Download XML actions.
- Show schema-validation status clearly.
- Distinguish XML syntax validity, XSD validation and actual NetCHB acceptance.
- Never show a successful validation state unless the backend confirms it.

### 3. Use the supplied shipment as demo data

Use the three assignment PDFs and these known facts:
- Invoice: `HLAS/BP/26-0912`
- Bill of lading: `BMLVHCM26090001`
- Buyer: Bluepeak Outfitters, Inc.
- Consignee: Summit Fulfillment Partners LLC
- Origin: Vietnam for the main goods; Bangladesh for the samples.
- Destination port: Tacoma, Washington.
- CIF total: USD 27,270.
- Freight: USD 3,850.
- Insurance: USD 185.
- Packages: 138 cartons.
- Commercial goods: 5,100 pieces; additional samples: 24 pieces.
- Gross weight: 1,888 kg.

Use these facts only as demo data until actual extraction is connected. Clearly identify mock or unverified values.

### 4. Functional requirements

Use React + TypeScript + Vite.

Create reusable components for:
- Navigation
- PDF upload
- Shipment summary
- Editable line-item table
- Reconciliation findings
- XML viewer
- Validation status

Create typed models for `Shipment`, `ShipmentLine`, `Finding` and `EntryResponse`.

Create a dedicated API service that sends uploaded PDFs as multipart `FormData` to `POST /api/entry`, using the field name `documents`.

Until the backend is connected, allow a clearly labelled demo mode. Do not fake successful PDF extraction or XML validation.

Include loading, empty, error and completed states. Make every visible button functional. Ensure mobile responsiveness and accessible form controls.

### 5. What to avoid

- Do not reproduce the marketing homepage as the application.
- Do not use a generic dark developer dashboard.
- Do not fill every section with separate cards.
- Do not invent extra product features unrelated to the assignment.
- Do not use fake customs filing success, fake XSD validation or fake NetCHB integration.
- Do not hardcode demo data into the production API layer.

### 6. Implementation instructions

First inspect the existing Lovable project. Modify it rather than unnecessarily rebuilding it. Implement the complete frontend, verify the build and ensure all interactions work.

Prioritize **brand fidelity to the screenshots, functional document upload, clear shipment data presentation and honest validation states** over decorative animation.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/0be64b32-0c40-4863-8e08-9fd06d71a541).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
