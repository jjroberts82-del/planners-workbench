/*
# Planner's Workbench

## Goal
Provide production planners with an Epicor Kinetic workbench for reviewing open demand within a selectable planning horizon, identifying uncovered, late, and unreleased work, and releasing eligible firm jobs through a confirmed ERP workflow.

## Users
Production planners at a discrete manufacturer.

## Key data + Epicor domain
- **Domain:** Sales order demand planning, with future tabs reserved for jobs, batching, capacity, and materials.
- **Requested source:** `Erp.BO.SalesOrderSvc`, using `OrderHed`, `OrderDtl`, and `OrderRel`.
- **Demand fields:** order, line, release, customer, part, revision, need-by date, ship-by date, remaining quantity, quantity covered by job, quantity from stock, and uncovered quantity.
- **ERP behavior:** reads use the existing host service calls; job release uses the explicit JobEntrySvc GetByID → ChangeJobHeadJobReleased → Update workflow after confirmation.
- **Service discovery note:** `Erp.BO.SalesOrderSvc` was not present in the available service catalog during discovery. Implement the adapter against that requested contract if available in the host; otherwise keep the ERP adapter isolated so it can be redirected to the tenant's equivalent SalesOrder service or BAQ without changing the UI.

## Key interactions / flows
1. Header provides a site selector defaulting to `MfgSys`, a planning horizon selector with 2, 4, 8, and 12 weeks defaulting to 4, and a Refresh button with the last-refreshed timestamp.
2. KPI strip shows open demand lines in the horizon, uncovered demand quantity, late jobs, and unreleased jobs due in the horizon.
3. Tabs include Demand, Jobs, Batching, Capacity, and Materials. Materials is read-only and derives job material readiness from JobMtls, PartSvc warehouse quantities, and open POSvc releases.
4. Demand loads open sales order releases whose ship-by date falls inside the selected horizon.
5. Demand table supports sorting, customer filtering, part filtering, and grouping by part with subtotals.
6. Highlight rows or cells with uncovered quantity greater than zero in red; highlight ship-by dates within five days in amber.
7. Clicking a demand row opens a side panel with order details and any linked jobs.
8. Refresh re-reads the current horizon and updates the timestamp; show loading, empty, error, and unavailable-service states.

## Assumptions
- “Open” means releases that are not fully fulfilled, closed, or canceled, subject to the available service/BAQ fields.
- The horizon begins at the current date and includes releases through the end of the selected number of weeks.
- “Within 5 days” means from the current date, including overdue dates; overdue dates should remain visually distinguishable from merely near-term dates if space permits.
- Coverage quantities may require joining or deriving related job and inventory information; do not invent values when the ERP response does not provide them—display an explicit unavailable state.
- KPI values are scoped to the selected site and horizon.
- The default site is `MfgSys`, but the selector should remain configurable from the host/data response.
- Use the fixed `lux_mode: light` and accessible table, filtering, grouping, side-panel, focus, and keyboard behavior.
- Other tabs are placeholders only and must not imply that their workflows are implemented.

## Non-goals
- No scheduling, material allocation, or order editing.
- No implementation of scheduling or capacity actions. Materials and planning views remain read-only; job release is the sole write workflow.
- No fabricated linked-job, stock-coverage, or KPI data when the backend cannot supply it.

## Bridge requirements
- **LLM:** no
- **ERP:** yes — read-only calls only. Keep service calls in the host bridge and document the actual tenant operation once the SalesOrder service/BAQ is available.

*/
const TEMPLATE = "<!-- Planner's Workbench: embedded production-planning workspace markup. -->\n<div class=\"app-shell\">\n  <header class=\"page-header\">\n    <div class=\"title-block\">\n      <div class=\"eyebrow\">Production planning</div>\n      <h1>Planner's Workbench</h1>\n      <p>Review open demand, coverage, and near-term ship commitments.</p>\n    </div>\n    <div class=\"header-controls\" aria-label=\"Planning controls\">\n      <label class=\"field-label\" for=\"site-selector\">Site<select id=\"site-selector\" aria-label=\"Site\"><option value=\"MfgSys\" selected>MfgSys</option></select></label>\n      <label class=\"field-label\" for=\"horizon-selector\">Horizon<select id=\"horizon-selector\" aria-label=\"Planning horizon\"><option value=\"2\">2 weeks</option><option value=\"4\" selected>4 weeks</option><option value=\"8\">8 weeks</option><option value=\"12\">12 weeks</option></select></label>\n      <div class=\"refresh-control\"><button id=\"refresh-button\" class=\"button button-primary\" type=\"button\">Refresh</button><span id=\"last-refreshed\" class=\"metadata\">Not refreshed</span></div>\n    </div>\n  </header>\n  <p class=\"erp-update-note\">Release and other actions require Allow updates (top of page) to be on.</p>\n\n  <section class=\"kpi-grid\" aria-label=\"Planning indicators\">\n    <article class=\"kpi-card\"><div class=\"kpi-label\">Open demand lines</div><div id=\"kpi-demand\" class=\"kpi-value mono\">—</div><div class=\"kpi-note\">Within selected horizon</div></article>\n    <article class=\"kpi-card\"><div class=\"kpi-label\">Uncovered demand qty</div><div id=\"kpi-uncovered\" class=\"kpi-value mono\">—</div><div class=\"kpi-note\">No job or stock coverage</div></article>\n    <article class=\"kpi-card\"><div class=\"kpi-label\">Late jobs</div><div id=\"kpi-late\" class=\"kpi-value mono\">—</div><div class=\"kpi-note\">Open jobs due before today</div></article>\n    <article class=\"kpi-card\"><div class=\"kpi-label\">Unreleased jobs due</div><div id=\"kpi-unreleased\" class=\"kpi-value mono\">—</div><div class=\"kpi-note\">Due within selected horizon</div></article>\n  </section>\n\n  <nav class=\"tabs\" aria-label=\"Planning workstreams\" role=\"tablist\">\n    <button class=\"tab is-active\" type=\"button\" role=\"tab\" aria-selected=\"true\" data-tab=\"today\">Today</button>\n    <button class=\"tab\" type=\"button\" role=\"tab\" aria-selected=\"false\" data-tab=\"demand\">Demand</button>\n    <button class=\"tab\" type=\"button\" role=\"tab\" aria-selected=\"false\" data-tab=\"jobs\">Jobs</button>\n    <button class=\"tab\" type=\"button\" role=\"tab\" aria-selected=\"false\" data-tab=\"batching\">Batching</button>\n    <button class=\"tab\" type=\"button\" role=\"tab\" aria-selected=\"false\" data-tab=\"capacity\">Capacity</button>\n    <button class=\"tab\" type=\"button\" role=\"tab\" aria-selected=\"false\" data-tab=\"materials\">Materials</button>\n  </nav>\n  <div id=\"tab-status\" class=\"tab-status\" aria-live=\"polite\"></div>\n\n  <main id=\"today-view\" class=\"content-card today-view\" aria-label=\"Today's planning summary\">\n    <div class=\"content-toolbar\"><div><h2>Today</h2><p>Priority signals from the demand, jobs, materials, capacity, and batching data already loaded.</p></div></div>\n    <div id=\"today-summary\" class=\"today-summary\" aria-live=\"polite\"></div>\n    <div id=\"today-sections\" class=\"today-sections\"></div>\n  </main>\n\n  <main id=\"demand-view\" class=\"content-card\" aria-label=\"Demand releases\">\n    <div class=\"content-toolbar\">\n      <div><h2>Open demand</h2><p>Sales order releases shipping inside the planning horizon.</p></div>\n      <label class=\"toggle-label\"><input id=\"group-by-part\" type=\"checkbox\" checked> Group by part</label>\n    </div>\n    <div class=\"filter-row\" aria-label=\"Demand filters\">\n      <label class=\"filter-field\" for=\"customer-filter\"><span>Customer</span><input id=\"customer-filter\" type=\"search\" placeholder=\"Filter customer\" autocomplete=\"off\"></label>\n      <label class=\"filter-field\" for=\"part-filter\"><span>Part</span><input id=\"part-filter\" type=\"search\" placeholder=\"Filter part\" autocomplete=\"off\"></label>\n      <div class=\"legend\" aria-label=\"Demand highlights\"><span><i class=\"legend-swatch amber\"></i>Ships within 5 days</span><span><i class=\"legend-swatch red\"></i>Uncovered quantity</span></div>\n    </div>\n    <div id=\"table-status\" class=\"table-status\" role=\"status\" aria-live=\"polite\">Preparing demand view…</div>\n    <div class=\"table-wrap\">\n      <table class=\"demand-table\">\n        <caption class=\"sr-only\">Open sales order releases in the selected planning horizon</caption>\n        <thead><tr><th><button type=\"button\" data-sort=\"order\">Order</button></th><th><button type=\"button\" data-sort=\"line\">Line</button></th><th><button type=\"button\" data-sort=\"release\">Rel</button></th><th><button type=\"button\" data-sort=\"customer\">Customer</button></th><th><button type=\"button\" data-sort=\"part\">Part</button></th><th>Rev</th><th><button type=\"button\" data-sort=\"needBy\">Need By</button></th><th><button type=\"button\" data-sort=\"shipBy\">Ship By</button></th><th class=\"number-head\">Remaining Qty</th><th class=\"number-head\">Qty Covered by Job</th><th class=\"number-head\">Qty From Stock</th><th class=\"number-head\">Uncovered Qty</th></tr></thead>\n        <tbody id=\"demand-table-body\"></tbody>\n      </table>\n    </div>\n  </main>\n  <section id=\"jobs-view\" class=\"content-card jobs-view\" aria-label=\"Open jobs\" hidden>\n    <div class=\"content-toolbar\"><div><h2>Open jobs</h2><p>Open manufacturing jobs and their current operations for the selected site.</p></div><div class=\"job-toggles\"><label class=\"field-label\" for=\"job-type-filter\"><span>Job type</span><select id=\"job-type-filter\" aria-label=\"Job type filter\"><option value=\"MFG\" selected>Manufacturing</option><option value=\"ALL\">All types</option><option value=\"MNT\">Maintenance</option><option value=\"PRJ\">Project</option><option value=\"SRV\">Service</option></select></label><label class=\"toggle-label\"><input id=\"hide-no-open-ops\" type=\"checkbox\" checked> Hide jobs with no open operations</label><label class=\"toggle-label\"><input id=\"show-stale-jobs\" type=\"checkbox\"> Show stale jobs (60+ days late) <span id=\"stale-hidden-count\" class=\"metadata\">(0 hidden)</span></label></div></div>\n    <div id=\"jobs-status\" class=\"table-status\" role=\"status\" aria-live=\"polite\">Preparing jobs view…</div>\n    <div class=\"table-wrap\">\n      <table class=\"demand-table jobs-table\">\n        <caption class=\"sr-only\">Open manufacturing jobs for the selected site</caption>\n        <thead><tr><th>Job</th><th>Part</th><th>Rev</th><th>Due</th><th>Released</th><th>Firm</th><th>Material status</th><th>Current op</th><th>Action</th></tr></thead>\n        <tbody id=\"jobs-table-body\"></tbody>\n      </table>\n    </div>\n    <section class=\"activity-section\" aria-labelledby=\"activity-log-title\"><h3 id=\"activity-log-title\">Activity log</h3><ul id=\"activity-log\" class=\"activity-log\"><li>No job release activity yet.</li></ul></section>\n  </section>\n  <section id=\"materials-view\" class=\"content-card materials-view\" aria-label=\"Materials readiness\" hidden>\n    <div class=\"content-toolbar\"><div><h2>Materials readiness</h2><p>Read-only job material coverage, inventory, and open incoming supply.</p></div></div>\n    <div id=\"materials-status\" class=\"table-status\" role=\"status\" aria-live=\"polite\">Preparing materials view…</div>\n    <div class=\"materials-grid\">\n      <section class=\"material-section\"><h3>Job materials</h3><div class=\"table-wrap\"><table class=\"demand-table materials-table\"><caption class=\"sr-only\">Job material readiness and short parts</caption><thead><tr><th>Job</th><th>Part</th><th>Required</th><th>Issued</th><th>On hand</th><th>Incoming</th><th>Short</th><th>Req date</th><th>Status</th></tr></thead><tbody id=\"materials-body\"></tbody></table></div></section>\n      <section class=\"material-section\"><h3>Ready to Release</h3><p class=\"section-note\">Firm, unreleased jobs whose materials are Ready.</p><ul id=\"ready-release-list\" class=\"ready-release-list\"></ul></section>\n    </div>\n  </section>\n  <section id=\"batching-view\" class=\"content-card batching-view\" aria-label=\"Batching suggestions\" hidden>\n    <div class=\"content-toolbar\"><div><h2>Batching suggestions</h2><p>Read-only grouping ideas from the jobs and operations already loaded.</p></div><label class=\"field-label\" for=\"batch-window\"><span>Due-date window</span><select id=\"batch-window\" aria-label=\"Batching due-date window\"><option value=\"5\">5 days</option><option value=\"10\" selected>10 days</option><option value=\"15\">15 days</option><option value=\"30\">30 days</option></select></label></div>\n    <div id=\"batching-status\" class=\"table-status\" role=\"status\" aria-live=\"polite\">Preparing batching suggestions…</div>\n    <div id=\"batching-groups\" class=\"batching-groups\"></div>\n  </section>\n  <section id=\"capacity-view\" class=\"content-card capacity-view\" aria-label=\"Capacity heat map\" hidden>\n    <div class=\"content-toolbar\"><div><h2>Capacity</h2><p>Estimated open-operation load from the selected site's visible jobs.</p></div><div id=\"capacity-summary\" class=\"metadata\"></div></div>\n    <div id=\"capacity-status\" class=\"table-status\" role=\"status\" aria-live=\"polite\">Preparing capacity view…</div>\n    <div id=\"capacity-controls\" class=\"capacity-controls\"></div>\n    <div class=\"table-wrap\"><table class=\"capacity-table\"><caption class=\"sr-only\">Weekly capacity by resource group</caption><thead id=\"capacity-head\"></thead><tbody id=\"capacity-body\"></tbody></table></div>\n    <div id=\"capacity-detail\" class=\"capacity-detail\" hidden></div>\n  </section>\n</div>\n\n<div id=\"release-dialog-backdrop\" class=\"panel-backdrop\" aria-hidden=\"true\" hidden></div>\n<section id=\"release-dialog\" class=\"release-dialog\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"release-dialog-title\" hidden>\n  <div class=\"panel-header\"><div><div class=\"eyebrow\">Job action</div><h2 id=\"release-dialog-title\">Release job</h2></div><button id=\"release-dialog-close\" class=\"icon-button\" type=\"button\" aria-label=\"Close release confirmation\">×</button></div>\n  <div class=\"release-dialog-content\"><p>Confirm release for this firm, unreleased job.</p><dl class=\"detail-list\"><div><dt>Job</dt><dd id=\"release-job-number\" class=\"mono\">—</dd></div><div><dt>Part</dt><dd id=\"release-job-part\">—</dd></div><div><dt>Quantity</dt><dd id=\"release-job-quantity\" class=\"mono\">—</dd></div><div><dt>Due date</dt><dd id=\"release-job-due\">—</dd></div><div><dt>Material status</dt><dd id=\"release-job-material-status\">—</dd></div></dl><label class=\"dialog-checkbox\"><input id=\"release-override-material\" type=\"checkbox\"> <span>Override material check</span></label><p id=\"release-dialog-error\" class=\"dialog-error\" role=\"alert\" hidden></p><div class=\"dialog-actions\"><button id=\"release-dialog-cancel\" class=\"button button-secondary\" type=\"button\">Cancel</button><button id=\"release-dialog-confirm\" class=\"button button-primary\" type=\"button\">Release job</button></div></div>\n</section>\n\n<div id=\"panel-backdrop\" class=\"panel-backdrop\" aria-hidden=\"true\" hidden></div>\n<aside id=\"detail-panel\" class=\"detail-panel\" hidden aria-labelledby=\"detail-panel-title\" aria-modal=\"false\">\n  <div class=\"panel-header\"><div><div class=\"eyebrow\">Demand detail</div><h2 id=\"detail-panel-title\">Release details</h2></div><button id=\"close-detail-panel\" class=\"icon-button\" type=\"button\" aria-label=\"Close release details\">×</button></div>\n  <div id=\"detail-panel-content\" class=\"panel-content\"></div>\n</aside>\n";
const STYLES = "/* Planner's Workbench: fixed light-mode LUX tokens and dense embedded layout. */\n:host {\n  --base-background: #F8FAFC;\n  --base-foreground: #0A0A0A;\n  --base-muted: #F5F5F5;\n  --base-muted-foreground: #525252;\n  --base-border: #94A3B8;\n  --card-border: #CBD5E1;\n  --card-background: #FFFFFF;\n  --input-background: #FFFFFF;\n  --input-border: #64748B;\n  --focus: #0369A1;\n  --primary: #0C4A6E;\n  --primary-foreground: #FFFFFF;\n  --secondary: #F5F5F5;\n  --secondary-foreground: #171717;\n  --outline-background: #F8FAFC;\n  --outline-border: #E5E5E5;\n  --success-background: #ECFEFF;\n  --success-foreground: #155E75;\n  --warning-background: #FFF7ED;\n  --warning-foreground: #A16207;\n  --warning-border: #A16207;\n  --error-background: #FEF2F2;\n  --error-foreground: #991B1B;\n  --error-border: #991B1B;\n  display: block;\n  color: var(--base-foreground);\n  background: var(--base-background);\n  font-family: Inter, ui-sans-serif, system-ui, sans-serif;\n  font-size: 14px;\n  line-height: 1.4;\n}\n[hidden] { display: none !important; }\n* { box-sizing: border-box; }\nbutton, input, select { font: inherit; }\nbutton { cursor: pointer; }\nbutton:focus-visible, input:focus-visible, select:focus-visible, tr:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }\n.app-shell { min-height: 100vh; padding: 28px 32px 32px; }\n.page-header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 24px; }\n.eyebrow { color: var(--base-muted-foreground); font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: .04em; }\n.erp-update-note { margin: -12px 0 16px; color: var(--base-muted-foreground); font-size: 12px; }\nh1 { margin: 4px 0 4px; font-size: 30px; line-height: 36px; font-weight: 300; letter-spacing: 0; }\n.title-block p, .content-toolbar p { margin: 0; color: var(--base-muted-foreground); }\n.header-controls { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; }\n.field-label, .filter-field { display: grid; gap: 5px; color: var(--base-muted-foreground); font-size: 12px; font-weight: 500; }\nselect, input { height: 36px; border: 1px solid var(--input-border); border-radius: 8px; background: var(--input-background); color: var(--base-foreground); padding: 0 10px; }\nselect { min-width: 132px; }\n.refresh-control { display: grid; justify-items: end; gap: 4px; }\n.button { min-height: 36px; border: 1px solid transparent; border-radius: 8px; padding: 0 16px; font-weight: 500; }\n.button-primary { color: var(--primary-foreground); background: var(--primary); }\nbutton:hover { filter: brightness(.92); }\nbutton:active { transform: scale(.97); filter: brightness(.85); }\nbutton:disabled { cursor: wait; opacity: .5; }\n.metadata, .kpi-note, .table-status { color: var(--base-muted-foreground); font-size: 12px; }\n.kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px; margin-bottom: 24px; }\n.kpi-card, .content-card { border: 1px solid var(--card-border); border-radius: 10px; background: var(--card-background); }\n.kpi-card { min-height: 104px; padding: 16px; }\n.kpi-label { font-size: 12px; font-weight: 700; }\n.kpi-value { margin: 8px 0 4px; font-size: 24px; line-height: 28px; }\n.unavailable { color: var(--base-muted-foreground); font-size: 18px; }\n.mono { font-family: \"JetBrains Mono\", ui-monospace, monospace; }\n.tabs { display: flex; gap: 20px; border-bottom: 1px solid var(--card-border); }\n.tab { min-height: 40px; padding: 0 2px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--base-muted-foreground); font-weight: 500; }\n.tab.is-active, .tab[aria-selected=\"true\"] { border-bottom-color: var(--primary); color: var(--primary); }\n.tab-status { min-height: 28px; padding-top: 8px; }\n.content-card { overflow: hidden; }\n.today-view { overflow: hidden; }\n.today-summary { padding: 16px; border-bottom: 1px solid var(--card-border); color: var(--base-foreground); font-size: 16px; line-height: 24px; }\n.today-sections { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 16px; }\n.today-section { border: 1px solid var(--card-border); border-radius: 8px; background: var(--card-background); padding: 14px 16px; }\n.today-section h3 { margin: 0 0 8px; font-size: 14px; font-weight: 600; }\n.today-section p { margin: 0; color: var(--base-muted-foreground); font-size: 12px; }\n.today-list { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }\n.today-list li { color: var(--base-foreground); font-size: 13px; }\n.today-link { width: 100%; padding: 4px 0; border: 0; background: transparent; color: var(--primary); text-align: left; text-decoration: underline; }\n.content-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 16px; border-bottom: 1px solid var(--card-border); }\nh2 { margin: 0; font-size: 16px; font-weight: 500; }\n.toggle-label { display: flex; align-items: center; gap: 8px; color: var(--base-muted-foreground); font-size: 12px; white-space: nowrap; }\n.toggle-label input { width: 16px; height: 16px; accent-color: var(--primary); }\n.filter-row { display: flex; align-items: flex-end; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--card-border); }\n.filter-field input { width: 190px; }\n.legend { display: flex; gap: 14px; margin-left: auto; padding-bottom: 8px; color: var(--base-muted-foreground); font-size: 12px; }\n.legend span { display: inline-flex; align-items: center; gap: 6px; }\n.legend-swatch { width: 10px; height: 10px; border-radius: 9999px; display: inline-block; }\n.legend-swatch.amber { background: var(--warning-border); }\n.legend-swatch.red { background: var(--error-border); }\n.table-status { min-height: 36px; display: flex; align-items: center; gap: 8px; padding: 0 16px; }\n.status-dot { width: 7px; height: 7px; border-radius: 9999px; display: inline-block; background: var(--focus); }\n.loading-dot { background: var(--focus); }\n.error-dot { background: var(--error-border); }\n.info-dot { background: var(--focus); }\n.link-button { border: 0; padding: 0; color: var(--primary); background: transparent; text-decoration: underline; }\n.table-wrap { overflow-x: auto; }\n.demand-table { width: 100%; min-width: 1160px; border-collapse: collapse; }\nth, td { border-bottom: 1px solid var(--card-border); padding: 10px 12px; text-align: left; white-space: nowrap; }\nth { background: var(--base-muted); color: var(--base-muted-foreground); font-size: 11px; font-weight: 700; text-transform: uppercase; }\nth button { border: 0; padding: 0; background: transparent; color: inherit; font-size: inherit; font-weight: inherit; text-transform: inherit; }\n.number-head, .number-cell { text-align: right; }\n.demand-row { background: var(--card-background); transition: background-color 120ms ease; }\n.demand-row:hover { background: var(--base-muted); }\n.demand-row.near-term .date-cell { background: var(--warning-background); color: var(--warning-foreground); }\n.demand-row.has-uncovered .uncovered-value { background: var(--error-background); color: var(--error-foreground); font-weight: 700; }\n.jobs-view { overflow: hidden; }\n.job-toggles { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px 16px; }\n.jobs-table { min-width: 980px; }\n.jobs-row { cursor: pointer; }\n.release-job-button { min-height: 32px; padding: 0 10px; border: 1px solid var(--outline-border); border-radius: 8px; color: var(--primary); background: var(--outline-background); font-size: 12px; }\n.release-job-button:disabled { cursor: not-allowed; }\n.activity-section { margin: 16px; padding-top: 16px; border-top: 1px solid var(--card-border); }\n.activity-section h3 { margin: 0 0 8px; font-size: 14px; font-weight: 600; }\n.activity-log { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; color: var(--base-muted-foreground); font-size: 12px; }\n.activity-log li { display: grid; grid-template-columns: 110px 1fr; gap: 10px; }\n.release-dialog { position: fixed; z-index: 2; top: 50%; left: 50%; width: min(440px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow-y: auto; transform: translate(-50%, -50%); border: 1px solid var(--card-border); border-radius: 10px; background: var(--card-background); box-shadow: 0 12px 30px var(--base-border); }\n.release-dialog-content { padding: 20px; }\n.release-dialog-content > p { margin: 0 0 16px; color: var(--base-muted-foreground); }\n.dialog-checkbox { display: flex; align-items: center; gap: 8px; min-height: 40px; margin-top: 16px; color: var(--base-foreground); font-size: 12px; }\n.dialog-checkbox input { width: 16px; height: 16px; }\n.dialog-error { padding: 10px 12px; border: 1px solid var(--error-border); border-radius: 8px; color: var(--error-foreground) !important; background: var(--error-background); }\n.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }\n.button-secondary { color: var(--secondary-foreground); background: var(--secondary); border-color: var(--outline-border); }\n.materials-view { overflow: hidden; }\n.materials-grid { display: grid; gap: 20px; padding: 16px; }\n.material-section { border: 1px solid var(--card-border); border-radius: 8px; overflow: hidden; }\n.material-section h3 { margin: 0; padding: 12px 16px; font-size: 14px; font-weight: 600; }\n.section-note { margin: -8px 16px 12px; color: var(--base-muted-foreground); font-size: 12px; }\n.materials-table { min-width: 900px; }\n.ready-release-list { display: grid; gap: 8px; margin: 0; padding: 0 16px 16px; list-style: none; }\n.ready-release-list li { padding: 10px 12px; border: 1px solid var(--card-border); border-radius: 8px; background: var(--base-muted); }\n.material-status { font-weight: 700; }\n.material-status.ready { color: var(--success-foreground); }\n.material-status.short { color: var(--error-foreground); }\n.material-status.arriving { color: var(--warning-foreground); }\n.jobs-row:hover { background: var(--base-muted); }\n.jobs-row .job-status { color: var(--base-muted-foreground); font-size: 12px; }\n.jobs-row .job-status.unreleased { color: var(--warning-foreground); font-weight: 700; }\n.jobs-row .job-status.late { color: var(--error-foreground); font-weight: 700; }\n.job-operations { background: var(--base-muted); }\n.job-operations td { white-space: normal; }\n.operation-list { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 0; padding: 0; list-style: none; }\n.operation-list li { color: var(--base-muted-foreground); font-size: 12px; }\n.batching-view { overflow: hidden; }\n.batching-groups { display: grid; gap: 12px; padding: 16px; }\n.batch-group { border: 1px solid var(--card-border); border-radius: 8px; background: var(--card-background); padding: 14px 16px; }\n.batch-group h3 { margin: 0 0 6px; font-size: 14px; font-weight: 600; }\n.batch-group p { margin: 0 0 10px; color: var(--base-muted-foreground); }\n.batch-group dl { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 0; }\n.batch-group dt { font-size: 11px; text-transform: uppercase; }\n.batch-group dd { text-align: left; font-family: \"JetBrains Mono\", ui-monospace, monospace; font-size: 13px; }\n.batch-members { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 10px; padding: 0; list-style: none; }\n.batch-members li { padding: 4px 8px; border: 1px solid var(--card-border); border-radius: 9999px; background: var(--base-muted); font-family: \"JetBrains Mono\", ui-monospace, monospace; font-size: 11px; }\n.batch-risk { color: var(--error-foreground); font-weight: 700; }\n.batch-safe { color: var(--success-foreground); font-weight: 600; }\n.capacity-view { overflow: hidden; }\n.capacity-controls { display: flex; flex-wrap: wrap; gap: 10px 16px; padding: 12px 16px; border-bottom: 1px solid var(--card-border); }\n.capacity-controls label { display: grid; gap: 4px; color: var(--base-muted-foreground); font-size: 12px; }\n.capacity-controls input { width: 110px; }\n.capacity-table { min-width: 760px; }\n.capacity-cell { min-width: 110px; text-align: center; cursor: pointer; }\n.capacity-cell.under { background: var(--success-background); color: var(--success-foreground); }\n.capacity-cell.watch { background: var(--warning-background); color: var(--warning-foreground); }\n.capacity-cell.over { background: var(--error-background); color: var(--error-foreground); }\n.capacity-cell strong { display: block; font-size: 14px; }\n.capacity-cell span { font-size: 11px; }\n.capacity-detail { margin: 16px; padding: 12px 16px; border: 1px solid var(--card-border); border-radius: 8px; background: var(--base-muted); }\n.capacity-detail h3 { margin: 0 0 8px; font-size: 14px; }\n.capacity-detail ul { margin: 0; padding-left: 18px; color: var(--base-muted-foreground); font-size: 12px; }\n@media (max-width: 680px) { .batch-group dl { grid-template-columns: repeat(2, minmax(0, 1fr)); } .today-sections { grid-template-columns: 1fr; } }\n.group-row th { padding: 8px 12px; background: var(--success-background); color: var(--success-foreground); text-transform: none; font-size: 12px; }\n.group-row th span { margin-left: 10px; color: var(--base-muted-foreground); font-weight: 400; }\n.panel-backdrop { position: fixed; inset: 0; background: var(--base-foreground); opacity: .18; }\n.detail-panel { position: fixed; top: 0; right: 0; width: min(420px, 100vw); height: 100vh; overflow-y: auto; padding: 20px; border-left: 1px solid var(--card-border); background: var(--card-background); }\n.panel-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 20px; border-bottom: 1px solid var(--card-border); }\n.panel-header h2 { margin-top: 4px; }\n.release-dialog .panel-header { padding: 16px 20px; }\n.release-dialog .detail-list { gap: 10px; }\n.release-dialog .detail-list dd { text-align: right; }\n.release-dialog-backdrop { z-index: 1; }\n.icon-button { width: 36px; height: 36px; border: 1px solid var(--outline-border); border-radius: 8px; color: var(--base-foreground); background: var(--outline-background); font-size: 22px; line-height: 1; }\n.panel-content { padding-top: 20px; }\n.panel-content h2 { margin: 4px 0 20px; font-size: 20px; line-height: 26px; }\n.detail-list { display: grid; gap: 14px; margin: 0; }\n.detail-list div { display: grid; grid-template-columns: 1fr 1.2fr; gap: 12px; }\ndt { color: var(--base-muted-foreground); font-size: 12px; } dd { margin: 0; text-align: right; }\n.linked-section { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--card-border); }\n.linked-section h3 { margin: 0 0 8px; font-size: 14px; font-weight: 500; }\n.linked-section p { margin: 0; color: var(--base-muted-foreground); }\n.danger-text { color: var(--error-foreground); font-weight: 700; }\n.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }\n@media (max-width: 860px) { .app-shell { padding: 20px 16px 24px; } .page-header { flex-direction: column; } .header-controls { width: 100%; align-items: end; } .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; } .filter-row { align-items: stretch; flex-wrap: wrap; } .legend { width: 100%; margin-left: 0; } }\n@media (max-width: 520px) { .kpi-grid { grid-template-columns: 1fr 1fr; } .content-toolbar { align-items: flex-start; flex-direction: column; } .filter-field, .filter-field input { width: 100%; } .header-controls { display: grid; grid-template-columns: 1fr 1fr; } .refresh-control { justify-items: start; } }\n";
/* lux-00-chart-utils.js — shared utilities for Lux widget rendering.
 * LUX values are resolved by the builder via query_lux_kg and passed through
 * each widget's options.tokens object. Runtime widgets do not know the KG.
 *
 * Global: LuxWidgetUtils
 * Methods: niceScale(min, max, n), fmt(v), esc(s), escAttr(s), tokens(opts),
 *          token(tokens, name, fallback), chartPalette(tokens),
 *          color(value, tokens, fallback), tooltipAttrs(title, rows, total),
 *          attachTooltip(container, tokens)
 */
var LuxWidgetUtils = (function () {
  function niceScale(min, max, n) {
    var range = (max - min) || 1;
    var step  = Math.pow(10, Math.floor(Math.log10(range / n)));
    var mults = [1, 2, 2.5, 5, 10];
    var nice  = step;
    for (var i = 0; i < mults.length; i++) {
      if (range / (step * mults[i]) <= n) { nice = step * mults[i]; break; }
    }
    var start = Math.floor(min / nice) * nice;
    var ticks = [];
    // Index-based: avoids both accumulated drift and the toPrecision truncation
    // bug where (largeV + nice).toPrecision(12) rounds back to largeV, looping forever.
    for (var i = 0; i < 1000; i++) {
      var v = start + i * nice;
      if (v > max + nice * 0.01) break;
      if (v >= min - nice * 0.01) ticks.push(v);
    }
    return ticks;
  }

  function fmt(v) { return Number.isInteger(v) ? v : +v.toFixed(2); }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function escAttr(s) {
    return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function tokens(opts) {
    opts = opts || {};
    return opts.tokens || opts.theme || {};
  }

  function token(map, name, fallback) {
    return map && map[name] ? map[name] : fallback;
  }

  function chartPalette(map) {
    if (map && Array.isArray(map.chartPalette) && map.chartPalette.length) {
      return map.chartPalette;
    }
    var keys = ['chart1', 'chart2', 'chart3', 'chart4', 'chart5'];
    var out = [];
    keys.forEach(function (key) {
      if (map && map[key]) out.push(map[key]);
    });
    return out.length ? out : ['currentColor'];
  }

  function color(value, map, fallback) {
    if (value && map && map[value]) return map[value];
    if (typeof value === 'string' && (value.charAt(0) === '#' || /^(rgb|hsl)/i.test(value))) {
      return fallback || 'currentColor';
    }
    return value || fallback || 'currentColor';
  }

  function tooltipAttrs(title, rows, total) {
    var ariaValues = rows.map(function (r) { return r.value; });
    var ariaDetail = rows.length === 2 && rows[0].label === 'Value' && rows[1].label === 'Share'
      ? rows[0].value + ' (' + rows[1].value + ')'
      : ariaValues.join(', ');
    return ' tabindex="0" role="img" data-lux-chart-point="' + escAttr(title) + '"' +
      ' aria-label="' + escAttr(title + ': ' + ariaDetail) + '"' +
      ' data-tooltip-title="' + escAttr(title) + '"' +
      ' data-tooltip-rows="' + escAttr(JSON.stringify(rows || [])) + '"' +
      (total ? ' data-tooltip-total="' + escAttr(total) + '"' : '');
  }

  function attachTooltip(container, map) {
    var tooltip = container.querySelector('[data-lux-chart-tooltip="true"]');
    if (!tooltip) return;
    tooltip.style.position = 'absolute';
    tooltip.style.pointerEvents = 'none';
    tooltip.style.zIndex = '20';
    tooltip.style.minWidth = '150px';
    tooltip.style.maxWidth = '260px';
    tooltip.style.padding = '8px 10px';
    tooltip.style.border = '1px solid ' + token(map, 'cardBorder', token(map, 'border', 'currentColor'));
    tooltip.style.borderRadius = '8px';
    tooltip.style.background = token(map, 'cardBg', 'Canvas');
    tooltip.style.color = token(map, 'cardFg', 'CanvasText');
    tooltip.style.boxShadow = token(map, 'shadowSm', 'none');
    tooltip.style.font = '12px Inter, sans-serif';
    tooltip.style.lineHeight = '1.35';
    tooltip.style.opacity = '0';
    tooltip.style.transform = 'translate(-9999px, -9999px)';
    tooltip.style.transition = 'opacity 120ms ease';

    function renderTooltip(target) {
      var rows = [];
      try { rows = JSON.parse(target.getAttribute('data-tooltip-rows') || '[]'); } catch (err) { rows = []; }
      var title = target.getAttribute('data-tooltip-title') || '';
      var total = target.getAttribute('data-tooltip-total') || '';
      tooltip.innerHTML =
        '<div style="font-weight:600;margin-bottom:6px;">' + esc(title) + '</div>' +
        rows.map(function (row) {
          return '<div style="display:flex;justify-content:space-between;gap:16px;">' +
            '<span style="color:' + token(map, 'mutedFg', 'currentColor') + ';">' + esc(row.label) + '</span>' +
            '<strong style="font-weight:600;">' + esc(row.value) + '</strong>' +
          '</div>';
        }).join('') +
        (total ? '<div style="border-top:1px solid ' + token(map, 'cardBorder', token(map, 'border', 'currentColor')) + ';margin-top:6px;padding-top:6px;color:' + token(map, 'mutedFg', 'currentColor') + ';">' + esc(total) + '</div>' : '');
    }

    function show(evt) {
      var target = evt.currentTarget;
      renderTooltip(target);
      var rect = container.getBoundingClientRect();
      var clientX = evt.clientX || rect.left + rect.width / 2;
      var clientY = evt.clientY || rect.top + 16;
      tooltip.style.transform = 'translate(' + (clientX - rect.left + 12) + 'px, ' + (clientY - rect.top + 12) + 'px)';
      tooltip.style.opacity = '1';
    }

    function hide() {
      tooltip.style.opacity = '0';
      tooltip.style.transform = 'translate(-9999px, -9999px)';
    }

    container.querySelectorAll('[data-lux-chart-point]').forEach(function (point) {
      point.addEventListener('mousemove', show);
      point.addEventListener('focus', show);
      point.addEventListener('mouseleave', hide);
      point.addEventListener('blur', hide);
    });
  }

  return {
    niceScale: niceScale,
    fmt: fmt,
    esc: esc,
    escAttr: escAttr,
    tokens: tokens,
    token: token,
    chartPalette: chartPalette,
    color: color,
    tooltipAttrs: tooltipAttrs,
    attachTooltip: attachTooltip
  };
})();

/* lux-accordion.js — Compact multi-section disclosure for dense details.
 *
 * Global: LuxAccordion
 * Usage:  LuxAccordion.create(container, items, options) → { getExpanded, setExpanded }
 *   items    [{ id, label, content? }, ...]
 *   options  { expandedIds?, tokens? }
 *
 * Use for progressive disclosure in long detail panes. Do not use this for
 * side-by-side comparison views where tabs are the better pattern.
 */
var LuxAccordion = (function () {
  function create(container, items, opts) {
    opts = opts || {};
    var sections = Array.isArray(items) ? items.slice() : [];
    var expanded = _toExpandedMap(opts.expandedIds || []);
    var tokens = LuxWidgetUtils.tokens(opts);

    function _render() {
      var border = LuxWidgetUtils.token(tokens, "border", "currentColor");
      var cardFg = LuxWidgetUtils.token(tokens, "cardFg", "currentColor");
      var mutedFg = LuxWidgetUtils.token(tokens, "mutedFg", cardFg);
      var focusRing = LuxWidgetUtils.token(tokens, "focusRing", border);

      container.innerHTML = "";
      container.style.cssText = "display:grid;border-top:1px solid " + border + ";";

      sections.forEach(function (item) {
        var isExpanded = !!expanded[item.id];
        var section = document.createElement("section");
        section.style.cssText = "border-bottom:1px solid " + border + ";";

        var button = document.createElement("button");
        button.type = "button";
        button.setAttribute("aria-expanded", isExpanded ? "true" : "false");
        button.setAttribute("data-accordion-id", item.id);
        button.style.cssText =
          "appearance:none;width:100%;display:flex;align-items:center;justify-content:space-between;" +
          "gap:16px;padding:12px 0;border:none;background:transparent;color:" + cardFg + ";" +
          "font-family:Inter,sans-serif;font-size:14px;line-height:20px;font-weight:500;" +
          "text-align:left;cursor:pointer;outline:none;";

        var label = document.createElement("span");
        label.textContent = item.label;

        var chevron = document.createElement("span");
        chevron.setAttribute("aria-hidden", "true");
        chevron.textContent = "⌄";
        chevron.style.cssText =
          "display:inline-block;color:" + mutedFg + ";" +
          "transform:rotate(" + (isExpanded ? "180deg" : "0deg") + ");";

        button.appendChild(label);
        button.appendChild(chevron);
        button.addEventListener("click", function () {
          expanded[item.id] = !expanded[item.id];
          _render();
        });
        button.addEventListener("focus", function () {
          button.style.outline = "2px solid " + focusRing;
          button.style.outlineOffset = "1px";
        });
        button.addEventListener("blur", function () {
          button.style.outline = "none";
        });
        button.addEventListener("keydown", function (event) {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            expanded[item.id] = !expanded[item.id];
            _render();
          }
        });

        section.appendChild(button);

        if (isExpanded) {
          var panel = document.createElement("div");
          panel.style.cssText =
            "padding:0 0 12px;font-family:Inter,sans-serif;font-size:14px;line-height:20px;color:" + cardFg + ";";
          panel.textContent = item.content == null ? "" : String(item.content);
          section.appendChild(panel);
        }

        container.appendChild(section);
      });
    }

    _render();

    return {
      getExpanded: function () {
        return sections.filter(function (item) { return !!expanded[item.id]; }).map(function (item) { return item.id; });
      },
      setExpanded: function (ids) {
        expanded = _toExpandedMap(ids || []);
        _render();
      }
    };
  }

  function _toExpandedMap(ids) {
    var map = {};
    (ids || []).forEach(function (id) { map[id] = true; });
    return map;
  }

  return { create: create };
})();

/* lux-area-chart.js — SVG multi-series filled area chart renderer.
 *
 * Global: LuxAreaChart
 * Usage:  LuxAreaChart.render(container, series, options)
 *   series     [{label, points: [{x, y}, ...], color?}, ...]
 *              x values may be numeric or ISO date strings (YYYY-MM-DD).
 *   options    {title?, width?, height?, showLegend?, xLabel?, yLabel?, smooth?,
 *               stacked?, tokens?}
 *              stacked:true → cumulative stacked areas (default: false, overlapping fills)
 *
 * Rendering:
 *   - Each series draws a closed filled path (line + baseline) with fill-opacity="0.18"
 *     and a full-opacity stroke.
 *   - Non-stacked: series drawn back-to-front (last series rendered first).
 *   - Stacked: cumulative y values per x position; each area fills between its
 *     cumulative baseline and its cumulative top.
 *
 * Example:
 *   LuxAreaChart.render(el, [
 *     { label: 'Revenue', points: [{x:1,y:120},{x:2,y:180},{x:3,y:150}] },
 *     { label: 'Cost',    points: [{x:1,y:80}, {x:2,y:90}, {x:3,y:100}] },
 *   ], { title: 'Trend', tokens: tokens });
 */
var LuxAreaChart = (function () {
  var niceScale  = LuxWidgetUtils.niceScale;
  var fmt        = LuxWidgetUtils.fmt;
  var esc        = LuxWidgetUtils.esc;

  /* Format an x-axis value: pass ISO date strings through, format numbers normally */
  function fmtX(v) {
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    return fmt(v);
  }

  /* Build a mapper that converts x values (numeric or ISO date) to plot coordinates */
  function makeXMapper(allXRaw) {
    var isDate = allXRaw.length > 0 && typeof allXRaw[0] === 'string' && /^\d{4}-\d{2}-\d{2}/.test(allXRaw[0]);
    if (isDate) {
      var unique = [];
      allXRaw.forEach(function (v) {
        if (unique.indexOf(v) === -1) unique.push(v);
      });
      unique.sort();
      return {
        toNum: function (v) { return unique.indexOf(v); },
        xMin: 0,
        xMax: Math.max(0, unique.length - 1),
        isDate: true,
        unique: unique,
      };
    }
    var nums = allXRaw.map(Number);
    return {
      toNum: function (v) { return Number(v); },
      xMin: Math.min.apply(null, nums),
      xMax: Math.max.apply(null, nums),
      isDate: false,
      unique: null,
    };
  }

  function render(container, series, opts) {
    opts = opts || {};
    var title      = opts.title      || '';
    var showLegend = opts.showLegend !== false;
    var xLabel     = opts.xLabel     || '';
    var yLabel     = opts.yLabel     || '';
    var smooth     = !!opts.smooth;
    var stacked    = !!opts.stacked;
    var tokens     = LuxWidgetUtils.tokens(opts);
    var palette    = LuxWidgetUtils.chartPalette(tokens);
    var gridColor  = LuxWidgetUtils.token(tokens, 'chartGrid', 'currentColor');
    var axisColor  = LuxWidgetUtils.token(tokens, 'chartAxis', 'currentColor');
    var mutedFg    = LuxWidgetUtils.token(tokens, 'mutedFg', 'currentColor');
    var width      = opts.width  || container.clientWidth  || container.offsetWidth  || 420;
    var height     = opts.height || container.clientHeight || container.offsetHeight || 280;

    if (!series || !series.length) { container.innerHTML = ''; return; }

    var titleH = title ? 28 : 0;
    var padL   = yLabel ? 52 : 40;
    var padR   = 16;
    var padT   = titleH + 12;
    var padB   = xLabel ? 44 : 30;

    var LEGEND_COLS = 4;
    var legRows = Math.ceil(series.length / LEGEND_COLS);
    var legH    = showLegend ? legRows * 20 + 8 : 0;

    var plotW  = width - padL - padR;
    var plotH  = height - padT - padB - legH;

    /* Collect all x values and determine mapper */
    var allXRaw = [], allY = [];
    series.forEach(function (s) {
      s.points.forEach(function (p) { allXRaw.push(p.x); allY.push(p.y); });
    });

    var mapper = makeXMapper(allXRaw);
    var xMin   = mapper.xMin;
    var xMax   = mapper.xMax;
    var xRange = xMax - xMin || 1;

    /* For stacked mode, y-max is the sum of all series at any x position */
    var yMin = 0;
    var yMax;
    if (stacked) {
      /* Build per-x cumulative totals */
      var xKeys = mapper.isDate ? mapper.unique.slice() : [];
      if (!mapper.isDate) {
        allXRaw.forEach(function (v) {
          var k = String(v);
          if (xKeys.indexOf(k) === -1) xKeys.push(k);
        });
      }
      var colTotals = {};
      xKeys.forEach(function (k) { colTotals[k] = 0; });
      series.forEach(function (s) {
        s.points.forEach(function (p) {
          var k = mapper.isDate ? p.x : String(p.x);
          colTotals[k] = (colTotals[k] || 0) + p.y;
        });
      });
      var totals = xKeys.map(function (k) { return colTotals[k]; });
      yMax = Math.max.apply(null, totals.concat([0]));
    } else {
      yMax = Math.max.apply(null, allY.concat([0]));
    }
    var yRange = yMax - yMin || 1;

    function px(xVal) { return padL + ((mapper.toNum(xVal) - xMin) / xRange) * plotW; }
    function py(y)    { return padT + plotH - ((y - yMin) / yRange) * plotH; }

    /* Grid and axis labels */
    var yTicks = niceScale(yMin, yMax, 5);
    var grid = [], yLabels = [], xLabels = [];

    yTicks.forEach(function (v) {
      var y = py(v);
      grid.push('<line x1="' + padL + '" y1="' + y + '" x2="' + (padL + plotW) + '" y2="' + y + '" stroke="' + gridColor + '" stroke-width="1"/>');
      yLabels.push('<text x="' + (padL - 5) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" fill="' + mutedFg + '">' + fmt(v) + '</text>');
    });

    if (mapper.isDate) {
      var step = Math.max(1, Math.ceil(mapper.unique.length / 6));
      mapper.unique.forEach(function (dateStr, i) {
        if (i % step !== 0 && i !== mapper.unique.length - 1) return;
        var x = px(dateStr);
        xLabels.push('<text x="' + x + '" y="' + (padT + plotH + 14) + '" text-anchor="middle" font-size="10" fill="' + mutedFg + '">' + esc(dateStr.slice(0, 10)) + '</text>');
      });
    } else {
      var xTicks = niceScale(xMin, xMax, 6);
      xTicks.forEach(function (v) {
        var x = px(v);
        xLabels.push('<text x="' + x + '" y="' + (padT + plotH + 14) + '" text-anchor="middle" font-size="10" fill="' + mutedFg + '">' + fmtX(v) + '</text>');
      });
    }

    var colors = series.map(function (s, i) { return LuxWidgetUtils.color(s.color, tokens, palette[i % palette.length]); });

    /* Build area paths and point circles */
    var areas   = [];
    var circles = [];

    if (stacked) {
      /* Track cumulative baseline per x position */
      var cumulative = {};
      series.forEach(function (s) {
        s.points.forEach(function (p) { cumulative[mapper.isDate ? p.x : String(p.x)] = 0; });
      });

      series.forEach(function (s, i) {
        var c   = colors[i];
        var pts = s.points;
        if (!pts.length) return;

        /* Compute bottom and top y for each point */
        var bottomPts = pts.map(function (p) {
          var k = mapper.isDate ? p.x : String(p.x);
          return { x: p.x, y: cumulative[k] || 0 };
        });
        var topPts = pts.map(function (p) {
          var k = mapper.isDate ? p.x : String(p.x);
          var base = cumulative[k] || 0;
          return { x: p.x, y: base + p.y };
        });

        /* Build closed path: top line forward, bottom line backward */
        var dParts = [];
        topPts.forEach(function (p, j) {
          dParts.push((j === 0 ? 'M' : 'L') + px(p.x) + ',' + py(p.y));
        });
        for (var j = bottomPts.length - 1; j >= 0; j--) {
          dParts.push('L' + px(bottomPts[j].x) + ',' + py(bottomPts[j].y));
        }
        dParts.push('Z');

        areas.push('<path d="' + dParts.join(' ') + '" fill="' + c + '" fill-opacity="0.18" stroke="' + c + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>');

        /* Point circles at the top of each stacked segment */
        topPts.forEach(function (p) {
          circles.push('<circle cx="' + px(p.x) + '" cy="' + py(p.y) + '" r="3.5" fill="' + c + '"' +
            LuxWidgetUtils.tooltipAttrs(s.label, [
              { label: 'X', value: fmtX(p.x) },
              { label: 'Y', value: fmt(p.y) }
            ]) + '/>');
        });

        /* Update cumulative baselines */
        pts.forEach(function (p) {
          var k = mapper.isDate ? p.x : String(p.x);
          cumulative[k] = (cumulative[k] || 0) + p.y;
        });
      });
    } else {
      /* Non-stacked: draw back-to-front (last series first) */
      var baselineY = py(0);

      for (var i = series.length - 1; i >= 0; i--) {
        var s   = series[i];
        var c   = colors[i];
        var pts = s.points;
        if (!pts.length) continue;

        /* Build closed path: line forward + baseline back */
        var dParts = [];
        pts.forEach(function (p, j) {
          dParts.push((j === 0 ? 'M' : 'L') + px(p.x) + ',' + py(p.y));
        });
        dParts.push('L' + px(pts[pts.length - 1].x) + ',' + baselineY);
        dParts.push('L' + px(pts[0].x) + ',' + baselineY);
        dParts.push('Z');

        areas.push('<path d="' + dParts.join(' ') + '" fill="' + c + '" fill-opacity="0.18" stroke="' + c + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>');
      }

      /* Circles on top (forward order so front series dots are on top) */
      series.forEach(function (s, i) {
        var c   = colors[i];
        var pts = s.points;
        pts.forEach(function (p) {
          circles.push('<circle cx="' + px(p.x) + '" cy="' + py(p.y) + '" r="3.5" fill="' + c + '"' +
            LuxWidgetUtils.tooltipAttrs(s.label, [
              { label: 'X', value: fmtX(p.x) },
              { label: 'Y', value: fmt(p.y) }
            ]) + '/>');
        });
      });
    }

    /* Legend */
    var legendEl = [];
    if (showLegend) {
      series.forEach(function (s, i) {
        var c   = colors[i];
        var col = i % LEGEND_COLS;
        var row = Math.floor(i / LEGEND_COLS);
        var lx  = padL + col * Math.max(100, plotW / LEGEND_COLS);
        var ly  = height - legH + 4 + row * 20;
        legendEl.push('<g data-lux-chart-legend-item="true"><rect x="' + lx + '" y="' + (ly + 6) + '" width="18" height="3" fill="' + c + '" rx="1.5"/>' +
                      '<text x="' + (lx + 22) + '" y="' + (ly + 12) + '" font-size="11" fill="currentColor">' + esc(s.label) + '</text></g>');
      });
    }

    var titleEl  = title  ? '<text x="' + (width / 2) + '" y="18" text-anchor="middle" font-size="14" font-weight="600" fill="currentColor">' + esc(title) + '</text>' : '';
    var xLabelEl = xLabel ? '<text x="' + (padL + plotW / 2) + '" y="' + (height - (legH ? legH + 2 : 2)) + '" text-anchor="middle" font-size="11" fill="' + mutedFg + '">' + esc(xLabel) + '</text>' : '';
    var yLabelEl = yLabel ? '<text transform="rotate(-90)" x="' + (-(padT + plotH / 2)) + '" y="12" text-anchor="middle" font-size="11" fill="' + mutedFg + '">' + esc(yLabel) + '</text>' : '';

    var axes = '<line x1="' + padL + '" y1="' + padT + '" x2="' + padL + '" y2="' + (padT + plotH) + '" stroke="' + axisColor + '" stroke-width="1"/>' +
               '<line x1="' + padL + '" y1="' + (padT + plotH) + '" x2="' + (padL + plotW) + '" y2="' + (padT + plotH) + '" stroke="' + axisColor + '" stroke-width="1"/>';

    container.innerHTML =
      '<div style="position:relative;display:inline-block;">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">' +
      titleEl + axes + grid.join('') + yLabels.join('') + xLabels.join('') +
      areas.join('') + circles.join('') +
      (showLegend ? '<g data-lux-chart-legend="true">' + legendEl.join('') + '</g>' : '') +
      xLabelEl + yLabelEl +
      '</svg><div data-lux-chart-tooltip="true"></div></div>';
    LuxWidgetUtils.attachTooltip(container, tokens);
  }

  return { render: render };
})();

/* lux-bar-chart.js — SVG bar chart renderer (vertical, horizontal, grouped, stacked).
 *
 * Global: LuxBarChart
 * Usage:  LuxBarChart.render(container, data, options)
 *
 * Flat data (original API — fully backward compatible):
 *   data       [{label, value, color?}, ...]
 *   options    {title?, width?, height?, horizontal?, showValues?, color?,
 *               showLegend?, tokens?, referenceLines?: [{y, label?, color?}, ...]}
 *
 * Grouped / clustered bars:
 *   options.groups  [{label, bars: [{label, value, color?}, ...]}]
 *   When groups is provided (and stacked is false), renders side-by-side bars.
 *   options.stacked  true → stacked bars within each group.
 *
 * Label rotation:
 *   When data.length > 8 or groups.length > 8, x-axis labels are rotated 45 degrees.
 *
 * Example (flat):
 *   LuxBarChart.render(el, [
 *     { label: 'Jan', value: 420 },
 *     { label: 'Feb', value: 380 },
 *   ], { title: 'Monthly Sales', showValues: true, tokens: tokens });
 *
 * Example (grouped):
 *   LuxBarChart.render(el, null, {
 *     groups: [
 *       { label: 'Jan', bars: [{ label: 'Actual', value: 100 }, { label: 'Budget', value: 120 }] },
 *     ],
 *     tokens: tokens,
 *   });
 */
var LuxBarChart = (function () {
  var niceScale  = LuxWidgetUtils.niceScale;
  var fmt        = LuxWidgetUtils.fmt;
  var esc        = LuxWidgetUtils.esc;

  /* ---- grouped/stacked rendering ---- */

  function renderGrouped(container, opts) {
    opts = opts || {};
    var groups     = opts.groups;
    var stacked    = !!opts.stacked;
    var title      = opts.title      || '';
    var showValues = opts.showValues !== false;
    var tokens     = LuxWidgetUtils.tokens(opts);
    var palette    = LuxWidgetUtils.chartPalette(tokens);
    var gridColor  = LuxWidgetUtils.token(tokens, 'chartGrid', 'currentColor');
    var axisColor  = LuxWidgetUtils.token(tokens, 'chartAxis', 'currentColor');
    var mutedFg    = LuxWidgetUtils.token(tokens, 'mutedFg', 'currentColor');
    var width      = opts.width  || container.clientWidth  || container.offsetWidth  || 500;
    var height     = opts.height || container.clientHeight || container.offsetHeight || 300;

    if (!groups || !groups.length) { container.innerHTML = ''; return; }

    /* collect series names for legend */
    var seriesNames = [];
    groups.forEach(function (g) {
      g.bars.forEach(function (b) {
        if (seriesNames.indexOf(b.label) === -1) seriesNames.push(b.label);
      });
    });

    var titleH  = title ? 28 : 0;
    var padL    = 44;
    var padR    = 16;
    var padT    = titleH + 12;
    var legRows = Math.ceil(seriesNames.length / 3);
    var legH    = legRows * 22 + 8;
    var rotateLabels = groups.length > 8;
    var padB    = (rotateLabels ? 64 : 50) + legH;
    var plotW   = width - padL - padR;
    var plotH   = height - padT - padB;

    /* compute value range */
    var vMax = 0;
    var vMin = 0;
    groups.forEach(function (g) {
      if (stacked) {
        var sum = 0;
        g.bars.forEach(function (b) { sum += b.value; });
        vMax = Math.max(vMax, sum);
      } else {
        g.bars.forEach(function (b) {
          vMax = Math.max(vMax, b.value);
          vMin = Math.min(vMin, b.value);
        });
      }
    });
    var vRange = vMax - vMin || 1;
    var ticks  = niceScale(vMin, vMax, 5);

    var zeroY  = padT + plotH - ((-vMin) / vRange) * plotH;
    var slotW  = plotW / groups.length;

    var grid = [], bars = [], axisLabels = [];
    var leftAxis = '<line x1="' + padL + '" y1="' + padT + '" x2="' + padL + '" y2="' + (padT + plotH) + '" stroke="' + axisColor + '" stroke-width="1"/>';
    var bottomAxis = '<line x1="' + padL + '" y1="' + (padT + plotH) + '" x2="' + (padL + plotW) + '" y2="' + (padT + plotH) + '" stroke="' + axisColor + '" stroke-width="1"/>';

    ticks.forEach(function (v) {
      var y = padT + plotH - ((v - vMin) / vRange) * plotH;
      grid.push('<line x1="' + padL + '" y1="' + y + '" x2="' + (padL + plotW) + '" y2="' + y + '" stroke="' + gridColor + '" stroke-width="1"/>');
      axisLabels.push('<text x="' + (padL - 5) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" fill="' + mutedFg + '">' + fmt(v) + '</text>');
    });

    groups.forEach(function (g, gi) {
      var gx = padL + gi * slotW;
      var cx = gx + slotW / 2;

      if (stacked) {
        var stackBottom = zeroY;
        var stackTotal  = g.bars.reduce(function (s, b) { return s + b.value; }, 0);
        g.bars.forEach(function (b, bi) {
          var c  = LuxWidgetUtils.color(b.color, tokens, palette[bi % palette.length]);
          var bH = Math.abs((b.value / vRange) * plotH);
          var by = stackBottom - bH;
          var bW = Math.max(4, Math.floor(slotW * 0.65));
          var bx = gx + (slotW - bW) / 2;
          bars.push('<rect x="' + bx + '" y="' + by + '" width="' + bW + '" height="' + bH + '" fill="' + c + '" rx="2"' +
            LuxWidgetUtils.tooltipAttrs(b.label, [
              { label: 'Value', value: fmt(b.value) },
              { label: 'Stack', value: fmt(stackTotal) },
            ]) + '/>');
          stackBottom = by;
        });
        if (showValues) {
          var topY = stackBottom - 4;
          bars.push('<text x="' + cx + '" y="' + topY + '" text-anchor="middle" font-size="11" fill="currentColor">' + fmt(stackTotal) + '</text>');
        }
      } else {
        var nBars = g.bars.length;
        var barW  = Math.max(4, Math.floor((slotW * 0.8) / nBars));
        var groupBarW = barW * nBars;
        var groupStartX = gx + (slotW - groupBarW) / 2;

        g.bars.forEach(function (b, bi) {
          var c  = LuxWidgetUtils.color(b.color, tokens, palette[bi % palette.length]);
          var bH = Math.abs((b.value / vRange) * plotH);
          var bx = groupStartX + bi * barW;
          var by = b.value >= 0 ? zeroY - bH : zeroY;
          bars.push('<rect x="' + bx + '" y="' + by + '" width="' + (barW - 1) + '" height="' + bH + '" fill="' + c + '" rx="2"' +
            LuxWidgetUtils.tooltipAttrs(b.label, [{ label: 'Value', value: fmt(b.value) }]) + '/>');
        });
      }

      /* x-axis group label */
      if (rotateLabels) {
        axisLabels.push('<text x="' + cx + '" y="' + (padT + plotH + 8) + '" text-anchor="end" font-size="11" fill="currentColor" transform="rotate(-45,' + cx + ',' + (padT + plotH + 8) + ')">' + esc(g.label) + '</text>');
      } else {
        axisLabels.push('<text x="' + cx + '" y="' + (padT + plotH + 14) + '" text-anchor="middle" font-size="11" fill="currentColor">' + esc(g.label) + '</text>');
      }
    });

    var titleEl = title
      ? '<text x="' + (width / 2) + '" y="18" text-anchor="middle" font-size="14" font-weight="600" fill="currentColor">' + esc(title) + '</text>'
      : '';

    /* legend — show series names */
    var legendEl = [];
    seriesNames.forEach(function (name, i) {
      var c   = LuxWidgetUtils.color(null, tokens, palette[i % palette.length]);
      var col = i % 3;
      var row = Math.floor(i / 3);
      var lx  = padL + col * Math.max(92, plotW / 3);
      var ly  = height - legH + 8 + row * 22;
      legendEl.push('<g data-lux-chart-legend-item="true">' +
        '<rect x="' + lx + '" y="' + ly + '" width="12" height="12" fill="' + c + '" rx="2"/>' +
        '<text x="' + (lx + 18) + '" y="' + (ly + 10) + '" font-size="11" fill="currentColor">' + esc(name) + '</text></g>');
    });

    container.innerHTML =
      '<div style="position:relative;display:inline-block;">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">' +
      titleEl + leftAxis + bottomAxis + grid.join('') + bars.join('') + axisLabels.join('') +
      '<g data-lux-chart-legend="true">' + legendEl.join('') + '</g>' +
      '</svg><div data-lux-chart-tooltip="true"></div></div>';
    LuxWidgetUtils.attachTooltip(container, tokens);
  }

  /* ---- flat (original) rendering ---- */

  function render(container, data, opts) {
    opts = opts || {};

    /* delegate to grouped renderer when groups are supplied */
    if (opts.groups) {
      renderGrouped(container, opts);
      return;
    }

    var title      = opts.title      || '';
    var horizontal = !!opts.horizontal;
    var showValues = opts.showValues !== false;
    var showLegend = !!opts.showLegend;
    var singleColor    = opts.color || null;
    var referenceLines = opts.referenceLines || [];
    var tokens = LuxWidgetUtils.tokens(opts);
    var palette = LuxWidgetUtils.chartPalette(tokens);
    var gridColor = LuxWidgetUtils.token(tokens, 'chartGrid', 'currentColor');
    var axisColor = LuxWidgetUtils.token(tokens, 'chartAxis', 'currentColor');
    var mutedFg = LuxWidgetUtils.token(tokens, 'mutedFg', 'currentColor');
    var referenceColor = LuxWidgetUtils.token(tokens, 'statusError', 'currentColor');
    var width  = opts.width  || container.clientWidth  || container.offsetWidth  || 420;
    var height = opts.height || container.clientHeight || container.offsetHeight || 280;

    if (!data || !data.length) { container.innerHTML = ''; return; }

    var rotateLabels = !horizontal && data.length > 8;

    var titleH = title ? 28 : 0;
    var padL   = horizontal ? 110 : 44;
    var maxRLLabel = referenceLines.reduce(function (m, rl) { return rl.label ? Math.max(m, rl.label.length) : m; }, 0);
    var padR   = maxRLLabel ? Math.max(16, maxRLLabel * 7 + 6) : 16;
    var padT   = titleH + 12;
    var legH   = showLegend ? Math.ceil(data.length / 3) * 22 + 8 : 0;
    var padB   = (horizontal ? 32 : (rotateLabels ? 64 : 50)) + legH;
    var plotW  = width - padL - padR;
    var plotH  = height - padT - padB;

    var values = data.map(function (d) { return d.value; });
    var vMax   = Math.max.apply(null, values.concat([0]));
    var vMin   = Math.min.apply(null, values.concat([0]));
    var vRange = vMax - vMin || 1;
    var ticks  = niceScale(vMin, vMax, 5);

    var grid = [], bars = [], axisLabels = [];
    var leftAxis = '<line x1="' + padL + '" y1="' + padT + '" x2="' + padL + '" y2="' + (padT + plotH) + '" stroke="' + axisColor + '" stroke-width="1"/>';

    if (horizontal) {
      var slotH  = plotH / data.length;
      var barH   = Math.max(4, Math.floor(slotH * 0.65));
      var zeroX  = padL + ((-vMin) / vRange) * plotW;

      ticks.forEach(function (v) {
        var x = padL + ((v - vMin) / vRange) * plotW;
        grid.push('<line x1="' + x + '" y1="' + padT + '" x2="' + x + '" y2="' + (padT + plotH) + '" stroke="' + gridColor + '" stroke-width="1"/>');
        axisLabels.push('<text x="' + x + '" y="' + (padT + plotH + 14) + '" text-anchor="middle" font-size="10" fill="' + mutedFg + '">' + fmt(v) + '</text>');
      });
      grid.push('<line x1="' + zeroX + '" y1="' + padT + '" x2="' + zeroX + '" y2="' + (padT + plotH) + '" stroke="' + axisColor + '" stroke-width="1"/>');

      data.forEach(function (d, i) {
        var c   = LuxWidgetUtils.color(d.color || singleColor, tokens, palette[i % palette.length]);
        var y   = padT + i * slotH + (slotH - barH) / 2;
        var bW  = Math.abs((d.value / vRange) * plotW);
        var x   = d.value >= 0 ? zeroX : zeroX - bW;
        bars.push('<rect x="' + x + '" y="' + y + '" width="' + bW + '" height="' + barH + '" fill="' + c + '" rx="2"' +
                  LuxWidgetUtils.tooltipAttrs(d.label, [{ label: 'Value', value: fmt(d.value) }]) + '/>');
        axisLabels.push('<text x="' + (padL - 5) + '" y="' + (y + barH / 2 + 4) + '" text-anchor="end" font-size="11" fill="currentColor">' + esc(d.label) + '</text>');
        if (showValues) {
          var vx   = d.value >= 0 ? x + bW + 4 : x - 4;
          var anch = d.value >= 0 ? 'start' : 'end';
          bars.push('<text x="' + vx + '" y="' + (y + barH / 2 + 4) + '" text-anchor="' + anch + '" font-size="11" fill="currentColor">' + fmt(d.value) + '</text>');
        }
      });
    } else {
      var slotW  = plotW / data.length;
      var barW   = Math.max(4, Math.floor(slotW * 0.65));
      var zeroY  = padT + plotH - ((-vMin) / vRange) * plotH;

      ticks.forEach(function (v) {
        var y = padT + plotH - ((v - vMin) / vRange) * plotH;
        grid.push('<line x1="' + padL + '" y1="' + y + '" x2="' + (padL + plotW) + '" y2="' + y + '" stroke="' + gridColor + '" stroke-width="1"/>');
        axisLabels.push('<text x="' + (padL - 5) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" fill="' + mutedFg + '">' + fmt(v) + '</text>');
      });

      data.forEach(function (d, i) {
        var c   = LuxWidgetUtils.color(d.color || singleColor, tokens, palette[i % palette.length]);
        var x   = padL + i * slotW + (slotW - barW) / 2;
        var bH  = Math.abs((d.value / vRange) * plotH);
        var y   = d.value >= 0 ? zeroY - bH : zeroY;
        var cx  = x + barW / 2;
        bars.push('<rect x="' + x + '" y="' + y + '" width="' + barW + '" height="' + bH + '" fill="' + c + '" rx="2"' +
                  LuxWidgetUtils.tooltipAttrs(d.label, [{ label: 'Value', value: fmt(d.value) }]) + '/>');
        if (rotateLabels) {
          axisLabels.push('<text x="' + cx + '" y="' + (padT + plotH + 8) + '" text-anchor="end" font-size="11" fill="currentColor" transform="rotate(-45,' + cx + ',' + (padT + plotH + 8) + ')">' + esc(d.label) + '</text>');
        } else {
          axisLabels.push('<text x="' + cx + '" y="' + (padT + plotH + 14) + '" text-anchor="middle" font-size="11" fill="currentColor">' + esc(d.label) + '</text>');
        }
        if (showValues) {
          var vy = d.value >= 0 ? y - 4 : y + bH + 13;
          bars.push('<text x="' + cx + '" y="' + vy + '" text-anchor="middle" font-size="11" fill="currentColor">' + fmt(d.value) + '</text>');
        }
      });
    }

    var refLines = [];
    if (!horizontal) {
      referenceLines.forEach(function (rl) {
        var ry = padT + plotH - ((rl.y - vMin) / vRange) * plotH;
        var rc = LuxWidgetUtils.color(rl.color, tokens, referenceColor);
        refLines.push('<line x1="' + padL + '" y1="' + ry + '" x2="' + (padL + plotW) + '" y2="' + ry + '" stroke="' + rc + '" stroke-width="1.5" stroke-dasharray="4,3"/>');
        if (rl.label) {
          refLines.push('<text x="' + (padL + plotW + 3) + '" y="' + (ry + 4) + '" text-anchor="start" font-size="10" fill="' + rc + '">' + esc(rl.label) + '</text>');
        }
      });
    }

    var titleEl = title
      ? '<text x="' + (width / 2) + '" y="18" text-anchor="middle" font-size="14" font-weight="600" fill="currentColor">' + esc(title) + '</text>'
      : '';
    var bottomAxis = horizontal ? '' : '<line x1="' + padL + '" y1="' + (padT + plotH) + '" x2="' + (padL + plotW) + '" y2="' + (padT + plotH) + '" stroke="' + axisColor + '" stroke-width="1"/>';
    var legendEl = [];
    if (showLegend) {
      data.forEach(function (d, i) {
        var c = LuxWidgetUtils.color(d.color || singleColor, tokens, palette[i % palette.length]);
        var col = i % 3;
        var row = Math.floor(i / 3);
        var lx = padL + col * Math.max(92, plotW / 3);
        var ly = height - legH + 8 + row * 22;
        legendEl.push('<g data-lux-chart-legend-item="true">' +
          '<rect x="' + lx + '" y="' + ly + '" width="12" height="12" fill="' + c + '" rx="2"/>' +
          '<text x="' + (lx + 18) + '" y="' + (ly + 10) + '" font-size="11" fill="currentColor">' +
          esc(d.label) + ' ' + fmt(d.value) + '</text></g>');
      });
    }

    container.innerHTML =
      '<div style="position:relative;display:inline-block;">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">' +
      titleEl + leftAxis + bottomAxis + grid.join('') + bars.join('') + refLines.join('') + axisLabels.join('') +
      (showLegend ? '<g data-lux-chart-legend="true">' + legendEl.join('') + '</g>' : '') +
      '</svg><div data-lux-chart-tooltip="true"></div></div>';
    LuxWidgetUtils.attachTooltip(container, tokens);
  }

  return { render: render };
})();

/* lux-bullet-chart.js — SVG bullet chart renderer (Stephen Few style).
 *
 * Global: LuxBulletChart
 * Usage:  LuxBulletChart.render(container, items, options)
 *   items   [{label, value, target?, max?, ranges?:[{to, tone:'success'|'warning'|'error'}]}, ...]
 *   options {title?, width?, height?, barHeight?, showValues?, tokens?}
 *
 * Example:
 *   LuxBulletChart.render(el, [
 *     { label: 'Revenue', value: 75, target: 80, max: 100,
 *       ranges: [{to:40,tone:'error'},{to:70,tone:'warning'},{to:100,tone:'success'}] },
 *   ], { showValues: true, tokens: tokens });
 */
var LuxBulletChart = (function () {
  var esc = LuxWidgetUtils.esc;

  function render(container, items, opts) {
    opts = opts || {};
    if (!Array.isArray(items) || !items.length) { container.innerHTML = ''; return; }

    var title     = opts.title     || '';
    var showValues = opts.showValues !== false; // default true
    var barHeight = opts.barHeight || 10;
    var tokens    = LuxWidgetUtils.tokens(opts);

    // Token colours
    var barFill       = LuxWidgetUtils.token(tokens, 'chart1', 'currentColor');
    var targetColor   = LuxWidgetUtils.token(tokens, 'mutedFg', 'GrayText');
    var successColor  = LuxWidgetUtils.token(tokens, 'semanticSuccessFg', 'currentColor');
    var warningColor  = LuxWidgetUtils.token(tokens, 'semanticWarningFg', 'currentColor');
    var errorColor    = LuxWidgetUtils.token(tokens, 'semanticErrorFg', 'currentColor');
    var mutedFg       = LuxWidgetUtils.token(tokens, 'mutedFg', 'GrayText');

    var rowHeight = opts.rowHeight || 40;
    var titleH    = title ? 28 : 0;
    var padL      = 100; // label area width
    var padR      = 16;
    var padT      = titleH + 8;
    var padB      = 8;

    var width  = opts.width  || container.clientWidth  || container.offsetWidth  || 400;
    var height = opts.height || (items.length * rowHeight + padT + padB);
    var plotW  = width - padL - padR;

    var toneColor = { success: successColor, warning: warningColor, error: errorColor };

    var rowEls = [];

    for (var i = 0; i < items.length; i++) {
      var item = items[i];

      // Compute max scale
      var scaleMax = item.max || 0;
      if (item.value > scaleMax)  scaleMax = item.value;
      if (item.target && item.target > scaleMax) scaleMax = item.target;
      if (item.ranges) {
        for (var r = 0; r < item.ranges.length; r++) {
          if (item.ranges[r].to > scaleMax) scaleMax = item.ranges[r].to;
        }
      }
      if (scaleMax === 0) scaleMax = 1;

      var rowY     = padT + i * rowHeight;
      var rowCy    = rowY + rowHeight / 2; // vertical centre of row

      // Range bands (background) — drawn from 0 up to each band's `to` value
      var rangeBandEls = [];
      if (item.ranges && item.ranges.length) {
        for (var ri = 0; ri < item.ranges.length; ri++) {
          var band     = item.ranges[ri];
          var bandW    = (band.to / scaleMax) * plotW;
          var bandC    = toneColor[band.tone] || mutedFg;
          rangeBandEls.push(
            '<rect data-lux-bullet-range="' + esc(band.tone) + '"' +
            ' x="' + padL + '" y="' + (rowCy - rowHeight * 0.35) + '"' +
            ' width="' + bandW + '" height="' + (rowHeight * 0.7) + '"' +
            ' fill="' + bandC + '" fill-opacity="0.2" rx="2"/>'
          );
        }
      }

      // Performance bar (actual value)
      var valueW   = (item.value / scaleMax) * plotW;
      var barY     = rowCy - barHeight / 2;
      var tooltipRows = [{ label: 'Value', value: String(LuxWidgetUtils.fmt(item.value)) }];
      if (item.target != null) {
        tooltipRows.push({ label: 'Target', value: String(LuxWidgetUtils.fmt(item.target)) });
      }

      var perfBar =
        '<rect data-lux-bullet-bar="true"' +
        ' x="' + padL + '" y="' + barY + '"' +
        ' width="' + valueW + '" height="' + barHeight + '"' +
        ' fill="' + barFill + '" rx="2"' +
        LuxWidgetUtils.tooltipAttrs(item.label, tooltipRows) + '/>';

      // Target tick (vertical line, taller than bar)
      var targetEl = '';
      if (item.target != null) {
        var targetX  = padL + (item.target / scaleMax) * plotW;
        var tickH    = barHeight * 2.2;
        var tickY1   = rowCy - tickH / 2;
        var tickY2   = rowCy + tickH / 2;
        targetEl =
          '<line data-lux-bullet-target="true"' +
          ' x1="' + targetX + '" y1="' + tickY1 + '"' +
          ' x2="' + targetX + '" y2="' + tickY2 + '"' +
          ' stroke="' + targetColor + '" stroke-width="2"/>';
      }

      // Value text
      var valueTextEl = '';
      if (showValues) {
        var vtx = padL + valueW + 5;
        var vty = rowCy + 4;
        valueTextEl =
          '<text data-lux-bullet-value="true"' +
          ' x="' + vtx + '" y="' + vty + '"' +
          ' font-size="10" fill="' + mutedFg + '">' +
          esc(String(LuxWidgetUtils.fmt(item.value))) + '</text>';
      }

      // Label (left of plot area)
      var labelEl =
        '<text x="' + (padL - 6) + '" y="' + (rowCy + 4) + '"' +
        ' text-anchor="end" font-size="11" fill="' + mutedFg + '">' +
        esc(item.label) + '</text>';

      rowEls.push(
        '<g data-lux-bullet-row="true">' +
        rangeBandEls.join('') +
        perfBar +
        targetEl +
        valueTextEl +
        labelEl +
        '</g>'
      );
    }

    var titleEl = title
      ? '<text x="' + (width / 2) + '" y="18" text-anchor="middle" font-size="14"' +
        ' font-weight="600" fill="currentColor">' + esc(title) + '</text>'
      : '';

    container.innerHTML =
      '<div style="position:relative;display:inline-block;">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height +
      '" font-family="Inter, sans-serif">' +
      titleEl +
      rowEls.join('') +
      '</svg>' +
      '<div data-lux-chart-tooltip="true"></div>' +
      '</div>';

    LuxWidgetUtils.attachTooltip(container, tokens);
  }

  return { render: render };
})();

/* lux-chat-feed.js — Streaming-capable chat message feed.
 *
 * Global: LuxChatFeed
 * Usage:  LuxChatFeed.create(container, options) → { appendMessage, updateLast, clear }
 *   options  { userLabel?, assistantLabel?, maxHeight?, tokens? }
 *   msg      { role: 'user'|'assistant'|'system', content, timestamp? }
 *
 * appendMessage(msg) — add a message bubble; returns the DOM element.
 * updateLast(text)   — replace the last message's text (use for streaming).
 * clear()            — remove all messages.
 *
 * Example:
 *   const feed = LuxChatFeed.create(el, { assistantLabel: 'AI' });
 *   feed.appendMessage({ role: 'user', content: 'Hello!' });
 *   const bot = feed.appendMessage({ role: 'assistant', content: '' });
 *   // ... stream tokens:
 *   feed.updateLast(accumulated);
 */
var LuxChatFeed = (function () {
  var esc = LuxWidgetUtils.esc;

  function create(container, opts) {
    opts = opts || {};
    var userLabel      = opts.userLabel      || 'You';
    var assistantLabel = opts.assistantLabel || 'Assistant';
    var maxHeight      = opts.maxHeight      || '400px';
    var tokens         = LuxWidgetUtils.tokens(opts);

    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;overflow-y:auto;padding:8px;' +
                         'box-sizing:border-box;max-height:' + maxHeight + ';scroll-behavior:smooth;';
    container.innerHTML = '';
    container.appendChild(wrap);

    var msgs = [];
    var _lastBody = null;

    function appendMessage(msg) {
      msgs.push(msg);
      var el = _bubble(msg, userLabel, assistantLabel, tokens);
      wrap.appendChild(el);
      _lastBody = el.querySelector('.lcf-body');
      wrap.scrollTop = wrap.scrollHeight;
      return el;
    }

    function updateLast(text) {
      if (!_lastBody) return;
      msgs[msgs.length - 1].content = text;
      _lastBody.textContent = text;
      wrap.scrollTop = wrap.scrollHeight;
    }

    function clear() { msgs = []; _lastBody = null; wrap.innerHTML = ''; }

    return { appendMessage: appendMessage, updateLast: updateLast, clear: clear };
  }

  function _bubble(msg, userLabel, assistantLabel, tokens) {
    var isUser = msg.role === 'user';
    var label  = isUser ? userLabel : (msg.role === 'assistant' ? assistantLabel : msg.role);
    var bg     = isUser
      ? LuxWidgetUtils.token(tokens, 'chatUserBg', LuxWidgetUtils.token(tokens, 'chart1', 'currentColor'))
      : LuxWidgetUtils.token(tokens, 'chatAssistantBg', 'transparent');
    var color  = isUser
      ? LuxWidgetUtils.token(tokens, 'chatUserFg', LuxWidgetUtils.token(tokens, 'chartFg', 'currentColor'))
      : LuxWidgetUtils.token(tokens, 'chatAssistantFg', 'currentColor');
    var align  = isUser ? 'flex-end' : 'flex-start';
    var mutedFg = LuxWidgetUtils.token(tokens, 'mutedFg', 'currentColor');

    var ts = '';
    if (msg.timestamp) {
      try { ts = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) {}
    }

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-direction:column;align-items:' + align + ';gap:2px;';

    var meta = document.createElement('div');
    meta.style.cssText = 'font-size:11px;color:' + mutedFg + ';padding:0 4px;display:flex;gap:8px;';
    meta.innerHTML = '<span>' + esc(label) + '</span>' + (ts ? '<span>' + esc(ts) + '</span>' : '');

    var bwrap = document.createElement('div');
    bwrap.style.cssText = 'display:flex;align-items:flex-start;gap:4px;max-width:80%;';

    var body = document.createElement('div');
    body.className = 'lcf-body';
    body.style.cssText = 'background:' + bg + ';color:' + color + ';padding:8px 12px;' +
                         'border-radius:12px;font-size:14px;line-height:1.5;' +
                         'white-space:pre-wrap;word-break:break-word;';
    body.textContent = msg.content;

    var copy = document.createElement('button');
    copy.title = 'Copy';
    copy.style.cssText = 'background:none;border:none;cursor:pointer;color:' + mutedFg + ';font-size:14px;' +
                         'padding:4px 2px;opacity:0;transition:opacity 0.15s;flex-shrink:0;align-self:flex-start;';
    copy.textContent = '⎘';

    bwrap.addEventListener('mouseenter', function () { copy.style.opacity = '1'; });
    bwrap.addEventListener('mouseleave', function () { copy.style.opacity = '0'; });
    copy.addEventListener('click', function () {
      var text = msg.content;
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
        .catch(function () { _copyFallback(text); });
      copy.textContent = '✓';
      setTimeout(function () { copy.textContent = '⎘'; }, 1500);
    });

    bwrap.appendChild(body);
    bwrap.appendChild(copy);
    row.appendChild(meta);
    row.appendChild(bwrap);
    return row;
  }

  function _copyFallback(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }

  return { create: create };
})();

/* lux-chat-input.js — Auto-growing chat input with file attachment support.
 *
 * Global: LuxChatInput
 * Usage:  LuxChatInput.create(container, options) → { onSubmit, clear, focus, setDisabled }
 *   options  { placeholder?, maxRows?, accept?, tokens? }
 *
 * onSubmit(fn)       — register submit handler; fn receives { text, attachments }.
 *                      attachments: [{ name, type, dataUrl }]
 * clear()            — reset text and attachments.
 * focus()            — focus the textarea.
 * setDisabled(bool)  — lock/unlock input (use during streaming).
 *
 * Submit triggers on Send button click or Enter key (Shift+Enter inserts newline).
 *
 * Example:
 *   const input = LuxChatInput.create(el, { placeholder: 'Ask anything…' });
 *   input.onSubmit(({ text, attachments }) => {
 *     handleMessage(text, attachments);
 *   });
 */
var LuxChatInput = (function () {
  var esc = LuxWidgetUtils.esc;

  function create(container, opts) {
    opts = opts || {};
    var placeholder = opts.placeholder || 'Type a message…';
    var maxRows     = opts.maxRows     || 6;
    var accept      = opts.accept      || '*/*';
    var tokens      = LuxWidgetUtils.tokens(opts);
    var border      = LuxWidgetUtils.token(tokens, 'border', 'currentColor');
    var inputBg     = LuxWidgetUtils.token(tokens, 'inputBg', 'transparent');
    var buttonBg    = LuxWidgetUtils.token(tokens, 'buttonPrimaryBg', LuxWidgetUtils.token(tokens, 'chart1', 'currentColor'));
    var buttonFg    = LuxWidgetUtils.token(tokens, 'buttonPrimaryFg', LuxWidgetUtils.token(tokens, 'chartFg', 'currentColor'));
    var chipBg      = LuxWidgetUtils.token(tokens, 'chipBg', 'transparent');
    var mutedFg     = LuxWidgetUtils.token(tokens, 'mutedFg', 'currentColor');

    container.innerHTML = '';

    var wrap = document.createElement('div');
    wrap.style.cssText = 'border:1px solid ' + border + ';border-radius:8px;padding:8px;' +
                         'display:flex;flex-direction:column;gap:6px;' +
                         'background:' + inputBg + ';box-sizing:border-box;';

    var chips = document.createElement('div');
    chips.style.cssText = 'display:none;flex-wrap:wrap;gap:4px;';

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:flex-end;gap:6px;';

    var ta = document.createElement('textarea');
    ta.placeholder = placeholder;
    ta.rows = 1;
    ta.style.cssText = 'flex:1;resize:none;border:none;outline:none;' +
                       'font-size:14px;font-family:inherit;line-height:1.5;' +
                       'padding:2px 0;background:transparent;overflow:hidden;';

    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = accept;
    fileInput.style.display = 'none';

    var clipBtn = _iconBtn('📎', 'Attach file', '18px', mutedFg);
    var sendBtn = document.createElement('button');
    sendBtn.textContent = 'Send';
    sendBtn.style.cssText = 'background:' + buttonBg + ';color:' + buttonFg + ';border:none;border-radius:8px;' +
                             'padding:6px 14px;font-size:14px;cursor:pointer;' +
                             'font-family:inherit;flex-shrink:0;white-space:nowrap;';

    row.appendChild(ta);
    row.appendChild(clipBtn);
    row.appendChild(sendBtn);
    wrap.appendChild(chips);
    wrap.appendChild(row);
    wrap.appendChild(fileInput);
    container.appendChild(wrap);

    var attachments = [];
    var submitHandler = null;
    var LINE_H = 21;

    ta.addEventListener('input', function () {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, LINE_H * maxRows) + 'px';
    });

    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _submit(); }
    });

    clipBtn.addEventListener('click', function () { fileInput.click(); });
    sendBtn.addEventListener('click', _submit);

    fileInput.addEventListener('change', function () {
      Array.from(fileInput.files || []).forEach(_addAttachment);
      fileInput.value = '';
    });

    function _addAttachment(file) {
      var reader = new FileReader();
      reader.onload = function (ev) {
        var att = { name: file.name, type: file.type, dataUrl: ev.target.result };
        attachments.push(att);
        _chip(att);
        chips.style.display = 'flex';
      };
      reader.readAsDataURL(file);
    }

    function _chip(att) {
      var chip = document.createElement('div');
      chip.style.cssText = 'background:' + chipBg + ';border:1px solid ' + border + ';border-radius:9999px;' +
                           'padding:2px 6px;font-size:12px;display:flex;align-items:center;gap:4px;';
      chip.innerHTML = '<span>' + esc(att.name) + '</span>';

      var x = _iconBtn('×', 'Remove', '14px', mutedFg);
      x.addEventListener('click', function () {
        attachments = attachments.filter(function (a) { return a !== att; });
        chip.remove();
        if (!chips.childElementCount) chips.style.display = 'none';
      });
      chip.appendChild(x);
      chips.appendChild(chip);
    }

    function _reset() {
      ta.value = '';
      ta.style.height = 'auto';
      attachments = [];
      chips.innerHTML = '';
      chips.style.display = 'none';
    }

    function _submit() {
      var text = ta.value.trim();
      if (!text && !attachments.length) return;
      if (submitHandler) submitHandler({ text: text, attachments: attachments.slice() });
      _reset();
    }

    function onSubmit(fn) { submitHandler = fn; }

    function clear() { _reset(); }

    function focus() { ta.focus(); }

    function setDisabled(disabled) {
      [ta, sendBtn, clipBtn].forEach(function (el) { el.disabled = disabled; });
      sendBtn.style.opacity  = disabled ? '0.5' : '1';
      sendBtn.style.cursor   = disabled ? 'not-allowed' : 'pointer';
    }

    return { onSubmit: onSubmit, clear: clear, focus: focus, setDisabled: setDisabled };
  }

  function _iconBtn(text, title, size, color) {
    var b = document.createElement('button');
    b.title = title;
    b.textContent = text;
    b.style.cssText = 'background:none;border:none;cursor:pointer;color:' + (color || 'currentColor') + ';font-size:' + size + ';' +
                      'padding:2px 4px;line-height:1;flex-shrink:0;';
    return b;
  }

  return { create: create };
})();

/* lux-combobox.js — Filterable combobox / autocomplete widget.
 *
 * Global: LuxCombobox
 * Usage:  LuxCombobox.create(container, options) → { getValue, setValue, setOptions, setDisabled, onChange }
 *
 * Options:
 *   label?, placeholder?, value?, options:[{value,label}], onChange?, tokens?
 */
var LuxCombobox = (function () {
  function create(container, opts) {
    opts = opts || {};
    var tokens = LuxWidgetUtils.tokens(opts);
    var inputBg = LuxWidgetUtils.token(tokens, "inputBg", "Canvas");
    var inputFg = LuxWidgetUtils.token(tokens, "inputFg", "currentColor");
    var inputBorder = LuxWidgetUtils.token(tokens, "inputBorder", "currentColor");
    var cardBg = LuxWidgetUtils.token(tokens, "cardBg", "Canvas");
    var cardBorder = LuxWidgetUtils.token(tokens, "cardBorder", "currentColor");
    var accentBg = LuxWidgetUtils.token(tokens, "accentBg", LuxWidgetUtils.token(tokens, "primary", "AccentColor"));
    var accentFg = LuxWidgetUtils.token(tokens, "buttonPrimaryFg", "Canvas");
    var focusRing = LuxWidgetUtils.token(tokens, "focusRing", "AccentColor");
    var mutedFg = LuxWidgetUtils.token(tokens, "mutedFg", "GrayText");
    var dropdownShadow = LuxWidgetUtils.token(tokens, "dropdownShadow", "none");

    container.innerHTML = "";

    var root = document.createElement("div");
    root.setAttribute("data-lux-combobox", "true");
    root.style.cssText = "position:relative;display:flex;flex-direction:column;gap:4px;font-family:Inter,sans-serif;";

    // label
    if (opts.label) {
      var labelEl = document.createElement("label");
      labelEl.style.cssText = "font-size:12px;font-weight:500;color:" + mutedFg + ";";
      labelEl.textContent = opts.label;
      root.appendChild(labelEl);
    }

    // input
    var input = document.createElement("input");
    input.type = "text";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("autocomplete", "off");
    input.placeholder = opts.placeholder || "";
    input.style.cssText =
      "width:100%;box-sizing:border-box;padding:6px 10px;font-size:13px;" +
      "border:1px solid " + inputBorder + ";border-radius:8px;" +
      "background:" + inputBg + ";color:" + inputFg + ";" +
      "outline:none;";
    root.appendChild(input);

    // dropdown listbox
    var listbox = document.createElement("div");
    listbox.setAttribute("role", "listbox");
    listbox.style.cssText =
      "position:absolute;top:100%;left:0;right:0;z-index:100;margin-top:2px;" +
      "border:1px solid " + cardBorder + ";border-radius:8px;" +
      "background:" + cardBg + ";outline:1px solid " + cardBorder + ";" +
      "max-height:200px;overflow-y:auto;display:none;";
    listbox.style.boxShadow = dropdownShadow;
    root.appendChild(listbox);

    container.appendChild(root);

    // state
    var currentValue = opts.value != null ? opts.value : null;
    var currentOptions = Array.isArray(opts.options) ? opts.options.slice() : [];
    var filterText = "";
    var focusedIndex = -1;
    var isOpen = false;
    var changeHandlers = [];

    if (typeof opts.onChange === "function") {
      changeHandlers.push(opts.onChange);
    }

    function getLabelForValue(val) {
      for (var i = 0; i < currentOptions.length; i++) {
        if (currentOptions[i].value === val) return currentOptions[i].label;
      }
      return "";
    }

    function getFilteredOptions() {
      if (!filterText) return currentOptions.slice();
      var lower = filterText.toLowerCase();
      var result = [];
      for (var i = 0; i < currentOptions.length; i++) {
        if (currentOptions[i].label.toLowerCase().indexOf(lower) !== -1) {
          result.push(currentOptions[i]);
        }
      }
      return result;
    }

    function renderOptions() {
      listbox.innerHTML = "";
      var filtered = getFilteredOptions();
      for (var i = 0; i < filtered.length; i++) {
        (function (opt, idx) {
          var item = document.createElement("div");
          item.setAttribute("role", "option");
          item.setAttribute("data-lux-combobox-option", opt.value);
          item.style.cssText =
            "padding:6px 10px;font-size:13px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
          item.textContent = opt.label;

          if (idx === focusedIndex) {
            item.style.background = accentBg;
            item.style.color = accentFg;
            item.setAttribute("aria-selected", "true");
          } else {
            item.setAttribute("aria-selected", "false");
          }

          item.addEventListener("mousedown", function (evt) {
            evt.preventDefault(); // prevent input blur
          });

          item.addEventListener("click", function () {
            selectOption(opt);
          });

          listbox.appendChild(item);
        }(filtered[i], i));
      }
    }

    function openDropdown() {
      if (isOpen) return;
      isOpen = true;
      focusedIndex = -1;
      listbox.style.display = "block";
      input.setAttribute("aria-expanded", "true");
      renderOptions();
    }

    function closeDropdown() {
      if (!isOpen) return;
      isOpen = false;
      focusedIndex = -1;
      listbox.style.display = "none";
      input.setAttribute("aria-expanded", "false");
    }

    function selectOption(opt) {
      currentValue = opt.value;
      filterText = "";
      input.value = opt.label;
      closeDropdown();
      for (var i = 0; i < changeHandlers.length; i++) {
        changeHandlers[i](currentValue);
      }
    }

    // set initial value display
    if (currentValue != null) {
      input.value = getLabelForValue(currentValue);
    }

    input.addEventListener("focus", function () {
      openDropdown();
    });

    input.addEventListener("click", function () {
      openDropdown();
    });

    input.addEventListener("blur", function () {
      // small delay to allow option click to fire first
      setTimeout(function () {
        closeDropdown();
        // if text cleared → deselect
        if (input.value === "") {
          if (currentValue !== null) {
            currentValue = null;
            filterText = "";
            for (var i = 0; i < changeHandlers.length; i++) {
              changeHandlers[i](null);
            }
          }
        } else if (currentValue === null) {
          // restore cleared text if nothing selected
          input.value = "";
        }
      }, 150);
    });

    input.addEventListener("input", function () {
      filterText = input.value;
      currentValue = null; // deselect while typing
      focusedIndex = -1;
      if (!isOpen) { openDropdown(); }
      else { renderOptions(); }
    });

    input.addEventListener("keydown", function (evt) {
      var filtered = getFilteredOptions();
      if (evt.key === "ArrowDown") {
        evt.preventDefault();
        if (!isOpen) { openDropdown(); }
        focusedIndex = Math.min(focusedIndex + 1, filtered.length - 1);
        renderOptions();
      } else if (evt.key === "ArrowUp") {
        evt.preventDefault();
        focusedIndex = Math.max(focusedIndex - 1, -1);
        renderOptions();
      } else if (evt.key === "Enter") {
        evt.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < filtered.length) {
          selectOption(filtered[focusedIndex]);
        }
      } else if (evt.key === "Escape") {
        closeDropdown();
      }
    });

    return {
      getValue: function () { return currentValue; },

      setValue: function (v) {
        currentValue = v;
        if (v === null) {
          input.value = "";
          filterText = "";
        } else {
          var lbl = getLabelForValue(v);
          input.value = lbl;
          filterText = "";
        }
      },

      setOptions: function (newOpts) {
        currentOptions = Array.isArray(newOpts) ? newOpts.slice() : [];
        currentValue = null;
        input.value = "";
        filterText = "";
        if (isOpen) { renderOptions(); }
      },

      setDisabled: function (bool) {
        input.disabled = !!bool;
      },

      onChange: function (fn) {
        changeHandlers = [fn];
      }
    };
  }

  return { create: create };
})();

/* lux-data-table.js — Sortable, paginated, filterable ERP data table.
 *
 * Global: LuxDataTable
 * Usage:  LuxDataTable.render(container, data, options) → api
 *   data     { columns: [{key, label, width?, align?, numeric?, render?}], rows: [{...}] }
 *   options  { title?, sortable?, pageSize?, striped?, selectable?, dense?,
 *              filterable?, exportable?, toneKey?,
 *              onRowClick?, onSelectionChange?, tokens? }
 *
 * Sorting:  click a column header to sort asc/desc.
 * Filter:   api.setFilter(text) filters across all visible columns.
 * Tone:     set toneKey:'_tone' and row._tone:'success'|'warning'|'error' for left-border colour.
 * Numeric:  columns with numeric:true use JetBrains Mono for value cells.
 * Dense:    dense:true tightens row padding for expert ERP layouts.
 * Export:   api.getCSV() returns CSV string of current (filtered, sorted) data.
 * Tokens:   all colours resolved via LuxWidgetUtils.token() — no hardcoded hex.
 *
 * LUX token fallbacks (light mode):
 *   tableHeaderBg → base/background  #F8FAFC
 *   tableHeaderFg → base/foreground  #0A0A0A
 *   rowHoverBg    → list/item/hover/background  #F0F9FF
 *   rowSelectedBg → list/item/selected/background  #F5F5F5
 *   rowSelectedFg → list/item/selected/foreground  #0A0A0A
 *   rowStripeBg   → base/muted  #F5F5F5
 *   mutedFg       → base/muted-foreground  #525252
 *   border        → base/border  #94A3B8
 *   cardBg        → base/card  #FFFFFF
 *   cardFg        → base/card-foreground  #0A0A0A
 *   buttonPrimaryBg → button/primary/default/background  #0C4A6E
 *   buttonPrimaryFg → button/primary/default/foreground  #FFFFFF
 *   semanticSuccessFg → semantic/success/foreground  #155E75
 *   semanticWarningFg → semantic/warning/foreground  #A16207
 *   semanticErrorFg   → semantic/error/foreground    #991B1B
 */
var LuxDataTable = (function () {
  var esc = LuxWidgetUtils.esc;

  function render(container, data, opts) {
    opts = opts || {};
    var title             = opts.title             || '';
    var sortable          = opts.sortable           !== false;
    var pageSize          = opts.pageSize           || 0;
    var striped           = opts.striped            !== false;
    var selectable        = opts.selectable         || false;
    var dense             = opts.dense              || false;
    var filterable        = opts.filterable         || false;
    var toneKey           = opts.toneKey            || null;
    var onRowClick        = opts.onRowClick         || null;
    var onSelectionChange = opts.onSelectionChange  || null;

    var tokens = LuxWidgetUtils.tokens(opts);

    // KG-aligned token fallbacks
    var headerBg    = LuxWidgetUtils.token(tokens, 'tableHeaderBg', 'ButtonFace');
    var headerFg    = LuxWidgetUtils.token(tokens, 'tableHeaderFg', 'CanvasText');
    var rowHoverBg  = LuxWidgetUtils.token(tokens, 'rowHoverBg', 'Canvas');
    var rowSelBg    = LuxWidgetUtils.token(tokens, 'rowSelectedBg', 'ButtonFace');
    var rowSelFg    = LuxWidgetUtils.token(tokens, 'rowSelectedFg', 'CanvasText');
    var rowStripeBg = LuxWidgetUtils.token(tokens, 'rowStripeBg', 'ButtonFace');
    var border      = LuxWidgetUtils.token(tokens, 'border',  'currentColor');
    var mutedFg     = LuxWidgetUtils.token(tokens, 'mutedFg', 'GrayText');
    var cardBg      = LuxWidgetUtils.token(tokens, 'cardBg', 'Canvas');
    var btnBg       = LuxWidgetUtils.token(tokens, 'buttonPrimaryBg', 'AccentColor');
    var btnFg       = LuxWidgetUtils.token(tokens, 'buttonPrimaryFg', 'Canvas');
    var toneSuccess = LuxWidgetUtils.token(tokens, 'semanticSuccessFg', 'currentColor');
    var toneWarning = LuxWidgetUtils.token(tokens, 'semanticWarningFg', 'currentColor');
    var toneError   = LuxWidgetUtils.token(tokens, 'semanticErrorFg', 'currentColor');

    var columns = (data && data.columns) || [];
    var rows    = (data && data.rows)    || [];

    if (!columns.length) {
      container.innerHTML = '';
      return { getSelected: function () { return []; }, clearSelection: function () {}, setFilter: function () {}, getCSV: function () { return ''; } };
    }

    // ── State ──────────────────────────────────────────────────────────
    var selectedSet = [];
    var filterText = '';
    var state = { key: null, asc: true, page: 0 };
    var _currentPageRows = [];

    function _isSelected(row) {
      for (var i = 0; i < selectedSet.length; i++) { if (selectedSet[i] === row) return true; }
      return false;
    }
    function _setSelected(arr) {
      selectedSet = arr.slice();
      if (onSelectionChange) onSelectionChange(selectedSet.slice());
    }

    // ── Tone colour helper ─────────────────────────────────────────────
    function _toneColor(tone) {
      if (tone === 'success') return toneSuccess;
      if (tone === 'warning') return toneWarning;
      if (tone === 'error')   return toneError;
      return null;
    }

    // ── Padding by density ─────────────────────────────────────────────
    var cellPad = dense ? '4px 8px' : '8px 12px';

    // ── CSV export ─────────────────────────────────────────────────────
    function _getCSV() {
      var sorted = _getSorted();
      var lines = [];
      lines.push(columns.map(function (c) { return c.label; }).join(','));
      sorted.forEach(function (row) {
        lines.push(columns.map(function (c) {
          var v = row[c.key];
          var s = v == null ? '' : String(v);
          if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
            s = '"' + s.replace(/"/g, '""') + '"';
          }
          return s;
        }).join(','));
      });
      return lines.join('\n');
    }

    // ── Get filtered+sorted rows ───────────────────────────────────────
    function _getSorted() {
      var filtered = rows;
      if (filterText) {
        var q = filterText.toLowerCase();
        filtered = rows.filter(function (row) {
          return columns.some(function (c) {
            var v = row[c.key];
            return v != null && String(v).toLowerCase().indexOf(q) !== -1;
          });
        });
      }
      var sorted = filtered.slice();
      if (state.key) {
        var k = state.key, asc = state.asc;
        sorted.sort(function (a, b) {
          var av = a[k], bv = b[k];
          if (typeof av === 'number' && typeof bv === 'number') return asc ? av - bv : bv - av;
          return asc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
        });
      }
      return sorted;
    }

    // ── Main render ────────────────────────────────────────────────────
    function _draw() {
      var sorted = _getSorted();
      var total    = pageSize ? Math.ceil(sorted.length / pageSize) : 1;
      var pg       = Math.min(state.page, Math.max(0, total - 1));
      state.page   = pg;
      var pageRows = pageSize ? sorted.slice(pg * pageSize, (pg + 1) * pageSize) : sorted;
      _currentPageRows = pageRows;

      var h = '<div style="font-family:Inter,sans-serif;font-size:14px;">';

      // Title
      if (title) {
        h += '<div style="font-size:14px;font-weight:600;margin-bottom:8px;' +
             'padding-bottom:6px;border-bottom:2px solid ' + headerBg + ';">' + esc(title) + '</div>';
      }

      // Filter input
      if (filterable) {
        h += '<div style="margin-bottom:8px;">' +
             '<input data-lux-table-filter type="text" placeholder="Search…"' +
             ' value="' + LuxWidgetUtils.escAttr(filterText) + '"' +
             ' style="width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid ' + border +
             ';border-radius:8px;font-size:13px;outline:none;background:' + cardBg + ';color:inherit;">' +
             '</div>';
      }

      h += '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">';
      h += '<thead><tr>';

      // Select-all checkbox
      if (selectable) {
        h += '<th scope="col" data-key="__select__" style="padding:' + cellPad + ';' +
             'background:' + headerBg + ';color:' + headerFg + ';width:36px;">' +
             '<input type="checkbox" data-select-all="true" /></th>';
      }

      columns.forEach(function (col) {
        var active  = state.key === col.key;
        var arrow   = active ? (state.asc ? ' ↑' : ' ↓') : (sortable ? ' <span style="opacity:0.25;font-size:10px;">⇅</span>' : '');
        var pointer = sortable ? 'cursor:pointer;user-select:none;' : '';
        h += '<th scope="col" aria-sort="' + (active ? (state.asc ? 'ascending' : 'descending') : 'none') + '"' +
             ' data-key="' + esc(col.key) + '"' +
             ' style="' + pointer +
             'text-align:' + (col.align || 'left') + ';' +
             'padding:' + cellPad + ';' +
             'background:' + headerBg + ';color:' + headerFg + ';' +
             'font-weight:600;white-space:nowrap;' +
             'position:sticky;top:0;z-index:1;' +
             (col.width ? 'width:' + esc(col.width) + ';' : '') + '">' +
             esc(col.label) + arrow + '</th>';
      });

      h += '</tr></thead><tbody>';

      pageRows.forEach(function (row, i) {
        var tone  = toneKey ? row[toneKey] : null;
        var tc    = tone ? _toneColor(String(tone)) : null;
        var bgStyle = '';
        if (striped && i % 2 === 1) bgStyle = 'background:' + rowStripeBg + ';';
        var leftBorder = tc ? 'border-left:3px solid ' + tc + ';' : '';
        var cursor = (onRowClick || selectable) ? 'cursor:pointer;' : '';
        var checked = _isSelected(row) ? ' checked' : '';

        h += '<tr data-lux-table-row data-i="' + i + '"' +
             (tone ? ' data-lux-tone="' + esc(String(tone)) + '"' : '') +
             ' style="' + bgStyle + cursor + leftBorder + '">';

        if (selectable) {
          h += '<td style="padding:' + cellPad + ';border-bottom:1px solid ' + border + ';width:36px;">' +
               '<input type="checkbox" data-row-select="true"' + checked + ' /></td>';
        }

        columns.forEach(function (col) {
          var v = row[col.key];
          var cellHtml;
          if (typeof col.render === 'function') {
            cellHtml = col.render(v, row);
          } else {
            cellHtml = esc(v == null ? '' : String(v));
          }
          var monoFont = col.numeric ? 'font-family:\'JetBrains Mono\',\'Fira Mono\',monospace;' : '';
          h += '<td style="padding:' + cellPad + ';border-bottom:1px solid ' + border + ';' +
               'text-align:' + (col.align || 'left') + ';' + monoFont + '">' +
               cellHtml + '</td>';
        });

        h += '</tr>';
      });

      h += '</tbody></table></div>';

      // Pagination
      if (pageSize && total > 1) {
        h += '<div style="display:flex;align-items:center;justify-content:flex-end;' +
             'gap:8px;margin-top:8px;font-size:13px;color:' + mutedFg + ';">';
        h += '<span>' + (pg * pageSize + 1) + '–' +
             Math.min((pg + 1) * pageSize, sorted.length) + ' of ' + sorted.length + '</span>';
        h += '<button data-pg="prev" ' + (pg === 0 ? 'disabled' : '') +
             ' style="border:1px solid ' + border + ';background:' + cardBg + ';' +
             'border-radius:8px;padding:3px 10px;cursor:pointer;">‹</button>';
        h += '<button data-pg="next" ' + (pg >= total - 1 ? 'disabled' : '') +
             ' style="border:1px solid ' + border + ';background:' + cardBg + ';' +
             'border-radius:8px;padding:3px 10px;cursor:pointer;">›</button>';
        h += '</div>';
      }

      h += '</div>';
      container.innerHTML = h;

      // Wire filter input
      if (filterable) {
        var filterInput = container.querySelector('[data-lux-table-filter]');
        if (filterInput) {
          filterInput.addEventListener('input', function () {
            filterText = filterInput.value;
            state.page = 0;
            _draw();
          });
        }
      }

      // Wire sort headers
      if (sortable) {
        container.querySelectorAll('th[data-key]').forEach(function (th) {
          if (th.dataset.key === '__select__') return;
          th.addEventListener('click', function () {
            var k = th.dataset.key;
            if (state.key === k) { state.asc = !state.asc; } else { state.key = k; state.asc = true; }
            state.page = 0;
            _draw();
          });
        });
      }

      // Wire row hover
      container.querySelectorAll('tbody tr[data-lux-table-row]').forEach(function (tr) {
        tr.addEventListener('mouseenter', function () { tr.style.background = rowHoverBg; });
        tr.addEventListener('mouseleave', function () {
          var i = parseInt(tr.dataset.i, 10);
          tr.style.background = (striped && i % 2 === 1) ? rowStripeBg : '';
        });
      });

      // Wire row clicks
      if (onRowClick || selectable) {
        container.querySelectorAll('tbody tr[data-lux-table-row]').forEach(function (tr, i) {
          tr.addEventListener('click', function (evt) {
            if (evt.target && evt.target.tagName === 'INPUT') return;
            if (onRowClick) onRowClick(_currentPageRows[i], i);
            if (selectable) {
              var row = _currentPageRows[i];
              var cb = tr.querySelector('input[data-row-select="true"]');
              if (cb) { cb.checked = !cb.checked; _toggleRow(row, cb.checked); }
            }
          });
        });
      }

      // Wire row checkboxes
      if (selectable) {
        container.querySelectorAll('input[data-row-select="true"]').forEach(function (cb, i) {
          cb.addEventListener('change', function () { _toggleRow(_currentPageRows[i], cb.checked); });
        });

        var selectAllCb = container.querySelector('input[data-select-all="true"]');
        if (selectAllCb) {
          selectAllCb.addEventListener('change', function () {
            if (selectAllCb.checked) {
              var newSelected = selectedSet.slice();
              _currentPageRows.forEach(function (row) { if (!_isSelected(row)) newSelected.push(row); });
              _setSelected(newSelected);
            } else {
              var newSelected = selectedSet.filter(function (row) {
                return !_currentPageRows.some(function (r) { return r === row; });
              });
              _setSelected(newSelected);
            }
            container.querySelectorAll('input[data-row-select="true"]').forEach(function (cb) {
              cb.checked = selectAllCb.checked;
            });
          });
        }
      }

      // Wire pagination
      container.querySelectorAll('[data-pg]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          state.page += btn.dataset.pg === 'prev' ? -1 : 1;
          _draw();
        });
      });
    }

    function _toggleRow(row, checked) {
      if (checked) { if (!_isSelected(row)) selectedSet.push(row); }
      else { selectedSet = selectedSet.filter(function (r) { return r !== row; }); }
      if (onSelectionChange) onSelectionChange(selectedSet.slice());
    }

    _draw();

    return {
      getSelected: function () { return selectedSet.slice(); },
      clearSelection: function () {
        _setSelected([]);
        container.querySelectorAll('input[data-row-select="true"]').forEach(function (cb) { cb.checked = false; });
        var sel = container.querySelector('input[data-select-all="true"]');
        if (sel) sel.checked = false;
      },
      setFilter: function (text) {
        filterText = text || '';
        state.page = 0;
        _draw();
      },
      getCSV: function () { return _getCSV(); },
    };
  }

  return { render: render };
})();

/* lux-date-range.js — Date range input pair (from / to).
 *
 * Global: LuxDateRange
 * Usage:  LuxDateRange.create(container, options)  →  { getValue, setValue, onChange, setDisabled }
 *   options    {labelFrom?, labelTo?, defaultFrom?, defaultTo?, tokens?}
 *
 * Example:
 *   const dr = LuxDateRange.create(el, {
 *     labelFrom: 'Start', labelTo: 'End',
 *     defaultFrom: '2026-01-01', defaultTo: '2026-03-31',
 *   });
 *   dr.onChange(({ from, to }) => updateRange(from, to));
 *   const { from, to } = dr.getValue();
 */
var LuxDateRange = (function () {
  function create(container, opts) {
    opts = opts || {};
    var labelFrom   = opts.labelFrom   != null ? opts.labelFrom  : 'From';
    var labelTo     = opts.labelTo     != null ? opts.labelTo    : 'To';
    var defaultFrom = opts.defaultFrom || '';
    var defaultTo   = opts.defaultTo   || '';
    var tokens      = LuxWidgetUtils.tokens(opts);
    var border      = LuxWidgetUtils.token(tokens, 'border', 'currentColor');
    var inputBg     = LuxWidgetUtils.token(tokens, 'inputBg', 'transparent');
    var inputFg     = LuxWidgetUtils.token(tokens, 'inputFg', 'currentColor');
    var labelFg     = LuxWidgetUtils.token(tokens, 'labelFg', 'currentColor');
    var mutedFg     = LuxWidgetUtils.token(tokens, 'mutedFg', 'currentColor');
    var inputStyle  =
      'font-family:Inter,sans-serif;font-size:13px;padding:5px 8px;' +
      'border:1px solid ' + border + ';border-radius:8px;background:' + inputBg + ';' +
      'color:' + inputFg + ';outline:none;';
    var labelStyle =
      'font-family:Inter,sans-serif;font-size:13px;font-weight:500;' +
      'color:' + labelFg + ';margin-right:4px;';

    var _listeners = [];

    // Wrapper
    var wrapper = document.createElement('div');
    wrapper.style.cssText =
      'display:flex;align-items:center;gap:12px;flex-wrap:wrap;';

    // --- From group ---
    var fromGroup = document.createElement('span');
    fromGroup.style.cssText = 'display:flex;align-items:center;';

    var fromLabel = document.createElement('label');
    fromLabel.style.cssText = labelStyle;
    fromLabel.textContent = labelFrom;

    var fromInput = document.createElement('input');
    fromInput.type = 'date';
    fromInput.style.cssText = inputStyle;
    if (defaultFrom) fromInput.value = defaultFrom;

    fromGroup.appendChild(fromLabel);
    fromGroup.appendChild(fromInput);

    // --- Separator ---
    var sep = document.createElement('span');
    sep.style.cssText = 'color:' + mutedFg + ';font-size:14px;';
    sep.textContent = '–';

    // --- To group ---
    var toGroup = document.createElement('span');
    toGroup.style.cssText = 'display:flex;align-items:center;';

    var toLabel = document.createElement('label');
    toLabel.style.cssText = labelStyle;
    toLabel.textContent = labelTo;

    var toInput = document.createElement('input');
    toInput.type = 'date';
    toInput.style.cssText = inputStyle;
    if (defaultTo) toInput.value = defaultTo;

    toGroup.appendChild(toLabel);
    toGroup.appendChild(toInput);

    // Assemble
    wrapper.appendChild(fromGroup);
    wrapper.appendChild(sep);
    wrapper.appendChild(toGroup);

    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(wrapper);

    // Change handler
    function _notify() {
      var val = { from: fromInput.value, to: toInput.value };
      for (var i = 0; i < _listeners.length; i++) _listeners[i](val);
    }
    fromInput.addEventListener('change', _notify);
    toInput.addEventListener('change', _notify);

    // Public API
    function getValue() {
      return { from: fromInput.value, to: toInput.value };
    }

    function setValue(val) {
      val = val || {};
      if (val.from != null) fromInput.value = val.from;
      if (val.to   != null) toInput.value   = val.to;
    }

    function onChange(fn) {
      _listeners.push(fn);
    }

    function setDisabled(bool) {
      fromInput.disabled = !!bool;
      toInput.disabled   = !!bool;
      wrapper.style.opacity       = bool ? '0.5' : '';
      wrapper.style.pointerEvents = bool ? 'none' : '';
    }

    return {
      getValue:    getValue,
      setValue:    setValue,
      onChange:    onChange,
      setDisabled: setDisabled,
    };
  }

  return { create: create };
})();

/* lux-dialog.js — Modal dialog overlay widget.
 *
 * Global: LuxDialog
 * Usage:  LuxDialog.open(options) → { close, setLoading }
 *
 * Options:
 *   title, body?(HTML string), actions?:[{label,primary?,onClick?}],
 *   size?:'sm'|'md'|'lg', onClose?(), tokens?
 *
 * Appends to document.body. Clicking backdrop or close button closes it.
 * Escape key closes it. setLoading(bool) disables action buttons + shows spinner.
 */
var LuxDialog = (function () {
  var SIZE_MAP = { sm: "400px", md: "560px", lg: "720px" };

  function open(opts) {
    opts = opts || {};
    var tokens = LuxWidgetUtils.tokens(opts);
    var cardBg = LuxWidgetUtils.token(tokens, "cardBg", "Canvas");
    var cardFg = LuxWidgetUtils.token(tokens, "cardFg", "CanvasText");
    var cardBorder = LuxWidgetUtils.token(tokens, "cardBorder", "currentColor");
    var mutedFg = LuxWidgetUtils.token(tokens, "mutedFg", "GrayText");
    var btnPrimaryBg = LuxWidgetUtils.token(tokens, "buttonPrimaryBg", "AccentColor");
    var btnPrimaryFg = LuxWidgetUtils.token(tokens, "buttonPrimaryFg", "Canvas");
    var btnSecondaryBg = LuxWidgetUtils.token(tokens, "buttonSecondaryBg", "ButtonFace");
    var btnSecondaryFg = LuxWidgetUtils.token(tokens, "buttonSecondaryFg", "ButtonText");
    var overlayBg = LuxWidgetUtils.token(tokens, "overlayBg", "transparent");
    var spinnerOverlayBg = LuxWidgetUtils.token(tokens, "spinnerOverlayBg", "Canvas");
    var spinnerTrack = LuxWidgetUtils.token(tokens, "spinnerTrack", "currentColor");
    var spinnerArc = LuxWidgetUtils.token(tokens, "spinnerArc", "AccentColor");

    var maxWidth = SIZE_MAP[opts.size] || SIZE_MAP.md;

    // backdrop
    var backdrop = document.createElement("div");
    backdrop.setAttribute("data-lux-dialog-backdrop", "true");
    backdrop.style.cssText =
      "position:fixed;inset:0;background:" + overlayBg + ";z-index:1000;" +
      "display:flex;align-items:center;justify-content:center;";

    // dialog panel
    var panel = document.createElement("div");
    panel.setAttribute("data-lux-dialog", "true");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "dlg-title");
    panel.style.cssText =
      "background:" + cardBg + ";color:" + cardFg + ";" +
      "border:1px solid " + cardBorder + ";" +
      "border-radius:10px;max-height:80vh;overflow-y:auto;" +
      "width:100%;max-width:" + maxWidth + ";" +
      "outline:1px solid " + cardBorder + ";" +
      "display:flex;flex-direction:column;font-family:Inter,sans-serif;";

    // header
    var headerEl = document.createElement("div");
    headerEl.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;" +
      "padding:16px 20px;border-bottom:1px solid " + cardBorder + ";";

    var titleEl = document.createElement("div");
    titleEl.id = "dlg-title";
    titleEl.style.cssText = "font-size:16px;font-weight:600;";
    titleEl.textContent = opts.title || "";

    var closeBtn = document.createElement("button");
    closeBtn.setAttribute("data-lux-dialog-close", "true");
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.style.cssText =
      "background:none;border:none;cursor:pointer;font-size:18px;line-height:1;" +
      "color:" + mutedFg + ";padding:2px 6px;border-radius:8px;";
    closeBtn.textContent = "✕";

    headerEl.appendChild(titleEl);
    headerEl.appendChild(closeBtn);
    panel.appendChild(headerEl);

    // body
    var bodyEl = document.createElement("div");
    bodyEl.setAttribute("data-lux-dialog-body", "true");
    bodyEl.style.cssText = "padding:16px 20px;flex:1;position:relative;";
    if (opts.body) {
      bodyEl.innerHTML = opts.body;
    }
    panel.appendChild(bodyEl);

    // footer
    var actionButtons = [];
    if (Array.isArray(opts.actions) && opts.actions.length > 0) {
      var footerEl = document.createElement("div");
      footerEl.setAttribute("data-lux-dialog-footer", "true");
      footerEl.style.cssText =
        "display:flex;justify-content:flex-end;gap:8px;padding:12px 20px;" +
        "border-top:1px solid " + cardBorder + ";";

      opts.actions.forEach(function (action, idx) {
        var btn = document.createElement("button");
        btn.setAttribute("data-lux-dialog-action", String(idx));
        btn.style.cssText =
          "border-radius:8px;padding:7px 16px;font-size:13px;cursor:pointer;font-family:Inter,sans-serif;" +
          (action.primary
            ? "background:" + btnPrimaryBg + ";color:" + btnPrimaryFg + ";border:none;"
            : "background:" + btnSecondaryBg + ";color:" + btnSecondaryFg + ";border:1px solid " + cardBorder + ";");
        btn.textContent = action.label;
        actionButtons.push(btn);

        (function (cb) {
          btn.addEventListener("click", function () {
            if (typeof cb === "function") { cb(); }
            doClose();
          });
        }(action.onClick));

        footerEl.appendChild(btn);
      });

      panel.appendChild(footerEl);
    }

    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);

    var closed = false;

    function doClose() {
      if (closed) return;
      closed = true;
      if (backdrop.parentNode) { backdrop.parentNode.removeChild(backdrop); }
      document.removeEventListener("keydown", onKeyDown);
      if (typeof opts.onClose === "function") { opts.onClose(); }
    }

    function onKeyDown(evt) {
      if (evt.key === "Escape") { doClose(); }
    }

    document.addEventListener("keydown", onKeyDown);

    closeBtn.addEventListener("click", doClose);

    // backdrop click — only when clicking the backdrop itself, not the panel
    backdrop.addEventListener("click", function (evt) {
      if (evt.target === backdrop) { doClose(); }
    });

    return {
      close: doClose,

      setLoading: function (bool) {
        actionButtons.forEach(function (btn) { btn.disabled = !!bool; });
        var existing = bodyEl.querySelector('[data-lux-dialog-spinner="true"]');
        if (bool) {
          if (!existing) {
            var spinner = document.createElement("div");
            spinner.setAttribute("data-lux-dialog-spinner", "true");
            spinner.style.cssText =
              "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;" +
              "border-radius:10px;";
            spinner.style.background = spinnerOverlayBg;
            var wheel = document.createElement("div");
            wheel.style.width = "24px";
            wheel.style.height = "24px";
            wheel.style.borderRadius = "50%";
            wheel.style.border = "2px solid " + spinnerTrack;
            wheel.style.borderTopColor = spinnerArc;
            wheel.style.animation = "lux-spin 0.7s linear infinite";
            spinner.appendChild(wheel);
            bodyEl.appendChild(spinner);
          }
        } else {
          if (existing) { existing.parentNode.removeChild(existing); }
        }
      }
    };
  }

  return { open: open };
})();

/* lux-empty-state.js — Consistent empty and no-results treatment.
 *
 * Global: LuxEmptyState
 * Usage:  LuxEmptyState.render(container, options) → { setActionDisabled }
 *   options  { title?, description?, actionLabel?, onAction?, tokens? }
 */
var LuxEmptyState = (function () {
  function render(container, opts) {
    opts = opts || {};
    var tokens = LuxWidgetUtils.tokens(opts);
    var cardBg = LuxWidgetUtils.token(tokens, "cardBg", "transparent");
    var cardFg = LuxWidgetUtils.token(tokens, "cardFg", "currentColor");
    var cardBorder = LuxWidgetUtils.token(tokens, "cardBorder", LuxWidgetUtils.token(tokens, "border", "currentColor"));
    var mutedFg = LuxWidgetUtils.token(tokens, "mutedFg", "currentColor");
    var buttonBg = LuxWidgetUtils.token(tokens, "buttonPrimaryBg", "transparent");
    var buttonFg = LuxWidgetUtils.token(tokens, "buttonPrimaryFg", cardFg);
    var buttonBorder = LuxWidgetUtils.token(tokens, "buttonPrimaryBorder", buttonBg);

    container.innerHTML = "";

    var wrapper = document.createElement("section");
    wrapper.style.cssText =
      "display:flex;flex-direction:column;align-items:flex-start;gap:12px;" +
      "padding:16px;border:1px solid " + cardBorder + ";" +
      "border-radius:10px;background:" + cardBg + ";color:" + cardFg + ";";

    var title = document.createElement("div");
    title.style.cssText =
      "font-family:Inter,sans-serif;font-size:14px;line-height:20px;font-weight:600;";
    title.textContent = opts.title || "Nothing to show yet";
    wrapper.appendChild(title);

    if (opts.description) {
      var description = document.createElement("div");
      description.style.cssText =
        "font-family:Inter,sans-serif;font-size:12px;line-height:16px;color:" + mutedFg + ";";
      description.textContent = String(opts.description);
      wrapper.appendChild(description);
    }

    var button = null;
    if (opts.actionLabel) {
      button = document.createElement("button");
      button.type = "button";
      button.style.cssText =
        "appearance:none;display:inline-flex;align-items:center;justify-content:center;" +
        "height:36px;padding:0 14px;border-radius:8px;" +
        "border:1px solid " + buttonBorder + ";" +
        "background:" + buttonBg + ";color:" + buttonFg + ";" +
        "font-family:Inter,sans-serif;font-size:14px;line-height:20px;font-weight:500;cursor:pointer;";
      button.textContent = String(opts.actionLabel);
      if (typeof opts.onAction === "function") {
        button.addEventListener("click", function () { opts.onAction(); });
      }
      wrapper.appendChild(button);
    }

    container.appendChild(wrapper);

    return {
      setActionDisabled: function (disabled) {
        if (!button) return;
        button.disabled = !!disabled;
        button.style.opacity = disabled ? "0.6" : "1";
        button.style.cursor = disabled ? "not-allowed" : "pointer";
      }
    };
  }

  return { render: render };
})();

/* lux-funnel-chart.js — SVG funnel chart renderer.
 *
 * Global: LuxFunnelChart
 * Usage:  LuxFunnelChart.render(container, stages, options)
 *   stages     [{label, value, color?}, ...] — ordered top-to-bottom, largest first by convention
 *   options    {title?, width?, height?, showValues?, showPercent?, tokens?}
 *
 * Example:
 *   LuxFunnelChart.render(el, [
 *     { label: 'Awareness',     value: 1000 },
 *     { label: 'Interest',      value: 600  },
 *     { label: 'Consideration', value: 300  },
 *     { label: 'Purchase',      value: 100  },
 *   ], { showValues: true, showPercent: true, tokens: tokens });
 */
var LuxFunnelChart = (function () {
  var esc = LuxWidgetUtils.esc;

  function render(container, stages, opts) {
    opts = opts || {};
    if (!Array.isArray(stages) || !stages.length) { container.innerHTML = ''; return; }

    var title       = opts.title      || '';
    var showValues  = opts.showValues !== false; // default true
    var showPercent = !!opts.showPercent;        // default false
    var tokens      = LuxWidgetUtils.tokens(opts);
    var palette     = LuxWidgetUtils.chartPalette(tokens);
    var mutedFg     = LuxWidgetUtils.token(tokens, 'mutedFg', 'GrayText');
    var connColor   = LuxWidgetUtils.token(tokens, 'border',    'currentColor');

    var width  = opts.width  || container.clientWidth  || container.offsetWidth  || 300;
    var height = opts.height || container.clientHeight || container.offsetHeight || (stages.length * 50 + 40);

    var padL = 60;
    var padR = 16;
    var padT = title ? 28 : 12;
    var padB = 12;
    var plotW = width  - padL - padR;
    var plotH = height - padT - padB;

    var slotH  = plotH / stages.length;
    var barH   = slotH * 0.6;
    var maxVal = 0;
    for (var i = 0; i < stages.length; i++) {
      if (stages[i].value > maxVal) maxVal = stages[i].value;
    }
    if (maxVal === 0) maxVal = 1;

    var firstVal = stages[0].value || 1;

    var barEls       = [];
    var labelEls     = [];
    var valueEls     = [];
    var percentEls   = [];
    var connectorEls = [];

    for (var i = 0; i < stages.length; i++) {
      var stage   = stages[i];
      var ratio   = stage.value / maxVal;
      var barW    = Math.max(ratio * plotW, 2);
      var cx      = padL + plotW / 2;              // horizontal center of plot area
      var bx      = cx - barW / 2;
      var slotTop = padT + i * slotH;
      var by      = slotTop + (slotH - barH) / 2;

      var fillColor = LuxWidgetUtils.color(stage.color, tokens, palette[i % palette.length]);

      var tooltipRows = [{ label: 'Value', value: String(LuxWidgetUtils.fmt(stage.value)) }];
      if (showPercent && i > 0) {
        var pct = ((stage.value / firstVal) * 100).toFixed(1);
        tooltipRows.push({ label: 'Share', value: pct + '%' });
      }

      barEls.push(
        '<rect data-lux-funnel-bar="' + esc(stage.label) + '"' +
        ' x="' + bx + '" y="' + by + '"' +
        ' width="' + barW + '" height="' + barH + '"' +
        ' fill="' + fillColor + '" rx="3"' +
        LuxWidgetUtils.tooltipAttrs(stage.label, tooltipRows) + '/>'
      );

      // Label — left of bar, vertically centred in slot
      var labelX = padL - 4;
      var labelY = slotTop + slotH / 2 + 4;
      labelEls.push(
        '<text data-lux-funnel-label="' + esc(stage.label) + '"' +
        ' x="' + labelX + '" y="' + labelY + '"' +
        ' text-anchor="end" font-size="11" fill="' + mutedFg + '">' +
        esc(stage.label) + '</text>'
      );

      // Value text
      if (showValues) {
        var vx = cx;
        var vy = by + barH / 2 + 4;
        valueEls.push(
          '<text data-lux-funnel-value="' + esc(stage.label) + '"' +
          ' x="' + vx + '" y="' + vy + '"' +
          ' text-anchor="middle" font-size="11" font-weight="600" fill="currentColor">' +
          esc(String(LuxWidgetUtils.fmt(stage.value))) + '</text>'
        );
      }

      // Percent text (non-first stages, right of bar)
      if (showPercent && i > 0) {
        var pctVal  = ((stage.value / firstVal) * 100).toFixed(1);
        var pctX    = cx + barW / 2 + 6;
        var pctY    = by + barH / 2 + 4;
        percentEls.push(
          '<text data-lux-funnel-percent="' + esc(stage.label) + '"' +
          ' x="' + pctX + '" y="' + pctY + '"' +
          ' font-size="10" fill="' + mutedFg + '">' +
          esc(pctVal + '%') + '</text>'
        );
      }

      // Connector between this bar and the next (dashed vertical line at center)
      if (i < stages.length - 1) {
        var connY1 = by + barH;
        var nextRatio = stages[i + 1].value / maxVal;
        var nextBarH  = barH;
        var nextSlotTop = padT + (i + 1) * slotH;
        var nextBy  = nextSlotTop + (slotH - nextBarH) / 2;
        var connY2  = nextBy;
        connectorEls.push(
          '<line data-lux-funnel-connector="true"' +
          ' x1="' + cx + '" y1="' + connY1 + '"' +
          ' x2="' + cx + '" y2="' + connY2 + '"' +
          ' stroke="' + connColor + '" stroke-width="1" stroke-dasharray="3,3"/>'
        );
      }
    }

    var titleEl = title
      ? '<text x="' + (width / 2) + '" y="18" text-anchor="middle" font-size="14"' +
        ' font-weight="600" fill="currentColor">' + esc(title) + '</text>'
      : '';

    container.innerHTML =
      '<div style="position:relative;display:inline-block;">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height +
      '" font-family="Inter, sans-serif">' +
      titleEl +
      connectorEls.join('') +
      barEls.join('') +
      labelEls.join('') +
      valueEls.join('') +
      percentEls.join('') +
      '</svg>' +
      '<div data-lux-chart-tooltip="true"></div>' +
      '</div>';

    LuxWidgetUtils.attachTooltip(container, tokens);
  }

  return { render: render };
})();

/* lux-gantt.js — SVG Gantt chart renderer (swimlane, date-range bars).
 *
 * Global: LuxGantt
 * Usage:  LuxGantt.render(container, rows, options)
 *   rows    [{label, bars: [{label, start, end, tone?, color?}]}, ...]
 *           start/end: Date objects or ISO date strings.
 *           Milestone: start === end → rendered as a ◆ diamond.
 *           tone: 'success'|'warning'|'error'|'info' overrides colour with semantic token.
 *   options {title?, width?, height?, startDate?, endDate?, showLegend?,
 *            showToday?, today?, onBarClick?, tokens?}
 *
 * Features:
 *   - Today marker line (showToday:true, today:'YYYY-MM-DD' for tests)
 *   - Milestones (diamond) for zero-duration bars
 *   - Adaptive gridlines: daily ≤14 days, weekly 15–90 days, monthly >90 days
 *   - Bar tone colours via semantic tokens (success/warning/error/info)
 *   - onBarClick(bar, row) callback
 *   - Dynamic label column width based on longest row label
 *
 * LUX token fallbacks (light mode):
 *   chart1–5         → base/chart/chart-1–5
 *   mutedFg          → base/muted-foreground  #525252
 *   border           → base/border            #94A3B8
 *   cardBg           → base/card              #FFFFFF
 *   semanticSuccessFg → semantic/success/foreground  #155E75
 *   semanticWarningFg → semantic/warning/foreground  #A16207
 *   semanticErrorFg   → semantic/error/foreground    #991B1B
 *   semanticInfoFg    → focus/default                #0369A1
 */
var LuxGantt = (function () {
  var esc = LuxWidgetUtils.esc;

  function toMidnightUTC(val) {
    var d = (val instanceof Date) ? new Date(val.getTime()) : new Date(val);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  function formatDate(d) {
    var mo = d.getUTCMonth() + 1;
    var dy = d.getUTCDate();
    return (mo < 10 ? '0' + mo : mo) + '/' + (dy < 10 ? '0' + dy : dy);
  }

  function formatMonth(d) {
    var mo = d.getUTCMonth() + 1;
    return d.getUTCFullYear() + '/' + (mo < 10 ? '0' + mo : mo);
  }

  // ── Label column width ───────────────────────────────────────────────
  function estimateLabelWidth(labels) {
    // Approximate: 7.5px per character at 12px Inter, min 80, max 220
    var maxLen = 0;
    labels.forEach(function (l) { if ((l || '').length > maxLen) maxLen = (l || '').length; });
    return Math.max(80, Math.min(220, maxLen * 7.5 + 16));
  }

  function render(container, rows, opts) {
    opts = opts || {};

    // Accept object with 'lanes' key as alias for rows array
    if (rows && !Array.isArray(rows) && Array.isArray(rows.lanes)) {
      opts = Object.assign({ title: rows.title, today: rows.today }, opts);
      rows = rows.lanes.map(function (lane) {
        var bars = (lane.bars || []).slice();
        // Flatten separate milestones[] into bars with start===end
        if (Array.isArray(lane.milestones)) {
          lane.milestones.forEach(function (m) {
            bars.push({ label: m.label, start: m.date || m.start, end: m.date || m.end || m.start });
          });
        }
        return { label: lane.label, bars: bars };
      });
    }

    if (!Array.isArray(rows)) {
      console.warn('LuxGantt: rows must be an array of {label, bars} objects');
      container.innerHTML = '';
      return;
    }
    if (!rows.length) { container.innerHTML = ''; return; }
    var hasAnyBar = rows.some(function (r) { return r.bars && r.bars.length; });
    if (!hasAnyBar) { container.innerHTML = ''; return; }

    var title      = opts.title      || '';
    var showLegend = opts.showLegend !== false;
    var showToday  = opts.showToday  !== false; // default on
    var onBarClick = typeof opts.onBarClick === 'function' ? opts.onBarClick : null;
    var width      = opts.width || container.clientWidth || container.offsetWidth || 600;

    var tokens  = LuxWidgetUtils.tokens(opts);
    var palette = LuxWidgetUtils.chartPalette(tokens);
    var gridColor    = LuxWidgetUtils.token(tokens, 'chartGrid', LuxWidgetUtils.token(tokens, 'border', 'currentColor'));
    var axisColor    = LuxWidgetUtils.token(tokens, 'chartAxis', LuxWidgetUtils.token(tokens, 'border', 'currentColor'));
    var mutedFg      = LuxWidgetUtils.token(tokens, 'mutedFg', 'GrayText');
    var chartFg      = LuxWidgetUtils.token(tokens, 'chartFg', 'Canvas');
    var toneSuccess  = LuxWidgetUtils.token(tokens, 'semanticSuccessFg', 'currentColor');
    var toneWarning  = LuxWidgetUtils.token(tokens, 'semanticWarningFg', 'currentColor');
    var toneError    = LuxWidgetUtils.token(tokens, 'semanticErrorFg', 'currentColor');
    var toneInfo     = LuxWidgetUtils.token(tokens, 'semanticInfoFg', LuxWidgetUtils.token(tokens, 'chart1', 'currentColor'));
    var todayColor   = LuxWidgetUtils.token(tokens, 'semanticErrorFg', 'currentColor');
    var rowHoverBg   = LuxWidgetUtils.token(tokens, 'rowHoverBg', 'Canvas');

    function _toneColor(tone) {
      if (tone === 'success') return toneSuccess;
      if (tone === 'warning') return toneWarning;
      if (tone === 'error')   return toneError;
      if (tone === 'info')    return toneInfo;
      return null;
    }

    // ── Collect all bars ─────────────────────────────────────────────
    var allBars = [];
    rows.forEach(function (r) { if (r.bars) allBars = allBars.concat(r.bars); });

    // ── Date range ───────────────────────────────────────────────────
    var rangeStart, rangeEnd;
    if (opts.startDate) {
      rangeStart = toMidnightUTC(opts.startDate);
    } else {
      var minT = Math.min.apply(null, allBars.map(function (b) { return toMidnightUTC(b.start).getTime(); }));
      rangeStart = new Date(minT);
      rangeStart.setUTCDate(rangeStart.getUTCDate() - 1);
      rangeStart.setUTCHours(0, 0, 0, 0);
    }
    if (opts.endDate) {
      rangeEnd = toMidnightUTC(opts.endDate);
    } else {
      var maxT = Math.max.apply(null, allBars.map(function (b) { return toMidnightUTC(b.end).getTime(); }));
      rangeEnd = new Date(maxT);
      rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 1);
      rangeEnd.setUTCHours(0, 0, 0, 0);
    }

    var totalMs  = rangeEnd.getTime() - rangeStart.getTime();
    var totalDays = totalMs / 86400000;

    // ── Adaptive grid interval ──────────────────────────────────────
    // ≤14 days → daily; 15–90 → weekly; >90 → monthly
    var gridIntervalDays = totalDays <= 14 ? 1 : totalDays <= 90 ? 7 : 30;

    // ── Layout metrics ──────────────────────────────────────────────
    var titleH  = title ? 28 : 0;
    var padL    = estimateLabelWidth(rows.map(function (r) { return r.label || ''; }));
    var padR    = 16;
    var padT    = titleH + 28;
    var legH    = showLegend ? Math.ceil(allBars.length / 3) * 22 + 8 : 0;
    var padB    = 12 + legH;
    var rowH    = 40;
    var barH    = 22;
    var plotW   = width - padL - padR;
    var plotH   = rows.length * rowH;
    var height  = opts.height || (padT + plotH + padB);
    if (height < padT + plotH + padB) { height = padT + plotH + padB; }

    function dateToX(d) {
      return padL + ((d.getTime() - rangeStart.getTime()) / totalMs) * plotW;
    }

    // ── Grid lines ──────────────────────────────────────────────────
    var gridLines = [];
    var axisLabels = [];
    var cur = new Date(rangeStart.getTime());
    while (cur.getTime() <= rangeEnd.getTime()) {
      var gx = dateToX(cur);
      gridLines.push(
        '<line data-lux-gantt-grid-line x1="' + gx + '" y1="' + padT + '" x2="' + gx + '" y2="' + (padT + plotH) +
        '" stroke="' + gridColor + '" stroke-width="1" stroke-dasharray="3,3"/>'
      );
      var labelText = gridIntervalDays >= 28 ? formatMonth(cur) : formatDate(cur);
      axisLabels.push(
        '<text x="' + gx + '" y="' + (padT - 7) +
        '" text-anchor="middle" font-size="10" fill="' + mutedFg + '">' +
        esc(labelText) + '</text>'
      );
      cur.setUTCDate(cur.getUTCDate() + gridIntervalDays);
    }

    // ── Today marker ────────────────────────────────────────────────
    var todayEl = '';
    if (showToday) {
      var todayDate = opts.today ? toMidnightUTC(opts.today) : (function () {
        var d = new Date(); d.setUTCHours(0, 0, 0, 0); return d;
      })();
      if (todayDate.getTime() >= rangeStart.getTime() && todayDate.getTime() <= rangeEnd.getTime()) {
        var tx = dateToX(todayDate);
        todayEl =
          '<line data-lux-gantt-today x1="' + tx + '" y1="' + (padT - 6) +
          '" x2="' + tx + '" y2="' + (padT + plotH) +
          '" stroke="' + todayColor + '" stroke-width="2"/>' +
          '<text x="' + tx + '" y="' + (padT - 10) +
          '" text-anchor="middle" font-size="9" font-weight="600" fill="' + todayColor + '">Today</text>';
      }
    }

    // ── Row separators ───────────────────────────────────────────────
    var rowSeps = [];
    for (var ri = 0; ri <= rows.length; ri++) {
      var sy = padT + ri * rowH;
      rowSeps.push(
        '<line x1="' + padL + '" y1="' + sy + '" x2="' + (padL + plotW) + '" y2="' + sy +
        '" stroke="' + gridColor + '" stroke-width="1"/>'
      );
    }

    // ── Row hover bands (transparent, shown via JS) ──────────────────
    var rowBands = [];
    rows.forEach(function (row, ri) {
      var bandY = padT + ri * rowH;
      rowBands.push(
        '<rect data-lux-gantt-row-band="' + ri + '"' +
        ' x="' + padL + '" y="' + bandY +
        '" width="' + plotW + '" height="' + rowH +
        '" fill="transparent" style="cursor:default;"/>'
      );
    });

    // ── Lane labels ─────────────────────────────────────────────────
    var laneLabels = [];
    rows.forEach(function (row, ri) {
      var labelY = padT + ri * rowH + rowH / 2 + 4;
      laneLabels.push(
        '<text x="8" y="' + labelY +
        '" text-anchor="start" font-size="12" fill="currentColor" font-family="Inter,sans-serif">' +
        esc(row.label || '') + '</text>'
      );
    });

    // ── Bars ─────────────────────────────────────────────────────────
    var barEls = [];
    var barMeta = []; // [{bar, row}] for click callbacks
    var barColorIdx = 0;

    rows.forEach(function (row, ri) {
      var rowTop = padT + ri * rowH;
      if (!row.bars) return;

      row.bars.forEach(function (bar) {
        var bStart = toMidnightUTC(bar.start);
        var bEnd   = toMidnightUTC(bar.end);
        var isMilestone = bStart.getTime() === bEnd.getTime();
        var barIdx = barMeta.length;
        barMeta.push({ bar: bar, row: row });

        // Colour resolution: tone > explicit color > palette
        var toneColor = bar.tone ? _toneColor(bar.tone) : null;
        var color = toneColor || LuxWidgetUtils.color(bar.color, tokens, palette[barColorIdx % palette.length]);
        barColorIdx++;

        // Tone bars use fill-opacity so dark semantic fg tokens render as
        // visible mid-tones against the white chart background.
        var toneOpacity = toneColor ? ' fill-opacity="0.75"' : '';

        if (isMilestone) {
          // Diamond milestone (◆) centred on the date
          var mx = dateToX(bStart);
          var my = rowTop + rowH / 2;
          var ms = barH / 2; // half-size of diamond
          barEls.push(
            '<polygon data-lux-gantt-milestone data-lux-gantt-bar="' + barIdx + '"' +
            ' points="' + mx + ',' + (my - ms) +
            ' ' + (mx + ms) + ',' + my +
            ' ' + mx + ',' + (my + ms) +
            ' ' + (mx - ms) + ',' + my + '"' +
            ' fill="' + color + '"' + toneOpacity +
            ' style="cursor:' + (onBarClick ? 'pointer' : 'default') + ';"' +
            LuxWidgetUtils.tooltipAttrs(bar.label || 'Milestone', [
              { label: 'Row', value: row.label || '' },
              { label: 'Date', value: formatDate(bStart) }
            ]) + '/>'
          );
        } else {
          var x1 = dateToX(bStart);
          var x2 = dateToX(bEnd);
          var bW = Math.max(4, x2 - x1);
          var bY = rowTop + (rowH - barH) / 2;

          var labelInside = bW > 44
            ? '<text x="' + (x1 + bW / 2) + '" y="' + (bY + barH / 2 + 4) +
              '" text-anchor="middle" font-size="10" fill="' + chartFg +
              '" pointer-events="none">' + esc(bar.label || '') + '</text>'
            : '';

          barEls.push(
            '<rect data-lux-gantt-bar="' + barIdx + '"' +
            ' x="' + x1 + '" y="' + bY + '" width="' + bW + '" height="' + barH +
            '" fill="' + color + '"' + toneOpacity + ' rx="4"' +
            ' style="cursor:' + (onBarClick ? 'pointer' : 'default') + ';"' +
            LuxWidgetUtils.tooltipAttrs(bar.label || row.label || 'Task', [
              { label: 'Lane',  value: row.label || '' },
              { label: 'Start', value: formatDate(bStart) },
              { label: 'End',   value: formatDate(bEnd) }
            ]) + '/>' +
            labelInside
          );
        }
      });
    });

    // ── Legend ───────────────────────────────────────────────────────
    var legendEl = [];
    if (showLegend) {
      var li = 0;
      rows.forEach(function (row) {
        (row.bars || []).forEach(function (bar) {
          var toneColor = bar.tone ? _toneColor(bar.tone) : null;
          var c = toneColor || LuxWidgetUtils.color(bar.color, tokens, palette[li % palette.length]);
          var col = li % 3;
          var r   = Math.floor(li / 3);
          var lx  = padL + col * Math.max(120, plotW / 3);
          var ly  = height - legH + 8 + r * 22;
          legendEl.push(
            '<g data-lux-chart-legend-item="true">' +
            '<rect x="' + lx + '" y="' + ly + '" width="12" height="12" fill="' + c + '" rx="2"/>' +
            '<text x="' + (lx + 18) + '" y="' + (ly + 10) +
            '" font-size="11" fill="currentColor">' + esc(bar.label || row.label || 'Task') + '</text></g>'
          );
          li++;
        });
      });
    }

    // ── Title ────────────────────────────────────────────────────────
    var titleEl = title
      ? '<text x="' + (width / 2) + '" y="18" text-anchor="middle" font-size="14" ' +
        'font-weight="600" fill="currentColor">' + esc(title) + '</text>'
      : '';

    // ── Left border line ─────────────────────────────────────────────
    var borderLine =
      '<line x1="' + padL + '" y1="' + padT + '" x2="' + padL + '" y2="' + (padT + plotH) +
      '" stroke="' + axisColor + '" stroke-width="1.5"/>';

    container.innerHTML =
      '<div style="position:relative;display:inline-block;width:100%;">' +
      '<svg xmlns="http://www.w3.org/2000/svg"' +
      ' width="' + width + '" height="' + height + '"' +
      ' font-family="Inter,sans-serif"' +
      ' data-lux-gantt-label-col="' + padL + '">' +
      titleEl +
      rowSeps.join('') +
      rowBands.join('') +
      gridLines.join('') +
      todayEl +
      borderLine +
      axisLabels.join('') +
      laneLabels.join('') +
      barEls.join('') +
      (showLegend ? '<g data-lux-chart-legend="true">' + legendEl.join('') + '</g>' : '') +
      '</svg><div data-lux-chart-tooltip="true"></div></div>';

    var svg = container.querySelector('svg');

    // ── Row hover interaction ─────────────────────────────────────────
    if (svg) {
      container.querySelectorAll('[data-lux-gantt-row-band]').forEach(function (band) {
        band.addEventListener('mouseenter', function () { band.setAttribute('fill', rowHoverBg); });
        band.addEventListener('mouseleave', function () { band.setAttribute('fill', 'transparent'); });
      });
    }

    // ── Bar click ─────────────────────────────────────────────────────
    if (onBarClick && svg) {
      container.querySelectorAll('[data-lux-gantt-bar]').forEach(function (el) {
        el.addEventListener('click', function () {
          var idx = parseInt(el.getAttribute('data-lux-gantt-bar'), 10);
          var meta = barMeta[idx];
          if (meta) onBarClick(meta.bar, meta.row);
        });
      });
    }

    LuxWidgetUtils.attachTooltip(container, tokens);
  }

  return { render: render };
})();

/* lux-gauge.js — SVG semicircular arc gauge.
 *
 * Global: LuxGauge
 * Usage:  LuxGauge.render(container, data, options)
 *   data       {value, min?, max?, target?, label?}
 *   options    {title?, width?, height?, zones?, showValue?, tokens?}
 *              zones: [{from, to, tone:'success'|'warning'|'error'}]
 *
 * Example:
 *   LuxGauge.render(el,
 *     { value: 72, min: 0, max: 100, target: 80, label: 'Utilisation' },
 *     { title: 'Machine Load', zones: [{from:0,to:70,tone:'success'},{from:70,to:100,tone:'error'}], tokens: tokens }
 *   );
 */
var LuxGauge = (function () {
  var esc = LuxWidgetUtils.esc;

  function polarToCartesian(cx, cy, r, angleDeg) {
    var rad = (angleDeg - 90) * Math.PI / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad)
    };
  }

  // Build an SVG arc path for the gauge semicircle.
  // startAngle=180 (left), endAngle=0 (right), going counterclockwise over the top.
  // We map those to the polar system: startDeg=-180, endDeg=0 in standard math.
  // Using the SVG arc convention with polarToCartesian (angle 0 = top, increases clockwise):
  //   leftmost point = 180 deg, rightmost = 0 deg (or 360).
  function arcPath(cx, cy, r, startAngleDeg, endAngleDeg) {
    var start = polarToCartesian(cx, cy, r, startAngleDeg);
    var end   = polarToCartesian(cx, cy, r, endAngleDeg);
    // Always draw the short way if the arc is less than 180 deg,
    // large-arc-flag = 1 when span > 180.
    var span = endAngleDeg - startAngleDeg;
    if (span < 0) { span += 360; }
    var large = span > 180 ? 1 : 0;
    var sweep = 1; // clockwise
    return 'M ' + start.x + ' ' + start.y +
           ' A ' + r + ' ' + r + ' 0 ' + large + ' ' + sweep +
           ' ' + end.x + ' ' + end.y;
  }

  function zoneColour(tone, tokens) {
    if (tone === 'success') { return LuxWidgetUtils.token(tokens, 'semanticSuccessFg', 'currentColor'); }
    if (tone === 'warning') { return LuxWidgetUtils.token(tokens, 'semanticWarningFg', 'currentColor'); }
    if (tone === 'error')   { return LuxWidgetUtils.token(tokens, 'semanticErrorFg', 'currentColor'); }
    return null;
  }

  function render(container, data, opts) {
    opts  = opts  || {};
    data  = data  || {};

    var value  = data.value != null ? data.value : 0;
    var min    = data.min   != null ? data.min   : 0;
    var max    = data.max   != null ? data.max   : 100;
    var target = data.target;
    var label  = data.label || '';

    var title      = opts.title     || '';
    var width      = opts.width     || 200;
    var height     = opts.height    || 120;
    var showValue  = opts.showValue !== false;
    var zones      = opts.zones     || [];
    var tokens     = LuxWidgetUtils.tokens(opts);

    var mutedBg  = LuxWidgetUtils.token(tokens, 'mutedBg', 'ButtonFace');
    var mutedFg  = LuxWidgetUtils.token(tokens, 'mutedFg', 'GrayText');
    var chart1   = LuxWidgetUtils.token(tokens, 'chart1', 'currentColor');

    // Arc geometry
    var cx = width / 2;
    var cy = height * 0.85;
    var r  = height * 0.72;
    var strokeW = 16;

    // Fraction (0–1) of value
    var frac = (max === min) ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min)));

    // Angle mapping: start=180deg (left), end=0deg (right) going over the top.
    // In our polarToCartesian: 180 = left, 0 = top, going clockwise to 360=left.
    // We want: 180 (left of centre) → 360/0 (right of centre), going over the top.
    // So start = 180, end = 360 for full arc.
    var arcStart  = 180;
    var arcEnd    = 360; // 360 == 0 == right, going clockwise from left over top
    var valueEnd  = arcStart + frac * 180;

    // Determine value arc colour from zones
    var arcColour = chart1;
    for (var zi = 0; zi < zones.length; zi++) {
      var z = zones[zi];
      if (value >= z.from && value <= z.to) {
        var zc = zoneColour(z.tone, tokens);
        if (zc) { arcColour = zc; break; }
      }
    }

    // Track arc (full 180°)
    var trackPath = arcPath(cx, cy, r, arcStart, arcEnd);

    // Value arc (from start to value position)
    var valuePath;
    if (frac <= 0) {
      valuePath = '';
    } else if (frac >= 1) {
      valuePath = arcPath(cx, cy, r, arcStart, arcEnd);
    } else {
      valuePath = arcPath(cx, cy, r, arcStart, valueEnd);
    }

    var tooltipRows = [{ label: 'Value', value: String(LuxWidgetUtils.fmt(value)) }];
    if (label) { tooltipRows.push({ label: 'Label', value: label }); }
    var tooltipTitle = label || 'Value';

    var titleEl = title
      ? '<text x="' + (width / 2) + '" y="14" text-anchor="middle" ' +
        'font-size="13" font-weight="600" fill="currentColor">' + esc(title) + '</text>'
      : '';

    var valueEl = showValue
      ? '<text x="' + cx + '" y="' + (cy - r * 0.1) + '" text-anchor="middle" ' +
        'font-size="22" font-weight="300" font-family="Inter, sans-serif" fill="currentColor">' +
        esc(String(LuxWidgetUtils.fmt(value))) + '</text>'
      : '';

    var labelEl = label
      ? '<text x="' + cx + '" y="' + (cy - r * 0.1 + 17) + '" text-anchor="middle" ' +
        'font-size="12" font-family="Inter, sans-serif" fill="' + mutedFg + '">' +
        esc(label) + '</text>'
      : '';

    // Target tick marker
    var targetEl = '';
    if (target != null) {
      var targetFrac = (max === min) ? 0 : Math.max(0, Math.min(1, (target - min) / (max - min)));
      var targetAngle = arcStart + targetFrac * 180;
      var tickOuter = polarToCartesian(cx, cy, r + strokeW / 2 + 4, targetAngle);
      var tickInner = polarToCartesian(cx, cy, r - strokeW / 2 - 4, targetAngle);
      targetEl = '<line x1="' + tickOuter.x + '" y1="' + tickOuter.y + '"' +
                 ' x2="' + tickInner.x + '" y2="' + tickInner.y + '"' +
                 ' stroke="' + mutedFg + '" stroke-width="2.5" stroke-linecap="round"' +
                 ' data-lux-gauge-target="true" aria-label="Target: ' + LuxWidgetUtils.escAttr(String(LuxWidgetUtils.fmt(target))) + '"/>';
    }

    var valueArcEl = valuePath
      ? '<path d="' + valuePath + '" fill="none" stroke="' + arcColour + '"' +
        ' stroke-width="' + strokeW + '" stroke-linecap="round"' +
        LuxWidgetUtils.tooltipAttrs(tooltipTitle, tooltipRows) + '/>'
      : '';

    container.innerHTML =
      '<div style="position:relative;display:inline-block;">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height +
      '" font-family="Inter, sans-serif">' +
      titleEl +
      '<path d="' + trackPath + '" fill="none" stroke="' + mutedBg + '"' +
      ' stroke-width="' + strokeW + '" stroke-linecap="round"/>' +
      valueArcEl +
      targetEl +
      valueEl +
      labelEl +
      '</svg>' +
      '<div data-lux-chart-tooltip="true"></div>' +
      '</div>';

    LuxWidgetUtils.attachTooltip(container, tokens);
  }

  return { render: render };
})();

/* lux-heatmap.js — SVG matrix heatmap renderer.
 *
 * Global: LuxHeatmap
 * Usage:  LuxHeatmap.render(container, data, options)
 *   data     {rows: string[], cols: string[], values: number[][]}
 *            values[r][c] for row r, col c.
 *   options  {title?, width?, height?, colorScale?: 'sequential'|'diverging',
 *             onCellClick?, tokens?}
 *
 * Rendering:
 *   - One <rect data-lux-heatmap-cell="[row]:[col]"> per cell.
 *   - 5 discrete colour buckets (quintiles):
 *     Sequential: mutedBg (min) → chart1 (max) via chart1..chart5 palette
 *     Diverging:  semanticErrorFg (min) → mutedBg (mid) → chart1 (max)
 *   - Row labels: <text data-lux-heatmap-row-label="[row]"> on left.
 *   - Col labels: <text data-lux-heatmap-col-label="[col]"> on top, rotated -45°.
 *
 * Token keys:
 *   mutedBg        → low/neutral cell colour  (fallback #E5E5E5)
 *   chart1         → high cell colour         (fallback #0F766E)
 *   chart2–5       → discrete scale midpoints
 *   semanticErrorFg → diverging low           (fallback #DC2626)
 *   mutedFg        → label text               (fallback #525252)
 *   chartGrid      → grid lines               (fallback #94A3B8)
 *
 * Example:
 *   LuxHeatmap.render(el, {
 *     rows: ['Mon','Tue','Wed'],
 *     cols: ['AM','PM','Eve'],
 *     values: [[1,2,3],[4,5,6],[7,8,9]],
 *   }, { title: 'Activity', tokens: tokens });
 */
var LuxHeatmap = (function () {
  var esc     = LuxWidgetUtils.esc;
  var escAttr = LuxWidgetUtils.escAttr;

  /* Assign one of 5 bucket indices (0–4) to each value given global min/max */
  function bucket(value, minVal, maxVal) {
    if (maxVal === minVal) return 4; /* all same → treat as high */
    var frac = (value - minVal) / (maxVal - minVal);
    var b    = Math.floor(frac * 5);
    return Math.min(4, b);
  }

  /* Pick fill colour for a bucket index under the chosen scale */
  function bucketColor(b, colorScale, tokens) {
    if (colorScale === 'diverging') {
      /* 0=low(error), 1, 2=mid(mutedBg), 3, 4=high(chart1) */
      var divPalette = [
        LuxWidgetUtils.token(tokens, 'semanticErrorFg', 'currentColor'),
        LuxWidgetUtils.token(tokens, 'chart4', 'currentColor'), /* warm mid-low */
        LuxWidgetUtils.token(tokens, 'mutedBg', 'ButtonFace'),
        LuxWidgetUtils.token(tokens, 'chart2', 'currentColor'), /* cool mid-high */
        LuxWidgetUtils.token(tokens, 'chart1', 'currentColor'),
      ];
      return divPalette[b];
    }
    /* Sequential: 5 steps from mutedBg up through chart5→chart4→chart3→chart2→chart1 */
    var seqPalette = [
      LuxWidgetUtils.token(tokens, 'mutedBg', 'ButtonFace'),
      LuxWidgetUtils.token(tokens, 'chart5', 'currentColor'),
      LuxWidgetUtils.token(tokens, 'chart3', 'currentColor'),
      LuxWidgetUtils.token(tokens, 'chart2', 'currentColor'),
      LuxWidgetUtils.token(tokens, 'chart1', 'currentColor'),
    ];
    return seqPalette[b];
  }

  function render(container, data, opts) {
    opts = opts || {};
    var tokens     = LuxWidgetUtils.tokens(opts);
    var title      = opts.title      || '';
    var colorScale = opts.colorScale || 'sequential';
    var onCellClick = opts.onCellClick || null;
    var width      = opts.width  || container.clientWidth  || container.offsetWidth  || 480;
    var height     = opts.height || container.clientHeight || container.offsetHeight || 320;
    var mutedFg    = LuxWidgetUtils.token(tokens, 'mutedFg', 'GrayText');

    var rows = (data && data.rows)   || [];
    var cols = (data && data.cols)   || [];
    var vals = (data && data.values) || [];

    /* Empty guard */
    if (!rows.length || !cols.length) { container.innerHTML = ''; return; }

    var nRows = rows.length;
    var nCols = cols.length;

    /* Compute global min/max across all values */
    var allVals = [];
    vals.forEach(function (row) { row.forEach(function (v) { allVals.push(v); }); });
    var minVal = Math.min.apply(null, allVals);
    var maxVal = Math.max.apply(null, allVals);

    /* Layout */
    var titleH  = title ? 28 : 0;
    var padTop  = titleH + 52; /* space for col labels (rotated -45°) */
    var padLeft = 80;           /* space for row labels */
    var padBot  = 12;
    var padRight = 12;

    var plotW   = width  - padLeft - padRight;
    var plotH   = height - padTop  - padBot;
    var cellW   = plotW  / nCols;
    var cellH   = plotH  / nRows;

    /* ── Title ── */
    var titleEl = title
      ? '<text x="' + (width / 2) + '" y="18"' +
        ' text-anchor="middle" font-size="14" font-weight="600" fill="currentColor">' +
        esc(title) + '</text>'
      : '';

    /* ── Col labels (rotated -45°) ── */
    var colLabels = cols.map(function (col, ci) {
      var cx = padLeft + ci * cellW + cellW / 2;
      var cy = padTop - 8;
      return (
        '<text data-lux-heatmap-col-label="' + escAttr(col) + '"' +
        ' x="' + cx.toFixed(2) + '" y="' + cy.toFixed(2) + '"' +
        ' text-anchor="end" font-size="11" fill="' + mutedFg + '"' +
        ' transform="rotate(-45,' + cx.toFixed(2) + ',' + cy.toFixed(2) + ')">' +
        esc(col) + '</text>'
      );
    });

    /* ── Row labels ── */
    var rowLabels = rows.map(function (row, ri) {
      var cy = padTop + ri * cellH + cellH / 2;
      return (
        '<text data-lux-heatmap-row-label="' + escAttr(row) + '"' +
        ' x="' + (padLeft - 6) + '" y="' + cy.toFixed(2) + '"' +
        ' text-anchor="end" dominant-baseline="middle" font-size="11" fill="' + mutedFg + '">' +
        esc(row) + '</text>'
      );
    });

    /* ── Cells ── */
    var cells = [];
    rows.forEach(function (row, ri) {
      cols.forEach(function (col, ci) {
        var v    = (vals[ri] && vals[ri][ci] != null) ? vals[ri][ci] : 0;
        var b    = bucket(v, minVal, maxVal);
        var fill = bucketColor(b, colorScale, tokens);
        var cx   = padLeft + ci * cellW;
        var cy   = padTop  + ri * cellH;
        var ttAttrs = LuxWidgetUtils.tooltipAttrs(
          esc(row) + ' / ' + esc(col),
          [
            { label: 'Row',   value: String(row)       },
            { label: 'Col',   value: String(col)       },
            { label: 'Value', value: String(v) },
          ],
        );
        cells.push(
          '<rect data-lux-heatmap-cell="' + escAttr(row) + ':' + escAttr(col) + '"' +
          ' x="' + cx.toFixed(2) + '" y="' + cy.toFixed(2) + '"' +
          ' width="' + cellW.toFixed(2) + '" height="' + cellH.toFixed(2) + '"' +
          ' fill="' + fill + '"' +
          ' stroke="' + LuxWidgetUtils.token(tokens, 'chartGrid', 'currentColor') + '"' +
          ' stroke-width="0.5"' +
          ttAttrs + '/>',
        );
      });
    });

    container.innerHTML =
      '<div style="position:relative;display:inline-block;">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">' +
      titleEl +
      colLabels.join('') +
      rowLabels.join('') +
      cells.join('') +
      '</svg><div data-lux-chart-tooltip="true"></div></div>';

    LuxWidgetUtils.attachTooltip(container, tokens);

    /* Wire click handler if provided */
    if (typeof onCellClick === 'function') {
      container.querySelectorAll('[data-lux-heatmap-cell]').forEach(function (el) {
        el.addEventListener('click', function () {
          var attr  = el.getAttribute('data-lux-heatmap-cell') || '';
          var colon = attr.indexOf(':');
          if (colon === -1) return;
          var row = attr.slice(0, colon);
          var col = attr.slice(colon + 1);
          var ri  = rows.indexOf(row);
          var ci  = cols.indexOf(col);
          var v   = (ri !== -1 && ci !== -1 && vals[ri]) ? (vals[ri][ci] || 0) : 0;
          onCellClick(row, col, v);
        });
      });
    }
  }

  return { render: render };
})();

/* lux-line-chart.js — SVG multi-series line chart renderer.
 *
 * Global: LuxLineChart
 * Usage:  LuxLineChart.render(container, series, options)
 *   series     [{label, points: [{x, y}, ...], color?}, ...]
 *              color may be a key in options.tokens
 *              x values may be numeric or ISO date strings (YYYY-MM-DD).
 *   options    {title?, width?, height?, showLegend?, xLabel?, yLabel?, smooth?,
 *               tokens?, referenceLines?: [{y, label?, color?}, ...]}
 *              referenceLines draws dashed horizontal lines across the plot area.
 *
 * Example:
 *   LuxLineChart.render(el, [
 *     { label: 'Revenue', points: [{x:1,y:120},{x:2,y:180},{x:3,y:150},{x:4,y:220}] },
 *     { label: 'Cost',    points: [{x:1,y:80}, {x:2,y:90}, {x:3,y:100},{x:4,y:95}]  },
 *   ], { title: 'Q1 Performance', xLabel: 'Month', yLabel: '$k', smooth: true,
 *        tokens: tokens, referenceLines: [{y: 150, label: 'Target'}] });
 */
var LuxLineChart = (function () {
  var niceScale  = LuxWidgetUtils.niceScale;
  var fmt        = LuxWidgetUtils.fmt;
  var esc        = LuxWidgetUtils.esc;

  /* Format an x-axis value: pass ISO date strings through, format numbers normally */
  function fmtX(v) {
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    return fmt(v);
  }

  /* Convert x value to a numeric position. Dates are converted by index. */
  function makeXMapper(allXRaw) {
    var isDate = allXRaw.length > 0 && typeof allXRaw[0] === 'string' && /^\d{4}-\d{2}-\d{2}/.test(allXRaw[0]);
    if (isDate) {
      /* Sort unique dates, map to 0-based indices */
      var unique = [];
      allXRaw.forEach(function (v) {
        if (unique.indexOf(v) === -1) unique.push(v);
      });
      unique.sort();
      return {
        toNum: function (v) { return unique.indexOf(v); },
        xMin: 0,
        xMax: Math.max(0, unique.length - 1),
        isDate: true,
        unique: unique,
      };
    }
    var nums = allXRaw.map(Number);
    return {
      toNum: function (v) { return Number(v); },
      xMin: Math.min.apply(null, nums),
      xMax: Math.max.apply(null, nums),
      isDate: false,
      unique: null,
    };
  }

  function render(container, series, opts) {
    opts = opts || {};
    var title         = opts.title      || '';
    var showLegend    = opts.showLegend !== false;
    var xLabel        = opts.xLabel     || '';
    var yLabel        = opts.yLabel     || '';
    var smooth        = !!opts.smooth;
    var referenceLines = opts.referenceLines || [];
    var tokens = LuxWidgetUtils.tokens(opts);
    var palette = LuxWidgetUtils.chartPalette(tokens);
    var gridColor = LuxWidgetUtils.token(tokens, 'chartGrid', 'currentColor');
    var axisColor = LuxWidgetUtils.token(tokens, 'chartAxis', 'currentColor');
    var mutedFg = LuxWidgetUtils.token(tokens, 'mutedFg', 'currentColor');
    var referenceColor = LuxWidgetUtils.token(tokens, 'statusError', 'currentColor');
    var width      = opts.width  || container.clientWidth  || container.offsetWidth  || 420;
    var height     = opts.height || container.clientHeight || container.offsetHeight || 280;

    if (!series || !series.length) { container.innerHTML = ''; return; }

    var titleH = title ? 28 : 0;
    var padL   = yLabel ? 52 : 40;
    var maxRLLabel = referenceLines.reduce(function (m, rl) { return rl.label ? Math.max(m, rl.label.length) : m; }, 0);
    var padR   = maxRLLabel ? Math.max(16, maxRLLabel * 7 + 6) : 16;
    var padT   = titleH + 12;
    var padB   = xLabel ? 44 : 30;

    /* Legend: max 4 items per row */
    var LEGEND_COLS = 4;
    var legRows = Math.ceil(series.length / LEGEND_COLS);
    var legH    = showLegend ? legRows * 20 + 8 : 0;

    var plotW  = width - padL - padR;
    var plotH  = height - padT - padB - legH;

    var allXRaw = [], allY = [];
    series.forEach(function (s) {
      s.points.forEach(function (p) { allXRaw.push(p.x); allY.push(p.y); });
    });

    var mapper = makeXMapper(allXRaw);
    var xMin = mapper.xMin;
    var xMax = mapper.xMax;
    var xRange = xMax - xMin || 1;

    var yMin = Math.min(Math.min.apply(null, allY), 0);
    var yMax = Math.max.apply(null, allY);
    var yRange = yMax - yMin || 1;

    function px(xVal) { return padL + ((mapper.toNum(xVal) - xMin) / xRange) * plotW; }
    function py(y)    { return padT + plotH - ((y - yMin) / yRange) * plotH; }

    var yTicks = niceScale(yMin, yMax, 5);
    var grid = [], yLabels = [], xLabels = [];

    yTicks.forEach(function (v) {
      var y = py(v);
      grid.push('<line x1="' + padL + '" y1="' + y + '" x2="' + (padL + plotW) + '" y2="' + y + '" stroke="' + gridColor + '" stroke-width="1"/>');
      yLabels.push('<text x="' + (padL - 5) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" fill="' + mutedFg + '">' + fmt(v) + '</text>');
    });

    /* x-axis ticks: use date unique values for date axes, niceScale for numeric */
    if (mapper.isDate) {
      var step = Math.max(1, Math.ceil(mapper.unique.length / 6));
      mapper.unique.forEach(function (dateStr, i) {
        if (i % step !== 0 && i !== mapper.unique.length - 1) return;
        var x = px(dateStr);
        xLabels.push('<text x="' + x + '" y="' + (padT + plotH + 14) + '" text-anchor="middle" font-size="10" fill="' + mutedFg + '">' + esc(dateStr.slice(0, 10)) + '</text>');
      });
    } else {
      var xTicks = niceScale(xMin, xMax, 6);
      xTicks.forEach(function (v) {
        var x = px(v);
        xLabels.push('<text x="' + x + '" y="' + (padT + plotH + 14) + '" text-anchor="middle" font-size="10" fill="' + mutedFg + '">' + fmtX(v) + '</text>');
      });
    }

    var refLines = [];
    referenceLines.forEach(function (rl) {
      var ry = py(rl.y);
      var rc = LuxWidgetUtils.color(rl.color, tokens, referenceColor);
      refLines.push('<line x1="' + padL + '" y1="' + ry + '" x2="' + (padL + plotW) + '" y2="' + ry + '" stroke="' + rc + '" stroke-width="1.5" stroke-dasharray="4,3"/>');
      if (rl.label) {
        refLines.push('<text x="' + (padL + plotW + 3) + '" y="' + (ry + 4) + '" text-anchor="start" font-size="10" fill="' + rc + '">' + esc(rl.label) + '</text>');
      }
    });

    var lines = [];
    var colors = series.map(function (s, i) { return LuxWidgetUtils.color(s.color, tokens, palette[i % palette.length]); });

    series.forEach(function (s, i) {
      var c   = colors[i];
      var pts = s.points;
      if (!pts.length) return;

      var d;
      if (smooth && pts.length > 2) {
        d = 'M' + px(pts[0].x) + ',' + py(pts[0].y);
        for (var j = 1; j < pts.length; j++) {
          var prev = pts[j - 1], curr = pts[j];
          var cpX = (px(prev.x) + px(curr.x)) / 2;
          d += ' C' + cpX + ',' + py(prev.y) + ' ' + cpX + ',' + py(curr.y) + ' ' + px(curr.x) + ',' + py(curr.y);
        }
      } else {
        d = pts.map(function (p, j) { return (j ? 'L' : 'M') + px(p.x) + ',' + py(p.y); }).join(' ');
      }

      lines.push('<path d="' + d + '" fill="none" stroke="' + c + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>');
      pts.forEach(function (p) {
        lines.push('<circle cx="' + px(p.x) + '" cy="' + py(p.y) + '" r="3.5" fill="' + c + '"' +
                   LuxWidgetUtils.tooltipAttrs(s.label, [
                     { label: 'X', value: fmtX(p.x) },
                     { label: 'Y', value: fmt(p.y) }
                   ]) + '/>');
      });
    });

    var legendEl = [];
    if (showLegend) {
      series.forEach(function (s, i) {
        var c   = colors[i];
        var col = i % LEGEND_COLS;
        var row = Math.floor(i / LEGEND_COLS);
        var lx  = padL + col * Math.max(100, plotW / LEGEND_COLS);
        var ly  = height - legH + 4 + row * 20;
        legendEl.push('<g data-lux-chart-legend-item="true"><rect x="' + lx + '" y="' + (ly + 6) + '" width="18" height="3" fill="' + c + '" rx="1.5"/>' +
                      '<text x="' + (lx + 22) + '" y="' + (ly + 12) + '" font-size="11" fill="currentColor">' + esc(s.label) + '</text></g>');
      });
    }

    var titleEl  = title  ? '<text x="' + (width / 2) + '" y="18" text-anchor="middle" font-size="14" font-weight="600" fill="currentColor">' + esc(title) + '</text>' : '';
    var xLabelEl = xLabel ? '<text x="' + (padL + plotW / 2) + '" y="' + (height - (legH ? legH + 2 : 2)) + '" text-anchor="middle" font-size="11" fill="' + mutedFg + '">' + esc(xLabel) + '</text>' : '';
    var yLabelEl = yLabel ? '<text transform="rotate(-90)" x="' + (-(padT + plotH / 2)) + '" y="12" text-anchor="middle" font-size="11" fill="' + mutedFg + '">' + esc(yLabel) + '</text>' : '';

    var axes = '<line x1="' + padL + '" y1="' + padT + '" x2="' + padL + '" y2="' + (padT + plotH) + '" stroke="' + axisColor + '" stroke-width="1"/>' +
               '<line x1="' + padL + '" y1="' + (padT + plotH) + '" x2="' + (padL + plotW) + '" y2="' + (padT + plotH) + '" stroke="' + axisColor + '" stroke-width="1"/>';

    container.innerHTML =
      '<div style="position:relative;display:inline-block;">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">' +
      titleEl + axes + grid.join('') + yLabels.join('') + xLabels.join('') + refLines.join('') + lines.join('') +
      (showLegend ? '<g data-lux-chart-legend="true">' + legendEl.join('') + '</g>' : '') + xLabelEl + yLabelEl +
      '</svg><div data-lux-chart-tooltip="true"></div></div>';
    LuxWidgetUtils.attachTooltip(container, tokens);
  }

  return { render: render };
})();

/* lux-loading-state.js — Shared loading shell for spinners and skeletons.
 *
 * Global: LuxLoadingState
 * Usage:  LuxLoadingState.render(container, options) → { setMode }
 *   options  { mode?, label?, lines?, tokens? }
 */
var LuxLoadingState = (function () {
  var _cssInjected = false;

  function render(container, opts) {
    var state = _normalise(opts);
    _ensureCss();

    function _draw() {
      var tokens = LuxWidgetUtils.tokens(state);
      var spinnerArc = LuxWidgetUtils.token(tokens, "spinnerArc", "currentColor");
      var spinnerTrack = LuxWidgetUtils.token(tokens, "spinnerTrack", LuxWidgetUtils.token(tokens, "border", "currentColor"));
      var mutedBg = LuxWidgetUtils.token(tokens, "mutedBg", LuxWidgetUtils.token(tokens, "cardBorder", "currentColor"));
      var mutedFg = LuxWidgetUtils.token(tokens, "mutedFg", "currentColor");

      container.innerHTML = "";

      if (state.mode === "skeleton") {
        var skeletonWrap = document.createElement("div");
        skeletonWrap.style.cssText = "display:grid;gap:10px;";
        for (var i = 0; i < state.lines; i++) {
          var line = document.createElement("div");
          line.setAttribute("data-lux-skeleton", "true");
          line.style.cssText =
            "height:" + (i === state.lines - 1 ? "12px" : "14px") + ";" +
            "width:" + (i === state.lines - 1 ? "72%" : "100%") + ";" +
            "border-radius:8px;background:" + mutedBg + ";" +
            "animation:_lux-loading-pulse 1.2s ease-in-out infinite;";
          skeletonWrap.appendChild(line);
        }
        container.appendChild(skeletonWrap);
        return;
      }

      var status = document.createElement("div");
      status.setAttribute("role", "status");
      status.setAttribute("aria-label", state.label);
      status.style.cssText =
        "display:inline-flex;align-items:center;gap:10px;color:" + mutedFg + ";";

      var spinner = document.createElement("div");
      spinner.setAttribute("aria-hidden", "true");
      spinner.style.cssText =
        "width:24px;height:24px;border-radius:9999px;" +
        "border:3px solid " + spinnerTrack + ";" +
        "border-top-color:" + spinnerArc + ";" +
        "animation:_lux-loading-spin 1s linear infinite;";

      var label = document.createElement("span");
      label.style.cssText = "font-family:Inter,sans-serif;font-size:12px;line-height:16px;";
      label.textContent = state.label;

      status.appendChild(spinner);
      status.appendChild(label);
      container.appendChild(status);
    }

    _draw();

    return {
      setMode: function (mode, nextOptions) {
        state = _normalise(nextOptions || {}, mode);
        _draw();
      }
    };
  }

  function _normalise(opts, forcedMode) {
    opts = opts || {};
    return {
      mode: forcedMode || opts.mode || "spinner",
      label: opts.label || "Loading…",
      lines: opts.lines || 3,
      tokens: opts.tokens || opts.theme || {}
    };
  }

  function _ensureCss() {
    if (_cssInjected) return;
    _cssInjected = true;
    var style = document.createElement("style");
    style.textContent =
      "@keyframes _lux-loading-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}" +
      "@keyframes _lux-loading-pulse{0%{opacity:0.55}50%{opacity:1}100%{opacity:0.55}}" +
      "@media (prefers-reduced-motion: reduce){" +
      "[role='status'] > div,[data-lux-skeleton='true']{animation:none!important}" +
      "}";
    document.head.appendChild(style);
  }

  return { render: render };
})();

/* lux-multi-select.js — Multi-value combobox with chip display.
 *
 * Global: LuxMultiSelect
 * Usage:  LuxMultiSelect.create(container, options) → { getValue, setValue, setOptions, setDisabled, onChange }
 *
 * Options:
 *   label?, placeholder?, value?, options:[{value,label}], onChange?, tokens?
 *
 * All colours flow through LuxWidgetUtils.token(tokens, key, fallback).
 */
var LuxMultiSelect = (function () {
  function create(container, opts) {
    opts = opts || {};
    var tokens = LuxWidgetUtils.tokens(opts);

    var inputBorder  = LuxWidgetUtils.token(tokens, 'inputBorder',      'currentColor');
    var inputBg      = LuxWidgetUtils.token(tokens, 'inputBg', 'Canvas');
    var chipBg       = LuxWidgetUtils.token(tokens, 'accentBg',
                         LuxWidgetUtils.token(tokens, 'buttonPrimaryBg', 'AccentColor'));
    var chipFg       = LuxWidgetUtils.token(tokens, 'buttonPrimaryFg', 'Canvas');
    var dropdownBg   = LuxWidgetUtils.token(tokens, 'cardBg', 'Canvas');
    var dropdownBdr  = LuxWidgetUtils.token(tokens, 'cardBorder',       'currentColor');
    var focusRing    = LuxWidgetUtils.token(tokens, 'focusRing',        'AccentColor');
    var mutedFg      = LuxWidgetUtils.token(tokens, 'mutedFg', 'GrayText');

    container.innerHTML = '';

    // Root wrapper
    var root = document.createElement('div');
    root.setAttribute('data-lux-multi-select', 'true');
    root.style.cssText = 'position:relative;display:flex;flex-direction:column;gap:4px;font-family:Inter,sans-serif;';

    // Optional label
    if (opts.label) {
      var labelEl = document.createElement('label');
      labelEl.style.cssText = 'font-size:12px;font-weight:500;color:' + mutedFg + ';';
      labelEl.textContent = String(opts.label);
      root.appendChild(labelEl);
    }

    // Field area (chips + text input)
    var field = document.createElement('div');
    field.setAttribute('data-lux-multi-select-field', 'true');
    field.style.cssText =
      'display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:4px 8px;' +
      'border:1px solid ' + inputBorder + ';border-radius:8px;' +
      'background:' + inputBg + ';cursor:text;min-height:36px;box-sizing:border-box;';

    // Text search input
    var input = document.createElement('input');
    input.setAttribute('data-lux-multi-select-input', 'true');
    input.type = 'text';
    input.placeholder = opts.placeholder || '';
    input.style.cssText =
      'border:none;outline:none;background:transparent;font-size:13px;' +
      'min-width:60px;flex:1;padding:2px 0;color:inherit;';

    field.appendChild(input);
    root.appendChild(field);

    // Dropdown listbox
    var listbox = document.createElement('div');
    listbox.setAttribute('data-lux-multi-select-listbox', 'true');
    listbox.setAttribute('role', 'listbox');
    listbox.style.cssText =
      'position:absolute;top:100%;left:0;right:0;z-index:100;margin-top:2px;' +
      'border:1px solid ' + dropdownBdr + ';border-radius:8px;' +
      'background:' + dropdownBg + ';max-height:200px;overflow-y:auto;display:none;';
    root.appendChild(listbox);

    container.appendChild(root);

    // ── State ──────────────────────────────────────────────────────────────
    var currentValues  = Array.isArray(opts.value) ? opts.value.slice() : [];
    var currentOptions = Array.isArray(opts.options) ? opts.options.slice() : [];
    var filterText     = '';
    var isOpen         = false;
    var isDisabled     = false;
    var changeHandlers = typeof opts.onChange === 'function' ? [opts.onChange] : [];

    // ── Helpers ────────────────────────────────────────────────────────────
    function getLabelForValue(val) {
      for (var i = 0; i < currentOptions.length; i++) {
        if (currentOptions[i].value === val) return currentOptions[i].label;
      }
      return val;
    }

    function getFilteredOptions() {
      if (!filterText) return currentOptions.slice();
      var lower = filterText.toLowerCase();
      var out = [];
      for (var i = 0; i < currentOptions.length; i++) {
        if (currentOptions[i].label.toLowerCase().indexOf(lower) !== -1) {
          out.push(currentOptions[i]);
        }
      }
      return out;
    }

    function fireChange() {
      for (var i = 0; i < changeHandlers.length; i++) {
        changeHandlers[i](currentValues.slice());
      }
    }

    // ── Chip rendering ─────────────────────────────────────────────────────
    function renderChips() {
      // Remove existing chips (leave the input in place)
      var existing = field.querySelectorAll('[data-lux-multi-select-chip]');
      for (var i = 0; i < existing.length; i++) {
        field.removeChild(existing[i]);
      }

      for (var j = 0; j < currentValues.length; j++) {
        (function (val) {
          var chip = document.createElement('div');
          chip.setAttribute('data-lux-multi-select-chip', val);
          chip.style.cssText =
            'display:inline-flex;align-items:center;gap:4px;padding:2px 6px;' +
            'border-radius:9999px;font-size:12px;' +
            'background:' + chipBg + ';color:' + chipFg + ';';

          var text = document.createElement('span');
          text.textContent = getLabelForValue(val);
          chip.appendChild(text);

          if (!isDisabled) {
            var removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.style.cssText =
              'border:none;background:transparent;cursor:pointer;padding:0;' +
              'color:' + chipFg + ';font-size:12px;line-height:1;';
            removeBtn.textContent = '×'; // ×
            removeBtn.addEventListener('click', function (evt) {
              evt.stopPropagation();
              removeValue(val);
            });
            chip.appendChild(removeBtn);
          }

          // Insert before input
          field.insertBefore(chip, input);
        }(currentValues[j]));
      }
    }

    // ── Option list rendering ──────────────────────────────────────────────
    function renderOptions() {
      listbox.innerHTML = '';
      var filtered = getFilteredOptions();
      for (var i = 0; i < filtered.length; i++) {
        (function (opt) {
          var isChecked = currentValues.indexOf(opt.value) !== -1;

          var item = document.createElement('div');
          item.setAttribute('data-lux-multi-select-option', opt.value);
          item.setAttribute('role', 'option');
          item.setAttribute('aria-checked', isChecked ? 'true' : 'false');
          item.style.cssText =
            'display:flex;align-items:center;gap:8px;padding:6px 10px;' +
            'font-size:13px;cursor:pointer;';

          var checkbox = document.createElement('span');
          checkbox.textContent = isChecked ? '☑' : '☐'; // ☑ or ☐
          checkbox.setAttribute('aria-hidden', 'true');
          item.appendChild(checkbox);

          var lbl = document.createElement('span');
          lbl.textContent = opt.label;
          item.appendChild(lbl);

          item.addEventListener('mousedown', function (evt) {
            evt.preventDefault(); // keep focus on input
          });

          item.addEventListener('click', function () {
            toggleValue(opt.value);
          });

          listbox.appendChild(item);
        }(filtered[i]));
      }
    }

    // ── Dropdown open/close ────────────────────────────────────────────────
    function openDropdown() {
      if (isOpen || isDisabled) return;
      isOpen = true;
      listbox.style.display = 'block';
      renderOptions();
    }

    function closeDropdown() {
      if (!isOpen) return;
      isOpen = false;
      listbox.style.display = 'none';
    }

    // ── Value mutation ─────────────────────────────────────────────────────
    function toggleValue(val) {
      var idx = currentValues.indexOf(val);
      if (idx === -1) {
        currentValues.push(val);
      } else {
        currentValues.splice(idx, 1);
      }
      renderChips();
      renderOptions();
      fireChange();
    }

    function removeValue(val) {
      var idx = currentValues.indexOf(val);
      if (idx !== -1) {
        currentValues.splice(idx, 1);
        renderChips();
        if (isOpen) renderOptions();
        fireChange();
      }
    }

    // ── Event wiring ───────────────────────────────────────────────────────
    field.addEventListener('click', function (evt) {
      if (isDisabled) return;
      input.focus();
      openDropdown();
    });

    input.addEventListener('input', function () {
      filterText = input.value;
      if (!isOpen) openDropdown();
      else renderOptions();
    });

    input.addEventListener('blur', function () {
      setTimeout(function () { closeDropdown(); }, 150);
    });

    input.addEventListener('keydown', function (evt) {
      if (evt.key === 'Escape') closeDropdown();
    });

    // Close when clicking outside
    document.addEventListener('click', function (evt) {
      if (!root.contains(evt.target)) closeDropdown();
    });

    // ── Initial render ─────────────────────────────────────────────────────
    renderChips();

    // ── Public API ─────────────────────────────────────────────────────────
    return {
      getValue: function () { return currentValues.slice(); },

      setValue: function (values) {
        currentValues = Array.isArray(values) ? values.slice() : [];
        renderChips();
        if (isOpen) renderOptions();
      },

      setOptions: function (newOpts) {
        currentOptions = Array.isArray(newOpts) ? newOpts.slice() : [];
        // Drop any selected values no longer in options
        currentValues = currentValues.filter(function (v) {
          return currentOptions.some(function (o) { return o.value === v; });
        });
        renderChips();
        if (isOpen) renderOptions();
      },

      setDisabled: function (bool) {
        isDisabled = !!bool;
        input.disabled = isDisabled;
        if (isDisabled) closeDropdown();
        renderChips(); // re-render to hide/show remove buttons
      },

      onChange: function (fn) {
        changeHandlers = [fn];
      }
    };
  }

  return { create: create };
})();

/* lux-number-input.js — Numeric stepper with +/- buttons, clamp, and label.
 *
 * Global: LuxNumberInput
 * Usage:  LuxNumberInput.create(container, options) → api
 *   options { label?, value?, min?, max?, step?, decimals?,
 *             disabled?, onChange?, tokens? }
 *
 * API: getValue(), setValue(v), setDisabled(bool), onChange(fn)
 */
var LuxNumberInput = (function () {

  function create(container, opts) {
    opts = opts || {};
    var label        = opts.label    || '';
    var value        = opts.value    != null ? Number(opts.value) : 0;
    var min          = opts.min      != null ? Number(opts.min)   : -Infinity;
    var max          = opts.max      != null ? Number(opts.max)   :  Infinity;
    var step         = opts.step     != null ? Number(opts.step)  : 1;
    var decimals     = opts.decimals != null ? Number(opts.decimals) : 0;
    var disabled     = opts.disabled || false;
    var tokens       = LuxWidgetUtils.tokens(opts);

    var inputBg     = LuxWidgetUtils.token(tokens, 'inputBg',     LuxWidgetUtils.token(tokens, 'cardBg',  'Canvas'));
    var inputFg     = LuxWidgetUtils.token(tokens, 'inputFg',     LuxWidgetUtils.token(tokens, 'cardFg',  'CanvasText'));
    var inputBorder = LuxWidgetUtils.token(tokens, 'inputBorder', LuxWidgetUtils.token(tokens, 'border',  'currentColor'));
    var labelFg     = LuxWidgetUtils.token(tokens, 'labelFg',     LuxWidgetUtils.token(tokens, 'mutedFg', 'currentColor'));
    var buttonBg    = LuxWidgetUtils.token(tokens, 'buttonBg',    'transparent');
    var buttonFg    = LuxWidgetUtils.token(tokens, 'buttonFg',    'currentColor');
    var focusRing   = LuxWidgetUtils.token(tokens, 'focusRing',   LuxWidgetUtils.token(tokens, 'border',  'currentColor'));

    var _current = _clamp(value);
    var _changeHandlers = [];
    if (typeof opts.onChange === 'function') {
      _changeHandlers.push(opts.onChange);
    }

    function _clamp(v) {
      if (v < min) return min;
      if (v > max) return max;
      return v;
    }

    function _fmt(v) {
      return decimals > 0 ? v.toFixed(decimals) : String(v);
    }

    // Build DOM
    var wrapper = document.createElement('div');
    wrapper.setAttribute('data-lux-number-input', 'true');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.gap = '4px';
    wrapper.style.fontFamily = 'Inter, sans-serif';
    wrapper.style.fontSize = '14px';

    var labelEl = document.createElement('label');
    labelEl.style.fontSize = '13px';
    labelEl.style.fontWeight = '500';
    labelEl.style.color = labelFg;
    labelEl.style.display = label ? 'block' : 'none';
    labelEl.textContent = label;

    var rowEl = document.createElement('div');
    rowEl.style.display = 'flex';
    rowEl.style.alignItems = 'center';
    rowEl.style.gap = '4px';

    var decBtn = document.createElement('button');
    decBtn.setAttribute('data-dec', 'true');
    decBtn.textContent = '−';
    decBtn.style.border = '1px solid ' + inputBorder;
    decBtn.style.background = buttonBg;
    decBtn.style.color = buttonFg;
    decBtn.style.borderRadius = '8px';
    decBtn.style.padding = '4px 10px';
    decBtn.style.cursor = 'pointer';
    decBtn.style.fontSize = '14px';
    decBtn.style.fontFamily = 'Inter, sans-serif';

    var inputEl = document.createElement('input');
    inputEl.type = 'number';
    inputEl.value = _fmt(_current);
    inputEl.disabled = disabled;
    inputEl.style.background = inputBg;
    inputEl.style.color = inputFg;
    inputEl.style.border = '1px solid ' + inputBorder;
    inputEl.style.borderRadius = '8px';
    inputEl.style.padding = '6px 10px';
    inputEl.style.fontFamily = 'Inter, sans-serif';
    inputEl.style.fontSize = '14px';
    inputEl.style.outline = 'none';
    inputEl.style.width = '80px';
    inputEl.style.textAlign = 'center';
    inputEl.style.boxSizing = 'border-box';

    var incBtn = document.createElement('button');
    incBtn.setAttribute('data-inc', 'true');
    incBtn.textContent = '+';
    incBtn.style.border = '1px solid ' + inputBorder;
    incBtn.style.background = buttonBg;
    incBtn.style.color = buttonFg;
    incBtn.style.borderRadius = '8px';
    incBtn.style.padding = '4px 10px';
    incBtn.style.cursor = 'pointer';
    incBtn.style.fontSize = '14px';
    incBtn.style.fontFamily = 'Inter, sans-serif';

    rowEl.appendChild(decBtn);
    rowEl.appendChild(inputEl);
    rowEl.appendChild(incBtn);

    wrapper.appendChild(labelEl);
    wrapper.appendChild(rowEl);
    container.appendChild(wrapper);

    function _updateButtonStates() {
      decBtn.disabled = disabled || _current <= min;
      incBtn.disabled = disabled || _current >= max;
    }

    function _setValue(v) {
      _current = _clamp(v);
      inputEl.value = _fmt(_current);
      _updateButtonStates();
    }

    function _notify() {
      for (var i = 0; i < _changeHandlers.length; i++) {
        _changeHandlers[i](_current);
      }
    }

    _updateButtonStates();

    incBtn.addEventListener('click', function () {
      if (incBtn.disabled) return;
      _setValue(_current + step);
      _notify();
    });

    decBtn.addEventListener('click', function () {
      if (decBtn.disabled) return;
      _setValue(_current - step);
      _notify();
    });

    inputEl.addEventListener('input', function () {
      var v = parseFloat(inputEl.value);
      if (!isNaN(v)) {
        _current = _clamp(v);
        _updateButtonStates();
        _notify();
      }
    });

    inputEl.addEventListener('focus', function () {
      inputEl.style.outline = '2px solid ' + focusRing;
      inputEl.style.outlineOffset = '1px';
    });
    inputEl.addEventListener('blur', function () {
      inputEl.style.outline = 'none';
    });

    return {
      getValue: function () { return _current; },
      setValue: function (v) { _setValue(v); },
      setDisabled: function (bool) {
        disabled = !!bool;
        inputEl.disabled = disabled;
        _updateButtonStates();
      },
      onChange: function (fn) { _changeHandlers.push(fn); },
    };
  }

  return { create: create };
})();

/* lux-panel-card.js — Reusable titled section shell for dashboard panels.
 *
 * Global: LuxPanelCard
 * Usage:  LuxPanelCard.render(container, options) → { body, setTitle, setDescription, setCollapsed, setLoading }
 *   options  {
 *     title?, description?,
 *     collapsible?: boolean,
 *     actions?: [{label, icon?, onClick, primary?}],
 *     tokens?
 *   }
 *
 * Cards are persistent content containers, not interactions. Generated screens
 * can append charts, tables, AI summaries, or filters into the returned body.
 */
var LuxPanelCard = (function () {
  function render(container, opts) {
    opts = opts || {};
    var tokens = LuxWidgetUtils.tokens(opts);
    var cardBg = LuxWidgetUtils.token(tokens, "cardBg", "transparent");
    var cardFg = LuxWidgetUtils.token(tokens, "cardFg", "currentColor");
    var cardBorder = LuxWidgetUtils.token(tokens, "cardBorder", LuxWidgetUtils.token(tokens, "border", "currentColor"));
    var mutedFg = LuxWidgetUtils.token(tokens, "mutedFg", "currentColor");
    var btnPrimaryBg = LuxWidgetUtils.token(tokens, "buttonPrimaryBg", "AccentColor");
    var btnPrimaryFg = LuxWidgetUtils.token(tokens, "buttonPrimaryFg", "Canvas");
    var btnSecondaryBg = LuxWidgetUtils.token(tokens, "buttonSecondaryBg", "ButtonFace");
    var btnSecondaryFg = LuxWidgetUtils.token(tokens, "buttonSecondaryFg", "ButtonText");
    var spinnerOverlayBg = LuxWidgetUtils.token(tokens, "spinnerOverlayBg", "Canvas");
    var spinnerTrack = LuxWidgetUtils.token(tokens, "spinnerTrack", "currentColor");
    var spinnerArc = LuxWidgetUtils.token(tokens, "spinnerArc", "AccentColor");

    container.innerHTML = "";

    var card = document.createElement("section");
    card.setAttribute("data-lux-panel-card", "true");
    card.style.cssText =
      "display:flex;flex-direction:column;gap:16px;" +
      "padding:16px;border:1px solid " + cardBorder + ";" +
      "border-radius:10px;background:" + cardBg + ";color:" + cardFg + ";";

    var header = document.createElement("div");
    header.style.cssText =
      "display:flex;align-items:flex-start;justify-content:space-between;gap:16px;";

    var copy = document.createElement("div");
    copy.style.cssText = "display:flex;flex-direction:column;gap:4px;min-width:0;flex:1;";

    var title = document.createElement("div");
    title.style.cssText =
      "font-family:Inter,sans-serif;font-size:14px;line-height:20px;font-weight:600;";
    title.textContent = opts.title || "";

    var description = document.createElement("div");
    description.style.cssText =
      "font-family:Inter,sans-serif;font-size:12px;line-height:16px;color:" + mutedFg + ";";
    description.textContent = opts.description || "";
    description.hidden = !opts.description;

    copy.appendChild(title);
    copy.appendChild(description);
    header.appendChild(copy);

    // header right: action buttons + collapse chevron
    var headerRight = document.createElement("div");
    headerRight.style.cssText = "display:flex;align-items:center;gap:8px;flex-shrink:0;";

    // action buttons
    if (Array.isArray(opts.actions)) {
      opts.actions.forEach(function (action) {
        var btn = document.createElement("button");
        btn.setAttribute("data-lux-panel-action", action.label);
        btn.style.cssText =
          "border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;font-family:Inter,sans-serif;border:none;" +
          (action.primary
            ? "background:" + btnPrimaryBg + ";color:" + btnPrimaryFg + ";"
            : "background:" + btnSecondaryBg + ";color:" + btnSecondaryFg + ";");
        btn.textContent = (action.icon ? action.icon + " " : "") + action.label;
        if (typeof action.onClick === "function") {
          btn.addEventListener("click", action.onClick);
        }
        headerRight.appendChild(btn);
      });
    }

    // collapse chevron
    var chevron = null;
    var collapsed = false;

    var body = document.createElement("div");
    body.style.cssText = "min-width:0;position:relative;";

    if (opts.collapsible) {
      chevron = document.createElement("button");
      chevron.setAttribute("data-lux-panel-collapse", "true");
      chevron.setAttribute("aria-expanded", "true");
      chevron.setAttribute("aria-label", "Toggle panel");
      chevron.style.cssText =
        "background:none;border:none;cursor:pointer;font-size:14px;padding:2px 4px;color:" + mutedFg + ";";
      chevron.textContent = "▼";

      (function (b, c) {
        c.addEventListener("click", function () {
          collapsed = !collapsed;
          b.hidden = collapsed;
          c.setAttribute("aria-expanded", collapsed ? "false" : "true");
          c.textContent = collapsed ? "▶" : "▼";
        });
      }(body, chevron));

      headerRight.appendChild(chevron);
    }

    header.appendChild(headerRight);
    card.appendChild(header);
    card.appendChild(body);
    container.appendChild(card);

    return {
      body: body,

      setTitle: function (nextTitle) {
        title.textContent = nextTitle == null ? "" : String(nextTitle);
      },

      setDescription: function (nextDescription) {
        description.textContent = nextDescription == null ? "" : String(nextDescription);
        description.hidden = !nextDescription;
      },

      setCollapsed: function (bool) {
        collapsed = !!bool;
        body.hidden = collapsed;
        if (chevron) {
          chevron.setAttribute("aria-expanded", collapsed ? "false" : "true");
          chevron.textContent = collapsed ? "▶" : "▼";
        }
      },

      setLoading: function (bool) {
        var existing = body.querySelector('[data-lux-panel-loading="true"]');
        if (bool) {
          if (!existing) {
            var overlay = document.createElement("div");
            overlay.setAttribute("data-lux-panel-loading", "true");
            overlay.style.cssText =
              "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;" +
              "border-radius:10px;z-index:5;";
            overlay.style.background = spinnerOverlayBg;
            var wheel = document.createElement("div");
            wheel.style.width = "20px";
            wheel.style.height = "20px";
            wheel.style.borderRadius = "50%";
            wheel.style.border = "2px solid " + spinnerTrack;
            wheel.style.borderTopColor = spinnerArc;
            wheel.style.animation = "lux-spin 0.7s linear infinite";
            overlay.appendChild(wheel);
            body.appendChild(overlay);
          }
        } else {
          if (existing) { existing.parentNode.removeChild(existing); }
        }
      }
    };
  }

  return { render: render };
})();

/* lux-pie-chart.js — SVG pie / donut chart renderer.
 *
 * Global: LuxPieChart
 * Usage:  LuxPieChart.render(container, data, options)
 *   data       [{label, value, color?}, ...]  color may be a key in options.tokens
 *   options    {title?, width?, height?, showLegend?, donut?, tokens?}
 *   Legends show label, value, and percent. Hover/focus slices for details.
 *
 * Example:
 *   LuxPieChart.render(el, [
 *     { label: 'Apples', value: 40 },
 *     { label: 'Oranges', value: 35 },
 *     { label: 'Bananas', value: 25, color: 'chart4' },
 *   ], { title: 'Fruit Split', donut: true, tokens: tokens });
 */
var LuxPieChart = (function () {
  var esc     = LuxWidgetUtils.esc;

  function render(container, data, opts) {
    opts = opts || {};
    var title      = opts.title      || '';
    var showLegend = opts.showLegend !== false;
    var donut      = !!opts.donut;
    var tokens     = LuxWidgetUtils.tokens(opts);
    var palette    = LuxWidgetUtils.chartPalette(tokens);
    var border     = LuxWidgetUtils.token(tokens, 'chartBorder', 'currentColor');
    var mutedFg    = LuxWidgetUtils.token(tokens, 'mutedFg', 'currentColor');
    var width      = opts.width  || container.clientWidth  || container.offsetWidth  || 360;
    var height     = opts.height || container.clientHeight || container.offsetHeight || 280;

    var total = data.reduce(function (s, d) { return s + d.value; }, 0);
    if (!total) { container.innerHTML = ''; return; }

    var titleH = title ? 28 : 0;
    var legW   = showLegend ? 132 : 0;
    var drawW  = width - legW;
    var drawH  = height - titleH;
    var r      = Math.min(drawW, drawH) * 0.42;
    var cx     = drawW / 2;
    var cy     = titleH + drawH / 2;
    var innerR = donut ? r * 0.5 : 0;

    var paths  = [];
    var legend = [];
    var a      = -Math.PI / 2;

    data.forEach(function (d, i) {
      var c  = LuxWidgetUtils.color(d.color, tokens, palette[i % palette.length]);
      var sa = a;
      var ea = a + (d.value / total) * 2 * Math.PI;
      var large = (ea - sa > Math.PI) ? 1 : 0;
      var x1 = cx + r * Math.cos(sa), y1 = cy + r * Math.sin(sa);
      var x2 = cx + r * Math.cos(ea), y2 = cy + r * Math.sin(ea);
      var pct = Math.round((d.value / total) * 100);
      var path;

      if (donut) {
        var ix1 = cx + innerR * Math.cos(ea), iy1 = cy + innerR * Math.sin(ea);
        var ix2 = cx + innerR * Math.cos(sa), iy2 = cy + innerR * Math.sin(sa);
        path = 'M' + x1 + ',' + y1 +
               ' A' + r + ',' + r + ' 0 ' + large + ' 1 ' + x2 + ',' + y2 +
               ' L' + ix1 + ',' + iy1 +
               ' A' + innerR + ',' + innerR + ' 0 ' + large + ' 0 ' + ix2 + ',' + iy2 + ' Z';
      } else {
        path = 'M' + cx + ',' + cy +
               ' L' + x1 + ',' + y1 +
               ' A' + r + ',' + r + ' 0 ' + large + ' 1 ' + x2 + ',' + y2 + ' Z';
      }

      paths.push('<path d="' + path + '" fill="' + c + '" stroke="' + border + '" stroke-width="1.5"' +
                 LuxWidgetUtils.tooltipAttrs(d.label, [
                   { label: 'Value', value: LuxWidgetUtils.fmt(d.value) },
                   { label: 'Share', value: pct + '%' }
                 ], 'Total ' + LuxWidgetUtils.fmt(total)) + '/>');

      if (showLegend) {
        var ly = titleH + 14 + i * 22;
        legend.push('<g data-lux-chart-legend-item="true">' +
                    '<rect x="' + (drawW + 8) + '" y="' + ly + '" width="12" height="12" fill="' + c + '" rx="2"/>' +
                    '<text x="' + (drawW + 24) + '" y="' + (ly + 8) + '" font-size="11" font-weight="600" fill="currentColor">' +
                    esc(d.label) + '</text>' +
                    '<text x="' + (drawW + 24) + '" y="' + (ly + 20) + '" font-size="10" fill="' + mutedFg + '">' +
                    LuxWidgetUtils.fmt(d.value) + ' • ' + pct + '%</text></g>');
      }
      a = ea;
    });

    var titleEl = title
      ? '<text x="' + (width / 2) + '" y="18" text-anchor="middle" font-size="14" font-weight="600" fill="currentColor">' + esc(title) + '</text>'
      : '';

    container.innerHTML =
      '<div style="position:relative;display:inline-block;">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" font-family="Inter, sans-serif">' +
      titleEl + paths.join('') + (showLegend ? '<g data-lux-chart-legend="true">' + legend.join('') + '</g>' : '') +
      '</svg><div data-lux-chart-tooltip="true"></div></div>';
    LuxWidgetUtils.attachTooltip(container, tokens);
  }

  return { render: render };
})();

/* lux-progress-bar.js — Horizontal progress bar with optional zone colouring.
 *
 * Global: LuxProgressBar
 * Usage:  LuxProgressBar.render(container, data, options)
 *   data       {value, min?, max?, label?}
 *   options    {title?, showValue?, height?, segments?, tokens?}
 *              segments: [{from, to, tone:'success'|'warning'|'error'}]
 *
 * Example:
 *   LuxProgressBar.render(el,
 *     { value: 72, min: 0, max: 100, label: 'Budget' },
 *     { title: 'Budget Used', segments: [{from:0,to:50,tone:'success'},{from:50,to:100,tone:'error'}], tokens: tokens }
 *   );
 */
var LuxProgressBar = (function () {

  function zoneColour(tone, tokens) {
    if (tone === 'success') { return LuxWidgetUtils.token(tokens, 'semanticSuccessFg', 'currentColor'); }
    if (tone === 'warning') { return LuxWidgetUtils.token(tokens, 'semanticWarningFg', 'currentColor'); }
    if (tone === 'error')   { return LuxWidgetUtils.token(tokens, 'semanticErrorFg', 'currentColor'); }
    return null;
  }

  function render(container, data, opts) {
    opts = opts || {};
    data = data || {};

    var tokens     = LuxWidgetUtils.tokens(opts);

    var value      = data.value != null ? data.value : 0;
    var min        = data.min   != null ? data.min   : 0;
    var max        = data.max   != null ? data.max   : 100;
    var label      = data.label || '';

    var title      = opts.title      || '';
    var showValue  = opts.showValue  !== false;
    var height     = opts.height     || 12;
    var segments   = opts.segments   || [];

    // Token-resolved colours
    var trackBg    = LuxWidgetUtils.token(tokens, 'mutedBg', 'ButtonFace');
    var defaultFg  = LuxWidgetUtils.token(tokens, 'chart1', 'currentColor');
    var mutedFg    = LuxWidgetUtils.token(tokens, 'mutedFg', 'GrayText');
    var titleFg    = LuxWidgetUtils.token(tokens, 'cardFg', 'CanvasText');

    // Compute fill fraction (clamped 0–1)
    var range = (max === min) ? 1 : (max - min);
    var frac  = Math.max(0, Math.min(1, (value - min) / range));
    var pct   = (frac * 100).toFixed(2).replace(/\.?0+$/, '') + '%';

    // Determine fill colour from segments
    var fillColour = defaultFg;
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      if (value >= seg.from && value <= seg.to) {
        var zc = zoneColour(seg.tone, tokens);
        if (zc) { fillColour = zc; break; }
      }
    }

    // Build DOM imperatively so colours land on .style and are testable
    container.innerHTML = '';

    var wrapper = document.createElement('div');
    wrapper.setAttribute('data-lux-progress-bar', 'true');
    wrapper.style.fontFamily = 'Inter, sans-serif';
    wrapper.style.fontSize   = '13px';
    wrapper.style.width      = '100%';

    // Title
    if (title) {
      var titleDiv = document.createElement('div');
      titleDiv.style.marginBottom = '4px';
      titleDiv.style.fontWeight   = '600';
      titleDiv.style.color        = titleFg;
      titleDiv.textContent = title;
      wrapper.appendChild(titleDiv);
    }

    // Label above track (data.label)
    if (label) {
      var labelDiv = document.createElement('div');
      labelDiv.style.marginBottom = '2px';
      labelDiv.style.color        = mutedFg;
      labelDiv.textContent = label;
      wrapper.appendChild(labelDiv);
    }

    // Track row: track + optional value label
    var row = document.createElement('div');
    row.style.display     = 'flex';
    row.style.alignItems  = 'center';
    row.style.gap         = '8px';

    // Track
    var track = document.createElement('div');
    track.setAttribute('data-lux-progress-track', 'true');
    track.style.flex         = '1';
    track.style.background   = trackBg;
    track.style.borderRadius = '9999px';
    track.style.height       = height + 'px';
    track.style.overflow     = 'hidden';

    // Fill
    var fill = document.createElement('div');
    fill.setAttribute('data-lux-progress-fill', 'true');
    fill.style.width         = pct;
    fill.style.height        = '100%';
    fill.style.background    = fillColour;
    fill.style.borderRadius  = '9999px';
    fill.style.transition    = 'width 300ms ease';

    track.appendChild(fill);
    row.appendChild(track);

    // Value label
    if (showValue) {
      var valueSpan = document.createElement('span');
      valueSpan.setAttribute('data-lux-progress-value', 'true');
      valueSpan.style.color      = mutedFg;
      valueSpan.style.whiteSpace = 'nowrap';
      valueSpan.style.minWidth   = '36px';
      valueSpan.style.textAlign  = 'right';
      valueSpan.textContent = String(LuxWidgetUtils.fmt(value));
      row.appendChild(valueSpan);
    }

    wrapper.appendChild(row);
    container.appendChild(wrapper);
  }

  return { render: render };
})();

/* lux-radar-chart.js — SVG spider/radar chart renderer.
 *
 * Global: LuxRadarChart
 * Usage:  LuxRadarChart.render(container, series, options)
 *   series   [{label, values: number[], color?}, ...]
 *            All series must have the same number of values;
 *            index i corresponds to axes[i].
 *   options  {axes: string[], title?, width?, height?,
 *             showLegend?, maxValue?, tokens?}
 *
 * Geometry:
 *   cx = width/2, cy = (height - legend)/2
 *   r  = min(cx, cy) * 0.7
 *   Spoke angle for axis i: -90 + i*(360/N) degrees (clockwise from top)
 *   polarToCartesian(cx, cy, r, angleDeg):
 *     x = cx + r*cos((angleDeg-90)*π/180)
 *     y = cy + r*sin((angleDeg-90)*π/180)
 *
 * Token keys:
 *   chartGrid → grid rings + spokes stroke  (fallback #94A3B8)
 *   mutedFg   → axis label fill             (fallback #525252)
 *   chart1–5  → series colours via chartPalette
 *
 * Example:
 *   LuxRadarChart.render(el, [
 *     { label: 'Team A', values: [80, 60, 70, 90, 50] },
 *     { label: 'Team B', values: [50, 80, 60, 40, 75], color: 'chart3' },
 *   ], { axes: ['Quality','Speed','Cost','UX','Scale'], tokens: tokens });
 */
var LuxRadarChart = (function () {
  var esc = LuxWidgetUtils.esc;

  /* Convert polar coords (angle in degrees, 0=top, clockwise) to SVG x/y */
  function polar(cx, cy, r, angleDeg) {
    var rad = (angleDeg - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  /* Build a polygon points string from an array of {x,y} objects */
  function pointsStr(pts) {
    return pts.map(function (p) { return p.x.toFixed(2) + ',' + p.y.toFixed(2); }).join(' ');
  }

  function render(container, series, opts) {
    opts = opts || {};
    var tokens     = LuxWidgetUtils.tokens(opts);
    var axes       = opts.axes || [];
    var title      = opts.title      || '';
    var showLegend = opts.showLegend !== false;
    var width      = opts.width  || container.clientWidth  || container.offsetWidth  || 400;
    var height     = opts.height || container.clientHeight || container.offsetHeight || 360;
    var palette    = LuxWidgetUtils.chartPalette(tokens);
    var gridColor  = LuxWidgetUtils.token(tokens, 'chartGrid', 'currentColor');
    var mutedFg    = LuxWidgetUtils.token(tokens, 'mutedFg', 'GrayText');

    var N = axes.length;
    if (!series || !series.length || N < 3) { container.innerHTML = ''; return; }

    /* Determine scale maximum */
    var allVals = [];
    series.forEach(function (s) { s.values.forEach(function (v) { allVals.push(v); }); });
    var maxValue = opts.maxValue != null ? opts.maxValue : Math.max.apply(null, allVals) || 1;

    /* Layout */
    var titleH  = title ? 28 : 0;
    var legRows = showLegend ? Math.ceil(series.length / 4) : 0;
    var legH    = legRows * 22 + (legRows ? 8 : 0);
    var cx      = width  / 2;
    var cy      = (height - titleH - legH) / 2 + titleH;
    var r       = Math.min(cx, cy - titleH / 2) * 0.70;
    var labelR  = r * 1.18; /* axis label radius (just beyond outermost ring) */

    /* ── Grid rings (5 concentric polygons at 20%/40%/60%/80%/100%) ── */
    var rings = [];
    for (var ring = 1; ring <= 5; ring++) {
      var rr   = r * ring / 5;
      var rpts = [];
      for (var i = 0; i < N; i++) {
        rpts.push(polar(cx, cy, rr, -90 + i * (360 / N)));
      }
      rings.push(
        '<polygon data-lux-radar-grid="true"' +
        ' points="' + pointsStr(rpts) + '"' +
        ' stroke="' + gridColor + '" stroke-width="1" fill="none"/>',
      );
    }

    /* ── Axis spokes ── */
    var spokes = [];
    var labelEls = [];
    for (var i = 0; i < N; i++) {
      var angle = -90 + i * (360 / N);
      var tip   = polar(cx, cy, r,      angle);
      var lp    = polar(cx, cy, labelR, angle);
      spokes.push(
        '<line data-lux-radar-spoke="true"' +
        ' x1="' + cx.toFixed(2) + '" y1="' + cy.toFixed(2) + '"' +
        ' x2="' + tip.x.toFixed(2) + '" y2="' + tip.y.toFixed(2) + '"' +
        ' stroke="' + gridColor + '" stroke-width="1"/>',
      );
      /* Text anchor based on angle quadrant */
      var anchor = 'middle';
      if (lp.x < cx - 4)  anchor = 'end';
      if (lp.x > cx + 4)  anchor = 'start';
      labelEls.push(
        '<text data-lux-radar-label="' + esc(axes[i]) + '"' +
        ' x="' + lp.x.toFixed(2) + '" y="' + lp.y.toFixed(2) + '"' +
        ' text-anchor="' + anchor + '" dominant-baseline="middle"' +
        ' font-size="11" fill="' + mutedFg + '">' + esc(axes[i]) + '</text>',
      );
    }

    /* ── Series polygons ── */
    var seriesEls = [];
    var colors = series.map(function (s, idx) {
      return LuxWidgetUtils.color(s.color, tokens, palette[idx % palette.length]);
    });

    series.forEach(function (s, idx) {
      var c    = colors[idx];
      var spts = [];
      for (var i = 0; i < N; i++) {
        var v   = (s.values[i] || 0);
        var frac = Math.min(1, Math.max(0, v / maxValue));
        spts.push(polar(cx, cy, r * frac, -90 + i * (360 / N)));
      }
      seriesEls.push(
        '<polygon data-lux-radar-series="' + esc(s.label) + '"' +
        ' points="' + pointsStr(spts) + '"' +
        ' stroke="' + c + '" stroke-width="2"' +
        ' fill="' + c + '" fill-opacity="0.2"' +
        LuxWidgetUtils.tooltipAttrs(s.label, s.values.map(function (v, i) {
          return { label: axes[i] || ('Axis ' + i), value: String(v) };
        })) +
        '/>',
      );
    });

    /* ── Legend ── */
    var legendEl = '';
    if (showLegend && series.length) {
      var ly0   = height - legH + 4;
      var items = series.map(function (s, idx) {
        var c  = colors[idx];
        var col = idx % 4;
        var row = Math.floor(idx / 4);
        var lx  = 16 + col * Math.floor((width - 16) / 4);
        var ly  = ly0 + row * 22 + 10;
        return (
          '<g data-lux-chart-legend-item="true">' +
          '<rect x="' + lx + '" y="' + (ly - 5) + '" width="10" height="10"' +
          ' fill="' + c + '" fill-opacity="0.8" rx="2"/>' +
          '<text x="' + (lx + 14) + '" y="' + ly + '"' +
          ' font-size="11" fill="currentColor" dominant-baseline="middle">' +
          esc(s.label) + '</text></g>'
        );
      });
      legendEl = '<g data-lux-chart-legend="true">' + items.join('') + '</g>';
    }

    /* ── Title ── */
    var titleEl = title
      ? '<text x="' + (width / 2) + '" y="18"' +
        ' text-anchor="middle" font-size="14" font-weight="600" fill="currentColor">' +
        esc(title) + '</text>'
      : '';

    container.innerHTML =
      '<div style="position:relative;display:inline-block;">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">' +
      titleEl +
      rings.join('') +
      spokes.join('') +
      labelEls.join('') +
      seriesEls.join('') +
      legendEl +
      '</svg><div data-lux-chart-tooltip="true"></div></div>';

    LuxWidgetUtils.attachTooltip(container, tokens);
  }

  return { render: render };
})();

/* lux-scatter-plot.js — SVG multi-series scatter plot renderer.
 *
 * Global: LuxScatterPlot
 * Usage:  LuxScatterPlot.render(container, series, options)
 *   series     [{label, points: [{x, y}, ...], color?}, ...]
 *              color may be a key in options.tokens
 *   options    {title?, width?, height?, showLegend?, xLabel?, yLabel?, pointSize?, tokens?}
 *
 * Example:
 *   LuxScatterPlot.render(el, [
 *     { label: 'Group A', points: [{x:1,y:2},{x:3,y:4},{x:2,y:6}] },
 *     { label: 'Group B', points: [{x:5,y:1},{x:6,y:5},{x:4,y:3}], color: 'chart4' },
 *   ], { title: 'Cluster View', xLabel: 'X Axis', yLabel: 'Y Axis', tokens: tokens });
 */
var LuxScatterPlot = (function () {
  var niceScale  = LuxWidgetUtils.niceScale;
  var fmt        = LuxWidgetUtils.fmt;
  var esc        = LuxWidgetUtils.esc;

  function render(container, series, opts) {
    opts = opts || {};
    var title      = opts.title      || '';
    var showLegend = opts.showLegend !== false;
    var xLabel     = opts.xLabel     || '';
    var yLabel     = opts.yLabel     || '';
    var pointSize  = opts.pointSize  || 5;
    var tokens     = LuxWidgetUtils.tokens(opts);
    var palette    = LuxWidgetUtils.chartPalette(tokens);
    var gridColor  = LuxWidgetUtils.token(tokens, 'chartGrid', 'currentColor');
    var axisColor  = LuxWidgetUtils.token(tokens, 'chartAxis', 'currentColor');
    var mutedFg    = LuxWidgetUtils.token(tokens, 'mutedFg', 'currentColor');
    var width      = opts.width  || container.clientWidth  || container.offsetWidth  || 420;
    var height     = opts.height || container.clientHeight || container.offsetHeight || 280;

    if (!series || !series.length) { container.innerHTML = ''; return; }

    var titleH = title ? 28 : 0;
    var padL   = yLabel ? 52 : 40;
    var padR   = 16;
    var padT   = titleH + 12;
    var padB   = xLabel ? 44 : 30;
    var legH   = showLegend ? series.length * 20 + 8 : 0;
    var plotW  = width - padL - padR;
    var plotH  = height - padT - padB - legH;

    var allX = [], allY = [];
    series.forEach(function (s) {
      s.points.forEach(function (p) { allX.push(p.x); allY.push(p.y); });
    });
    var xMin = Math.min.apply(null, allX), xMax = Math.max.apply(null, allX);
    var yMin = Math.min.apply(null, allY), yMax = Math.max.apply(null, allY);
    var xRange = xMax - xMin || 1;
    var yRange = yMax - yMin || 1;

    /* Add 5% padding around the data extent so points don't sit on axes. */
    xMin -= xRange * 0.05; xMax += xRange * 0.05; xRange = xMax - xMin;
    yMin -= yRange * 0.05; yMax += yRange * 0.05; yRange = yMax - yMin;

    function px(x) { return padL + ((x - xMin) / xRange) * plotW; }
    function py(y) { return padT + plotH - ((y - yMin) / yRange) * plotH; }

    var xTicks = niceScale(xMin, xMax, 6);
    var yTicks = niceScale(yMin, yMax, 5);
    var grid = [], xLabels = [], yLabels = [];

    xTicks.forEach(function (v) {
      var x = px(v);
      grid.push('<line x1="' + x + '" y1="' + padT + '" x2="' + x + '" y2="' + (padT + plotH) + '" stroke="' + gridColor + '" stroke-width="1"/>');
      xLabels.push('<text x="' + x + '" y="' + (padT + plotH + 14) + '" text-anchor="middle" font-size="10" fill="' + mutedFg + '">' + fmt(v) + '</text>');
    });
    yTicks.forEach(function (v) {
      var y = py(v);
      grid.push('<line x1="' + padL + '" y1="' + y + '" x2="' + (padL + plotW) + '" y2="' + y + '" stroke="' + gridColor + '" stroke-width="1"/>');
      yLabels.push('<text x="' + (padL - 5) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" fill="' + mutedFg + '">' + fmt(v) + '</text>');
    });

    var dots = [];
    var colors = series.map(function (s, i) { return LuxWidgetUtils.color(s.color, tokens, palette[i % palette.length]); });

    series.forEach(function (s, i) {
      var c = colors[i];
      s.points.forEach(function (p) {
        dots.push('<circle cx="' + px(p.x) + '" cy="' + py(p.y) + '" r="' + pointSize + '" fill="' + c + '" fill-opacity="0.8"' +
                  LuxWidgetUtils.tooltipAttrs(s.label, [
                    { label: 'X', value: fmt(p.x) },
                    { label: 'Y', value: fmt(p.y) }
                  ]) + '/>');
      });
    });

    var legendEl = [];
    if (showLegend) {
      var ly0 = height - legH + 4;
      series.forEach(function (s, i) {
        var c  = colors[i];
        var lx = padL + i * 120;
        legendEl.push('<g data-lux-chart-legend-item="true"><circle cx="' + (lx + pointSize) + '" cy="' + (ly0 + 8) + '" r="' + pointSize + '" fill="' + c + '" fill-opacity="0.8"/>' +
                      '<text x="' + (lx + pointSize * 2 + 6) + '" y="' + (ly0 + 12) + '" font-size="11" fill="currentColor">' + esc(s.label) + '</text></g>');
      });
    }

    var titleEl  = title  ? '<text x="' + (width / 2) + '" y="18" text-anchor="middle" font-size="14" font-weight="600" fill="currentColor">' + esc(title) + '</text>' : '';
    var xLabelEl = xLabel ? '<text x="' + (padL + plotW / 2) + '" y="' + (height - (legH ? legH + 2 : 2)) + '" text-anchor="middle" font-size="11" fill="' + mutedFg + '">' + esc(xLabel) + '</text>' : '';
    var yLabelEl = yLabel ? '<text transform="rotate(-90)" x="' + (-(padT + plotH / 2)) + '" y="12" text-anchor="middle" font-size="11" fill="' + mutedFg + '">' + esc(yLabel) + '</text>' : '';

    var axes = '<line x1="' + padL + '" y1="' + padT + '" x2="' + padL + '" y2="' + (padT + plotH) + '" stroke="' + axisColor + '" stroke-width="1"/>' +
               '<line x1="' + padL + '" y1="' + (padT + plotH) + '" x2="' + (padL + plotW) + '" y2="' + (padT + plotH) + '" stroke="' + axisColor + '" stroke-width="1"/>';

    container.innerHTML =
      '<div style="position:relative;display:inline-block;">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">' +
      titleEl + axes + grid.join('') + yLabels.join('') + xLabels.join('') + dots.join('') +
      (showLegend ? '<g data-lux-chart-legend="true">' + legendEl.join('') + '</g>' : '') + xLabelEl + yLabelEl +
      '</svg><div data-lux-chart-tooltip="true"></div></div>';
    LuxWidgetUtils.attachTooltip(container, tokens);
  }

  return { render: render };
})();

/* lux-select.js — Short-list selection control for compact ERP filters.
 *
 * Global: LuxSelect
 * Usage:  LuxSelect.create(container, options) → { getValue, setValue, setDisabled }
 *   options  { label?, placeholder?, value?, options, onChange?, tokens? }
 *
 * Intended for short fixed lists. For larger or searchable datasets, a future
 * combobox primitive should take over.
 */
var LuxSelect = (function () {
  function create(container, opts) {
    opts = opts || {};
    var items = Array.isArray(opts.options) ? opts.options.slice() : [];
    var tokens = LuxWidgetUtils.tokens(opts);
    var value = opts.value != null ? opts.value : null;
    var disabled = false;

    function _findLabel(nextValue) {
      for (var i = 0; i < items.length; i++) {
        if (items[i].value === nextValue) return items[i].label;
      }
      return null;
    }

    function _render() {
      var inputBg = LuxWidgetUtils.token(tokens, "inputBg", "transparent");
      var inputFg = LuxWidgetUtils.token(tokens, "inputFg", "currentColor");
      var inputBorder = LuxWidgetUtils.token(tokens, "inputBorder", LuxWidgetUtils.token(tokens, "border", "currentColor"));
      var cardBg = LuxWidgetUtils.token(tokens, "cardBg", inputBg);
      var cardBorder = LuxWidgetUtils.token(tokens, "cardBorder", inputBorder);
      var mutedFg = LuxWidgetUtils.token(tokens, "mutedFg", inputFg);
      var focusRing = LuxWidgetUtils.token(tokens, "focusRing", inputBorder);
      var selectedLabel = _findLabel(value);

      container.innerHTML = "";
      container.style.cssText = "display:grid;gap:8px;min-width:0;";

      if (opts.label) {
        var label = document.createElement("label");
        label.style.cssText =
          "font-family:Inter,sans-serif;font-size:14px;line-height:20px;font-weight:500;color:" + inputFg + ";";
        label.textContent = String(opts.label);
        container.appendChild(label);
      }

      var trigger = document.createElement("button");
      trigger.type = "button";
      trigger.disabled = disabled;
      trigger.setAttribute("role", "combobox");
      trigger.setAttribute("aria-expanded", "false");
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.style.cssText =
        "appearance:none;height:36px;width:100%;display:flex;align-items:center;justify-content:space-between;" +
        "gap:12px;padding:0 12px;border-radius:8px;border:1px solid " + inputBorder + ";" +
        "background:" + inputBg + ";color:" + inputFg + ";" +
        "font-family:Inter,sans-serif;font-size:14px;line-height:20px;cursor:" + (disabled ? "not-allowed" : "pointer") + ";" +
        "outline:none;opacity:" + (disabled ? "0.6" : "1") + ";";

      var text = document.createElement("span");
      text.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:" + (selectedLabel ? inputFg : mutedFg) + ";";
      text.textContent = selectedLabel || opts.placeholder || "";

      var chevron = document.createElement("span");
      chevron.setAttribute("aria-hidden", "true");
      chevron.textContent = "⌄";
      chevron.style.cssText = "color:" + mutedFg + ";";

      trigger.appendChild(text);
      trigger.appendChild(chevron);
      trigger.addEventListener("focus", function () {
        trigger.style.outline = "2px solid " + focusRing;
        trigger.style.outlineOffset = "1px";
      });
      trigger.addEventListener("blur", function () {
        trigger.style.outline = "none";
      });

      container.appendChild(trigger);

      var list = document.createElement("div");
      list.setAttribute("role", "listbox");
      list.style.cssText =
        "display:none;border:1px solid " + cardBorder + ";" +
        "border-radius:10px;background:" + cardBg + ";padding:4px;";

      items.forEach(function (item) {
        var option = document.createElement("button");
        option.type = "button";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", item.value === value ? "true" : "false");
        option.style.cssText =
          "appearance:none;width:100%;display:flex;align-items:center;justify-content:space-between;" +
          "gap:12px;padding:8px 10px;border:none;border-radius:8px;background:" +
          (item.value === value ? LuxWidgetUtils.token(tokens, "listItemSelectedBg", "transparent") : "transparent") + ";" +
          "color:" + inputFg + ";font-family:Inter,sans-serif;font-size:14px;line-height:20px;text-align:left;cursor:pointer;";
        option.textContent = item.label;
        option.addEventListener("click", function () {
          value = item.value;
          list.style.display = "none";
          trigger.setAttribute("aria-expanded", "false");
          _render();
          if (typeof opts.onChange === "function") opts.onChange(value);
        });
        list.appendChild(option);
      });

      container.appendChild(list);

      if (!disabled) {
        trigger.addEventListener("click", function () {
          var isOpen = list.style.display !== "none";
          list.style.display = isOpen ? "none" : "block";
          trigger.setAttribute("aria-expanded", isOpen ? "false" : "true");
        });
      }
    }

    _render();

    return {
      getValue: function () { return value; },
      setValue: function (nextValue) {
        value = nextValue;
        _render();
      },
      setDisabled: function (nextDisabled) {
        disabled = !!nextDisabled;
        _render();
      }
    };
  }

  return { create: create };
})();

/* lux-sparkline.js — Compact inline SVG sparkline (line or bar).
 *
 * Global: LuxSparkline
 * Usage:  LuxSparkline.render(container, points, options)
 *   points     number[]  OR  [{x, y}]
 *   options    {type?:'line'|'bar', color?, width?, height?, strokeWidth?, tokens?}
 *
 * Example:
 *   LuxSparkline.render(el, [10, 25, 18, 40, 33],
 *     { type: 'line', tokens: tokens });
 *   LuxSparkline.render(el, [{x:'Jan',y:10},{x:'Feb',y:20}],
 *     { type: 'bar', tokens: tokens });
 */
var LuxSparkline = (function () {

  /* Normalise input to plain y-value array */
  function toYValues(points) {
    if (!Array.isArray(points) || points.length === 0) return [];
    if (typeof points[0] === 'object' && points[0] !== null) {
      return points.map(function (p) { return p.y; });
    }
    return points.slice();
  }

  function render(container, points, opts) {
    opts   = opts   || {};
    points = points || [];

    var tokens      = LuxWidgetUtils.tokens(opts);
    var palette     = LuxWidgetUtils.chartPalette(tokens);

    var type        = opts.type        || 'line';
    var svgW        = opts.width       != null ? opts.width  : 80;
    var svgH        = opts.height      != null ? opts.height : 24;
    var strokeWidth = opts.strokeWidth != null ? opts.strokeWidth : 1.5;

    // Colour: explicit option wins, then chart1 token, then first palette entry
    var colour = opts.color
      ? opts.color
      : LuxWidgetUtils.token(tokens, 'chart1', palette[0] || 'currentColor');

    var ys = toYValues(points);
    var n  = ys.length;

    var pad    = 2;                          // padding so strokes don't clip
    var innerW = svgW - pad * 2;
    var innerH = svgH - pad * 2;

    var yMin = n ? Math.min.apply(null, ys) : 0;
    var yMax = n ? Math.max.apply(null, ys) : 1;
    var yRange = (yMax === yMin) ? 1 : (yMax - yMin);

    // Map a y value to SVG y coordinate (top = high values)
    function mapY(y) {
      return pad + innerH - ((y - yMin) / yRange) * innerH;
    }

    var innerSVG = '';

    if (type === 'bar') {
      var barW = n ? innerW / n : 0;
      for (var i = 0; i < n; i++) {
        var barH  = ((ys[i] - yMin) / yRange) * innerH;
        var barX  = pad + i * barW;
        var barY  = pad + innerH - barH;
        innerSVG += '<rect' +
          ' data-lux-sparkline-bar="true"' +
          ' x="' + LuxWidgetUtils.escAttr(String(+barX.toFixed(3))) + '"' +
          ' y="' + LuxWidgetUtils.escAttr(String(+barY.toFixed(3))) + '"' +
          ' width="' + LuxWidgetUtils.escAttr(String(+barW.toFixed(3))) + '"' +
          ' height="' + LuxWidgetUtils.escAttr(String(+barH.toFixed(3))) + '"' +
          ' fill="' + LuxWidgetUtils.escAttr(colour) + '"' +
          '/>';
      }
    } else {
      // Line type
      if (n > 0) {
        var stepX = n > 1 ? innerW / (n - 1) : 0;

        // Build point pairs for polyline
        var ptPairs = [];
        for (var j = 0; j < n; j++) {
          var px = pad + j * stepX;
          var py = mapY(ys[j]);
          ptPairs.push(+px.toFixed(3) + ',' + +py.toFixed(3));
        }
        var pointsAttr = ptPairs.join(' ');

        // Polyline (line)
        innerSVG += '<polyline' +
          ' data-lux-sparkline-line="true"' +
          ' points="' + LuxWidgetUtils.escAttr(pointsAttr) + '"' +
          ' fill="none"' +
          ' stroke="' + LuxWidgetUtils.escAttr(colour) + '"' +
          ' stroke-width="' + LuxWidgetUtils.escAttr(String(strokeWidth)) + '"' +
          ' stroke-linecap="round"' +
          ' stroke-linejoin="round"' +
          '/>';

        // Area fill polygon (close path to bottom corners)
        var firstX = pad;
        var lastX  = pad + (n - 1) * stepX;
        var baseY  = pad + innerH;
        var areaPts = pointsAttr +
          ' ' + +lastX.toFixed(3)  + ',' + +baseY.toFixed(3) +
          ' ' + +firstX.toFixed(3) + ',' + +baseY.toFixed(3);

        innerSVG += '<polygon' +
          ' data-lux-sparkline-area="true"' +
          ' points="' + LuxWidgetUtils.escAttr(areaPts) + '"' +
          ' fill="' + LuxWidgetUtils.escAttr(colour) + '"' +
          ' fill-opacity="0.15"' +
          '/>';
      }
    }

    // Build SVG string and inject via innerHTML (controlled, no user data in structure)
    container.innerHTML =
      '<svg data-lux-sparkline="true"' +
      ' xmlns="http://www.w3.org/2000/svg"' +
      ' width="' + LuxWidgetUtils.escAttr(String(svgW)) + '"' +
      ' height="' + LuxWidgetUtils.escAttr(String(svgH)) + '"' +
      ' viewBox="0 0 ' + LuxWidgetUtils.escAttr(String(svgW)) + ' ' + LuxWidgetUtils.escAttr(String(svgH)) + '"' +
      ' overflow="visible"' +
      '>' +
      innerSVG +
      '</svg>';
  }

  return { render: render };
})();

/* lux-stat-cards.js — KPI stat card row for dense dashboards.
 *
 * Global: LuxStatCards
 * Usage:  LuxStatCards.render(container, stats, options)
 *   stats    [{ label, value, meta?, trend?, delta?, onClick? }, ...]
 *   options  { columns?, minCardWidth?, tokens? }
 *
 * trend: if starts with +/↑ → ↑ arrow in semanticSuccessFg
 *        if starts with -/↓ → ↓ arrow in semanticErrorFg
 *        else → plain text in mutedFg
 * delta: optional small muted subtitle below the value
 * onClick: optional click handler; adds role=button, tabIndex=0
 */
var LuxStatCards = (function () {
  function render(container, stats, opts) {
    opts = opts || {};
    var items = Array.isArray(stats) ? stats : [];
    var tokens = LuxWidgetUtils.tokens(opts);
    var columns = opts.columns || items.length || 1;
    var minCardWidth = opts.minCardWidth || "180px";
    var cardBg = LuxWidgetUtils.token(tokens, "cardBg", "transparent");
    var cardFg = LuxWidgetUtils.token(tokens, "cardFg", "currentColor");
    var cardBorder = LuxWidgetUtils.token(tokens, "cardBorder", LuxWidgetUtils.token(tokens, "border", "currentColor"));
    var mutedFg = LuxWidgetUtils.token(tokens, "mutedFg", "currentColor");
    var valueFg = LuxWidgetUtils.token(tokens, "accentFg", cardFg);
    var successFg = LuxWidgetUtils.token(tokens, "semanticSuccessFg", "currentColor");
    var errorFg = LuxWidgetUtils.token(tokens, "semanticErrorFg", "currentColor");

    container.innerHTML = "";
    container.style.cssText =
      "display:grid;gap:16px;" +
      "grid-template-columns:repeat(" + columns + ", minmax(" + minCardWidth + ", 1fr));";

    items.forEach(function (item) {
      var card = document.createElement("section");
      card.setAttribute("data-lux-stat-card", "true");
      var cardCss =
        "display:flex;flex-direction:column;gap:8px;" +
        "min-width:0;padding:16px;" +
        "border:1px solid " + cardBorder + ";" +
        "border-radius:10px;background:" + cardBg + ";color:" + cardFg + ";";

      if (typeof item.onClick === "function") {
        card.setAttribute("data-lux-stat-card-clickable", "true");
        card.setAttribute("role", "button");
        card.setAttribute("tabindex", "0");
        cardCss += "cursor:pointer;";

        (function (cb) {
          card.addEventListener("click", function () { cb(); });
          card.addEventListener("keydown", function (evt) {
            if (evt.key === "Enter" || evt.key === " ") { evt.preventDefault(); cb(); }
          });
        }(item.onClick));
      }

      card.style.cssText = cardCss;

      var label = document.createElement("div");
      label.style.cssText =
        "font-family:Inter,sans-serif;font-size:12px;line-height:16px;font-weight:500;color:" + mutedFg + ";";
      label.textContent = item.label == null ? "" : String(item.label);

      var value = document.createElement("div");
      value.style.cssText =
        "font-family:Inter,sans-serif;font-size:28px;line-height:32px;font-weight:300;color:" + valueFg + ";";
      value.textContent = item.value == null ? "" : String(item.value);

      card.appendChild(label);
      card.appendChild(value);

      // delta — small muted subtitle below value
      if (item.delta != null) {
        var delta = document.createElement("div");
        delta.style.cssText =
          "font-family:Inter,sans-serif;font-size:11px;line-height:16px;color:" + mutedFg + ";";
        delta.textContent = String(item.delta);
        card.appendChild(delta);
      }

      if (item.meta != null || item.trend != null) {
        var meta = document.createElement("div");
        meta.style.cssText =
          "display:flex;align-items:center;justify-content:space-between;gap:12px;" +
          "font-family:Inter,sans-serif;font-size:12px;line-height:16px;color:" + mutedFg + ";";

        var metaText = document.createElement("span");
        metaText.textContent = item.meta == null ? "" : String(item.meta);
        meta.appendChild(metaText);

        if (item.trend != null) {
          var trendStr = String(item.trend);
          var firstChar = trendStr.charAt(0);
          var isUp = firstChar === "+" || firstChar === "↑";
          var isDown = firstChar === "-" || firstChar === "↓";

          // arrow span
          var arrow = document.createElement("span");
          if (isUp) {
            arrow.setAttribute("data-lux-stat-trend", "up");
            arrow.style.color = successFg;
            arrow.textContent = "↑";
          } else if (isDown) {
            arrow.setAttribute("data-lux-stat-trend", "down");
            arrow.style.color = errorFg;
            arrow.textContent = "↓";
          } else {
            arrow.style.color = mutedFg;
          }

          // trend text span
          var trendText = document.createElement("span");
          trendText.textContent = trendStr;

          var trendWrap = document.createElement("span");
          trendWrap.style.cssText = "display:inline-flex;align-items:center;gap:2px;";
          trendWrap.appendChild(arrow);
          trendWrap.appendChild(trendText);
          meta.appendChild(trendWrap);
        }

        card.appendChild(meta);
      }

      container.appendChild(card);
    });
  }

  return { render: render };
})();

/* lux-status-badge.js — Semantic status badges for ERP states.
 *
 * Global: LuxStatusBadge
 * Usage:  LuxStatusBadge.render(container, badge, options) → HTMLElement
 *   badge    { label, tone?, icon? }
 *   options  { tokens? }
 */
var LuxStatusBadge = (function () {
  var _cssInjected = false;

  function render(container, badge, opts) {
    opts = opts || {};
    badge = badge || {};
    var tone = badge.tone || "neutral";
    var tokens = LuxWidgetUtils.tokens(opts);
    var palette = _tonePalette(tone, tokens);
    _ensureCss();

    container.innerHTML = "";

    var el = document.createElement("span");
    el.setAttribute("data-lux-status-badge", "true");
    el.style.cssText =
      "display:inline-flex;align-items:center;gap:6px;" +
      "min-height:24px;padding:2px 8px;" +
      "border-radius:9999px;border:1px solid " + palette.border + ";" +
      "background:" + palette.bg + ";color:" + palette.fg + ";" +
      "font-family:JetBrains Mono,ui-monospace,monospace;font-size:12px;line-height:16px;font-weight:500;";

    if (badge.icon) {
      var icon = document.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      icon.style.cssText = "font-size:12px;line-height:1;";
      icon.textContent = badge.icon;
      el.appendChild(icon);
    } else if (tone === "processing") {
      var spinner = document.createElement("span");
      spinner.setAttribute("aria-hidden", "true");
      spinner.style.cssText =
        "display:inline-block;width:12px;height:12px;border-radius:9999px;" +
        "border:2px solid " + LuxWidgetUtils.token(tokens, "spinnerTrack", palette.border) + ";" +
        "border-top-color:" + LuxWidgetUtils.token(tokens, "spinnerArc", palette.fg) + ";" +
        "animation:_lux-status-badge-spin 1s linear infinite;";
      el.appendChild(spinner);
    }

    var label = document.createElement("span");
    label.textContent = badge.label || "";
    el.appendChild(label);
    container.appendChild(el);
    return el;
  }

  function _ensureCss() {
    if (_cssInjected) return;
    _cssInjected = true;
    var style = document.createElement("style");
    style.textContent =
      "@keyframes _lux-status-badge-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}" +
      "@media (prefers-reduced-motion: reduce){" +
      "[data-lux-status-badge='true'] span{animation:none!important}" +
      "}";
    document.head.appendChild(style);
  }

  function _tonePalette(tone, tokens) {
    if (tone === "success") {
      return {
        bg: LuxWidgetUtils.token(tokens, "semanticSuccessBg", "transparent"),
        fg: LuxWidgetUtils.token(tokens, "semanticSuccessFg", "currentColor"),
        border: LuxWidgetUtils.token(tokens, "semanticSuccessBorder", LuxWidgetUtils.token(tokens, "semanticSuccessBg", "currentColor"))
      };
    }
    if (tone === "warning") {
      return {
        bg: LuxWidgetUtils.token(tokens, "semanticWarningBg", "transparent"),
        fg: LuxWidgetUtils.token(tokens, "semanticWarningFg", "currentColor"),
        border: LuxWidgetUtils.token(tokens, "semanticWarningBorder", LuxWidgetUtils.token(tokens, "semanticWarningBg", "currentColor"))
      };
    }
    if (tone === "error") {
      return {
        bg: LuxWidgetUtils.token(tokens, "semanticErrorBg", "transparent"),
        fg: LuxWidgetUtils.token(tokens, "semanticErrorFg", "currentColor"),
        border: LuxWidgetUtils.token(tokens, "semanticErrorBorder", LuxWidgetUtils.token(tokens, "semanticErrorBg", "currentColor"))
      };
    }
    if (tone === "info") {
      return {
        bg: LuxWidgetUtils.token(tokens, "semanticInfoBg", "transparent"),
        fg: LuxWidgetUtils.token(tokens, "semanticInfoFg", "currentColor"),
        border: LuxWidgetUtils.token(tokens, "semanticInfoBorder", LuxWidgetUtils.token(tokens, "semanticInfoBg", "currentColor"))
      };
    }
    if (tone === "processing") {
      return {
        bg: LuxWidgetUtils.token(tokens, "baseStatusProcessingBg", "transparent"),
        fg: LuxWidgetUtils.token(tokens, "baseStatusProcessingFg", "currentColor"),
        border: LuxWidgetUtils.token(tokens, "baseStatusProcessingBorder", LuxWidgetUtils.token(tokens, "border", "currentColor"))
      };
    }
    return {
      bg: LuxWidgetUtils.token(tokens, "badgeBg", "transparent"),
      fg: LuxWidgetUtils.token(tokens, "badgeFg", "currentColor"),
      border: LuxWidgetUtils.token(tokens, "badgeBorder", LuxWidgetUtils.token(tokens, "border", "currentColor"))
    };
  }

  return { render: render };
})();

/* lux-stepper.js — Horizontal step progress indicator.
 *
 * Global: LuxStepper
 * Usage:  LuxStepper.create(container, steps, options)  →  { setStep, getStep }
 *   steps      ['Step 1', 'Step 2', ...]  (labels)
 *   options    {activeStep?, tokens?}  (0-based index, default 0)
 *
 * Example:
 *   const stepper = LuxStepper.create(el, ['Customer', 'Parts', 'AI Brief'], { activeStep: 0 });
 *   stepper.setStep(1);  // advance to second step
 *   const currentStep = stepper.getStep(); // 1
 */
var LuxStepper = (function () {
  var CIRCLE_SIZE     = 28;

  function _clearContainer(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function _render(container, steps, activeStep, tokens) {
    _clearContainer(container);
    var activeBg = LuxWidgetUtils.token(tokens, 'stepActiveBg', LuxWidgetUtils.token(tokens, 'buttonPrimaryBg', 'currentColor'));
    var activeFg = LuxWidgetUtils.token(tokens, 'stepActiveFg', LuxWidgetUtils.token(tokens, 'buttonPrimaryFg', 'currentColor'));
    var doneBg = LuxWidgetUtils.token(tokens, 'stepDoneBg', LuxWidgetUtils.token(tokens, 'chart2', 'currentColor'));
    var doneFg = LuxWidgetUtils.token(tokens, 'stepDoneFg', activeFg);
    var futureBorder = LuxWidgetUtils.token(tokens, 'stepFutureBorder', LuxWidgetUtils.token(tokens, 'border', 'currentColor'));
    var futureFg = LuxWidgetUtils.token(tokens, 'stepFutureFg', LuxWidgetUtils.token(tokens, 'mutedFg', 'currentColor'));
    var futureBg = LuxWidgetUtils.token(tokens, 'stepFutureBg', 'transparent');

    var wrapper = document.createElement('div');
    wrapper.style.cssText =
      'display:flex;align-items:flex-start;justify-content:space-between;' +
      'width:100%;padding:8px 0;';

    for (var i = 0; i < steps.length; i++) {
      var isDone   = i < activeStep;
      var isActive = i === activeStep;

      // Step item wrapper (circle + label, stacked)
      var item = document.createElement('div');
      item.style.cssText =
        'display:flex;flex-direction:column;align-items:center;' +
        'position:relative;flex:1;';

      // Left connector (not for first item)
      if (i > 0) {
        var leftLine = document.createElement('div');
        var leftDone = i <= activeStep;
        leftLine.style.cssText =
          'position:absolute;top:' + (CIRCLE_SIZE / 2) + 'px;' +
          'left:0;width:50%;height:2px;' +
          'background:' + (leftDone ? doneBg : futureBorder) + ';' +
          'transform:translateY(-50%);';
        item.appendChild(leftLine);
      }

      // Right connector (not for last item)
      if (i < steps.length - 1) {
        var rightLine = document.createElement('div');
        var rightDone = i < activeStep;
        rightLine.style.cssText =
          'position:absolute;top:' + (CIRCLE_SIZE / 2) + 'px;' +
          'right:0;width:50%;height:2px;' +
          'background:' + (rightDone ? doneBg : futureBorder) + ';' +
          'transform:translateY(-50%);';
        item.appendChild(rightLine);
      }

      // Circle
      var circle = document.createElement('div');
      circle.setAttribute('data-lux-stepper-circle', 'true');
      var circleBg, circleBorder, circleColor;
      if (isActive) {
        circleBg     = activeBg;
        circleBorder = activeBg;
        circleColor  = activeFg;
      } else if (isDone) {
        circleBg     = doneBg;
        circleBorder = doneBg;
        circleColor  = doneFg;
      } else {
        circleBg     = futureBg;
        circleBorder = futureBorder;
        circleColor  = futureFg;
      }

      circle.style.cssText =
        'width:' + CIRCLE_SIZE + 'px;height:' + CIRCLE_SIZE + 'px;' +
        'border-radius:50%;' +
        'background:' + circleBg + ';' +
        'border:2px solid ' + circleBorder + ';' +
        'color:' + circleColor + ';' +
        'display:flex;align-items:center;justify-content:center;' +
        'font-family:Inter,sans-serif;font-size:13px;font-weight:600;' +
        'position:relative;z-index:1;flex-shrink:0;';

      circle.textContent = isDone ? '✓' : String(i + 1);

      // Label
      var label = document.createElement('div');
      label.style.cssText =
        'font-family:Inter,sans-serif;font-size:12px;margin-top:6px;' +
        'text-align:center;' +
        'font-weight:' + (isActive ? '700' : '400') + ';' +
        'color:' + (isActive ? 'currentColor' : (isDone ? 'currentColor' : futureFg)) + ';';
      label.textContent = steps[i];

      item.appendChild(circle);
      item.appendChild(label);
      wrapper.appendChild(item);
    }

    container.appendChild(wrapper);
  }

  function create(container, steps, opts) {
    opts = opts || {};
    var _active = opts.activeStep != null ? opts.activeStep : 0;
    var tokens = LuxWidgetUtils.tokens(opts);

    _render(container, steps, _active, tokens);

    function setStep(n) {
      _active = n;
      _render(container, steps, _active, tokens);
    }

    function getStep() {
      return _active;
    }

    return {
      setStep: setStep,
      getStep: getStep,
    };
  }

  return { create: create };
})();

/* lux-tabs.js — Accessible tabs for related in-place views.
 *
 * Global: LuxTabs
 * Usage:  LuxTabs.create(container, tabs, options) → { getActive, setActive, onChange }
 *   tabs     [{ id, label, content? }, ...]
 *   options  { activeId?, size?, tokens? }
 *
 * Sizes:
 *   - large  → underline-style professional page tabs
 *   - medium → bordered buttons with filled active state
 *   - small  → segmented control inside a shared container
 */
var LuxTabs = (function () {
  function create(container, tabs, opts) {
    opts = opts || {};
    var items = Array.isArray(tabs) ? tabs.slice() : [];
    var tokens = LuxWidgetUtils.tokens(opts);
    var size = opts.size || "large";
    var listeners = [];
    var activeId = _initialActiveId(items, opts);

    function _emit(id) {
      listeners.forEach(function (listener) { listener(id); });
    }

    function _focusByOffset(currentIndex, offset) {
      var nextIndex = currentIndex + offset;
      if (nextIndex < 0) nextIndex = items.length - 1;
      if (nextIndex >= items.length) nextIndex = 0;
      var buttons = container.querySelectorAll('[role="tab"]');
      var next = buttons[nextIndex];
      if (next && typeof next.focus === "function") next.focus();
    }

    function _activate(id) {
      if (id === activeId) return;
      activeId = id;
      _render();
      _emit(id);
    }

    function _render() {
      var border = LuxWidgetUtils.token(tokens, "border", "currentColor");
      var panelBg = LuxWidgetUtils.token(tokens, "cardBg", "transparent");
      var panelFg = LuxWidgetUtils.token(tokens, "cardFg", "currentColor");
      var panelBorder = LuxWidgetUtils.token(tokens, "cardBorder", border);
      var focusRing = LuxWidgetUtils.token(tokens, "focusRing", border);
      var panelRadius = size === "large" ? "0 0 10px 10px" : "10px";
      var tabStyles = _stylesForSize(size, tokens, border);
      var activeIndex = _findIndex(items, activeId);
      var activeItem = activeIndex >= 0 ? items[activeIndex] : null;

      container.innerHTML = "";

      var tablist = document.createElement("div");
      tablist.setAttribute("role", "tablist");
      tablist.setAttribute("aria-label", opts["ariaLabel"] || "Views");
      tablist.style.cssText =
        "display:flex;gap:" + tabStyles.gap + ";" +
        "align-items:stretch;flex-wrap:wrap;" +
        "border-bottom:" + tabStyles.tablistBorderBottom + ";" +
        "background:" + tabStyles.tablistBg + ";" +
        "border:" + tabStyles.tablistBorder + ";" +
        "border-radius:" + tabStyles.tablistRadius + ";" +
        "padding:" + tabStyles.tablistPadding + ";";

      items.forEach(function (item, index) {
        var isActive = item.id === activeId;
        var button = document.createElement("button");
        var panelId = "lux-tab-panel-" + item.id;
        var tabId = "lux-tab-" + item.id;
        button.type = "button";
        button.id = tabId;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", isActive ? "true" : "false");
        button.setAttribute("aria-controls", panelId);
        button.tabIndex = isActive ? 0 : -1;
        button.style.cssText =
          "appearance:none;border:" + (isActive ? tabStyles.activeBorder : tabStyles.inactiveBorder) + ";" +
          "border-bottom:" + (isActive ? tabStyles.activeBorderBottom : tabStyles.inactiveBorderBottom) + ";" +
          "background:" + (isActive ? tabStyles.activeBg : tabStyles.inactiveBg) + ";" +
          "color:" + (isActive ? tabStyles.activeFg : tabStyles.inactiveFg) + ";" +
          "border-radius:" + tabStyles.tabRadius + ";" +
          "padding:" + tabStyles.tabPadding + ";" +
          "font:inherit;font-size:14px;line-height:20px;font-weight:" + (isActive ? "600" : "500") + ";" +
          "cursor:pointer;white-space:nowrap;outline:none;";
        button.textContent = item.label;
        button.addEventListener("click", function () { _activate(item.id); });
        button.addEventListener("focus", function () {
          button.style.outline = "2px solid " + focusRing;
          button.style.outlineOffset = "1px";
        });
        button.addEventListener("blur", function () {
          button.style.outline = "none";
        });
        button.addEventListener("keydown", function (event) {
          if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            event.preventDefault();
            _focusByOffset(index, 1);
            return;
          }
          if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
            event.preventDefault();
            _focusByOffset(index, -1);
            return;
          }
          if (event.key === "Home") {
            event.preventDefault();
            var first = container.querySelector('[role="tab"]');
            if (first && typeof first.focus === "function") first.focus();
            return;
          }
          if (event.key === "End") {
            event.preventDefault();
            var all = container.querySelectorAll('[role="tab"]');
            var last = all[all.length - 1];
            if (last && typeof last.focus === "function") last.focus();
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            _activate(item.id);
          }
        });
        tablist.appendChild(button);
      });

      container.appendChild(tablist);

      if (!activeItem) return;

      var panel = document.createElement("div");
      panel.id = "lux-tab-panel-" + activeItem.id;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", "lux-tab-" + activeItem.id);
      panel.style.cssText =
        "background:" + panelBg + ";" +
        "color:" + panelFg + ";" +
        "border:1px solid " + panelBorder + ";" +
        "border-top:" + (size === "large" ? "none" : "1px solid " + panelBorder) + ";" +
        "border-radius:" + panelRadius + ";" +
        "padding:16px;margin-top:" + (size === "large" ? "0" : "12px") + ";";

      if (typeof activeItem.render === "function") {
        activeItem.render(panel, activeItem);
      } else if (activeItem.content != null) {
        panel.textContent = String(activeItem.content);
      }

      container.appendChild(panel);
    }

    _render();

    return {
      getActive: function () { return activeId; },
      setActive: function (id) {
        if (_findIndex(items, id) === -1) return;
        _activate(id);
      },
      onChange: function (fn) {
        if (typeof fn === "function") listeners.push(fn);
      }
    };
  }

  function _initialActiveId(items, opts) {
    if (opts.activeId && _findIndex(items, opts.activeId) !== -1) return opts.activeId;
    return items.length ? items[0].id : null;
  }

  function _findIndex(items, id) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) return i;
    }
    return -1;
  }

  function _stylesForSize(size, tokens, border) {
    if (size === "small") {
      return {
        gap: "4px",
        tablistBg: LuxWidgetUtils.token(tokens, "tabSmallContainerBg", "transparent"),
        tablistBorder: "1px solid " + LuxWidgetUtils.token(tokens, "tabSmallContainerBorder", border),
        tablistBorderBottom: "none",
        tablistRadius: "9999px",
        tablistPadding: "4px",
        activeBg: LuxWidgetUtils.token(tokens, "tabSmallSelectedBg", "transparent"),
        activeFg: LuxWidgetUtils.token(tokens, "tabSmallSelectedFg", "currentColor"),
        inactiveBg: LuxWidgetUtils.token(tokens, "tabSmallUnselectedBg", "transparent"),
        inactiveFg: LuxWidgetUtils.token(tokens, "tabSmallUnselectedFg", "currentColor"),
        activeBorder: "1px solid " + LuxWidgetUtils.token(tokens, "tabSmallSelectedBorder", "transparent"),
        inactiveBorder: "1px solid transparent",
        activeBorderBottom: "1px solid " + LuxWidgetUtils.token(tokens, "tabSmallSelectedBorder", "transparent"),
        inactiveBorderBottom: "1px solid transparent",
        tabRadius: "9999px",
        tabPadding: "8px 12px"
      };
    }

    if (size === "medium") {
      return {
        gap: "8px",
        tablistBg: "transparent",
        tablistBorder: "none",
        tablistBorderBottom: "none",
        tablistRadius: "0",
        tablistPadding: "0",
        activeBg: LuxWidgetUtils.token(tokens, "tabMediumSelectedBg", "transparent"),
        activeFg: LuxWidgetUtils.token(tokens, "tabMediumSelectedFg", "currentColor"),
        inactiveBg: LuxWidgetUtils.token(tokens, "tabMediumUnselectedBg", "transparent"),
        inactiveFg: LuxWidgetUtils.token(tokens, "tabMediumUnselectedFg", "currentColor"),
        activeBorder: "1px solid " + LuxWidgetUtils.token(tokens, "tabMediumSelectedBorder", border),
        inactiveBorder: "1px solid " + LuxWidgetUtils.token(tokens, "tabMediumUnselectedBorder", border),
        activeBorderBottom: "1px solid " + LuxWidgetUtils.token(tokens, "tabMediumSelectedBorder", border),
        inactiveBorderBottom: "1px solid " + LuxWidgetUtils.token(tokens, "tabMediumUnselectedBorder", border),
        tabRadius: "9999px",
        tabPadding: "8px 14px"
      };
    }

    return {
      gap: "0",
      tablistBg: "transparent",
      tablistBorder: "none",
      tablistBorderBottom: "1px solid " + border,
      tablistRadius: "0",
      tablistPadding: "0",
      activeBg: LuxWidgetUtils.token(tokens, "tabLargeSelectedBg", "transparent"),
      activeFg: LuxWidgetUtils.token(tokens, "tabLargeSelectedFg", "currentColor"),
      inactiveBg: LuxWidgetUtils.token(tokens, "tabLargeUnselectedBg", "transparent"),
      inactiveFg: LuxWidgetUtils.token(tokens, "tabLargeUnselectedFg", "currentColor"),
      activeBorder: "none",
      inactiveBorder: "none",
      activeBorderBottom: "2px solid " + LuxWidgetUtils.token(tokens, "tabLargeSelectedBorder", border),
      inactiveBorderBottom: "2px solid transparent",
      tabRadius: "0",
      tabPadding: "10px 14px"
    };
  }

  return { create: create };
})();

/* lux-text-input.js — Single-line text input with label and error state.
 *
 * Global: LuxTextInput
 * Usage:  LuxTextInput.create(container, options) → api
 *   options { label?, placeholder?, value?, type?, errorMessage?,
 *             disabled?, onChange?, tokens? }
 *
 * API: getValue(), setValue(v), setError(msg|null), setDisabled(bool),
 *      onChange(fn)
 */
var LuxTextInput = (function () {

  function create(container, opts) {
    opts = opts || {};
    var label        = opts.label        || '';
    var placeholder  = opts.placeholder  || '';
    var initialValue = opts.value        != null ? String(opts.value) : '';
    var inputType    = opts.type         || 'text';
    var errorMessage = opts.errorMessage || '';
    var disabled     = opts.disabled     || false;
    var tokens       = LuxWidgetUtils.tokens(opts);

    var inputBg          = LuxWidgetUtils.token(tokens, 'inputBg',          LuxWidgetUtils.token(tokens, 'cardBg',      'Canvas'));
    var inputFg          = LuxWidgetUtils.token(tokens, 'inputFg',          LuxWidgetUtils.token(tokens, 'cardFg',      'CanvasText'));
    var inputBorder      = LuxWidgetUtils.token(tokens, 'inputBorder',      LuxWidgetUtils.token(tokens, 'border',      'currentColor'));
    var inputErrorBorder = LuxWidgetUtils.token(tokens, 'inputErrorBorder', LuxWidgetUtils.token(tokens, 'statusError', 'currentColor'));
    var inputErrorFg     = LuxWidgetUtils.token(tokens, 'inputErrorFg',     LuxWidgetUtils.token(tokens, 'statusError', 'currentColor'));
    var labelFg          = LuxWidgetUtils.token(tokens, 'labelFg',          LuxWidgetUtils.token(tokens, 'mutedFg',     'currentColor'));
    var focusRing        = LuxWidgetUtils.token(tokens, 'focusRing',        LuxWidgetUtils.token(tokens, 'border',      'currentColor'));

    // Build DOM
    var wrapper = document.createElement('div');
    wrapper.setAttribute('data-lux-text-input', 'true');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.gap = '4px';
    wrapper.style.fontFamily = 'Inter, sans-serif';
    wrapper.style.fontSize = '14px';

    var labelEl = document.createElement('label');
    labelEl.style.fontSize = '13px';
    labelEl.style.fontWeight = '500';
    labelEl.style.color = labelFg;
    labelEl.style.display = label ? 'block' : 'none';
    labelEl.textContent = label;

    var inputEl = document.createElement('input');
    inputEl.type = inputType;
    inputEl.value = initialValue;
    inputEl.placeholder = placeholder;
    inputEl.disabled = disabled;
    inputEl.style.background = inputBg;
    inputEl.style.color = inputFg;
    inputEl.style.border = '1px solid ' + inputBorder;
    inputEl.style.borderRadius = '8px';
    inputEl.style.padding = '6px 10px';
    inputEl.style.fontFamily = 'Inter, sans-serif';
    inputEl.style.fontSize = '14px';
    inputEl.style.outline = 'none';
    inputEl.style.width = '100%';
    inputEl.style.boxSizing = 'border-box';

    var errorEl = document.createElement('div');
    errorEl.setAttribute('data-lux-input-error', 'true');
    errorEl.style.fontSize = '12px';
    errorEl.style.color = inputErrorFg;
    errorEl.style.display = 'none';

    wrapper.appendChild(labelEl);
    wrapper.appendChild(inputEl);
    wrapper.appendChild(errorEl);
    container.appendChild(wrapper);

    // Focus styles via events
    inputEl.addEventListener('focus', function () {
      inputEl.style.outline = '2px solid ' + focusRing;
      inputEl.style.outlineOffset = '1px';
    });
    inputEl.addEventListener('blur', function () {
      inputEl.style.outline = 'none';
    });

    // Initial error state
    var _hasError = false;
    if (errorMessage) {
      _applyError(errorMessage);
    }

    // onChange handlers list
    var _changeHandlers = [];
    if (typeof opts.onChange === 'function') {
      _changeHandlers.push(opts.onChange);
    }

    inputEl.addEventListener('input', function () {
      for (var i = 0; i < _changeHandlers.length; i++) {
        _changeHandlers[i](inputEl.value);
      }
    });

    function _applyError(msg) {
      _hasError = !!msg;
      if (msg) {
        errorEl.textContent = msg;
        errorEl.style.display = 'block';
        inputEl.style.borderColor = inputErrorBorder;
      } else {
        errorEl.textContent = '';
        errorEl.style.display = 'none';
        inputEl.style.borderColor = inputBorder;
      }
    }

    return {
      getValue: function () { return inputEl.value; },
      setValue: function (v) { inputEl.value = v; },
      setError: function (msg) { _applyError(msg); },
      setDisabled: function (bool) { inputEl.disabled = !!bool; },
      onChange: function (fn) { _changeHandlers.push(fn); },
    };
  }

  return { create: create };
})();

/* lux-timeline.js — DOM-based vertical timeline widget.
 *
 * Global: LuxTimeline
 * Usage:  LuxTimeline.render(container, items, options)  →  { append, clear }
 *   items      [{date, label, description?, tone?, icon?}, ...]
 *              tone: 'neutral'|'info'|'success'|'warning'|'error'
 *   options    {title?, maxHeight?, tokens?}
 *
 * Example:
 *   const tl = LuxTimeline.render(el, [
 *     { date: '2026-06-01', label: 'Order Created', description: 'PO-001', tone: 'success' },
 *     { date: '2026-06-05', label: 'Shipped', tone: 'info' },
 *   ], { title: 'Order History', tokens: tokens });
 *   tl.append({ date: '2026-06-10', label: 'Delivered', tone: 'success' });
 *   tl.clear();
 */
var LuxTimeline = (function () {

  function toneColour(tone, tokens) {
    if (tone === 'success') { return LuxWidgetUtils.token(tokens, 'semanticSuccessFg', 'currentColor'); }
    if (tone === 'warning') { return LuxWidgetUtils.token(tokens, 'semanticWarningFg', 'currentColor'); }
    if (tone === 'error')   { return LuxWidgetUtils.token(tokens, 'semanticErrorFg', 'currentColor'); }
    if (tone === 'info')    { return LuxWidgetUtils.token(tokens, 'semanticInfoFg', 'currentColor'); }
    return LuxWidgetUtils.token(tokens, 'mutedFg', 'GrayText'); // neutral / default
  }

  function buildItem(item, isLast, tokens) {
    var mutedFg  = LuxWidgetUtils.token(tokens, 'mutedFg', 'GrayText');
    var cardFg   = LuxWidgetUtils.token(tokens, 'cardFg', 'CanvasText');
    var border   = LuxWidgetUtils.token(tokens, 'border',   'currentColor');
    var dotColor = toneColour(item.tone || 'neutral', tokens);

    // Outer item wrapper
    var itemEl = document.createElement('div');
    itemEl.setAttribute('data-lux-timeline-item', 'true');
    itemEl.style.cssText = 'display:flex;gap:12px;position:relative;';

    // Stem column (dot + line)
    var stem = document.createElement('div');
    stem.setAttribute('data-lux-timeline-stem', 'true');
    stem.style.cssText = 'display:flex;flex-direction:column;align-items:center;flex-shrink:0;width:24px;';

    var dot = document.createElement('div');
    dot.setAttribute('data-lux-timeline-dot', 'true');
    dot.style.cssText = 'width:10px;height:10px;border-radius:50%;background:' + dotColor +
      ';flex-shrink:0;margin-top:4px;';

    stem.appendChild(dot);

    if (!isLast) {
      var line = document.createElement('div');
      line.setAttribute('data-lux-timeline-line', 'true');
      line.style.cssText = 'flex:1;width:2px;background:' + border + ';min-height:16px;';
      stem.appendChild(line);
    }

    itemEl.appendChild(stem);

    // Content column
    var content = document.createElement('div');
    content.style.cssText = 'padding-bottom:16px;flex:1;';

    var dateEl = document.createElement('div');
    dateEl.style.cssText = 'font-size:11px;color:' + mutedFg + ';font-family:Inter,sans-serif;';
    dateEl.textContent = item.date || '';

    var labelEl = document.createElement('div');
    labelEl.style.cssText = 'font-size:13px;font-weight:600;color:' + cardFg + ';font-family:Inter,sans-serif;';
    labelEl.textContent = item.label || '';

    content.appendChild(dateEl);
    content.appendChild(labelEl);

    if (item.description) {
      var descEl = document.createElement('div');
      descEl.style.cssText = 'font-size:12px;color:' + mutedFg + ';font-family:Inter,sans-serif;';
      descEl.textContent = item.description;
      content.appendChild(descEl);
    }

    itemEl.appendChild(content);
    return itemEl;
  }

  function render(container, items, opts) {
    opts  = opts  || {};
    items = items || [];

    var title     = opts.title     || '';
    var maxHeight = opts.maxHeight || null;
    var tokens    = LuxWidgetUtils.tokens(opts);
    var cardFg    = LuxWidgetUtils.token(tokens, 'cardFg', 'CanvasText');

    // Clear container
    while (container.firstChild) { container.removeChild(container.firstChild); }

    // Outer wrapper
    var wrapper = document.createElement('div');
    wrapper.setAttribute('data-lux-timeline', 'true');
    wrapper.style.cssText = 'display:flex;flex-direction:column;gap:0;font-family:Inter,sans-serif;';
    if (maxHeight) {
      wrapper.style.overflowY = 'auto';
      wrapper.style.maxHeight = typeof maxHeight === 'number' ? maxHeight + 'px' : maxHeight;
    }

    // Optional title
    if (title) {
      var titleEl = document.createElement('div');
      titleEl.style.cssText = 'font-size:14px;font-weight:600;color:' + cardFg +
        ';margin-bottom:12px;font-family:Inter,sans-serif;';
      titleEl.textContent = title;
      wrapper.appendChild(titleEl);
    }

    // Items list container — used by append/clear
    var list = document.createElement('div');
    list.setAttribute('data-lux-timeline-list', 'true');
    wrapper.appendChild(list);

    // Render initial items
    for (var i = 0; i < items.length; i++) {
      var isLast = i === items.length - 1;
      list.appendChild(buildItem(items[i], isLast, tokens));
    }

    container.appendChild(wrapper);

    // ── API ─────────────────────────────────────────────────────────────────

    function refreshLastLine() {
      // After structural changes, ensure only the last item lacks a line.
      var allItems = list.querySelectorAll('[data-lux-timeline-item]');
      for (var j = 0; j < allItems.length; j++) {
        var isLastItem = (j === allItems.length - 1);
        var stem = allItems[j].querySelector('[data-lux-timeline-stem]');
        if (!stem) { continue; }
        var existingLine = stem.querySelector('[data-lux-timeline-line]');
        if (isLastItem && existingLine) {
          stem.removeChild(existingLine);
        } else if (!isLastItem && !existingLine) {
          var border = LuxWidgetUtils.token(tokens, 'border', 'currentColor');
          var newLine = document.createElement('div');
          newLine.setAttribute('data-lux-timeline-line', 'true');
          newLine.style.cssText = 'flex:1;width:2px;background:' + border + ';min-height:16px;';
          stem.appendChild(newLine);
        }
      }
    }

    function append(item) {
      // Previous last item now needs a connector line — refreshLastLine handles it after append.
      var newEl = buildItem(item, true, tokens);
      list.appendChild(newEl);
      refreshLastLine();
    }

    function clear() {
      while (list.firstChild) { list.removeChild(list.firstChild); }
    }

    return { append: append, clear: clear };
  }

  return { render: render };
})();

/* lux-toast.js — Non-blocking toast notifications.
 *
 * Global: LuxToast
 * Usage:  LuxToast.show(options) → { dismiss() }
 *   options  { message, type?, duration?, tokens? }
 *     type      'info' (default) | 'success' | 'error' | 'warning'
 *     duration  ms before auto-dismiss; 0 = stays until closed (default 3000)
 *
 * Toasts stack in the bottom-right corner of the document (outside shadow DOM).
 * Each toast has a close button and can be programmatically dismissed.
 *
 * Example:
 *   LuxToast.show({ message: 'Saved!', type: 'success' });
 *   LuxToast.show({ message: 'Something went wrong', type: 'error', duration: 0 });
 *   const t = LuxToast.show({ message: 'Loading…', type: 'info', duration: 0 });
 *   t.dismiss(); // programmatic close
 */
var LuxToast = (function () {
  var ICONS = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };

  var _host = null;
  var _cssInjected = false;

  function show(opts) {
    if (typeof opts === 'string') opts = { message: opts };
    var type     = opts.type     || 'info';
    var message  = opts.message  || '';
    var duration = opts.duration != null ? opts.duration : 3000;
    var tokens   = LuxWidgetUtils.tokens(opts);

    _ensure();

    var prefix = type === 'success' || type === 'error' || type === 'warning' ? type : 'info';
    var bg = LuxWidgetUtils.token(tokens, 'toastBg', 'transparent');
    var fg = LuxWidgetUtils.token(tokens, 'toastFg', 'currentColor');
    var border = LuxWidgetUtils.token(tokens, prefix + 'Border', LuxWidgetUtils.token(tokens, 'border', 'currentColor'));
    var closeFg = LuxWidgetUtils.token(tokens, 'toastMutedFg', LuxWidgetUtils.token(tokens, 'mutedFg', 'currentColor'));
    var toast = document.createElement('div');
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    toast.style.cssText = 'display:flex;align-items:center;gap:8px;' +
      'background:' + bg + ';color:' + fg + ';' +
      'border-left:4px solid ' + border + ';' +
      'border-radius:8px;padding:10px 14px;' +
      'font-size:14px;font-family:inherit;' +
      'min-width:220px;max-width:380px;' +
      'transition:opacity 0.2s,transform 0.2s;' +
      'animation:_lux-toast-in 0.2s ease;pointer-events:auto;';

    var icon = document.createElement('span');
    icon.style.cssText = 'font-size:16px;flex-shrink:0;';
    icon.textContent = ICONS[type] || ICONS.info;

    var msg = document.createElement('span');
    msg.style.flex = '1';
    msg.textContent = message;

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = 'background:none;border:none;color:' + closeFg + ';' +
                              'font-size:18px;cursor:pointer;padding:0;margin-left:4px;line-height:1;';
    closeBtn.addEventListener('click', function () { _dismiss(toast); });

    toast.appendChild(icon);
    toast.appendChild(msg);
    toast.appendChild(closeBtn);
    _host.appendChild(toast);

    var timer = duration > 0 ? setTimeout(function () { _dismiss(toast); }, duration) : null;

    return {
      dismiss: function () {
        if (timer) clearTimeout(timer);
        _dismiss(toast);
      }
    };
  }

  function _dismiss(toast) {
    if (!toast.parentNode) return;
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    setTimeout(function () { toast.remove(); }, 220);
  }

  function _ensure() {
    if (_host && document.body.contains(_host)) return;

    if (!_cssInjected) {
      _cssInjected = true;
      var style = document.createElement('style');
      style.textContent = '@keyframes _lux-toast-in{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:none}}@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}';
      document.head.appendChild(style);
    }

    _host = document.createElement('div');
    _host.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;' +
                           'display:flex;flex-direction:column;gap:8px;pointer-events:none;';
    document.body.appendChild(_host);
  }

  return { show: show };
})();

/* lux-toggle.js — Accessible on/off toggle switch.
 *
 * Global: LuxToggle
 * Usage:  LuxToggle.create(container, options) → api
 *   options { label?, value?, disabled?, onChange?, tokens? }
 *
 * API: getValue(), setValue(v), setDisabled(bool), onChange(fn)
 */
var LuxToggle = (function () {

  function create(container, opts) {
    opts = opts || {};
    var label    = opts.label    || '';
    var value    = opts.value    || false;
    var disabled = opts.disabled || false;
    var tokens   = LuxWidgetUtils.tokens(opts);

    var toggleActiveBg  = LuxWidgetUtils.token(tokens, 'toggleActiveBg',  LuxWidgetUtils.token(tokens, 'buttonPrimaryBg', 'AccentColor'));
    var toggleInactiveBg= LuxWidgetUtils.token(tokens, 'toggleInactiveBg',LuxWidgetUtils.token(tokens, 'muted', 'ButtonFace'));
    var toggleBorder    = LuxWidgetUtils.token(tokens, 'toggleBorder',    LuxWidgetUtils.token(tokens, 'border',          'currentColor'));
    var toggleThumbBg   = LuxWidgetUtils.token(tokens, 'toggleThumbBg', 'Canvas');

    var _current = !!value;
    var _changeHandlers = [];
    if (typeof opts.onChange === 'function') {
      _changeHandlers.push(opts.onChange);
    }

    // Build DOM — outer label wraps everything so clicking label text also toggles
    var outerLabel = document.createElement('label');
    outerLabel.setAttribute('data-lux-toggle', 'true');
    outerLabel.style.display = 'flex';
    outerLabel.style.alignItems = 'center';
    outerLabel.style.gap = '8px';
    outerLabel.style.cursor = 'pointer';
    outerLabel.style.userSelect = 'none';

    // Track button (role=switch)
    var trackBtn = document.createElement('button');
    trackBtn.setAttribute('role', 'switch');
    trackBtn.setAttribute('data-toggle-track', 'true');
    trackBtn.setAttribute('aria-checked', String(_current));
    trackBtn.type = 'button';
    trackBtn.style.width = '40px';
    trackBtn.style.height = '20px';
    trackBtn.style.borderRadius = '9999px';
    trackBtn.style.position = 'relative';
    trackBtn.style.cursor = 'pointer';
    trackBtn.style.flexShrink = '0';
    trackBtn.style.padding = '0';
    trackBtn.style.outline = 'none';
    trackBtn.style.transition = 'background 120ms ease, border-color 120ms ease';

    // Thumb span
    var thumb = document.createElement('span');
    thumb.setAttribute('data-toggle-thumb', 'true');
    thumb.style.width = '14px';
    thumb.style.height = '14px';
    thumb.style.borderRadius = '9999px';
    thumb.style.background = toggleThumbBg;
    thumb.style.position = 'absolute';
    thumb.style.top = '2px';
    thumb.style.transition = 'left 120ms ease';

    trackBtn.appendChild(thumb);

    // Label span
    var labelSpan = document.createElement('span');
    labelSpan.setAttribute('data-toggle-label', 'true');
    labelSpan.textContent = label;

    outerLabel.appendChild(trackBtn);
    outerLabel.appendChild(labelSpan);
    container.appendChild(outerLabel);

    function _applyVisual() {
      if (_current) {
        trackBtn.style.background = toggleActiveBg;
        trackBtn.style.border = '1px solid ' + toggleActiveBg;
        thumb.style.left = '22px';
      } else {
        trackBtn.style.background = toggleInactiveBg;
        trackBtn.style.border = '1px solid ' + toggleBorder;
        thumb.style.left = '2px';
      }
      trackBtn.setAttribute('aria-checked', String(_current));
    }

    function _applyDisabled() {
      trackBtn.disabled = disabled;
      outerLabel.style.opacity = disabled ? '0.5' : '1';
      outerLabel.style.cursor = disabled ? 'not-allowed' : 'pointer';
    }

    _applyVisual();
    _applyDisabled();

    // Prevent label click from also firing track click (double toggle)
    // The outerLabel click bubbles to track anyway since track is inside label,
    // so we wire only the track button click.
    trackBtn.addEventListener('click', function (evt) {
      evt.preventDefault(); // prevent label re-firing
      if (disabled) return;
      _current = !_current;
      _applyVisual();
      for (var i = 0; i < _changeHandlers.length; i++) {
        _changeHandlers[i](_current);
      }
    });

    return {
      getValue: function () { return _current; },
      setValue: function (v) {
        _current = !!v;
        _applyVisual();
      },
      setDisabled: function (bool) {
        disabled = !!bool;
        _applyDisabled();
      },
      onChange: function (fn) { _changeHandlers.push(fn); },
    };
  }

  return { create: create };
})();

/* lux-toolbar.js — Search + action button toolbar for panels and tables.
 *
 * Global: LuxToolbar
 * Usage:  LuxToolbar.create(container, options) → { getSearch, setSearch, onSearch, onAction, setDisabled }
 *
 * Options:
 *   searchPlaceholder?, actions?:[{id,label,icon?,primary?,disabled?}],
 *   onSearch?(text), onAction?(id), tokens?
 */
var LuxToolbar = (function () {
  function create(container, opts) {
    opts = opts || {};
    var tokens = LuxWidgetUtils.tokens(opts);
    var inputBg = LuxWidgetUtils.token(tokens, "inputBg", "Canvas");
    var inputBorder = LuxWidgetUtils.token(tokens, "inputBorder", "currentColor");
    var btnPrimaryBg = LuxWidgetUtils.token(tokens, "buttonPrimaryBg", "AccentColor");
    var btnPrimaryFg = LuxWidgetUtils.token(tokens, "buttonPrimaryFg", "Canvas");
    var btnSecondaryBg = LuxWidgetUtils.token(tokens, "buttonSecondaryBg", "ButtonFace");
    var btnSecondaryFg = LuxWidgetUtils.token(tokens, "buttonSecondaryFg", "ButtonText");
    var border = LuxWidgetUtils.token(tokens, "border", "currentColor");

    container.innerHTML = "";

    var root = document.createElement("div");
    root.setAttribute("data-lux-toolbar", "true");
    root.style.cssText =
      "display:flex;align-items:center;gap:8px;padding:8px 0;font-family:Inter,sans-serif;";

    // search input
    var input = document.createElement("input");
    input.type = "search";
    input.setAttribute("data-lux-toolbar-search", "true");
    input.placeholder = opts.searchPlaceholder || "Search…";
    input.style.cssText =
      "flex:1;min-width:0;padding:6px 10px;font-size:13px;" +
      "border:1px solid " + inputBorder + ";border-radius:8px;" +
      "background:" + inputBg + ";outline:none;box-sizing:border-box;";
    root.appendChild(input);

    // actions container
    var actionsWrap = document.createElement("div");
    actionsWrap.style.cssText = "display:flex;gap:8px;flex-shrink:0;";

    var actionButtons = [];
    if (Array.isArray(opts.actions)) {
      opts.actions.forEach(function (action) {
        var btn = document.createElement("button");
        btn.setAttribute("data-lux-toolbar-action", action.id);
        btn.style.cssText =
          "border-radius:8px;padding:5px 12px;font-size:13px;cursor:pointer;font-family:Inter,sans-serif;" +
          (action.primary
            ? "background:" + btnPrimaryBg + ";color:" + btnPrimaryFg + ";border:none;"
            : "background:" + btnSecondaryBg + ";color:" + btnSecondaryFg + ";border:1px solid " + border + ";");
        btn.textContent = (action.icon ? action.icon + " " : "") + action.label;
        if (action.disabled) { btn.disabled = true; }
        actionButtons.push(btn);
        actionsWrap.appendChild(btn);
      });
    }

    root.appendChild(actionsWrap);
    container.appendChild(root);

    // handlers
    var searchHandler = typeof opts.onSearch === "function" ? opts.onSearch : null;
    var actionHandler = typeof opts.onAction === "function" ? opts.onAction : null;

    // wire action buttons
    actionButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (actionHandler) {
          actionHandler(btn.getAttribute("data-lux-toolbar-action"));
        }
      });
    });

    // wire search — no debounce for testability (synchronous)
    input.addEventListener("input", function () {
      if (searchHandler) { searchHandler(input.value); }
    });

    return {
      getSearch: function () { return input.value; },

      setSearch: function (text) {
        input.value = text == null ? "" : String(text);
      },

      onSearch: function (fn) { searchHandler = fn; },

      onAction: function (fn) { actionHandler = fn; },

      setDisabled: function (bool) {
        input.disabled = !!bool;
        actionButtons.forEach(function (btn) { btn.disabled = !!bool; });
      }
    };
  }

  return { create: create };
})();

/* lux-tree-view.js — Collapsible tree widget for hierarchical data.
 *
 * Global: LuxTreeView
 * Usage:  LuxTreeView.render(container, nodes, options) → { expand(id), collapse(id), getSelected() }
 *
 * nodes: [{ id, label, children?, icon?, disabled? }]
 * options: { title?, selectable?, defaultExpanded?, onSelect?, tokens? }
 *
 * All colours flow through LuxWidgetUtils.token(tokens, key, fallback).
 */
var LuxTreeView = (function () {
  function render(container, nodes, opts) {
    opts = opts || {};
    var tokens = LuxWidgetUtils.tokens(opts);

    var selectedBg   = LuxWidgetUtils.token(tokens, 'accentBg',
                         LuxWidgetUtils.token(tokens, 'buttonPrimaryBg', 'AccentColor'));
    var selectedFg   = LuxWidgetUtils.token(tokens, 'buttonPrimaryFg', 'Canvas');
    var defaultFg    = LuxWidgetUtils.token(tokens, 'cardFg', 'CanvasText');
    var mutedFg      = LuxWidgetUtils.token(tokens, 'mutedFg', 'GrayText');

    var selectable      = !!opts.selectable;
    var defaultExpanded = Array.isArray(opts.defaultExpanded) ? opts.defaultExpanded : [];
    var onSelect        = typeof opts.onSelect === 'function' ? opts.onSelect : null;

    container.innerHTML = '';

    // ── State ──────────────────────────────────────────────────────────────
    var expandedIds = {};
    for (var i = 0; i < defaultExpanded.length; i++) {
      expandedIds[defaultExpanded[i]] = true;
    }
    var selectedNode = null; // { id, label }

    // Keep a map from id → { rowEl, childListEl } for programmatic API
    var nodeRegistry = {};

    // ── Root wrapper ───────────────────────────────────────────────────────
    var wrapper = document.createElement('div');
    wrapper.setAttribute('data-lux-tree-view', 'true');
    wrapper.style.cssText = 'font-family:Inter,sans-serif;font-size:13px;color:' + defaultFg + ';';

    if (opts.title) {
      var titleEl = document.createElement('div');
      titleEl.style.cssText = 'font-weight:600;font-size:14px;margin-bottom:8px;color:' + defaultFg + ';';
      titleEl.textContent = String(opts.title);
      wrapper.appendChild(titleEl);
    }

    // ── Helpers ────────────────────────────────────────────────────────────
    function applyRowStyle(rowEl, nodeId) {
      var isSelected = selectedNode && selectedNode.id === nodeId;
      rowEl.style.background = isSelected ? selectedBg : 'transparent';
      rowEl.style.color      = isSelected ? selectedFg : defaultFg;
      if (isSelected) {
        rowEl.setAttribute('data-lux-tree-selected', 'true');
      } else {
        rowEl.removeAttribute('data-lux-tree-selected');
      }
    }

    function selectNodeById(id, label) {
      // Deselect previous
      if (selectedNode) {
        var prev = nodeRegistry[selectedNode.id];
        if (prev) applyRowStyle(prev.rowEl, selectedNode.id);
      }
      selectedNode = { id: id, label: label };
      var current = nodeRegistry[id];
      if (current) applyRowStyle(current.rowEl, id);
    }

    // ── Recursive node builder ─────────────────────────────────────────────
    function buildList(nodeList, role) {
      var ul = document.createElement('ul');
      ul.setAttribute('data-lux-tree-list', 'true');
      ul.setAttribute('role', role || 'tree');
      ul.style.cssText = 'list-style:none;margin:0;padding:0;';

      for (var i = 0; i < nodeList.length; i++) {
        ul.appendChild(buildItem(nodeList[i]));
      }
      return ul;
    }

    function buildItem(node) {
      var hasChildren = Array.isArray(node.children) && node.children.length > 0;
      var isExpanded  = !!expandedIds[node.id];
      var isDisabled  = !!node.disabled;

      var li = document.createElement('li');
      li.setAttribute('data-lux-tree-item', node.id);
      li.setAttribute('role', 'treeitem');
      li.setAttribute('aria-expanded', hasChildren ? String(isExpanded) : 'false');
      if (isDisabled) li.setAttribute('aria-disabled', 'true');

      // Row
      var row = document.createElement('div');
      row.setAttribute('data-lux-tree-row', node.id);
      row.style.cssText =
        'display:flex;align-items:center;gap:4px;padding:4px 8px;border-radius:8px;' +
        'cursor:' + (isDisabled ? 'not-allowed' : 'pointer') + ';' +
        'user-select:none;';

      // Toggle chevron (only if has children)
      var toggleBtn = null;
      if (hasChildren) {
        toggleBtn = document.createElement('button');
        toggleBtn.setAttribute('data-lux-tree-toggle', node.id);
        toggleBtn.type = 'button';
        toggleBtn.style.cssText =
          'border:none;background:transparent;cursor:pointer;padding:0;' +
          'color:' + mutedFg + ';font-size:10px;line-height:1;width:16px;text-align:center;';
        toggleBtn.textContent = isExpanded ? '▼' : '▶';
        row.appendChild(toggleBtn);
      } else {
        // Spacer for alignment
        var spacer = document.createElement('span');
        spacer.style.cssText = 'display:inline-block;width:16px;';
        row.appendChild(spacer);
      }

      // Icon (optional)
      if (node.icon) {
        var iconEl = document.createElement('span');
        iconEl.setAttribute('aria-hidden', 'true');
        iconEl.style.cssText = 'font-size:14px;';
        iconEl.textContent = String(node.icon);
        row.appendChild(iconEl);
      }

      // Label
      var labelEl = document.createElement('span');
      labelEl.setAttribute('data-lux-tree-label', node.id);
      labelEl.style.cssText = 'flex:1;color:' + (isDisabled ? mutedFg : 'inherit') + ';';
      labelEl.textContent = String(node.label);
      row.appendChild(labelEl);

      li.appendChild(row);

      // Children list (hidden when collapsed)
      var childList = null;
      if (hasChildren) {
        childList = buildList(node.children, 'group');
        childList.setAttribute('data-lux-tree-list', ''); // remove the "true" value for child lists
        childList.removeAttribute('data-lux-tree-list');
        // Use the group-scoped attribute instead
        var childUl = document.createElement('ul');
        childUl.setAttribute('data-lux-tree-children', node.id);
        childUl.setAttribute('role', 'group');
        childUl.style.cssText = 'list-style:none;margin:0;padding:0 0 0 20px;' +
          'display:' + (isExpanded ? 'block' : 'none') + ';';

        // Build children items directly into childUl
        for (var c = 0; c < node.children.length; c++) {
          childUl.appendChild(buildItem(node.children[c]));
        }

        li.appendChild(childUl);
        childList = childUl;
      }

      // Register node
      nodeRegistry[node.id] = { rowEl: row, childListEl: childList, li: li, toggleBtn: toggleBtn, node: node };

      // Apply initial selection style
      applyRowStyle(row, node.id);

      // ── Event handlers ─────────────────────────────────────────────────
      if (!isDisabled) {
        // Toggle button click (only toggles expand/collapse, does not select)
        if (toggleBtn) {
          toggleBtn.addEventListener('click', function (evt) {
            evt.stopPropagation();
            toggleExpand(node.id);
          });
        }

        // Row click: toggle expand (if has children) + select (if selectable)
        row.addEventListener('click', function () {
          if (hasChildren) toggleExpand(node.id);
          if (selectable) selectNodeById(node.id, node.label);
          if (onSelect) onSelect({ id: node.id, label: node.label });
        });
      }

      return li;
    }

    // ── Expand/collapse ────────────────────────────────────────────────────
    function toggleExpand(id) {
      if (expandedIds[id]) {
        collapseNode(id);
      } else {
        expandNode(id);
      }
    }

    function expandNode(id) {
      expandedIds[id] = true;
      var reg = nodeRegistry[id];
      if (!reg) return;
      if (reg.childListEl) reg.childListEl.style.display = 'block';
      if (reg.toggleBtn)   reg.toggleBtn.textContent = '▼';
      reg.li.setAttribute('aria-expanded', 'true');
    }

    function collapseNode(id) {
      delete expandedIds[id];
      var reg = nodeRegistry[id];
      if (!reg) return;
      if (reg.childListEl) reg.childListEl.style.display = 'none';
      if (reg.toggleBtn)   reg.toggleBtn.textContent = '▶';
      reg.li.setAttribute('aria-expanded', 'false');
    }

    // ── Build tree ─────────────────────────────────────────────────────────
    var topList = buildList(nodes, 'tree');
    topList.setAttribute('data-lux-tree-list', 'true');
    wrapper.appendChild(topList);

    container.appendChild(wrapper);

    // ── Public API ─────────────────────────────────────────────────────────
    return {
      expand: function (id) { expandNode(id); },
      collapse: function (id) { collapseNode(id); },
      getSelected: function () { return selectedNode ? { id: selectedNode.id, label: selectedNode.label } : null; }
    };
  }

  return { render: render };
})();

/* lux-waterfall.js — SVG waterfall (bridge) chart renderer.
 *
 * Global: LuxWaterfall
 * Usage:  LuxWaterfall.render(container, data, options)
 *   data       [{label, value, type?:'delta'|'total'|'subtotal'}, ...]
 *              'delta' (default): floating bar from cumulative position
 *              'total'|'subtotal': bar from zero (full-height anchor)
 *   options    {title?, width?, height?, showValues?, tokens?}
 *
 * Example:
 *   LuxWaterfall.render(el, [
 *     { label: 'Opening', value: 100, type: 'total' },
 *     { label: 'Sales',   value:  50 },
 *     { label: 'COGS',    value: -30 },
 *     { label: 'Closing', value: 120, type: 'total' },
 *   ], { showValues: true, tokens: tokens });
 */
var LuxWaterfall = (function () {
  var esc = LuxWidgetUtils.esc;

  function render(container, data, opts) {
    opts = opts || {};
    if (!Array.isArray(data) || !data.length) { container.innerHTML = ''; return; }

    var title      = opts.title      || '';
    var showValues = !!opts.showValues;
    var tokens     = LuxWidgetUtils.tokens(opts);
    var width      = opts.width  || container.clientWidth  || container.offsetWidth  || 480;
    var height     = opts.height || container.clientHeight || container.offsetHeight || 280;

    // Token colours
    var positiveColor  = LuxWidgetUtils.token(tokens, 'chart1', 'currentColor');
    var negativeColor  = LuxWidgetUtils.token(tokens, 'semanticErrorFg', 'currentColor');
    var totalColor     = LuxWidgetUtils.token(tokens, 'chart3', 'currentColor');
    var gridColor      = LuxWidgetUtils.token(tokens, 'chartGrid',        'currentColor');
    var axisColor      = LuxWidgetUtils.token(tokens, 'chartAxis',        'currentColor');
    var mutedFg        = LuxWidgetUtils.token(tokens, 'mutedFg', 'GrayText');
    var connectorColor = LuxWidgetUtils.token(tokens, 'border',           'currentColor');

    var titleH = title ? 28 : 0;
    var padL   = 40;
    var padR   = 16;
    var padT   = titleH + 16;
    var padB   = 36;
    var plotW  = width  - padL - padR;
    var plotH  = height - padT - padB;

    // ── Compute bar extents ──────────────────────────────────────────────────
    // Each item is { label, value, type }
    // For 'total'/'subtotal': bar is from 0 to value
    // For 'delta': bar floats from cumulative position
    var items = [];
    var cumulative = 0;
    var allValues = [];

    for (var i = 0; i < data.length; i++) {
      var d    = data[i];
      var type = d.type || 'delta';
      var barStart, barEnd, cumAfter;

      if (type === 'total' || type === 'subtotal') {
        barStart = 0;
        barEnd   = d.value;
        cumAfter = d.value;
      } else {
        barStart = cumulative;
        barEnd   = cumulative + d.value;
        cumAfter = barEnd;
      }

      allValues.push(barStart);
      allValues.push(barEnd);
      items.push({ label: d.label, value: d.value, type: type, barStart: barStart, barEnd: barEnd, cumAfter: cumAfter });
      cumulative = cumAfter;
    }

    // ── Scale ────────────────────────────────────────────────────────────────
    var dataMin = Math.min.apply(null, allValues);
    var dataMax = Math.max.apply(null, allValues);
    var padding = (dataMax - dataMin) * 0.12 || 10;
    var scaleMin = dataMin - padding;
    var scaleMax = dataMax + padding;
    var scaleRange = scaleMax - scaleMin;

    function toY(v) {
      return padT + plotH - ((v - scaleMin) / scaleRange) * plotH;
    }

    var slotW  = plotW / items.length;
    var barW   = slotW * 0.65;

    // ── Grid & axes ──────────────────────────────────────────────────────────
    var ticks  = LuxWidgetUtils.niceScale(scaleMin, scaleMax, 5);
    var gridEls = [];
    for (var ti = 0; ti < ticks.length; ti++) {
      var ty  = toY(ticks[ti]);
      var isZero = ticks[ti] === 0;
      gridEls.push(
        '<line x1="' + padL + '" y1="' + ty + '" x2="' + (padL + plotW) + '" y2="' + ty +
        '" stroke="' + (isZero ? axisColor : gridColor) + '"' +
        ' stroke-width="' + (isZero ? 1.5 : 1) + '"' +
        (isZero ? '' : ' stroke-dasharray="3,3"') + '"/>' +
        '<text x="' + (padL - 6) + '" y="' + (ty + 4) + '" text-anchor="end"' +
        ' font-size="10" fill="' + mutedFg + '">' + esc(String(LuxWidgetUtils.fmt(ticks[ti]))) + '</text>'
      );
    }

    // ── Bars ─────────────────────────────────────────────────────────────────
    var barEls      = [];
    var labelEls    = [];
    var connectors  = [];

    for (var ii = 0; ii < items.length; ii++) {
      var item  = items[ii];
      var bx    = padL + ii * slotW + (slotW - barW) / 2;
      var y1    = toY(item.barEnd);
      var y2    = toY(item.barStart);
      var bh    = Math.abs(y2 - y1);
      var by    = Math.min(y1, y2);
      if (bh < 1) { bh = 1; }

      var fillColor;
      if (item.type === 'total' || item.type === 'subtotal') {
        fillColor = totalColor;
      } else if (item.value >= 0) {
        fillColor = positiveColor;
      } else {
        fillColor = negativeColor;
      }

      var tooltipRows = [
        { label: 'Value',         value: String(LuxWidgetUtils.fmt(item.value)) },
        { label: 'Running total', value: String(LuxWidgetUtils.fmt(item.cumAfter)) }
      ];

      barEls.push(
        '<rect x="' + bx + '" y="' + by + '" width="' + barW + '" height="' + bh + '"' +
        ' fill="' + fillColor + '" rx="2"' +
        LuxWidgetUtils.tooltipAttrs(item.label, tooltipRows) + '/>'
      );

      // X-axis labels
      var lx = padL + ii * slotW + slotW / 2;
      var ly = padT + plotH + 16;
      labelEls.push(
        '<text x="' + lx + '" y="' + ly + '" text-anchor="middle"' +
        ' font-size="11" fill="' + mutedFg + '">' + esc(item.label) + '</text>'
      );

      // Value labels on bars
      if (showValues) {
        var valY = item.value >= 0 ? by - 4 : by + bh + 13;
        barEls.push(
          '<text x="' + (bx + barW / 2) + '" y="' + valY + '" text-anchor="middle"' +
          ' font-size="10" font-weight="600" fill="currentColor">' +
          esc(String(LuxWidgetUtils.fmt(item.value))) + '</text>'
        );
      }

      // Dashed connector to next delta bar
      if (ii < items.length - 1) {
        var next = items[ii + 1];
        if (next.type === 'delta') {
          var connY  = toY(item.cumAfter);
          var connX1 = bx + barW;
          var connX2 = padL + (ii + 1) * slotW + (slotW - barW) / 2;
          connectors.push(
            '<line x1="' + connX1 + '" y1="' + connY + '" x2="' + connX2 + '" y2="' + connY +
            '" stroke="' + connectorColor + '" stroke-width="1" stroke-dasharray="3,3"/>'
          );
        }
      }
    }

    var titleEl = title
      ? '<text x="' + (width / 2) + '" y="18" text-anchor="middle" font-size="14"' +
        ' font-weight="600" fill="currentColor">' + esc(title) + '</text>'
      : '';

    container.innerHTML =
      '<div style="position:relative;display:inline-block;">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height +
      '" font-family="Inter, sans-serif">' +
      titleEl +
      gridEls.join('') +
      connectors.join('') +
      barEls.join('') +
      labelEls.join('') +
      '</svg>' +
      '<div data-lux-chart-tooltip="true"></div>' +
      '</div>';

    LuxWidgetUtils.attachTooltip(container, tokens);
  }

  return { render: render };
})();

/* prism-bridge.js — Lightweight Prism host-bridge wrapper.
 *
 * Exposes a global `PrismElement` base class. Extend it in element.js
 * instead of HTMLElement when the component calls LLM or ERP services.
 *
 * The host activates the component by setting:
 *   element.prism = bridge   (bridge must have version === "0.1")
 *
 * Override lifecycle hooks to wire bridge-dependent behaviour:
 *   onInitialize(prism)       — awaited once after first prism + connected
 *   onConnect(prism)          — awaited each time connected when prism set
 *   onDisconnect()            — called synchronously on disconnectedCallback
 *   onPrismChanged(p, prev)   — called synchronously on reassignment
 *   renderView(state, root)   — called after state changes
 *   renderDefaultView()       — fallback render (title + message)
 *
 * Legacy hook still works: _onPrismReady(prism) is called from onInitialize.
 *
 * Read references/host-interface.md for the full bridge contract.
 */
var PrismElement = class extends HTMLElement {
  #prism = null;
  #initialized = false;
  #initializing = false;
  #error = null;
  #readyResolvers = [];
  #subscriptions = new Set();

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = '<div part="content"></div>';
    this.contentRoot = this.shadowRoot.querySelector('[part="content"]');
  }

  // ── Prism setter / getter ──────────────────────────────────────────────────

  get prism() { return this.#prism; }
  set prism(bridge) {
    if (bridge !== null && bridge !== undefined) {
      if (bridge.version !== "0.1") {
        throw new TypeError('Prism bridge version must be "0.1"');
      }
    }
    const previous = this.#prism;
    const first = previous === null;
    this.#prism = bridge;

    if (!first && bridge !== previous) {
      this.onPrismChanged(bridge, previous);
    }

    if (bridge && first) {
      // Legacy sync hook fires immediately regardless of DOM connection.
      this._onPrismReady(bridge);
      this._tryInitialize();
    }
  }

  async _tryInitialize() {
    if (this.#initialized || this.#initializing) return;
    // Only initialize once both prism is set and element is connected.
    if (!this.#prism || !this.isConnected) return;
    this.#initializing = true;
    this.#_renderView();
    try {
      await this.onInitialize(this.#prism);
      this.#initialized = true;
    } catch (err) {
      this.#error = err;
    } finally {
      this.#initializing = false;
      this.#_renderView();
      // Resolve any whenPrismReady() waiters.
      for (const resolve of this.#readyResolvers) resolve(this.#prism);
      this.#readyResolvers = [];
    }
  }

  // ── State ──────────────────────────────────────────────────────────────────

  get state() {
    return {
      connected: this.isConnected,
      initialized: this.#initialized,
      initializing: this.#initializing,
      prism: this.#prism,
      error: this.#error,
    };
  }

  get lastError() { return this.#error; }

  whenPrismReady() {
    if (this.#initialized) return Promise.resolve(this.#prism);
    return new Promise((resolve) => this.#readyResolvers.push(resolve));
  }

  // ── DOM lifecycle ──────────────────────────────────────────────────────────

  connectedCallback() {
    this._tryInitialize();
    if (this.#initialized && this.#prism) {
      this.onConnect(this.#prism);
    }
    this.#_renderView();
  }

  disconnectedCallback() {
    this.onDisconnect();
    this.releaseSubscriptions();
  }

  // ── Overridable lifecycle hooks ────────────────────────────────────────────

  async onInitialize(prism) {} // eslint-disable-line no-unused-vars

  async onConnect(prism) {}       // eslint-disable-line no-unused-vars
  onDisconnect() {}
  onPrismChanged(prism, previous) {} // eslint-disable-line no-unused-vars

  // Override renderView(state, root) if you want PrismElement's state-change
  // re-render cycle to drive your DOM. By default this is a no-op so that
  // subclasses that set contentRoot.innerHTML themselves in connectedCallback
  // or onInitialize are not overwritten when the bridge connects.
  renderView(_state, _root) {} // eslint-disable-line no-unused-vars

  renderDefaultView() {
    if (this.contentRoot) {
      this.contentRoot.innerHTML = '<div><strong>PrismElement</strong></div>';
    }
  }

  #_renderView() {
    try { this.renderView(this.state, this.contentRoot); } catch (_) {}
  }

  /* Override in element.js — called once on the first non-null prism assignment. */
  _onPrismReady(prism) {}         // eslint-disable-line no-unused-vars

  // ── Internal helper ────────────────────────────────────────────────────────

  _ensureResult(result, fallback = "ERP call failed.") {
    if (result?.error) {
      throw Object.assign(
        new Error(result.error.message || fallback),
        { code: result.error.code },
      );
    }
    return result;
  }

  _assertStorageScope(scope) {
    if (scope !== "user" && scope !== "tenant") {
      throw new TypeError(`Invalid storage scope "${scope}". Must be "user" or "tenant".`);
    }
  }

  _assertStorageProvider(provider) {
    if (provider !== "db" && provider !== "browser") {
      throw new TypeError(`Invalid storage provider "${provider}". Must be "db" or "browser".`);
    }
  }

  // ── LLM ───────────────────────────────────────────────────────────────────

  async invokeModel(request) {
    return this._ensureResult(await this.#prism.llm.invoke(request));
  }

  // ── ERP ───────────────────────────────────────────────────────────────────

  async callService(request) {
    return this._ensureResult(await this.#prism.erp.call(request));
  }

  requireBridge() {
    if (!this.#prism) throw new Error("PrismElement: bridge not connected");
    const p = this.#prism;
    const check = (path, fn) => {
      if (typeof fn !== "function") {
        throw new TypeError(`Bridge missing required method: ${path}`);
      }
    };
    check("erp.call",          p.erp?.call);
    check("llm.invoke",        p.llm?.invoke);
    check("storage.get",       p.storage?.get);
    check("storage.set",       p.storage?.set);
    check("storage.remove",    p.storage?.remove);
    check("storage.list",      p.storage?.list);
    check("events.subscribe",  p.events?.subscribe);
    check("ui.setTitle",       p.ui?.setTitle);
    check("ui.requestSize",    p.ui?.requestSize);
    check("ui.openRecord",     p.ui?.openRecord);
    return p;
  }

  // ── Storage ───────────────────────────────────────────────────────────────

  async getStorage(key, scope, provider) {
    const s = scope ?? 'user';
    const p = provider ?? 'browser';
    if (scope !== undefined) this._assertStorageScope(s);
    if (provider !== undefined) this._assertStorageProvider(p);
    return this.#prism.storage.get(key, s, p);
  }

  async setStorage(params) { return this.#prism.storage.set(params); }

  async removeStorage(key, scope, provider) {
    const s = scope ?? 'user';
    const p = provider ?? 'browser';
    if (scope !== undefined) this._assertStorageScope(s);
    if (provider !== undefined) this._assertStorageProvider(p);
    return this.#prism.storage.remove(key, s, p);
  }

  async listStorage(prefix, scope, provider) {
    const s = scope ?? 'user';
    const p = provider ?? 'browser';
    if (scope !== undefined) this._assertStorageScope(s);
    if (provider !== undefined) this._assertStorageProvider(p);
    return this.#prism.storage.list(prefix, s, p);
  }

  // ── Bridge info getters ───────────────────────────────────────────────────

  get size()    { return this.#prism?.ui.size    ?? null; }
  get session() { return this.#prism?.session    ?? null; }
  get context() { return this.#prism?.context    ?? null; }

  // ── UI helpers ────────────────────────────────────────────────────────────

  setTitle(title) { this.#prism.ui.setTitle(title); }

  async requestSize(size) {
    if (size !== "narrow" && size !== "wide" && size !== "full") {
      throw new TypeError(`Invalid size "${size}". Must be "narrow", "wide", or "full".`);
    }
    return this.#prism.ui.requestSize(size);
  }

  async openRecord(target) { return this.#prism.ui.openRecord(target); }

  // ── Events ────────────────────────────────────────────────────────────────

  static #VALID_EVENTS = ["context.changed", "theme.changed", "visibility.changed"];

  subscribe(eventName, handler) {
    if (!PrismElement.#VALID_EVENTS.includes(eventName)) {
      throw new TypeError(`Unsupported Prism event "${eventName}"`);
    }
    const unsub = this.#prism.events.subscribe(eventName, handler);
    this.#subscriptions.add(unsub);
    return () => {
      unsub();
      this.#subscriptions.delete(unsub);
    };
  }

  releaseSubscriptions() {
    for (const unsub of this.#subscriptions) unsub();
    this.#subscriptions.clear();
  }
};

// Planner's Workbench runtime. TEMPLATE and STYLES are injected by the composer as top-level constants.
import { definePrismAgent } from './prism-shim.js';

const SERVICE_NAME = 'Erp.BO.SalesOrderSvc';
const PAGE_SIZE = 250;
const ERP_UPDATE_NOTE = 'Release and other actions require Allow updates (top of page) to be on.';

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
};

const formatQty = (value) => value === null || value === undefined || value === '' ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });


/* Theme: shop-floor andon board over a steel plate. Signal colors carry meaning:
   red = stop (late), amber = caution (needs action), green = running clean. */
const THEME_CSS = `
:host {
  --ink: #0F2430; --muted: #5B6B76; --line: #DCE3E8; --page: #F7F9FA; --navy: #01446F;
  --base-background: var(--page); --base-foreground: var(--ink);
  --base-muted: #F2F5F7; --base-muted-foreground: var(--muted);
  --base-border: #9AA9B4; --card-border: var(--line); --input-border: #9AA9B4;
  --primary: var(--navy); --focus: #1B6FA8;
  --success-background: #EAF5EE; --success-foreground: #1E6B3A;
  --warning-background: #FFF5DC; --warning-foreground: #845A00; --warning-border: #C58B00;
  --error-background: #FCEDED; --error-foreground: #A61B1B; --error-border: #C62828;
  font-family: "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
  font-size: 14px; line-height: 1.45;
}
.app-shell { padding: 0 0 32px; }
.app-shell > :not(.page-header) { margin-left: 28px; margin-right: 28px; }

/* Banner */
.page-header { background: linear-gradient(90deg, #083A51 0%, #1D5E7F 100%); color: #FFFFFF; padding: 20px 28px 22px; margin: 0 0 14px; align-items: center; }
.page-header h1 { font-size: 24px; line-height: 30px; font-weight: 700; color: #FFFFFF; margin: 0 0 2px; }
.page-header .title-block p { color: #C8DCE6; font-size: 13px; }
.title-block .eyebrow { display: none; }
.eyebrow { text-transform: none; letter-spacing: 0; font-size: 12px; font-weight: 600; color: var(--muted); }
.page-header .field-label { color: #C8DCE6; font-size: 11px; font-weight: 600; }
.page-header select { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.35); color: #FFFFFF; height: 34px; border-radius: 6px; }
.page-header select option { color: var(--ink); }
.page-header .button-primary { background: #FFFFFF; color: var(--navy); font-weight: 600; }
.page-header .metadata { color: #C8DCE6; }
.page-header :focus-visible { outline-color: #FFFFFF; }
.erp-update-note { margin-top: 0; margin-bottom: 14px; font-size: 12px; }

/* KPI cards */
.kpi-grid { gap: 12px; margin-bottom: 16px; }
.kpi-card { background: #FFFFFF; border: 1px solid var(--line); border-left: 4px solid var(--navy); border-radius: 8px; padding: 12px 16px; min-height: 0; }
.kpi-card[data-signal="stop"] { border-left-color: #C62828; }
.kpi-card[data-signal="caution"] { border-left-color: #D99A00; }
.kpi-card[data-signal="run"] { border-left-color: #2E7D32; }
.kpi-label { font-size: 12px; font-weight: 400; color: var(--muted); }
.kpi-value, .kpi-value.mono { font-family: inherit; font-size: 24px; line-height: 30px; font-weight: 700; color: var(--ink); margin: 4px 0 0; }
.kpi-card[data-signal="stop"] .kpi-value { color: #A61B1B; }
.kpi-note { font-size: 11px; }

/* Tabs */
.tabs { gap: 4px; border-bottom: 1px solid var(--line); }
.tab { min-height: 40px; padding: 0 10px; font-size: 14px; font-weight: 500; color: var(--muted); border-bottom: 3px solid transparent; }
.tab.is-active, .tab[aria-selected="true"] { color: var(--ink); font-weight: 600; border-bottom-color: var(--navy); }

/* Surfaces and tables */
.content-card { border-radius: 8px; border-color: var(--line); background: #FFFFFF; }
.content-toolbar h2 { font-size: 18px; font-weight: 700; }
h2, h3 { font-family: inherit; }
select, input { border-radius: 6px; }
.button { border-radius: 6px; font-weight: 600; }
th { text-transform: none; letter-spacing: 0; font-size: 12px; font-weight: 600; color: #4A5A66; background: #F3F6F8; }
td { font-size: 13px; }
.mono { font-family: "Cascadia Mono", Consolas, ui-monospace, monospace; font-size: 12.5px; }
.group-row th { background: #F3F6F8; color: var(--ink); }
.capacity-cell.under { background: #F4FAF6; }
.capacity-cell.watch { background: #FFF7E0; }
.capacity-cell.over { background: #FCEDED; }
.capacity-cell strong { font-size: 15px; font-weight: 700; }
.cap-group-cell { min-width: 150px; }
.cap-group { display: block; font-size: 13px; font-weight: 600; color: var(--ink); }
.cap-hours { display: inline-flex; align-items: center; gap: 4px; margin-top: 4px; font-size: 11px; font-weight: 400; color: var(--muted); }
.cap-hours input { width: 60px; height: 26px; padding: 0 6px; font-size: 12px; border-radius: 4px; }
.batch-group dt { text-transform: none; }
@media (max-width: 900px) {
  .page-header { flex-direction: column; align-items: flex-start; }
}
`;
const JOB_DRAWER_STYLES = `<style>
.detail-panel.job-drawer { width: min(820px, 100vw); }
.jd-title { margin-bottom: 2px !important; }
.jd-sub { color: var(--base-muted-foreground); font-size: 13px; margin-bottom: 10px; }
.jd-muted { color: var(--base-muted-foreground); font-size: 13px; }
.jd-small { font-size: 12px; margin-top: 6px; }
.jd-error { background: var(--error-background); color: var(--error-foreground); border: 1px solid var(--error-border); padding: 10px 12px; border-radius: 6px; font-size: 13px; }
.jd-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.jd-chip { display: inline-block; padding: 1px 9px; border-radius: 999px; font-size: 12px; background: #FFFFFF; color: #1D5E7F; border: 1px solid #7FA8BC; }
.jd-chip.jd-bad { background: var(--error-background); color: var(--error-foreground); border-color: var(--error-border); }
.jd-chip.jd-warn { background: var(--warning-background); color: var(--warning-foreground); border-color: transparent; }
.jd-chip.jd-good { background: var(--success-background); color: var(--success-foreground); border-color: transparent; }
.jd-badtext { color: var(--error-foreground); font-weight: 600; }
.jd-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px 16px; margin: 0 0 12px; }
.jd-facts div { display: block; }
.jd-facts dt { font-size: 13px; font-weight: 600; color: var(--base-muted-foreground); }
.jd-facts dd { margin: 2px 0 0; font-size: 16px; text-align: left; font-weight: 600; }
.jd-progress { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--base-muted-foreground); margin-bottom: 12px; }
.jd-bar { flex: 1; height: 8px; background: var(--base-muted); border-radius: 999px; overflow: hidden; border: 1px solid var(--card-border); }
.jd-bar span { display: block; height: 100%; background: #01446F; }
.jd-release { margin-bottom: 8px; }
.jd-h { font-size: 16px; font-weight: 700; margin: 22px 0 8px; padding-top: 14px; border-top: 1px solid var(--card-border); }
.jd-legend { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; font-size: 12px; color: var(--base-muted-foreground); margin-bottom: 8px; }
.jd-li { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.jd-key { display: inline-block; width: 12px; height: 8px; border-radius: 2px; }
.jd-key.done, .jd-tbar.done, .jd-dot.done { background: #15803D; }
.jd-key.active, .jd-tbar.active, .jd-dot.active { background: #D97706; }
.jd-key.late, .jd-tbar.late, .jd-dot.late { background: #B91C1C; }
.jd-key.notstarted, .jd-tbar.notstarted, .jd-dot.notstarted { background: #94A3B8; }
.jd-key.est, .jd-cbar.est { background: #94A3B8; }
.jd-key.act, .jd-cbar.act { background: #1E3A5F; }
.jd-timeline { border: 1px solid var(--card-border); border-radius: 6px; padding: 8px 10px; }
.jd-axis { display: flex; justify-content: space-between; font-size: 11px; color: var(--base-muted-foreground); margin-left: 150px; margin-bottom: 4px; }
.jd-trow { display: flex; align-items: center; height: 22px; }
.jd-tlabel { width: 150px; flex: none; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 8px; }
.jd-ttrack { position: relative; flex: 1; height: 12px; background: var(--base-muted); border-radius: 3px; }
.jd-ttrack em { font-size: 11px; color: var(--base-muted-foreground); position: absolute; left: 4px; top: -2px; }
.jd-tbar { position: absolute; top: 0; height: 12px; border-radius: 3px; }
.jd-today { position: absolute; top: -4px; bottom: -4px; width: 2px; background: #0A0A0A; opacity: .55; z-index: 1; }
.jd-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
.jd-scroll { overflow-x: auto; }
.jd-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.jd-table th { text-align: left; font-weight: 600; color: var(--base-muted-foreground); font-size: 13px;  padding: 6px 8px; border-bottom: 1px solid var(--card-border); white-space: nowrap; }
.jd-table td { padding: 6px 8px; border-bottom: 1px solid var(--card-border); vertical-align: top; }
.jd-table .n { text-align: right; font-variant-numeric: tabular-nums; }
.jd-shortrow { background: var(--error-background); }
.jd-click { cursor: pointer; }
.jd-click:hover td, .jd-click:focus td { background: var(--base-muted); }
.jd-link { color: var(--primary); text-decoration: underline; }
.jd-back { background: none; border: none; color: var(--primary); cursor: pointer; padding: 0; margin: 0 0 10px; font: inherit; font-size: 13px; }
.jd-loadbar { max-width: 360px; }
.jd-order + .jd-order { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--card-border); }
.jd-order .jd-chip { margin-top: 3px; }
.capacity-cell.has-load { cursor: pointer; }
.capacity-cell.has-load:hover { outline: 2px solid var(--focus, #2563EB); outline-offset: -2px; }
.jd-supply { min-width: 170px; white-space: normal; }
.jd-supply > div + div { margin-top: 6px; }
.jd-supply .jd-chip { margin-bottom: 2px; }
.jd-costs { display: grid; gap: 8px; margin-bottom: 10px; }
.jd-crow { display: flex; align-items: center; gap: 10px; }
.jd-clabel { width: 120px; flex: none; font-size: 12px; }
.jd-cbars { flex: 1; display: grid; grid-template-columns: 1fr auto; gap: 3px 8px; align-items: center; }
.jd-cbar { display: block; height: 9px; border-radius: 3px; min-width: 2px; }
.jd-cval { font-size: 11px; color: var(--base-muted-foreground); font-variant-numeric: tabular-nums; min-width: 64px; text-align: right; }
@media (max-width: 600px) { .jd-tlabel { width: 100px; } .jd-axis { margin-left: 100px; } .jd-clabel { width: 90px; } }
</style>`;

const daysFromToday = (value) => {
  if (!value) return null;
  const target = new Date(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
};

class PlannerRuntime {
  constructor(host) {
    this.host = host;
    this._rows = [];
    this._filteredRows = [];
    this._selected = null;
    this._sort = { key: 'shipBy', direction: 'asc' };
    this._filters = { customer: '', part: '' };
    this._groupByPart = true;
    this._site = 'MfgSys';
    this._horizon = 4;
    this._loading = false;
    this._error = '';
    this._jobs = [];
    this._jobError = '';
    this._jobsLoading = false;
    this._materials = [];
    this._inventory = new Map();
    this._incoming = new Map();
    this._materialsError = '';
    this._materialsLoading = false;
    this._jobOperationsAvailable = true;
    this._hideNoOpenOps = true;
    this._showStaleJobs = false;
    this._jobType = 'MFG';
    this._batchWindow = 10;
    this._batchGroups = [];
    this._capacity = this._readCapacity();
    this._capacityWeeks = [];
    this._capacityCells = new Map();
    this._activeTab = 'today';
    this._todayTargets = [];
    this._demandFocusIds = null;
    this._jobFocusNums = null;
    this._materialFocusKeys = null;
    this._capacityFocusKeys = null;
    this._batchFocusIndex = null;
    this._releaseJobPending = null;
    this._releaseBusy = false;
    this._activityLog = [];
    this._lastRefreshed = null;
  }

  _readCapacity() {
    try { return JSON.parse(localStorage.getItem('planner-capacity-hours') || '{}'); } catch (error) { return {}; }
  }

  _saveCapacity() {
    try { localStorage.setItem('planner-capacity-hours', JSON.stringify(this._capacity)); } catch (error) { /* browser storage may be unavailable */ }
  }

  async initialize() {
    this.prism = this.host.prism;
  }

  connect() {
    this.host.contentRoot.innerHTML = `<style>${STYLES}${THEME_CSS}</style>${TEMPLATE}`;
    this._cacheElements();
    this._wireControls();
    const todayTab = this.host.contentRoot.querySelector('[data-tab="today"]');
    if (todayTab) this._selectTab(todayTab);
    this._render();
    this._refreshAll();
  }

  async _refreshAll() {
    await this.loadDemand();
    await this._loadJobs();
  }

  _cacheElements() {
    const root = this.host.contentRoot;
    this._els = {
      root,
      site: root.querySelector('#site-selector'),
      horizon: root.querySelector('#horizon-selector'),
      refresh: root.querySelector('#refresh-button'),
      refreshed: root.querySelector('#last-refreshed'),
      customer: root.querySelector('#customer-filter'),
      part: root.querySelector('#part-filter'),
      group: root.querySelector('#group-by-part'),
      tableBody: root.querySelector('#demand-table-body'),
      tableStatus: root.querySelector('#table-status'),
      todayView: root.querySelector('#today-view'),
      todaySummary: root.querySelector('#today-summary'),
      todaySections: root.querySelector('#today-sections'),
      demandView: root.querySelector('#demand-view'),
      jobsView: root.querySelector('#jobs-view'),
      jobsStatus: root.querySelector('#jobs-status'),
      jobsBody: root.querySelector('#jobs-table-body'),
      activityLog: root.querySelector('#activity-log'),
      releaseDialog: root.querySelector('#release-dialog'),
      releaseBackdrop: root.querySelector('#release-dialog-backdrop'),
      releaseClose: root.querySelector('#release-dialog-close'),
      releaseCancel: root.querySelector('#release-dialog-cancel'),
      releaseConfirm: root.querySelector('#release-dialog-confirm'),
      releaseOverride: root.querySelector('#release-override-material'),
      releaseError: root.querySelector('#release-dialog-error'),
      releaseJobNumber: root.querySelector('#release-job-number'),
      releaseJobPart: root.querySelector('#release-job-part'),
      releaseJobQuantity: root.querySelector('#release-job-quantity'),
      releaseJobDue: root.querySelector('#release-job-due'),
      releaseJobMaterialStatus: root.querySelector('#release-job-material-status'),
      materialsView: root.querySelector('#materials-view'),
      materialsStatus: root.querySelector('#materials-status'),
      materialsBody: root.querySelector('#materials-body'),
      readyReleaseList: root.querySelector('#ready-release-list'),
      hideNoOpenOps: root.querySelector('#hide-no-open-ops'),
      showStaleJobs: root.querySelector('#show-stale-jobs'),
      jobType: root.querySelector('#job-type-filter'),
      staleHiddenCount: root.querySelector('#stale-hidden-count'),
      batchingView: root.querySelector('#batching-view'),
      batchingStatus: root.querySelector('#batching-status'),
      batchingGroups: root.querySelector('#batching-groups'),
      batchWindow: root.querySelector('#batch-window'),
      capacityView: root.querySelector('#capacity-view'),
      capacityStatus: root.querySelector('#capacity-status'),
      capacitySummary: root.querySelector('#capacity-summary'),
      capacityControls: root.querySelector('#capacity-controls'),
      capacityHead: root.querySelector('#capacity-head'),
      capacityBody: root.querySelector('#capacity-body'),
      capacityDetail: root.querySelector('#capacity-detail'),
      panel: root.querySelector('#detail-panel'),
      panelContent: root.querySelector('#detail-panel-content'),
      closePanel: root.querySelector('#close-detail-panel'),
      kpis: {
        demand: root.querySelector('#kpi-demand'),
        uncovered: root.querySelector('#kpi-uncovered'),
        late: root.querySelector('#kpi-late'),
        unreleased: root.querySelector('#kpi-unreleased')
      }
    };
  }

  _wireControls() {
    const e = this._els;
    if (e.site) e.site.addEventListener('change', () => { this._site = e.site.value; this._refreshAll(); });
    if (e.horizon) e.horizon.addEventListener('change', () => { this._horizon = Number(e.horizon.value); this._refreshAll(); });
    if (e.refresh) e.refresh.addEventListener('click', () => { this._refreshAll(); });
    if (e.customer) e.customer.addEventListener('input', () => { this._filters.customer = e.customer.value; this._renderDemand(); });
    if (e.part) e.part.addEventListener('input', () => { this._filters.part = e.part.value; this._renderDemand(); });
    if (e.group) e.group.addEventListener('change', () => { this._groupByPart = e.group.checked; this._renderDemand(); });
    if (e.hideNoOpenOps) e.hideNoOpenOps.addEventListener('change', () => { this._hideNoOpenOps = e.hideNoOpenOps.checked; this._renderJobs(); this._renderMaterials(); this._renderBatching(); });
    if (e.showStaleJobs) e.showStaleJobs.addEventListener('change', () => { this._showStaleJobs = e.showStaleJobs.checked; this._renderJobs(); this._renderMaterials(); this._renderBatching(); this._renderCapacity(); this._renderKpis(); });
    if (e.jobType) e.jobType.addEventListener('change', () => { this._jobType = e.jobType.value; this._renderJobs(); this._renderMaterials(); this._renderBatching(); this._renderCapacity(); this._renderKpis(); });
    if (e.batchWindow) e.batchWindow.addEventListener('change', () => { this._batchWindow = Number(e.batchWindow.value); this._renderBatching(); });
    if (e.closePanel) e.closePanel.addEventListener('click', () => this._closePanel());
    const tabs = this.host.contentRoot.querySelectorAll('[data-tab]');
    tabs.forEach((tab) => tab.addEventListener('click', () => this._selectTab(tab)));
    const backdrop = this.host.contentRoot.querySelector('#panel-backdrop');
    if (backdrop) backdrop.addEventListener('click', () => this._closePanel());
    this.host.contentRoot.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this._releaseJobPending) this._closeReleaseDialog();
      else if (event.key === 'Escape' && this._selected) this._closePanel();
    });
    this.host.contentRoot.addEventListener('click', (event) => {
      const releaseButton = event.target.closest('[data-release-job]');
      if (releaseButton) { event.stopPropagation(); this._openReleaseDialog(releaseButton.dataset.releaseJob); return; }
      const link = event.target.closest('[data-today-target]');
      if (link) this._openTodayTarget(Number(link.dataset.todayTarget));
    });
    if (e.releaseClose) e.releaseClose.addEventListener('click', () => this._closeReleaseDialog());
    if (e.releaseCancel) e.releaseCancel.addEventListener('click', () => this._closeReleaseDialog());
    if (e.releaseBackdrop) e.releaseBackdrop.addEventListener('click', () => this._closeReleaseDialog());
    if (e.releaseConfirm) e.releaseConfirm.addEventListener('click', () => this._confirmRelease());
  }

  async loadDemand() {
    if (this._loading) return;
    this._loading = true;
    this._error = '';
    this._render();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const horizonEnd = new Date(start);
    horizonEnd.setDate(horizonEnd.getDate() + this._horizon * 7);
    const horizonEndValue = horizonEnd.toISOString();
    const site = String(this._site).replace(/'/g, "''");
    const input = {
      $filter: 'OpenOrder eq true',
      $select: 'OrderNum,CustNum,CustomerCustID,CustomerName',
      $expand: `OrderDtls($filter=OpenLine eq true;$select=OrderLine,PartNum,RevisionNum;$expand=OrderRels($filter=OpenRelease eq true and ReqDate le ${horizonEndValue} and Plant eq '${site}';$select=OrderRelNum,Plant,NeedByDate,ReqDate,OurReqQty,OurJobQty,OurStockQty,OurJobShippedQty,OurStockShippedQty))`,
      $top: String(PAGE_SIZE)
    };
    try {
      let result;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          result = await this.host.callService({ service: SERVICE_NAME, operation: 'SalesOrders', method: 'GET', input });
          break;
        } catch (error) {
          const message = String(error && (error.message || error.code || error.name || error.status) ? (error.message || error.code || error.name || error.status) : error).toLowerCase();
          if (attempt === 0 && (message.includes('timeout') || message.includes('timed out'))) continue;
          throw error;
        }
      }
      const orders = result && result.data && Array.isArray(result.data.value) ? result.data.value.filter((order) => Array.isArray(order.OrderDtls) && order.OrderDtls.some((detail) => Array.isArray(detail.OrderRels) && detail.OrderRels.length)) : [];
      this._rows = this._normalizeRows(orders);
      this._lastRefreshed = new Date();
    } catch (error) {
      this._rows = [];
      this._error = error && error.message ? error.message : 'The Sales Order service is unavailable.';
    } finally {
      this._loading = false;
      this._render();
    }
  }

  _normalizeRows(orders) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const horizonEnd = new Date(start);
    horizonEnd.setDate(horizonEnd.getDate() + this._horizon * 7);
    return orders.flatMap((order) => (Array.isArray(order.OrderDtls) ? order.OrderDtls : []).flatMap((detail) => (Array.isArray(detail.OrderRels) ? detail.OrderRels : []).map((release, index) => {
      const shipBy = release.ReqDate;
      const shipDate = shipBy ? new Date(shipBy) : null;
      const inHorizon = shipDate && !Number.isNaN(shipDate.getTime()) && shipDate >= start && shipDate <= horizonEnd;
      const remaining = Number(release.OurReqQty || 0) - Number(release.OurJobShippedQty || 0) - Number(release.OurStockShippedQty || 0);
      const coveredByJob = Number(release.OurJobQty || 0);
      const fromStock = Number(release.OurStockQty || 0);
      return inHorizon && release.Plant === this._site ? {
        id: `${order.OrderNum || 'order'}-${detail.OrderLine || 'line'}-${release.OrderRelNum || index}`,
        order: order.OrderNum,
        line: detail.OrderLine,
        release: release.OrderRelNum ?? index + 1,
        customer: order.CustomerName || order.CustomerCustID || order.CustNum || '—',
        part: detail.PartNum || '—',
        rev: detail.RevisionNum || '—',
        needBy: release.NeedByDate,
        shipBy,
        remaining,
        coveredByJob,
        fromStock,
        uncovered: Math.max(0, remaining - coveredByJob - fromStock),
        linkedJobs: null,
        raw: { order, detail, release }
      } : null;
    }).filter(Boolean)));
  }

  _selectTab(tab) {
    const tabs = this.host.contentRoot.querySelectorAll('[data-tab]');
    tabs.forEach((item) => {
      const selected = item === tab;
      item.setAttribute('aria-selected', selected ? 'true' : 'false');
      item.classList.toggle('is-active', selected);
    });
    this._activeTab = tab.dataset.tab;
    const views = { today: this._els.todayView, demand: this._els.demandView, jobs: this._els.jobsView, batching: this._els.batchingView, capacity: this._els.capacityView, materials: this._els.materialsView };
    Object.keys(views).forEach((name) => {
      const view = views[name];
      if (view) { view.hidden = name !== this._activeTab; view.setAttribute('aria-hidden', name === this._activeTab ? 'false' : 'true'); }
    });
    const status = this.host.contentRoot.querySelector('#tab-status');
    if (this._activeTab === 'today') {
      if (status) status.textContent = '';
      this._renderToday();
    } else if (this._activeTab === 'materials') {
      if (status) status.textContent = '';
      if (!this._materials.length && !this._materialsLoading) this._loadMaterials();
      this._renderMaterials();
    } else if (this._activeTab === 'capacity') {
      if (status) status.textContent = '';
      this._renderCapacity();
    } else if (this._activeTab === 'batching') {
      if (status) status.textContent = '';
      this._renderBatching();
    } else if (this._activeTab === 'jobs') {
      if (!this._jobs.length && !this._jobsLoading) this._loadJobs();
      if (status) status.textContent = '';
      this._renderJobs();
    } else if (status) {
      status.textContent = this._activeTab === 'demand' ? '' : `${tab.textContent.trim()} is reserved for a future planning workstream.`;
    }
  }

  async _loadJobs() {
    if (this._jobsLoading) return;
    this._jobsLoading = true;
    this._jobError = '';
    this._jobOperationsAvailable = true;
    this._renderJobs();
    const fields = 'JobNum,PartNum,RevisionNum,ProdQty,StartDate,ReqDueDate,DueDate,JobFirm,JobEngineered,JobReleased,SchedLocked,JobType';
    const expand = 'JobAsmbls($select=AssemblySeq,PartNum;$expand=JobOpers($select=OprSeq,OpCode,OpComplete,QtyCompleted,EstSetHours,EstProdHours,StartDate,DueDate;$expand=JobOpDtls($select=ResourceGrpID)),JobMtls($select=PartNum,RequiredQty,IssuedQty,ReqDate,RelatedOperation))';
    try {
      let result;
      try {
        result = await this.host.callService({ service: 'Erp.BO.JobEntrySvc', operation: 'JobEntries', method: 'GET', input: { $filter: `JobComplete eq false and JobClosed eq false and Plant eq '${String(this._site).replace(/'/g, "''")}'`, $select: fields, $expand: expand, $top: String(PAGE_SIZE) } });
      } catch (expandError) {
        this._jobOperationsAvailable = false;
        result = await this.host.callService({ service: 'Erp.BO.JobEntrySvc', operation: 'JobEntries', method: 'GET', input: { $filter: `JobComplete eq false and JobClosed eq false and Plant eq '${String(this._site).replace(/'/g, "''")}'`, $select: fields, $top: String(PAGE_SIZE) } });
      }
      const jobs = result && result.data && Array.isArray(result.data.value) ? result.data.value : [];
      this._jobs = jobs.map((job) => this._normalizeJob(job));
    } catch (error) {
      this._jobs = [];
      this._jobError = error && error.message ? error.message : 'The JobEntry service is unavailable.';
    } finally {
      this._jobsLoading = false;
      this._renderJobs();
      await this._loadMaterials();
      this._renderBatching();
      this._renderCapacity();
      this._renderKpis();
    }
  }

  _normalizeJob(job) {
    const operations = (Array.isArray(job.JobAsmbls) ? job.JobAsmbls : []).flatMap((assembly) => (Array.isArray(assembly.JobOpers) ? assembly.JobOpers : []).map((operation) => ({ ...operation, assembly: assembly.AssemblySeq, operationDetails: Array.isArray(operation.JobOpDtls) ? operation.JobOpDtls : [] })));
    const assemblies = this._assemblyGroups({ ...job, operations });
    const firstAssembly = assemblies.find((assembly) => assembly.operations.some((operation) => !operation.OpComplete));
    const firstOpen = firstAssembly && firstAssembly.operations.find((operation) => !operation.OpComplete);
    const currentOp = firstOpen ? `Asm ${firstAssembly.assembly} · Op ${firstOpen.OprSeq} ${firstOpen.OpCode || ''}` : (this._jobOperationsAvailable ? 'No open operation' : 'Open job for detail');
    const materials = (Array.isArray(job.JobAsmbls) ? job.JobAsmbls : []).flatMap((assembly) => (Array.isArray(assembly.JobMtls) ? assembly.JobMtls : []).map((material) => {
      const relatedOperation = (assembly.JobOpers || []).find((operation) => Number(operation.OprSeq) === Number(material.RelatedOperation));
      const materialReqDate = material.ReqDate || (relatedOperation && relatedOperation.StartDate) || job.StartDate || '';
      return { ...material, JobNum: job.JobNum, AssemblySeq: assembly.AssemblySeq, materialReqDate, materialReqDateEstimated: !material.ReqDate, shortQty: 0 };
    }));
    return { ...job, operations, assemblies, materials, currentOp };
  }

  async _loadJobOperations(job) {
    try {
      const result = await this.host.callService({ service: 'Erp.BO.JobEntrySvc', operation: 'GetByID', method: 'POST', input: { jobNum: job.JobNum } });
      const payload = result && result.data && result.data.returnObj ? result.data.returnObj : {};
      const operations = Array.isArray(payload.JobOper) ? payload.JobOper : (Array.isArray(payload.JobAsmbl) ? payload.JobAsmbl.flatMap((assembly) => Array.isArray(assembly.JobOper) ? assembly.JobOper : (Array.isArray(assembly.JobOpers) ? assembly.JobOpers : [])) : []);
      job.operations = operations;
      job.assemblies = this._assemblyGroups(job);
      const firstAssembly = job.assemblies.find((assembly) => assembly.operations.some((operation) => !operation.OpComplete));
      const firstOpen = firstAssembly && firstAssembly.operations.find((operation) => !operation.OpComplete);
      job.currentOp = firstOpen ? `Asm ${firstAssembly.assembly} · Op ${firstOpen.OprSeq} ${firstOpen.OpCode || ''}` : 'No open operation';
      this._jobError = '';
    } catch (error) {
      this._jobError = error && error.message ? error.message : 'The JobEntry service is unavailable.';
    }
    this._renderJobs();
    this._renderBatching();
    this._renderCapacity();
  }

  async _loadMaterials() {
    if (this._materialsLoading || this._jobsLoading) return;
    this._materialsLoading = true;
    this._materialsError = '';
    this._renderMaterials();
    try {
      const materials = this._jobs.flatMap((job) => Array.isArray(job.materials) ? job.materials : []);
      this._materials = materials;
      const parts = [...new Set(materials.map((material) => material.PartNum).filter(Boolean))];
      this._inventory = new Map();
      for (let index = 0; index < parts.length; index += 25) {
        const group = parts.slice(index, index + 25);
        const filter = group.map((part) => `PartNum eq '${String(part).replace(/'/g, "''")}'`).join(' or ');
        const result = await this.host.callService({ service: 'Erp.BO.PartSvc', operation: 'Parts', method: 'GET', input: { $filter: filter, $select: 'PartNum,PartDescription', $expand: 'PartWhses($select=WarehouseCode,OnHandQty,AllocatedQty)' } });
        (result && result.data && Array.isArray(result.data.value) ? result.data.value : []).forEach((part) => {
          const warehouses = Array.isArray(part.PartWhses) ? part.PartWhses : [];
          this._inventory.set(part.PartNum, warehouses.reduce((sum, warehouse) => sum + Number(warehouse.OnHandQty || 0) - Number(warehouse.AllocatedQty || 0), 0));
        });
      }
      const poResult = await this.host.callService({ service: 'Erp.BO.POSvc', operation: 'POes', method: 'GET', input: { $filter: 'OpenOrder eq true', $select: 'PONum,OpenOrder,VendorNum', $expand: 'PODetails($select=POLine,PartNum,OrderQty,DueDate;$filter=OpenLine eq true;$expand=PORels($select=XRelQty,ReceivedQty,DueDate;$filter=OpenRelease eq true))' } });
      this._incoming = new Map();
      (poResult && poResult.data && Array.isArray(poResult.data.value) ? poResult.data.value : []).forEach((po) => (Array.isArray(po.PODetails) ? po.PODetails : []).forEach((detail) => (Array.isArray(detail.PORels) ? detail.PORels : []).forEach((release) => {
        if (!this._incoming.has(detail.PartNum)) this._incoming.set(detail.PartNum, []);
        this._incoming.get(detail.PartNum).push({ quantity: Math.max(0, Number(release.XRelQty || 0) - Number(release.ReceivedQty || 0)), ordered: Number(release.XRelQty || 0), received: Number(release.ReceivedQty || 0), dueDate: release.DueDate, expectedDate: release.PromiseDt || release.DueDate, poNum: po.PONum, poLine: detail.POLine, vendorNum: po.VendorNum });
      })));
      this._refreshMaterialStatuses();
    } catch (error) {
      this._materialsError = error && error.message ? error.message : 'Materials query failed.';
    } finally {
      this._materialsLoading = false;
      this._renderMaterials();
      this._renderJobs();
    }
  }

  _materialLine(material) {
    const onHand = material.allocatedOnHand === undefined ? Number(this._inventory.get(material.PartNum) || 0) : Number(material.allocatedOnHand || 0);
    const supplies = (this._incoming.get(material.PartNum) || []).slice();
    const incoming = supplies.reduce((sum, supply) => sum + Number(supply.quantity || 0), 0);
    const shortQty = Math.max(0, Number(material.RequiredQty || 0) - Number(material.IssuedQty || 0) - onHand);
    return { ...material, onHand, incoming, shortQty, supplies };
  }

  _visibleMaterialJobs() {
    return this._jobs.filter((job) => this._isVisibleJob(job) && (!this._hideNoOpenOps || job.operations.some((operation) => !operation.OpComplete)));
  }

  _refreshMaterialStatuses() {
    const remaining = new Map(this._inventory);
    const jobs = this._visibleMaterialJobs().slice().sort((a, b) => {
      const aDate = Math.min(...(a.materials || []).map((material) => new Date(material.materialReqDate || 8640000000000000).getTime()));
      const bDate = Math.min(...(b.materials || []).map((material) => new Date(material.materialReqDate || 8640000000000000).getTime()));
      return aDate - bDate;
    });
    jobs.forEach((job) => (job.materials || []).forEach((material) => {
      const need = Math.max(0, Number(material.RequiredQty || 0) - Number(material.IssuedQty || 0));
      const available = Math.max(0, Number(remaining.get(material.PartNum) || 0));
      const allocated = Math.min(need, available);
      material.allocatedOnHand = allocated;
      remaining.set(material.PartNum, available - allocated);
    }));
    this._jobs.forEach((job) => { job.materialStatus = this._materialStatus(job); });
  }

  _materialStatus(job) {
    const lines = (Array.isArray(job.materials) ? job.materials : []).map((material) => this._materialLine(material));
    const shortages = lines.filter((material) => material.shortQty > 0);
    if (!shortages.length) return { label: 'Ready', tone: 'ready', severity: 0, shortParts: [], lines };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const pastDue = shortages.some((material) => material.materialReqDate && new Date(material.materialReqDate) < today);
    if (pastDue) return { label: 'Short - past due', tone: 'short', severity: 0, shortParts: shortages.map((material) => material.PartNum), lines };
    const hasNoSupply = shortages.some((material) => !material.supplies.some((supply) => supply.quantity > 0));
    if (hasNoSupply) return { label: 'Short - no supply', tone: 'short', severity: 0, shortParts: shortages.map((material) => material.PartNum), lines };
    const hasOverdueSupply = shortages.some((material) => material.supplies.some((supply) => supply.quantity > 0 && supply.expectedDate && new Date(supply.expectedDate) < today));
    if (hasOverdueSupply) return { label: 'Short - PO overdue', tone: 'short', severity: 1, shortParts: shortages.map((material) => material.PartNum), lines };
    const hasLateSupply = shortages.some((material) => material.materialReqDate && material.supplies.filter((supply) => supply.quantity > 0).every((supply) => supply.expectedDate && new Date(supply.expectedDate) > new Date(material.materialReqDate)));
    if (hasLateSupply) return { label: 'Short - PO late', tone: 'short', severity: 1, shortParts: shortages.map((material) => material.PartNum), lines };
    return { label: 'Short - PO arriving in time', tone: 'arriving', severity: 2, shortParts: shortages.map((material) => material.PartNum), lines };
  }

  _lineStatus(material) {
    // Status for a single material line; the job-level status stays in _materialStatus for the Jobs tab.
    if (!(material.shortQty > 0)) return { label: 'Ready', tone: 'ready' };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (material.materialReqDate && new Date(material.materialReqDate) < today) return { label: 'Short - past due', tone: 'short' };
    const supplies = (material.supplies || []).filter((supply) => supply.quantity > 0);
    if (!supplies.length) return { label: 'Short - no supply', tone: 'short' };
    if (supplies.some((supply) => supply.expectedDate && new Date(supply.expectedDate) < today)) return { label: 'Short - PO overdue', tone: 'short' };
    const reqTime = material.materialReqDate ? new Date(material.materialReqDate).getTime() : null;
    if (reqTime !== null && supplies.every((supply) => supply.expectedDate && new Date(supply.expectedDate).getTime() > reqTime)) return { label: 'Short - PO late', tone: 'short' };
    return { label: 'Short - PO arriving in time', tone: 'arriving' };
  }

  _getVisibleJobMaterials() {
    return this._jobs.filter((job) => this._isVisibleJob(job) && (!this._hideNoOpenOps || job.operations.some((operation) => !operation.OpComplete))).flatMap((job) => (job.materialStatus && Array.isArray(job.materialStatus.lines) ? job.materialStatus.lines : []));
  }

  _renderMaterials() {
    const e = this._els;
    if (!e || !e.materialsBody || !e.materialsStatus) return;
    if (this._materialsLoading) { e.materialsStatus.innerHTML = '<span class="status-dot loading-dot"></span>Loading inventory and open PO supply…'; e.materialsBody.innerHTML = ''; return; }
    if (this._materialsError) { e.materialsStatus.innerHTML = `<span class="status-dot error-dot"></span>${escapeHtml(this._materialsError)}`; e.materialsBody.innerHTML = ''; if (e.readyReleaseList) e.readyReleaseList.innerHTML = ''; return; }
    this._refreshMaterialStatuses();
    const rows = this._getVisibleJobMaterials().filter((material) => !this._materialFocusKeys || this._materialFocusKeys.has(`${material.JobNum}|${material.PartNum}`)).sort((a, b) => {
      const dateCompare = new Date(a.materialReqDate || 8640000000000000) - new Date(b.materialReqDate || 8640000000000000);
      if (dateCompare) return dateCompare;
      const aJob = this._jobs.find((job) => String(job.JobNum) === String(a.JobNum));
      const bJob = this._jobs.find((job) => String(job.JobNum) === String(b.JobNum));
      return (aJob?.materialStatus?.severity ?? 9) - (bJob?.materialStatus?.severity ?? 9);
    });
    e.materialsStatus.textContent = `${rows.length.toLocaleString()} visible material line${rows.length === 1 ? '' : 's'} · inventory batched in groups of 25`;
    e.materialsBody.innerHTML = rows.map((material) => { const job = this._jobs.find((item) => String(item.JobNum) === String(material.JobNum)); const status = this._lineStatus(material); return `<tr><td class="mono">${escapeHtml(material.JobNum)}</td><td class="mono">${escapeHtml(material.PartNum)}</td><td class="number-cell mono">${formatQty(material.RequiredQty)}</td><td class="number-cell mono">${formatQty(material.IssuedQty)}</td><td class="number-cell mono">${formatQty(material.onHand)}</td><td class="number-cell mono">${formatQty(material.incoming)}</td><td class="number-cell mono">${formatQty(material.shortQty)}</td><td>${formatDate(material.materialReqDate)}${material.materialReqDateEstimated ? ' (est.)' : ''}</td><td class="material-status ${status.tone}">${escapeHtml(status.label)}</td></tr>`; }).join('');
    const ready = this._jobs.filter((job) => this._isVisibleJob(job) && (!this._hideNoOpenOps || job.operations.some((operation) => !operation.OpComplete)) && job.JobFirm && job.JobReleased === false && job.materialStatus && job.materialStatus.label === 'Ready');
    if (e.readyReleaseList) e.readyReleaseList.innerHTML = ready.length ? ready.map((job) => `<li><strong class="mono">${escapeHtml(job.JobNum)}</strong> · ${escapeHtml(job.PartNum || '—')} · due ${escapeHtml(formatDate(job.DueDate || job.ReqDueDate))}</li>`).join('') : '<li>No firm, unreleased jobs are ready to release.</li>';
  }

  _isStaleJob(job) {
    const days = daysFromToday(job.DueDate || job.ReqDueDate);
    return days !== null && days < -60;
  }

  _isVisibleJob(job) {
    return (this._jobType === 'ALL' || job.JobType === this._jobType) && (this._showStaleJobs || !this._isStaleJob(job));
  }

  _releaseButton(job) {
    if (!job || !job.JobFirm || job.JobReleased !== false) return '';
    const ready = job.materialStatus && job.materialStatus.label === 'Ready';
    return `<button type="button" class="release-job-button" data-release-job="${escapeHtml(job.JobNum)}" ${ready ? '' : 'disabled'} title="${ready ? 'Release this job' : 'Materials must be Ready to release'}">Release</button>`;
  }

  _openReleaseDialog(jobNum) {
    const job = this._jobs.find((item) => String(item.JobNum) === String(jobNum));
    if (!job || !job.JobFirm || job.JobReleased !== false) return;
    this._releaseJobPending = job;
    const e = this._els;
    if (e.releaseJobNumber) e.releaseJobNumber.textContent = job.JobNum || '—';
    if (e.releaseJobPart) e.releaseJobPart.textContent = job.PartNum || '—';
    if (e.releaseJobQuantity) e.releaseJobQuantity.textContent = formatQty(job.ProdQty);
    if (e.releaseJobDue) e.releaseJobDue.textContent = formatDate(job.DueDate || job.ReqDueDate);
    if (e.releaseJobMaterialStatus) e.releaseJobMaterialStatus.textContent = job.materialStatus ? job.materialStatus.label : 'Unavailable';
    if (e.releaseOverride) e.releaseOverride.checked = false;
    if (e.releaseError) { e.releaseError.hidden = true; e.releaseError.textContent = ''; }
    if (e.releaseDialog) e.releaseDialog.hidden = false;
    if (e.releaseBackdrop) e.releaseBackdrop.hidden = false;
    if (e.releaseConfirm) { e.releaseConfirm.disabled = false; e.releaseConfirm.textContent = 'Release job'; e.releaseConfirm.focus(); }
  }

  _closeReleaseDialog() {
    if (this._releaseBusy) return;
    this._releaseJobPending = null;
    if (this._els.releaseDialog) this._els.releaseDialog.hidden = true;
    if (this._els.releaseBackdrop) this._els.releaseBackdrop.hidden = true;
  }

  _releaseErrorMessage(error) {
    const data = error && error.data;
    const raw = String((data && (data.ErrorMessage || data.errorMessage || data.message)) || (error && (error.message || error.ErrorMessage)) || 'The job could not be released.').replace(/^Error:\s*/i, '');
    const code = String((error && (error.code || error.errorCode)) || (data && (data.code || data.errorCode)) || '').toUpperCase();
    return code === 'FORBIDDEN' || code === 'UNAUTHORIZED' || /allow erp updates|erp update permission|write permission|not authorized|forbidden|write.*(refus|den|allow|disable)|update.*(refus|den|allow|disable)/i.test(raw) ? ERP_UPDATE_NOTE : raw;
  }

  async _confirmRelease() {
    const job = this._releaseJobPending;
    if (!job || this._releaseBusy) return;
    const override = Boolean(this._els.releaseOverride && this._els.releaseOverride.checked);
    if (!override && (!job.materialStatus || job.materialStatus.label !== 'Ready')) {
      if (this._els.releaseError) { this._els.releaseError.hidden = false; this._els.releaseError.textContent = 'Materials must be Ready before this job can be released.'; }
      return;
    }
    this._releaseBusy = true;
    if (this._els.releaseConfirm) { this._els.releaseConfirm.disabled = true; this._els.releaseConfirm.textContent = 'Releasing…'; }
    try {
      const getResult = await this.host.callService({ service: 'Erp.BO.JobEntrySvc', operation: 'GetByID', method: 'POST', input: { jobNum: job.JobNum } });
      const ds = getResult && getResult.data && getResult.data.returnObj;
      if (!ds || !Array.isArray(ds.JobHead) || !ds.JobHead[0]) throw new Error('Kinetic did not return the job dataset.');
      ds.JobHead[0].JobReleased = true;
      ds.JobHead[0].RowMod = 'U';
      const changeResult = await this.host.callService({ service: 'Erp.BO.JobEntrySvc', operation: 'ChangeJobHeadJobReleased', method: 'POST', input: { ds } });
      const changedDs = changeResult && changeResult.data && changeResult.data.parameters && changeResult.data.parameters.ds;
      if (!changedDs) throw new Error('Kinetic did not return the changed job dataset.');
      await this.host.callService({ service: 'Erp.BO.JobEntrySvc', operation: 'Update', method: 'POST', input: { ds: changedDs } });
      this._activityLog.unshift({ time: new Date(), job: job.JobNum, action: 'Release Job', result: 'Success' });
      this._activityLog = this._activityLog.slice(0, 20);
      this._releaseBusy = false;  // must clear before closing: _closeReleaseDialog ignores closes while busy
      this._closeReleaseDialog();
      await this._loadJobs();
      this._renderActivityLog();
    } catch (error) {
      if (this._els.releaseError) { this._els.releaseError.hidden = false; this._els.releaseError.textContent = this._releaseErrorMessage(error); }
    } finally {
      this._releaseBusy = false;
      if (this._els.releaseConfirm && this._releaseJobPending) { this._els.releaseConfirm.disabled = false; this._els.releaseConfirm.textContent = 'Release job'; }
    }
  }

  _renderActivityLog() {
    const e = this._els;
    if (!e || !e.activityLog) return;
    e.activityLog.innerHTML = this._activityLog.length ? this._activityLog.map((entry) => `<li><span class="mono">${escapeHtml(entry.time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</span><span>${escapeHtml(entry.job)} · ${escapeHtml(entry.action)} · ${escapeHtml(entry.result)}</span></li>`).join('') : '<li>No job release activity yet.</li>';
  }

  _assemblyGroups(job) {
    const groups = new Map();
    (Array.isArray(job.operations) ? job.operations : []).forEach((operation) => {
      const seq = Number(operation.assembly ?? operation.AssemblySeq ?? 0);
      if (!groups.has(seq)) groups.set(seq, []);
      groups.get(seq).push(operation);
    });
    return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([assembly, operations]) => ({ assembly, part: job.JobAsmbls && job.JobAsmbls.find((item) => Number(item.AssemblySeq) === assembly)?.PartNum || job.PartNum, operations: operations.sort((a, b) => Number(a.OprSeq || 0) - Number(b.OprSeq || 0)) }));
  }

  _renderJobs() {
    const e = this._els;
    if (!e || !e.jobsBody || !e.jobsStatus) return;
    if (this._jobsLoading) { e.jobsStatus.innerHTML = '<span class="status-dot loading-dot"></span>Loading open jobs from JobEntrySvc…'; e.jobsBody.innerHTML = ''; return; }
    if (this._jobError) { e.jobsStatus.innerHTML = `<span class="status-dot error-dot"></span>${escapeHtml(this._jobError)}`; e.jobsBody.innerHTML = ''; return; }
    const staleCount = this._jobs.filter((job) => this._isStaleJob(job) && (this._jobType === 'ALL' || job.JobType === this._jobType)).length;
    if (e.staleHiddenCount) e.staleHiddenCount.textContent = this._showStaleJobs ? '(shown)' : `(${staleCount} hidden)`;
    const visibleJobs = this._jobs.filter((job) => (!this._jobFocusNums || this._jobFocusNums.has(String(job.JobNum))) && this._isVisibleJob(job) && (!this._hideNoOpenOps || job.operations.some((operation) => !operation.OpComplete)));
    if (!visibleJobs.length) { e.jobsStatus.innerHTML = '<span class="status-dot info-dot"></span>No open jobs match the current operation filter.'; e.jobsBody.innerHTML = ''; return; }
    e.jobsStatus.textContent = `${visibleJobs.length.toLocaleString()} visible open job${visibleJobs.length === 1 ? '' : 's'} for ${this._site}`;
    e.jobsBody.innerHTML = visibleJobs.map((job) => {
      const days = daysFromToday(job.DueDate || job.ReqDueDate);
      const dueClass = days !== null && days < 0 ? 'late' : '';
      const releaseClass = job.JobReleased === false ? 'unreleased' : '';
      const operations = Array.isArray(job.assemblies) && job.assemblies.length
        ? '<tr class="job-operations"><td colspan="9"><ul class="operation-list">' + job.assemblies.map((assembly) => '<li><strong>Asm ' + escapeHtml(assembly.assembly) + (assembly.part ? ' (' + escapeHtml(assembly.part) + ')' : ' (top level)') + '</strong>: ' + assembly.operations.map((operation) => '<span class="mono">Op ' + escapeHtml(operation.OprSeq) + '</span> ' + escapeHtml(operation.OpCode || 'Operation') + ' · ' + (operation.OpComplete ? 'Complete' : 'Open')).join(', ') + '</li>').join('') + '</ul></td></tr>'
        : '';
      const materialStatus = job.materialStatus || { label: 'Loading…', tone: '' };
      return `<tr class="demand-row jobs-row" tabindex="0" data-job-num="${escapeHtml(job.JobNum)}" aria-label="Job ${escapeHtml(job.JobNum)}, due ${escapeHtml(formatDate(job.DueDate || job.ReqDueDate))}"><td class="mono">${escapeHtml(job.JobNum)}</td><td class="mono">${escapeHtml(job.PartNum)}</td><td class="mono">${escapeHtml(job.RevisionNum || '—')}</td><td class="date-cell ${dueClass}">${formatDate(job.DueDate || job.ReqDueDate)}</td><td class="job-status ${releaseClass}">${job.JobReleased === false ? 'No' : 'Yes'}</td><td>${job.JobFirm ? 'Yes' : 'No'}</td><td class="material-status ${materialStatus.tone}">${escapeHtml(materialStatus.label)}</td><td class="job-status ${dueClass}">${escapeHtml(job.currentOp)}</td><td>${this._releaseButton(job)}</td></tr>${operations}`;
    }).join('');
    e.jobsBody.querySelectorAll('.jobs-row').forEach((rowEl) => {
      const open = (event) => { if (event && event.target.closest('[data-release-job]')) return; const job = this._jobs.find((item) => String(item.JobNum) === String(rowEl.dataset.jobNum)); if (job && !this._jobOperationsAvailable && !job.operations.length) this._loadJobOperations(job); if (job) this._openJobDetail(job.JobNum); };
      rowEl.addEventListener('click', open);
      rowEl.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
    });
  }

  _buildBatchGroups() {
    const candidates = this._jobs.filter((job) => this._isVisibleJob(job)).flatMap((job) => this._assemblyGroups(job).map((assembly) => {
      const firstOpen = assembly.operations.find((operation) => !operation.OpComplete);
      return firstOpen ? { job, assembly, operation: firstOpen, due: new Date(job.DueDate || job.ReqDueDate), start: new Date(job.StartDate || Date.now()) } : null;
    })).filter((item) => item && !Number.isNaN(item.due.getTime()));
    const groups = [];
    const addGroup = (members, label) => {
      if (members.length < 2) return;
      const dueDates = members.map((item) => item.due.getTime());
      const earliest = Math.min(...dueDates);
      const latest = Math.max(...dueDates);
      if ((latest - earliest) / 86400000 > this._batchWindow) return;
      const setupHours = members.reduce((sum, item) => sum + Number(item.operation.EstSetHours || 0), 0);
      const saved = Math.max(0, setupHours - Math.max(...members.map((item) => Number(item.operation.EstSetHours || 0))));
      let elapsed = 0;
      const riskJobs = [];
      members.slice().sort((a, b) => a.due - b.due).forEach((item) => {
        const duration = Number(item.operation.EstSetHours || 0) + Number(item.operation.EstProdHours || 0);
        elapsed += duration;
        const projected = new Date(Math.min(...members.map((member) => member.start.getTime())) + elapsed * 3600000);
        if (projected > item.due) riskJobs.push(item.job.JobNum);
      });
      groups.push({ members, label, combinedQty: members.reduce((sum, item) => sum + Number(item.job.ProdQty || 0), 0), earliest: new Date(earliest), latest: new Date(latest), saved, riskJobs });
    };
    const byPart = new Map();
    candidates.forEach((item) => { const key = `${item.assembly.part || item.job.PartNum || '—'}|${item.job.RevisionNum || '—'}`; if (!byPart.has(key)) byPart.set(key, []); byPart.get(key).push(item); });
    byPart.forEach((members, key) => addGroup(members, `same-part:${key}`));
    const byOp = new Map();
    candidates.forEach((item) => { const key = item.operation.OpCode || 'Open operation'; if (!byOp.has(key)) byOp.set(key, []); byOp.get(key).push(item); });
    byOp.forEach((members, key) => { if (new Set(members.map((item) => `${item.assembly.part || item.job.PartNum}|${item.job.RevisionNum || ''}`)).size > 1) addGroup(members, `setup-family:${key}`); });
    return groups.sort((a, b) => b.saved - a.saved);
  }

  _renderBatching() {
    const e = this._els;
    if (!e || !e.batchingGroups || !e.batchingStatus) return;
    if (this._jobsLoading) { e.batchingStatus.innerHTML = '<span class="status-dot loading-dot"></span>Loading job data…'; e.batchingGroups.innerHTML = ''; return; }
    if (this._jobError) { e.batchingStatus.innerHTML = `<span class="status-dot error-dot"></span>${escapeHtml(this._jobError)}`; e.batchingGroups.innerHTML = ''; return; }
    this._batchGroups = this._buildBatchGroups();
    if (this._batchFocusIndex !== null) this._batchGroups = this._batchGroups.filter((group, index) => index === this._batchFocusIndex);
    if (!this._batchGroups.length) { e.batchingStatus.textContent = `No batching groups found. Widen the due-date window beyond ${this._batchWindow} days or turn off the Jobs operation filter.`; e.batchingGroups.innerHTML = ''; return; }
    e.batchingStatus.textContent = `${this._batchGroups.length} suggested group${this._batchGroups.length === 1 ? '' : 's'} · sorted by setup hours saved`;
    e.batchingGroups.innerHTML = this._batchGroups.map((group) => {
      const jobs = group.members.map((item) => item.job.JobNum);
      const parts = [...new Set(group.members.map((item) => item.assembly.part || item.job.PartNum || 'part'))];
      const dueDays = Math.max(0, Math.round((group.latest - group.earliest) / 86400000));
      const risk = group.riskJobs.length ? `<span class="batch-risk">Risk: ${escapeHtml(group.riskJobs.join(', '))} may miss due date.</span>` : '<span class="batch-safe">No due dates at risk.</span>';
      const explanation = `${jobs.length} jobs${parts.length === 1 ? ` for part ${parts[0]}` : ` in setup family ${group.members[0].operation.OpCode || 'operation'}`} due within ${dueDays} days; running together saves ~${group.saved.toFixed(1)} setup hours; ${risk.replace(/<[^>]+>/g, '')}`;
      return `<article class="batch-group"><h3>${escapeHtml(group.members[0].operation.OpCode || 'Batch suggestion')}</h3><p>${escapeHtml(explanation)}</p><ul class="batch-members">${jobs.map((job) => `<li>${escapeHtml(job)}</li>`).join('')}</ul><dl><div><dt>Combined qty</dt><dd>${formatQty(group.combinedQty)}</dd></div><div><dt>Due range</dt><dd>${formatDate(group.earliest)} – ${formatDate(group.latest)}</dd></div><div><dt>Setup saved</dt><dd>${group.saved.toFixed(1)} h</dd></div><div><dt>Risk check</dt><dd>${risk}</dd></div></dl></article>`;
    }).join('');
  }

  _getCapacityJobs() {
    return this._jobs.filter((job) => this._isVisibleJob(job) && (!this._hideNoOpenOps || job.operations.some((operation) => !operation.OpComplete)));
  }

  _renderCapacity() {
    const e = this._els;
    if (!e || !e.capacityBody || !e.capacityHead || !e.capacityStatus || !e.capacityControls) return;
    if (this._jobsLoading) { e.capacityStatus.innerHTML = '<span class="status-dot loading-dot"></span>Loading job data…'; e.capacityBody.innerHTML = ''; return; }
    if (this._jobError) { e.capacityStatus.innerHTML = `<span class="status-dot error-dot"></span>${escapeHtml(this._jobError)}`; e.capacityBody.innerHTML = ''; return; }
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const weeks = Array.from({ length: this._horizon }, (_, index) => { const date = new Date(start); date.setDate(date.getDate() + index * 7); return date; });
    this._capacityWeeks = weeks;
    const cells = new Map();
    this._getCapacityJobs().forEach((job) => {
      const operations = job.operations.filter((operation) => !operation.OpComplete);
      operations.forEach((operation) => {
        const operationDate = new Date(operation.StartDate || job.StartDate || start);
        if (Number.isNaN(operationDate.getTime())) return;
        const weekIndex = Math.floor((operationDate.setHours(0, 0, 0, 0) - start.getTime()) / (7 * 86400000));
        if (weekIndex >= weeks.length) return;
        const bucket = weekIndex < 0 ? -1 : weekIndex;
        const group = operation.operationDetails.map((detail) => detail.ResourceGrpID).find(Boolean) || 'Unassigned';
        const qty = Number(job.ProdQty || 0); const completed = Number(operation.QtyCompleted || 0);
        const remainingRatio = qty > 0 ? Math.max(0, Math.min(1, (qty - completed) / qty)) : 1;
        const hours = (completed <= 0 ? Number(operation.EstSetHours || 0) : 0) + Number(operation.EstProdHours || 0) * remainingRatio;
        const key = `${group}|${bucket}`; if (!cells.has(key)) cells.set(key, { group, weekIndex: bucket, hours: 0, members: [] });
        const cell = cells.get(key); cell.hours += hours; cell.members.push({ job, operation, hours });
      });
    });
    if (this._capacityFocusKeys) [...cells.keys()].forEach((key) => { if (!this._capacityFocusKeys.has(key)) cells.delete(key); });
    this._capacityCells = cells;
    const groups = [...new Set([...cells.values()].map((cell) => cell.group))].sort();
    if (!groups.length) { e.capacityStatus.textContent = 'No visible open-operation load falls within the selected horizon.'; e.capacityHead.innerHTML = ''; e.capacityBody.innerHTML = ''; e.capacityControls.innerHTML = ''; if (e.capacitySummary) e.capacitySummary.textContent = ''; return; }
    e.capacityStatus.textContent = `${groups.length} resource group${groups.length === 1 ? '' : 's'} across ${weeks.length} week${weeks.length === 1 ? '' : 's'}.`;
    const overload = [...cells.values()].map((cell) => ({ ...cell, ratio: cell.hours / (Number(this._capacity[cell.group]) || 80) })).sort((a, b) => b.ratio - a.ratio)[0];
    if (e.capacitySummary) e.capacitySummary.textContent = overload && overload.ratio > 1 ? `Most overloaded: ${overload.group}, ${this._capacityWeekLabel(overload.weekIndex).toLowerCase()} (${Math.round(overload.ratio * 100)}%).` : 'No resource group exceeds 100% capacity.';
    e.capacityControls.innerHTML = ''; e.capacityControls.hidden = true;
    const wireCapacityInputs = () => e.capacityBody.querySelectorAll('[data-capacity-group]').forEach((input) => input.addEventListener('change', () => { this._capacity[input.dataset.capacityGroup] = Math.max(1, Number(input.value) || 80); this._saveCapacity(); this._renderCapacity(); }));
    const columns = [-1, ...weeks.map((_, i) => i)];
    e.capacityHead.innerHTML = `<tr><th>Resource group / weekly hours</th>${columns.map((index) => `<th>${index < 0 ? 'Past due' : escapeHtml(formatDate(weeks[index]))}</th>`).join('')}</tr>`;
    e.capacityBody.innerHTML = groups.map((group) => `<tr><th class="cap-group-cell"><span class="cap-group">${escapeHtml(group)}</span><label class="cap-hours" title="Weekly capacity hours for ${escapeHtml(group)}"><input type="number" min="1" step="1" value="${Number(this._capacity[group]) || 80}" data-capacity-group="${escapeHtml(group)}" aria-label="Weekly capacity hours for ${escapeHtml(group)}"><span>h/wk</span></label></th>${columns.map((index) => { const cell = cells.get(`${group}|${index}`) || { hours: 0, members: [] }; const capacity = Number(this._capacity[group]) || 80; const ratio = cell.hours / capacity; const tone = index < 0 ? (cell.hours > 0 ? 'over' : 'under') : ratio > 1 ? 'over' : ratio >= .85 ? 'watch' : 'under'; return `<td class="capacity-cell ${tone}${cell.members.length ? ' has-load' : ''}" title="${cell.members.length ? 'Click to see the jobs scheduled here' : ''}" tabindex="0" data-capacity-key="${escapeHtml(`${group}|${index}`)}"><strong>${cell.hours.toFixed(1)}h</strong><span>${index < 0 ? (cell.hours > 0 ? 'to recover' : 'none') : `${Math.round(ratio * 100)}% of ${capacity}h`}</span></td>`; }).join('')}</tr>`).join('');
    wireCapacityInputs();
    const openCell = (cell) => { const value = cells.get(cell.dataset.capacityKey); if (!value) return; if (e.capacityDetail) e.capacityDetail.hidden = true; this._openCapacityCell(cell.dataset.capacityKey); return; e.capacityDetail.hidden = false; e.capacityDetail.innerHTML = `<h3>${escapeHtml(value.group)} · week ${value.weekIndex + 1}</h3><ul>${value.members.map((member) => `<li><span class="mono">${escapeHtml(member.job.JobNum)}</span> · Op ${escapeHtml(member.operation.OprSeq)} ${escapeHtml(member.operation.OpCode || '')} · ${member.hours.toFixed(1)}h</li>`).join('')}</ul>`; };
    e.capacityBody.querySelectorAll('[data-capacity-key]').forEach((cell) => { cell.addEventListener('click', () => openCell(cell)); cell.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openCell(cell); } }); });
  }

  _renderToday() {
    const e = this._els;
    if (!e || !e.todaySummary || !e.todaySections) return;
    if (this._loading || this._jobsLoading || this._materialsLoading) {
      e.todaySummary.textContent = 'Today’s planning summary is preparing from the loaded workbench data.';
      e.todaySections.innerHTML = '<p class="today-empty">Loading demand, jobs, and materials…</p>';
      return;
    }
    const target = (kind, payload, label) => {
      const index = this._todayTargets.push({ kind, ...payload }) - 1;
      return `<button type="button" class="today-link" data-today-target="${index}">${escapeHtml(label)}</button>`;
    };
    this._todayTargets = [];
    const riskRows = this._rows.filter((row) => row.uncovered !== null && Number(row.uncovered) > 0).sort((a, b) => new Date(a.shipBy) - new Date(b.shipBy)).slice(0, 5);
    const readyJobs = this._jobs.filter((job) => this._isVisibleJob(job) && job.JobFirm && job.JobReleased === false && job.materialStatus && job.materialStatus.label === 'Ready');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const fiveDays = new Date(today); fiveDays.setDate(fiveDays.getDate() + 5);
    const materialProblems = this._getVisibleJobMaterials().map((material) => ({ material, status: this._lineStatus(material) })).filter(({ material, status }) => {
      const need = new Date(material.materialReqDate || '');
      return status.tone === 'short' && !Number.isNaN(need.getTime()) && need >= today && need <= fiveDays;
    }).sort((a, b) => new Date(a.material.materialReqDate) - new Date(b.material.materialReqDate));
    const overloads = [...this._capacityCells.values()].filter((cell) => (cell.weekIndex === 0 || cell.weekIndex === 1) && cell.hours / (Number(this._capacity[cell.group]) || 80) > 1).sort((a, b) => b.hours / (Number(this._capacity[b.group]) || 80) - a.hours / (Number(this._capacity[a.group]) || 80));
    const groups = this._buildBatchGroups();
    const weekUncovered = riskRows.filter((row) => { const days = daysFromToday(row.shipBy); return days !== null && days >= 0 && days <= 7; }).length;
    const latePoJobs = this._jobs.filter((job) => job.materialStatus && /PO (overdue|late)/.test(job.materialStatus.label)).length;
    const nextOverload = overloads.find((cell) => cell.weekIndex === 1) || overloads[0];
    const clauses = [];
    if (weekUncovered) clauses.push(`${weekUncovered} order${weekUncovered === 1 ? '' : 's'} due this week ${weekUncovered === 1 ? 'is' : 'are'} uncovered`);
    if (latePoJobs) clauses.push(`${latePoJobs} job${latePoJobs === 1 ? ' is' : 's are'} short material from a late PO`);
    if (nextOverload) clauses.push(`${nextOverload.group} is ${Math.round(nextOverload.hours / (Number(this._capacity[nextOverload.group]) || 80) * 100)}% loaded ${nextOverload.weekIndex === 1 ? 'next week' : 'this week'}`);
    e.todaySummary.textContent = clauses.length ? `${clauses.join(', ')}.` : 'No immediate planning risks were found in the loaded data.';
    const section = (title, items, empty) => `<section class="today-section"><h3>${escapeHtml(title)}</h3>${items.length ? `<ul class="today-list">${items.join('')}</ul>` : `<p>${escapeHtml(empty)}</p>`}</section>`;
    const riskItems = riskRows.map((row) => `<li>${target('demand', { ids: [row.id] }, `Order ${row.order}, line ${row.line} · ${row.part} · ${formatQty(row.uncovered)} uncovered · ships ${formatDate(row.shipBy)}`)}</li>`);
    const readyItems = readyJobs.map((job) => `<li>${target('jobs', { nums: [job.JobNum] }, `Job ${job.JobNum} · ${job.PartNum || '—'} · due ${formatDate(job.DueDate || job.ReqDueDate)}`)} ${this._releaseButton(job)}</li>`);
    const materialItems = materialProblems.map(({ material, status }) => `<li>${target('materials', { keys: [`${material.JobNum}|${material.PartNum}`] }, `Job ${material.JobNum} · ${material.PartNum} · ${status.label} · need ${formatDate(material.materialReqDate)}`)}</li>`);
    const capacityItems = overloads.map((cell) => { const ratio = Math.round(cell.hours / (Number(this._capacity[cell.group]) || 80) * 100); return `<li>${target('capacity', { keys: [`${cell.group}|${cell.weekIndex}`] }, `${cell.group} · ${cell.weekIndex === 0 ? 'This week' : 'Next week'} · ${ratio}% loaded`)}</li>`; });
    const batchItems = groups.slice(0, 1).map((group) => `<li>${target('batching', { index: 0 }, `${group.members.length} jobs · saves ${group.saved.toFixed(1)} setup hours · ${group.members[0].operation.OpCode || 'open operation'}`)}</li>`);
    e.todaySections.innerHTML = section('Top 5 at-risk demand lines', riskItems, 'No uncovered demand lines in the loaded horizon.') + section('Jobs ready to release', readyItems, 'No firm, unreleased jobs with Ready materials.') + section('Material problems needed in the next 5 days', materialItems, 'No material shortages in the next 5 days.') + section('Resource groups over 100%', capacityItems, 'No resource groups exceed 100% this week or next.') + section('Top batching opportunity', batchItems, 'No batching opportunity is available from the loaded jobs.');
  }

  _openTodayTarget(index) {
    const target = this._todayTargets[index];
    if (!target) return;
    this._demandFocusIds = null; this._jobFocusNums = null; this._materialFocusKeys = null; this._capacityFocusKeys = null; this._batchFocusIndex = null;
    if (target.kind === 'demand') this._demandFocusIds = new Set(target.ids);
    if (target.kind === 'jobs') this._jobFocusNums = new Set(target.nums.map(String));
    if (target.kind === 'materials') this._materialFocusKeys = new Set(target.keys);
    if (target.kind === 'capacity') this._capacityFocusKeys = new Set(target.keys);
    if (target.kind === 'batching') this._batchFocusIndex = target.index;
    const tab = this.host.contentRoot.querySelector(`[data-tab="${target.kind}"]`);
    if (tab) this._selectTab(tab);
  }

  _render() {
    const e = this._els;
    if (!e) return;
    if (e.refreshed) e.refreshed.textContent = this._lastRefreshed ? `Last refreshed ${this._lastRefreshed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Not refreshed';
    if (e.refresh) { e.refresh.disabled = this._loading; e.refresh.textContent = this._loading ? 'Refreshing…' : 'Refresh'; }
    this._renderDemand();
    this._renderJobs();
    this._renderMaterials();
    this._renderBatching();
    this._renderCapacity();
    this._renderToday();
    this._renderActivityLog();
    this._renderKpis();
  }

  _renderKpis() {
    const visible = this._getVisibleRows();
    const set = (el, value) => { if (el) el.textContent = value; };
    set(this._els.kpis.demand, this._rows.length ? visible.length.toLocaleString() : '—');
    const uncovered = visible.reduce((sum, row) => sum + (row.uncovered === null ? 0 : Number(row.uncovered)), 0);
    set(this._els.kpis.uncovered, this._rows.some((row) => row.uncovered !== null) ? formatQty(uncovered) : 'Unavailable');
    const lateJobs = this._jobs.filter((job) => { const days = daysFromToday(job.DueDate || job.ReqDueDate); return this._isVisibleJob(job) && days !== null && days < 0; });
    const horizonJobs = this._jobs.filter((job) => { const days = daysFromToday(job.DueDate || job.ReqDueDate); return this._isVisibleJob(job) && days !== null && days >= 0 && days <= this._horizon * 7 && job.JobReleased === false; });
    set(this._els.kpis.late, this._jobsLoading ? 'Loading…' : this._jobError ? 'Unavailable' : lateJobs.length.toLocaleString());
    set(this._els.kpis.unreleased, this._jobsLoading ? 'Loading…' : this._jobError ? 'Unavailable' : horizonJobs.length.toLocaleString());
    const signal = (el, value) => { const card = el && el.closest('.kpi-card'); if (card) { if (value) card.dataset.signal = value; else delete card.dataset.signal; } };
    const demandReady = this._rows.some((row) => row.uncovered !== null);
    const jobsReady = !this._jobsLoading && !this._jobError;
    signal(this._els.kpis.uncovered, demandReady ? (uncovered > 0 ? 'caution' : 'run') : '');
    signal(this._els.kpis.late, jobsReady ? (lateJobs.length ? 'stop' : 'run') : '');
    signal(this._els.kpis.unreleased, jobsReady && horizonJobs.length ? 'caution' : '');
  }

  _getVisibleRows() {
    const customer = this._filters.customer.trim().toLowerCase();
    const part = this._filters.part.trim().toLowerCase();
    const rows = this._rows.filter((row) => (!this._demandFocusIds || this._demandFocusIds.has(row.id)) && (!customer || String(row.customer).toLowerCase().includes(customer)) && (!part || String(row.part).toLowerCase().includes(part)));
    const direction = this._sort.direction === 'asc' ? 1 : -1;
    return rows.sort((a, b) => {
      const av = a[this._sort.key] ?? '';
      const bv = b[this._sort.key] ?? '';
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * direction;
    });
  }

  _renderDemand() {
    const e = this._els;
    if (!e || !e.tableBody || !e.tableStatus) return;
    const rows = this._getVisibleRows();
    if (this._loading) { e.tableStatus.innerHTML = '<span class="status-dot loading-dot"></span>Loading open releases from SalesOrderSvc…'; e.tableBody.innerHTML = ''; return; }
    if (this._error) { e.tableStatus.innerHTML = `<span class="status-dot error-dot"></span>${escapeHtml(this._error)} <button type="button" class="link-button" id="retry-inline">Retry</button>`; e.tableBody.innerHTML = ''; const retry = e.tableStatus.querySelector('#retry-inline'); if (retry) retry.addEventListener('click', () => this.loadDemand()); return; }
    if (!this._rows.length) { e.tableStatus.innerHTML = '<span class="status-dot info-dot"></span>No releases are available for this horizon, or the tenant SalesOrder contract is not available.'; e.tableBody.innerHTML = ''; return; }
    e.tableStatus.textContent = `${rows.length.toLocaleString()} open release${rows.length === 1 ? '' : 's'} in horizon`;
    const grouped = this._groupByPart ? this._groupRows(rows) : [{ part: null, rows }];
    e.tableBody.innerHTML = grouped.map((group) => {
      const groupHead = group.part ? `<tr class="group-row"><th colspan="12" scope="rowgroup">${escapeHtml(group.part)} <span>${group.rows.length} release${group.rows.length === 1 ? '' : 's'} · ${formatQty(group.rows.reduce((sum, row) => sum + (Number(row.remaining) || 0), 0))} remaining</span></th></tr>` : '';
      return groupHead + group.rows.map((row) => {
        const nearTerm = daysFromToday(row.shipBy);
        const uncovered = row.uncovered !== null && Number(row.uncovered) > 0;
        const rowClass = `${uncovered ? 'has-uncovered' : ''} ${nearTerm !== null && nearTerm <= 5 ? 'near-term' : ''}`;
        return `<tr class="demand-row ${rowClass}" tabindex="0" data-row-id="${escapeHtml(row.id)}" aria-label="Order ${escapeHtml(row.order)}, line ${escapeHtml(row.line)}, part ${escapeHtml(row.part)}">
          <td class="mono">${escapeHtml(row.order)}</td><td class="mono">${escapeHtml(row.line)}</td><td class="mono">${escapeHtml(row.release)}</td><td>${escapeHtml(row.customer)}</td><td class="mono">${escapeHtml(row.part)}</td><td class="mono">${escapeHtml(row.rev)}</td><td class="date-cell ${nearTerm !== null && nearTerm <= 5 ? 'date-near' : ''}">${formatDate(row.needBy)}</td><td class="date-cell ${nearTerm !== null && nearTerm <= 5 ? 'date-near' : ''}">${formatDate(row.shipBy)}</td><td class="number-cell mono">${formatQty(row.remaining)}</td><td class="number-cell mono">${formatQty(row.coveredByJob)}</td><td class="number-cell mono">${formatQty(row.fromStock)}</td><td class="number-cell mono ${uncovered ? 'uncovered-value' : ''}">${formatQty(row.uncovered)}</td>
        </tr>`;
      }).join('');
    }).join('');
    e.tableBody.querySelectorAll('.demand-row').forEach((rowEl) => {
      const open = () => this._openPanel(rowEl.dataset.rowId);
      rowEl.addEventListener('click', open);
      rowEl.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
    });
    e.root.querySelectorAll('[data-sort]').forEach((button) => button.addEventListener('click', () => this._sortBy(button.dataset.sort)));
  }

  _groupRows(rows) {
    const groups = [];
    rows.forEach((row) => {
      let group = groups.find((item) => item.part === row.part);
      if (!group) { group = { part: row.part, rows: [] }; groups.push(group); }
      group.rows.push(row);
    });
    return groups;
  }

  _sortBy(key) {
    this._sort = this._sort.key === key ? { key, direction: this._sort.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' };
    this._renderDemand();
  }

  _openPanel(id) {
    this._selected = this._rows.find((row) => row.id === id) || null;
    if (!this._selected || !this._els.panel || !this._els.panelContent) return;
    const row = this._selected;
    const linked = row.linkedJobs ? escapeHtml(row.linkedJobs) : 'No linked job returned by the release contract.';
    this._els.panelContent.innerHTML = `<div class="detail-eyebrow">Sales order release</div><h2>Order ${escapeHtml(row.order)} · Line ${escapeHtml(row.line)} · Rel ${escapeHtml(row.release)}</h2><dl class="detail-list"><div><dt>Customer</dt><dd>${escapeHtml(row.customer)}</dd></div><div><dt>Part / revision</dt><dd class="mono">${escapeHtml(row.part)} / ${escapeHtml(row.rev)}</dd></div><div><dt>Need by</dt><dd>${formatDate(row.needBy)}</dd></div><div><dt>Ship by</dt><dd>${formatDate(row.shipBy)}</dd></div><div><dt>Remaining quantity</dt><dd class="mono">${formatQty(row.remaining)}</dd></div><div><dt>Uncovered quantity</dt><dd class="mono ${row.uncovered !== null && Number(row.uncovered) > 0 ? 'danger-text' : ''}">${formatQty(row.uncovered)}</dd></div></dl><section class="linked-section"><h3>Linked jobs</h3><p>${linked}</p></section>`;
    this._els.panel.hidden = false;
    const backdrop = this.host.contentRoot.querySelector('#panel-backdrop');
    if (backdrop) backdrop.hidden = false;
    if (this._els.closePanel) this._els.closePanel.focus();
  }

  // ---------------------------------------------------------------- capacity cell drawer
  _capacityWeekLabel(weekIndex) {
    if (weekIndex < 0) return 'Past due';
    const week = (this._capacityWeeks || [])[weekIndex];
    return week ? `Week of ${formatDate(week)}` : `Week ${weekIndex + 1}`;
  }

  _openCapacityCell(key) {
    const cell = this._capacityCells && this._capacityCells.get(key);
    const e = this._els;
    if (!cell || !e || !e.panel || !e.panelContent) return;
    this._selected = { capacity: key };
    this._detailToken = (this._detailToken || 0) + 1;
    const token = this._detailToken;
    this._capDetail = { key, token };
    this._jobDetail = null;
    e.panel.classList.add('job-drawer');
    this._setPanelHeader(`Capacity · ${cell.group}`, this._capacityWeekLabel(cell.weekIndex));
    this._renderCapacityCell();
    e.panel.hidden = false;
    const backdrop = this.host.contentRoot.querySelector('#panel-backdrop');
    if (backdrop) backdrop.hidden = false;
    if (e.closePanel) e.closePanel.focus();
    this._loadCellOrders(cell, token);
  }

  async _loadCellOrders(cell, token) {
    this._jobProdCache = this._jobProdCache || new Map();
    this._orderHeadCache = this._orderHeadCache || new Map();
    const jobs = [...new Set(cell.members.map((m) => m.job.JobNum))].filter((num) => !this._jobProdCache.has(num));
    // Job-to-order links come from each job's JobProd rows (GetByID), a few at a time
    for (let i = 0; i < jobs.length; i += 4) {
      await Promise.all(jobs.slice(i, i + 4).map(async (jobNum) => {
        try {
          const result = await this.host.callService({ service: 'Erp.BO.JobEntrySvc', operation: 'GetByID', method: 'POST', input: { jobNum } });
          const ds = result && result.data && result.data.returnObj;
          this._jobProdCache.set(jobNum, ds && Array.isArray(ds.JobProd) ? ds.JobProd : []);
        } catch (error) { this._jobProdCache.set(jobNum, null); }
      }));
      if (token !== this._detailToken) return;
      this._renderCapacityCell();
    }
    // Order header details for linked orders not already loaded on the Demand tab
    const known = new Set((this._rows || []).map((row) => String(row.order)));
    const orderNums = new Set();
    cell.members.forEach((m) => (this._jobProdCache.get(m.job.JobNum) || []).forEach((prod) => {
      const num = Number(prod.OrderNum || 0);
      if (num > 0 && !known.has(String(num)) && !this._orderHeadCache.has(num)) orderNums.add(num);
    }));
    if (orderNums.size) {
      try {
        const filter = [...orderNums].slice(0, 25).map((num) => `OrderNum eq ${num}`).join(' or ');
        const result = await this.host.callService({ service: 'Erp.BO.SalesOrderSvc', operation: 'SalesOrders', method: 'GET', input: { $filter: filter, $select: 'OrderNum,CustomerCustID,CustomerName,NeedByDate,RequestDate,PONum' } });
        (result && result.data && Array.isArray(result.data.value) ? result.data.value : []).forEach((order) => this._orderHeadCache.set(Number(order.OrderNum), order));
      } catch (error) { /* order numbers still show without customer details */ }
    }
    this._ordersLoaded = true;
    if (token === this._detailToken) this._renderCapacityCell();
  }

  _orderLinksFor(jobNum) {
    const prods = this._jobProdCache && this._jobProdCache.get(jobNum);
    if (prods === undefined) return { state: 'loading', links: [] };
    if (prods === null) return { state: 'error', links: [] };
    const links = prods.filter((prod) => Number(prod.OrderNum || 0) > 0).map((prod) => {
      const row = (this._rows || []).find((r) => String(r.order) === String(prod.OrderNum) && String(r.line) === String(prod.OrderLine) && (prod.OrderRelNum === undefined || String(r.release) === String(prod.OrderRelNum)))
        || (this._rows || []).find((r) => String(r.order) === String(prod.OrderNum));
      const head = this._orderHeadCache && this._orderHeadCache.get(Number(prod.OrderNum));
      return {
        order: prod.OrderNum, line: prod.OrderLine, release: prod.OrderRelNum, qty: prod.ProdQty,
        customer: row ? row.customer : head ? (head.CustomerName || head.CustomerCustID) : '',
        needBy: row ? (row.needBy || row.shipBy) : head ? (head.NeedByDate || head.RequestDate) : null,
        uncovered: row && row.uncovered !== null ? row.uncovered : null,
        customerPO: head ? head.PONum : '',
      };
    });
    return { state: 'ready', links };
  }

  _renderCapacityCell() {
    const e = this._els;
    if (!e || !e.panelContent || !this._capDetail) return;
    const cell = this._capacityCells && this._capacityCells.get(this._capDetail.key);
    if (!cell) { e.panelContent.innerHTML = JOB_DRAWER_STYLES + '<p class="jd-muted">This cell is no longer in the current view. Refresh and try again.</p>'; return; }
    const scroll = e.panel ? e.panel.scrollTop : 0;
    const capacity = Number(this._capacity[cell.group]) || 80;
    const ratio = cell.hours / capacity;
    const tone = ratio > 1 ? 'jd-bad' : ratio >= 0.85 ? 'jd-warn' : 'jd-good';
    const jobsInCell = new Set(cell.members.map((m) => m.job.JobNum));
    const members = cell.members.slice().sort((a, b) => new Date(a.operation.StartDate || a.job.StartDate || 0) - new Date(b.operation.StartDate || b.job.StartDate || 0) || new Date(a.job.DueDate || a.job.ReqDueDate || 0) - new Date(b.job.DueDate || b.job.ReqDueDate || 0));
    const linkedCount = [...jobsInCell].filter((num) => { const l = this._orderLinksFor(num); return l.links.length; }).length;
    let html = JOB_DRAWER_STYLES;
    if (cell.weekIndex < 0) html += `<div class="jd-chips"><span class="jd-chip jd-bad">${cell.hours.toFixed(1)} hours of work past due</span><span class="jd-chip">${members.length} operation${members.length === 1 ? '' : 's'} on ${jobsInCell.size} job${jobsInCell.size === 1 ? '' : 's'}</span></div>`;
    else html += `<div class="jd-chips"><span class="jd-chip ${tone}">${Math.round(ratio * 100)}% of ${capacity}h capacity</span><span class="jd-chip">${cell.hours.toFixed(1)} hours</span><span class="jd-chip">${members.length} operation${members.length === 1 ? '' : 's'} on ${jobsInCell.size} job${jobsInCell.size === 1 ? '' : 's'}</span></div>`;
    if (cell.weekIndex >= 0) html += `<div class="jd-progress"><div class="jd-bar jd-loadbar"><span style="width:${Math.min(100, ratio * 100)}%;background:${ratio > 1 ? '#B91C1C' : ratio >= 0.85 ? '#D97706' : '#15803D'}"></span></div><span>${ratio > 1 ? `${(cell.hours - capacity).toFixed(1)}h over` : `${(capacity - cell.hours).toFixed(1)}h free`}</span></div>`;
    if (cell.weekIndex < 0) html += '<p class="jd-muted jd-small">These operations were scheduled to start before today and are not complete. They need to be worked in or rescheduled.</p>';
    html += `<h3 class="jd-h">Scheduled work</h3><div class="jd-scroll"><table class="jd-table"><thead><tr><th>Job / part</th><th>Operation</th><th class="n">Hours</th><th>Op start</th><th>Job due</th><th>Material</th><th>Sales order</th></tr></thead><tbody>`;
    html += members.map((m) => {
      const job = m.job; const op = m.operation;
      const dueDays = daysFromToday(job.DueDate || job.ReqDueDate);
      const orders = this._orderLinksFor(job.JobNum);
      let orderCell;
      if (orders.state === 'loading') orderCell = '<span class="jd-muted">Loading…</span>';
      else if (orders.state === 'error') orderCell = '<span class="jd-muted">Unavailable</span>';
      else if (!orders.links.length) orderCell = '<span class="jd-muted">Make to stock</span>';
      else orderCell = orders.links.map((l) => {
        const d = daysFromToday(l.needBy);
        const jobDue = job.DueDate || job.ReqDueDate;
        const late = l.needBy && jobDue && new Date(jobDue) > new Date(l.needBy);
        const flag = late ? '<span class="jd-chip jd-bad">Job finishes after need-by</span>' : d !== null && d <= 5 ? '<span class="jd-chip jd-warn">Needed soon</span>' : '';
        return `<div class="jd-order"><span class="mono">${escapeHtml(l.order)}-${escapeHtml(l.line)}${l.release !== undefined ? '-' + escapeHtml(l.release) : ''}</span>${l.qty ? ` <span class="jd-muted">qty ${formatQty(l.qty)}</span>` : ''}<div>${escapeHtml(l.customer || '—')}${l.customerPO ? ` <span class="jd-muted">· PO ${escapeHtml(l.customerPO)}</span>` : ''}</div><div class="jd-muted">Need by ${formatDate(l.needBy)}</div>${flag}</div>`;
      }).join('');
      const mat = job.materialStatus ? job.materialStatus.label : '—';
      const matTone = /^Short/.test(mat) ? 'jd-badtext' : '';
      return `<tr class="jd-click" tabindex="0" data-cap-job="${escapeHtml(job.JobNum)}"><td><span class="mono jd-link">${escapeHtml(job.JobNum)}</span><div class="mono jd-muted jd-small">${escapeHtml(job.PartNum || '')}</div></td><td>Asm ${escapeHtml(op.assembly ?? op.AssemblySeq ?? 0)} · ${escapeHtml(op.OprSeq)} ${escapeHtml(op.OpCode || '')}</td><td class="n">${m.hours.toFixed(1)}</td><td>${formatDate(op.StartDate || job.StartDate)}</td><td>${formatDate(job.DueDate || job.ReqDueDate)}${dueDays !== null && dueDays < 0 ? ' <span class="jd-chip jd-bad">Late</span>' : ''}</td><td class="${matTone}">${escapeHtml(mat)}</td><td class="jd-supply">${orderCell}</td></tr>`;
    }).join('');
    html += '</tbody></table></div><div class="jd-muted jd-small">Click a row to open the job.</div>';
    if (this._ordersLoaded && jobsInCell.size && !linkedCount) html += '<p class="jd-muted jd-small">None of these jobs are linked to a sales order (make-to-stock).</p>';
    e.panelContent.innerHTML = html;
    if (e.panel) e.panel.scrollTop = scroll;
    e.panelContent.querySelectorAll('[data-cap-job]').forEach((row) => {
      const go = () => { this._drawerBack = { key: this._capDetail.key }; this._openJobDetail(row.dataset.capJob); };
      row.addEventListener('click', go);
      row.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); go(); } });
    });
  }

  // ---------------------------------------------------------------- job detail drawer
  async _openJobDetail(jobNum) {
    const job = this._jobs.find((item) => String(item.JobNum) === String(jobNum));
    const e = this._els;
    if (!job || !e || !e.panel || !e.panelContent) return;
    this._selected = { jobDetail: job.JobNum };
    this._detailToken = (this._detailToken || 0) + 1;
    const token = this._detailToken;
    this._jobDetail = { job, ds: null, error: '', labor: null, laborError: '', back: this._drawerBack || null };
    this._drawerBack = null;
    this._capDetail = null;
    e.panel.classList.add('job-drawer');
    this._setPanelHeader('Job detail', `Job ${job.JobNum}`);
    this._renderJobDetail();
    e.panel.hidden = false;
    const backdrop = this.host.contentRoot.querySelector('#panel-backdrop');
    if (backdrop) backdrop.hidden = false;
    if (e.closePanel) e.closePanel.focus();
    try {
      const result = await this.host.callService({ service: 'Erp.BO.JobEntrySvc', operation: 'GetByID', method: 'POST', input: { jobNum: job.JobNum } });
      if (token !== this._detailToken) return;
      const ds = result && result.data && result.data.returnObj;
      if (!ds || !Array.isArray(ds.JobHead)) throw new Error('Kinetic did not return the job dataset.');
      this._jobDetail.ds = ds;
    } catch (error) {
      if (token !== this._detailToken) return;
      this._jobDetail.error = error && error.message ? error.message : String(error);
    }
    this._renderJobDetail();
    if (this._jobDetail.ds) {
      this._loadJobLabor(job.JobNum, token);
      this._loadVendorNames(token);
    }
  }

  async _loadJobLabor(jobNum, token) {
    const filter = `JobNum eq '${String(jobNum).replace(/'/g, "''")}'`;
    const sources = this._laborSource ? [this._laborSource] : [['Erp.BO.LaborDtlSearchSvc', 'LaborDtlSearches'], ['Erp.BO.LaborSvc', 'LaborDtls']];
    let lastError = '';
    for (const [service, operation] of sources) {
      try {
        const result = await this.host.callService({ service, operation, method: 'GET', input: { $filter: filter, $top: '200' } });
        if (token !== this._detailToken) return;
        this._laborSource = [service, operation];
        this._jobDetail.labor = result && result.data && Array.isArray(result.data.value) ? result.data.value : [];
        this._renderJobDetail();
        return;
      } catch (error) {
        lastError = error && error.message ? error.message : String(error);
      }
    }
    if (token !== this._detailToken) return;
    this._jobDetail.labor = [];
    this._jobDetail.laborError = lastError;
    this._renderJobDetail();
  }

  async _loadVendorNames(token) {
    this._vendorNames = this._vendorNames || new Map();
    const ds = this._jobDetail && this._jobDetail.ds;
    if (!ds) return;
    const nums = new Set();
    (ds.JobMtl || []).forEach((mtl) => (this._incoming.get(mtl.PartNum) || []).forEach((supply) => { if (supply.vendorNum && !this._vendorNames.has(supply.vendorNum)) nums.add(supply.vendorNum); }));
    if (!nums.size) return;
    try {
      const filter = [...nums].slice(0, 25).map((num) => `VendorNum eq ${Number(num)}`).join(' or ');
      const result = await this.host.callService({ service: 'Erp.BO.VendorSvc', operation: 'Vendors', method: 'GET', input: { $filter: filter, $select: 'VendorNum,VendorID,Name' } });
      (result && result.data && Array.isArray(result.data.value) ? result.data.value : []).forEach((vendor) => this._vendorNames.set(vendor.VendorNum, vendor.Name || vendor.VendorID));
    } catch (error) { /* names are a nicety; PO numbers still show */ }
    if (token === this._detailToken) this._renderJobDetail();
  }

  _jobDetailModel() {
    const { job, ds } = this._jobDetail;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const day = (value) => { if (!value) return null; const d = new Date(value); if (Number.isNaN(d.getTime())) return null; d.setHours(0, 0, 0, 0); return d; };
    const head = (ds.JobHead || [])[0] || {};
    const asms = Array.isArray(ds.JobAsmbl) ? ds.JobAsmbl : [];
    const asmBySeq = new Map(asms.map((asm) => [Number(asm.AssemblySeq || 0), asm]));
    const depth = (seq, guard = 0) => { const asm = asmBySeq.get(seq); if (!asm || seq === 0 || guard > 20) return 0; return 1 + depth(Number(asm.Parent || 0), guard + 1); };
    const resource = new Map();
    (ds.JobOpDtl || []).forEach((dtl) => { const key = `${Number(dtl.AssemblySeq || 0)}-${Number(dtl.OprSeq || 0)}`; if (!resource.has(key)) resource.set(key, dtl.ResourceGrpID || dtl.ResourceID || ''); });
    const ops = (ds.JobOper || []).map((op) => {
      const asm = Number(op.AssemblySeq || 0);
      const start = day(op.StartDate); const due = day(op.DueDate);
      const estHours = Number(op.EstSetHours || 0) + Number(op.EstProdHours || 0);
      const hasActual = op.ActProdHours !== undefined || op.ActSetupHours !== undefined;
      const actHours = Number(op.ActSetupHours || 0) + Number(op.ActProdHours || 0);
      let status = 'notstarted';
      if (op.OpComplete) status = 'done';
      else if (due && due < today) status = 'late';
      else if (Number(op.QtyCompleted || 0) > 0 || (start && start <= today)) status = 'active';
      return { ...op, asm, depth: depth(asm), start, due, estHours, actHours, hasActual, status, resource: resource.get(`${asm}-${Number(op.OprSeq || 0)}`) || '', asmPart: (asmBySeq.get(asm) || {}).PartNum || '' };
    }).sort((a, b) => (b.depth - a.depth) || (a.asm - b.asm) || (Number(a.OprSeq || 0) - Number(b.OprSeq || 0)));
    const mtls = (ds.JobMtl || []).map((mtl) => {
      const required = Number(mtl.RequiredQty || 0); const issued = Number(mtl.IssuedQty || 0);
      const onHand = Number(this._inventory.get(mtl.PartNum) || 0);
      const short = Math.max(0, required - issued - onHand);
      const reqDate = day(mtl.ReqDate);
      const supplies = (this._incoming.get(mtl.PartNum) || []).filter((supply) => supply.quantity > 0).map((supply) => {
        const expected = day(supply.expectedDate);
        return { ...supply, expected, overdue: Boolean(expected && expected < today), late: Boolean(expected && reqDate && expected > reqDate) };
      }).sort((a, b) => (a.expected ? a.expected.getTime() : Infinity) - (b.expected ? b.expected.getTime() : Infinity));
      return { ...mtl, required, issued, onHand, short, reqDate, supplies };
    });
    const asm0 = asmBySeq.get(0) || asms[0] || {};
    const costKeys = [['Labor', 'LaborCost'], ['Burden', 'BurdenCost'], ['Material', 'MaterialCost'], ['Subcontract', 'SubcontractCost'], ['Material burden', 'MtlBurCost']];
    const hasCosts = Object.keys(asm0).some((key) => /^TL[EA]/.test(key));
    const num = (key) => Number(asm0[key] || 0);
    const costs = hasCosts ? costKeys.map(([label, key]) => ({ label, est: num('TLE' + key) + num('LLE' + key), act: num('TLA' + key) + num('LLA' + key) })) : [];
    const completed = ops.filter((op) => op.status === 'done').length;
    const late = ops.filter((op) => op.status === 'late').length;
    const allDates = [day(head.StartDate || job.StartDate), day(head.DueDate || head.ReqDueDate || job.DueDate || job.ReqDueDate), ...ops.flatMap((op) => [op.start, op.due])].filter(Boolean);
    return { job, head, ops, mtls, costs, hasCosts, completed, late, today, minDate: allDates.length ? new Date(Math.min(...allDates)) : null, maxDate: allDates.length ? new Date(Math.max(...allDates)) : null };
  }

  _renderJobDetail() {
    const e = this._els;
    if (!e || !e.panelContent || !this._jobDetail) return;
    const scroll = e.panel ? e.panel.scrollTop : 0;
    const { job, ds, error } = this._jobDetail;
    const money = (value) => '$' + Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
    const hours = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
    let html = JOB_DRAWER_STYLES;
    const back = this._jobDetail.back && this._capacityCells && this._capacityCells.get(this._jobDetail.back.key);
    if (back) html += `<button type="button" class="jd-back" data-jd-back="${escapeHtml(this._jobDetail.back.key)}">← Back to ${escapeHtml(back.group)}, ${escapeHtml(this._capacityWeekLabel(back.weekIndex).toLowerCase())}</button>`;
    if (error) {
      html += `<div class="jd-error">Could not load job details: ${escapeHtml(error)}</div>`;
    } else if (!ds) {
      html += '<p class="jd-muted">Loading operations, materials, labor, and costs…</p>';
    } else {
      const m = this._jobDetailModel();
      const total = m.ops.length;
      const pct = total ? Math.round((m.completed / total) * 100) : 0;
      const firm = m.head.JobFirm ?? job.JobFirm; const released = m.head.JobReleased ?? job.JobReleased;
      const dueDays = daysFromToday(m.head.DueDate || m.head.ReqDueDate || job.DueDate || job.ReqDueDate);
      const health = m.late ? `<span class="jd-chip jd-bad">${m.late} operation${m.late === 1 ? '' : 's'} past due</span>` : (total && m.completed === total ? '<span class="jd-chip jd-good">All operations complete</span>' : '<span class="jd-chip jd-good">On plan</span>');
      html += `<div class="jd-sub" style="margin-top:-8px">${escapeHtml(m.head.PartNum || job.PartNum || '')}${(m.head.RevisionNum || job.RevisionNum) ? ' · Rev ' + escapeHtml(m.head.RevisionNum || job.RevisionNum) : ''}${m.head.PartDescription ? ' · ' + escapeHtml(m.head.PartDescription) : ''}</div>
        <div class="jd-chips"><span class="jd-chip">${released ? 'Released' : firm ? 'Firm, unreleased' : 'Unfirm'}</span>${health}${dueDays !== null ? `<span class="jd-chip ${dueDays < 0 ? 'jd-bad' : dueDays <= 5 ? 'jd-warn' : ''}">${dueDays < 0 ? Math.abs(dueDays) + ' days past due' : 'Due in ' + dueDays + ' day' + (dueDays === 1 ? '' : 's')}</span>` : ''}</div>
        <dl class="jd-facts"><div><dt>Quantity</dt><dd>${formatQty(m.head.ProdQty ?? job.ProdQty)}</dd></div><div><dt>Start</dt><dd>${formatDate(m.head.StartDate || job.StartDate)}</dd></div><div><dt>Due</dt><dd>${formatDate(m.head.DueDate || m.head.ReqDueDate || job.DueDate || job.ReqDueDate)}</dd></div><div><dt>Material</dt><dd>${escapeHtml(job.materialStatus ? job.materialStatus.label : '—')}</dd></div></dl>
        <div class="jd-progress" aria-label="${m.completed} of ${total} operations complete"><div class="jd-bar"><span style="width:${pct}%"></span></div><span>${m.completed} of ${total} operations complete</span></div>
        ${firm && released === false ? `<button type="button" class="button button-primary jd-release" data-jd-release="${escapeHtml(job.JobNum)}">Release job…</button>` : ''}`;

      // Routing timeline
      html += '<h3 class="jd-h">Routing timeline</h3>';
      if (m.minDate && m.maxDate && total) {
        const span = Math.max(1, m.maxDate - m.minDate);
        const pos = (d) => Math.min(100, Math.max(0, ((d - m.minDate) / span) * 100));
        const todayPos = m.today >= m.minDate && m.today <= m.maxDate ? pos(m.today) : null;
        html += `<div class="jd-legend"><span class="jd-li"><span class="jd-key done"></span>Complete</span><span class="jd-li"><span class="jd-key active"></span>In progress</span><span class="jd-li"><span class="jd-key late"></span>Past due</span><span class="jd-li"><span class="jd-key notstarted"></span>Not started</span></div><div class="jd-timeline">`;
        html += `<div class="jd-axis"><span>${formatDate(m.minDate)}</span><span>${formatDate(m.maxDate)}</span></div>`;
        m.ops.forEach((op) => {
          const s = op.start || op.due; const d = op.due || op.start;
          const left = s ? pos(s) : 0; const width = s && d ? Math.max(1.5, pos(d) - left) : 1.5;
          html += `<div class="jd-trow"><div class="jd-tlabel" title="${escapeHtml(op.asmPart)}">Asm ${op.asm} · ${escapeHtml(op.OprSeq)} ${escapeHtml(op.OpCode || '')}</div><div class="jd-ttrack">${todayPos !== null ? `<i class="jd-today" style="left:${todayPos}%"></i>` : ''}${s ? `<span class="jd-tbar ${op.status}" style="left:${left}%;width:${width}%" title="${escapeHtml(formatDate(op.start))} to ${escapeHtml(formatDate(op.due))}"></span>` : '<em>no dates</em>'}</div></div>`;
        });
        html += `</div>${todayPos !== null ? '<div class="jd-muted jd-small">Vertical line marks today.</div>' : ''}`;
      } else {
        html += '<p class="jd-muted">No scheduled operation dates on this job.</p>';
      }

      // Operations
      html += `<h3 class="jd-h">Operations and resources</h3><div class="jd-scroll"><table class="jd-table"><thead><tr><th>Asm</th><th>Op</th><th>Code</th><th>Resource group</th><th class="n">Est hrs</th><th class="n">Act hrs</th><th class="n">Qty done</th><th>Due</th><th>Status</th></tr></thead><tbody>`;
      html += m.ops.map((op) => `<tr><td>${op.asm}</td><td class="mono">${escapeHtml(op.OprSeq)}</td><td>${escapeHtml(op.OpCode || '')}</td><td>${escapeHtml(op.resource || '—')}</td><td class="n">${hours(op.estHours)}</td><td class="n">${op.hasActual ? hours(op.actHours) : '—'}</td><td class="n">${formatQty(op.QtyCompleted)}</td><td>${formatDate(op.DueDate)}</td><td><span class="jd-dot ${op.status}"></span>${{ done: 'Complete', active: 'In progress', late: 'Past due', notstarted: 'Not started' }[op.status]}</td></tr>`).join('') || '<tr><td colspan="9" class="jd-muted">No operations.</td></tr>';
      html += '</tbody></table></div>';

      // Materials and supply
      html += `<h3 class="jd-h">Materials and supply</h3><div class="jd-scroll"><table class="jd-table"><thead><tr><th>Asm</th><th>Part</th><th class="n">Required</th><th class="n">Issued</th><th class="n">On hand</th><th class="n">Short</th><th>Needed</th><th>Open PO supply</th></tr></thead><tbody>`;
      html += m.mtls.map((mtl) => {
        const supply = mtl.supplies.length ? mtl.supplies.slice(0, 2).map((s) => {
          const vendor = s.vendorNum && this._vendorNames && this._vendorNames.get(s.vendorNum);
          const flag = s.overdue ? '<span class="jd-chip jd-bad">Overdue</span>' : s.late ? '<span class="jd-chip jd-bad">Arrives after need date</span>' : '';
          return `<div>${mtl.short > 0 && flag ? flag + '<br>' : ''}PO ${escapeHtml(s.poNum ?? '?')}${vendor ? ' · ' + escapeHtml(vendor) : ''}<br><span class="jd-muted">${formatQty(s.quantity)} due ${formatDate(s.expectedDate)}</span></div>`;
        }).join('') : (mtl.short > 0 ? '<span class="jd-chip jd-bad">No open PO</span>' : '<span class="jd-muted">—</span>');
        return `<tr class="${mtl.short > 0 ? 'jd-shortrow' : ''}"><td>${escapeHtml(mtl.AssemblySeq ?? 0)}</td><td><span class="mono">${escapeHtml(mtl.PartNum)}</span>${mtl.Description ? `<div class="jd-muted jd-small">${escapeHtml(mtl.Description)}</div>` : ''}</td><td class="n">${formatQty(mtl.required)}</td><td class="n">${formatQty(mtl.issued)}</td><td class="n">${formatQty(mtl.onHand)}</td><td class="n ${mtl.short > 0 ? 'jd-badtext' : ''}">${formatQty(mtl.short)}</td><td>${formatDate(mtl.ReqDate)}</td><td class="jd-supply">${supply}</td></tr>`;
      }).join('') || '<tr><td colspan="8" class="jd-muted">No materials on this job.</td></tr>';
      html += '</tbody></table></div><div class="jd-muted jd-small">On hand is site-wide availability, not reserved for this job.</div>';

      // Labor
      html += '<h3 class="jd-h">Labor transactions</h3>';
      const labor = this._jobDetail.labor;
      if (labor === null) html += '<p class="jd-muted">Loading labor…</p>';
      else if (this._jobDetail.laborError) html += `<p class="jd-muted">Labor records could not be read: ${escapeHtml(this._jobDetail.laborError)}</p>`;
      else if (!labor.length) html += '<p class="jd-muted">No labor posted to this job yet.</p>';
      else {
        const totalHrs = labor.reduce((sum, row) => sum + Number(row.LaborHrs || 0), 0);
        html += `<div class="jd-scroll"><table class="jd-table"><thead><tr><th>Date</th><th>Employee</th><th>Asm</th><th>Op</th><th>Resource group</th><th>Type</th><th class="n">Hours</th><th class="n">Qty</th></tr></thead><tbody>`;
        html += labor.slice().sort((a, b) => new Date(b.ClockInDate || 0) - new Date(a.ClockInDate || 0)).slice(0, 50).map((row) => `<tr><td>${formatDate(row.ClockInDate || row.PayrollDate)}</td><td>${escapeHtml(row.EmployeeNum || row.EmpBasicName || '—')}</td><td>${escapeHtml(row.AssemblySeq ?? '—')}</td><td class="mono">${escapeHtml(row.OprSeq ?? '—')}</td><td>${escapeHtml(row.ResourceGrpID || '—')}</td><td>${escapeHtml({ P: 'Production', S: 'Setup', I: 'Indirect', R: 'Rework' }[row.LaborType] || row.LaborType || '—')}</td><td class="n">${hours(row.LaborHrs)}</td><td class="n">${formatQty(row.LaborQty)}</td></tr>`).join('');
        html += `</tbody></table></div><div class="jd-muted jd-small">${labor.length} record${labor.length === 1 ? '' : 's'}, ${hours(totalHrs)} hours total${labor.length > 50 ? ' (latest 50 shown)' : ''}.</div>`;
      }

      // Costs
      html += '<h3 class="jd-h">Costs: estimate vs actual</h3>';
      if (!m.hasCosts) {
        html += '<p class="jd-muted">Cost rollup fields were not returned for this job.</p>';
      } else {
        const max = Math.max(1, ...m.costs.flatMap((c) => [c.est, c.act]));
        const estTotal = m.costs.reduce((s, c) => s + c.est, 0); const actTotal = m.costs.reduce((s, c) => s + c.act, 0);
        html += '<div class="jd-legend"><span class="jd-li"><span class="jd-key est"></span>Estimate</span><span class="jd-li"><span class="jd-key act"></span>Actual to date</span></div><div class="jd-costs">';
        html += m.costs.map((c) => `<div class="jd-crow"><div class="jd-clabel">${c.label}</div><div class="jd-cbars"><span class="jd-cbar est" style="width:${(c.est / max) * 100}%"></span><span class="jd-cval">${money(c.est)}</span><span class="jd-cbar act" style="width:${(c.act / max) * 100}%"></span><span class="jd-cval">${money(c.act)}</span></div></div>`).join('');
        const variance = actTotal - estTotal;
        html += `</div><dl class="jd-facts"><div><dt>Estimated total</dt><dd>${money(estTotal)}</dd></div><div><dt>Actual to date</dt><dd>${money(actTotal)}</dd></div><div><dt>Remaining estimate</dt><dd>${money(Math.max(0, estTotal - actTotal))}</dd></div></dl>`;
        if (actTotal === 0) html += '<div class="jd-muted jd-small">No actual cost posted yet. Actuals come from labor and material issue transactions.</div>';
        else if (m.completed === total && variance > 0) html += `<div class="jd-chip jd-bad">Over estimate by ${money(variance)}</div>`;
      }
    }
    e.panelContent.innerHTML = html;
    if (e.panel) e.panel.scrollTop = scroll;
    const backBtn = e.panelContent.querySelector('[data-jd-back]');
    if (backBtn) backBtn.addEventListener('click', () => this._openCapacityCell(backBtn.dataset.jdBack));
    const releaseBtn = e.panelContent.querySelector('[data-jd-release]');
    if (releaseBtn) releaseBtn.addEventListener('click', () => { const num = releaseBtn.dataset.jdRelease; this._closePanel(); this._openReleaseDialog(num); });
  }

  _setPanelHeader(eyebrow, title) {
    const panel = this._els && this._els.panel;
    if (!panel) return;
    const eb = panel.querySelector('.panel-header .eyebrow');
    const h = panel.querySelector('#detail-panel-title');
    if (eb) eb.textContent = eyebrow;
    if (h) h.textContent = title;
    if (this._els.closePanel) this._els.closePanel.setAttribute('aria-label', `Close ${eyebrow.toLowerCase()}`);
  }

  _closePanel() {
    this._capDetail = null;
    this._setPanelHeader('Demand detail', 'Release details');
    this._detailToken = (this._detailToken || 0) + 1;
    this._jobDetail = null;
    if (this._els && this._els.panel) this._els.panel.classList.remove('job-drawer');
    this._selected = null;
    if (this._els && this._els.panel) this._els.panel.hidden = true;
    const backdrop = this.host.contentRoot.querySelector('#panel-backdrop');
    if (backdrop) backdrop.hidden = true;
  }
}

const AgentElement = definePrismAgent({
  async initialize({ host }) {
    host.runtime = new PlannerRuntime(host);
    await host.runtime.initialize();
  },
  connect({ host }) {
    host.runtime.connect();
  }
});

export default AgentElement;

//# sourceURL=agent-builder://preview/bundle.js