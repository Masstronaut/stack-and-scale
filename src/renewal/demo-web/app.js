const $ = (id) => document.getElementById(id);
let portfolio;
let generation = 0;
async function api(path, input) {
  const r = await fetch(
    path,
    input
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        }
      : { cache: "no-store" },
  );
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Unable to load demo");
  return data;
}
async function generate(account) {
  const current = ++generation;
  $("preview-title").textContent = account.name;
  $("draft-content").hidden = true;
  $("draft-status").textContent = "Retrieving the verified Box/Nova email preview…";
  $("preview").showModal();
  try {
    const { draft } = await api("/api/draft", {
      customerId: account.id,
      portfolioId: portfolio.id,
    });
    if (current !== generation) return;
    $("email-subject").textContent = draft.email.subject;
    $("email-body").textContent = draft.email.body;
    $("draft-status").textContent = "Verified cached preview · no new AI charge";
    $("sources").replaceChildren();
    for (const s of draft.sources) {
      if (!/^https:\/\/app\.box\.com\/file\/\d+$/.test(s.url)) continue;
      const a = document.createElement("a");
      a.textContent = s.name;
      a.href = s.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.title = `Verified Box version ${s.version}`;
      $("sources").append(a);
    }
    $("verification-note").textContent = draft.notice;
    $("draft-content").hidden = false;
  } catch (e) {
    $("draft-status").textContent = e.message;
  }
}
$("close-preview").onclick = () => {
  generation++;
  $("preview").close();
};
$("preview").addEventListener("cancel", () => generation++);
api("/api/state")
  .then((state) => {
    portfolio = state.portfolio;
    if (!portfolio || portfolio.accounts.length !== 2)
      throw new Error("The two verified priorities are not available yet");
    $("status").textContent =
      `${state.attempted} accounts attempted · ${state.verified} verified · assessed ${portfolio.asOf} · cached ${new Date(portfolio.generatedAt).toLocaleString()}`;
    for (const [i, a] of portfolio.accounts.entries()) {
      const row = document.createElement("article");
      row.className = "opportunity";
      const number = document.createElement("span");
      number.className = "row-number";
      number.textContent = String(i + 1).padStart(2, "0");
      const copy = document.createElement("div"),
        name = document.createElement("h2"),
        reason = document.createElement("p");
      name.textContent = a.name;
      reason.className = "reason";
      reason.textContent = a.reason;
      copy.append(name, reason);
      const button = document.createElement("button");
      button.className = "generate";
      button.textContent = "Generate Email ↗";
      button.setAttribute("aria-label", `Generate Email for ${a.name}`);
      button.onclick = () => generate(a);
      row.append(number, copy, button);
      $("opportunities").append(row);
    }
  })
  .catch((e) => ($("status").textContent = e.message));
