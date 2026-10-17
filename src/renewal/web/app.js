const $ = (id) => document.getElementById(id);
let token = "";
let portfolio = null;
let state = null;
let draft = null;
let polling = null;
let previewRequest = 0;

async function api(path, input) {
  const response = await fetch(
    path,
    input === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Renewer-Token": token },
          body: JSON.stringify(input),
        },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Please try again.");
  return result;
}

function status(message, mode = "", loading = false) {
  const el = $("status");
  el.replaceChildren();
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.setAttribute("aria-hidden", "true");
  el.append(dot, document.createTextNode(message));
  el.dataset.mode = mode;
  el.classList.toggle("loading", loading);
  dot.hidden = loading;
}

function render(p) {
  portfolio = p;
  $("opportunities").replaceChildren();
  $("empty").hidden = Boolean(p);
  $("refresh").hidden = !p || p.mode === "fixture";
  if (!p) return;
  for (const [index, account] of p.accounts.entries()) {
    const row = document.createElement("article");
    row.className = "opportunity";
    const num = document.createElement("span");
    num.className = "row-number";
    num.textContent = String(index + 1).padStart(2, "0");
    num.setAttribute("aria-hidden", "true");
    const copy = document.createElement("div");
    const name = document.createElement("h2");
    name.textContent = account.name;
    const reason = document.createElement("p");
    reason.className = "reason";
    reason.textContent = account.reason;
    copy.append(name, reason);
    const button = document.createElement("button");
    button.className = "generate";
    button.textContent = "Generate Email";
    button.setAttribute("aria-label", `Generate Email for ${account.name}`);
    const arrow = document.createElement("span");
    arrow.textContent = "↗";
    arrow.setAttribute("aria-hidden", "true");
    button.append(arrow);
    button.addEventListener("click", () => generate(account));
    row.append(num, copy, button);
    $("opportunities").append(row);
  }
  const date = new Date(p.generatedAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  if (p.mode === "fixture")
    status("Design preview · fictional examples, not Box customers or AI results", "fixture");
  else status(`Previously analyzed ${date} · as of ${p.asOf} · refresh to re-read Box`, "cached");
}

async function load() {
  state = await api("/api/state");
  token = state.token;
  if (state.portfolio) render(state.portfolio);
  else {
    render(null);
    status(state.blocker || "Ready to review your portfolio.", state.blocker ? "blocked" : "");
  }
  if (state.running) watch();
}

async function analyze() {
  $("analyze").disabled = true;
  $("refresh").disabled = true;
  try {
    await api("/api/analyze", {});
    status("Reading your portfolio and preparing evidence-backed priorities…", "live", true);
    watch();
  } catch (error) {
    status(error.message, "blocked");
    $("analyze").disabled = false;
    $("refresh").disabled = false;
  }
}

function watch() {
  if (polling) clearTimeout(polling);
  polling = setTimeout(async () => {
    try {
      state = await api("/api/state");
      if (state.running) {
        status(state.progress.detail, "live", true);
        watch();
        return;
      }
      $("analyze").disabled = false;
      $("refresh").disabled = false;
      if (state.progress.stage === "error") status(state.progress.detail, "blocked");
      else if (state.portfolio) {
        render(state.portfolio);
        status(
          `Analyzed with Nova · ${state.portfolio.asOf} · source-matched, ready for your review`,
          "live",
        );
      }
    } catch {
      status("Connection interrupted. No email was sent.", "blocked");
      $("analyze").disabled = false;
      $("refresh").disabled = false;
    }
  }, 1000);
}

async function generate(account) {
  const request = ++previewRequest;
  draft = null;
  $("preview-title").textContent = account.name;
  $("draft-content").hidden = true;
  $("send").disabled = true;
  $("draft-status").textContent =
    portfolio.mode === "fixture"
      ? "Preparing a fixture email preview. No Box retrieval or model invocation."
      : "Re-reading this customer's Box evidence and preparing an email with Nova…";
  $("send-note").textContent = "Nothing is sent automatically.";
  $("preview").showModal();
  try {
    const result = await api("/api/draft", {
      customerId: account.id,
      portfolioId: portfolio.id,
      mode: portfolio.mode,
    });
    if (request !== previewRequest) return;
    draft = result.draft;
    $("email-subject").textContent = draft.email.subject;
    $("email-body").textContent = draft.email.body;
    $("draft-status").textContent =
      draft.mode === "fixture"
        ? "Design preview only · fictional evidence · not an AI-generated customer email"
        : "Source passages matched · review the evidence and recommendations before sending";
    $("sources").replaceChildren();
    for (const source of draft.sources) {
      const link = document.createElement(source.url ? "a" : "span");
      link.textContent = source.name;
      if (source.url && /^https:\/\/app\.box\.com\/file\/\d+$/.test(source.url)) {
        link.href = source.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      } else link.className = "fixture-source";
      $("sources").append(link);
    }
    $("verification-note").textContent =
      draft.verification === "fixture"
        ? "These sources are anonymous UI fixtures, not files from your Box dataset."
        : draft.notice;
    $("draft-content").hidden = false;
    $("send").disabled = false;
    $("send-note").textContent = "Delivery is disabled during local review.";
  } catch (error) {
    $("draft-status").textContent = error.message;
  }
}

$("fixture").addEventListener("click", async () => {
  try {
    const result = await api("/api/fixture", {});
    render(result.portfolio);
  } catch (error) {
    status(error.message, "blocked");
  }
});
$("analyze").addEventListener("click", analyze);
$("refresh").addEventListener("click", analyze);
$("close-preview").addEventListener("click", () => {
  previewRequest++;
  $("preview").close();
});
$("preview").addEventListener("cancel", () => {
  previewRequest++;
});
$("send").addEventListener("click", () => {
  if (draft) $("approval").showModal();
});
$("close-approval").addEventListener("click", () => $("approval").close());
// No send fetch is attached: local review cannot send, even after opening approval.
load()
  .then(() => {
    if (state.liveEnabled && !state.portfolio && !state.running) analyze();
  })
  .catch(() => {
    $("empty").hidden = false;
    status("The local service is unavailable. No analysis was run.", "blocked");
  });
