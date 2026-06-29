const sampleCsv = `name,phone,consent_source,tags
Riya Shah,(415) 555-0103,loyalty signup,regular;popup
Mateo Garcia,+14155550104,instagram giveaway,popup
Elena Brooks,415-555-0105,email list,regular`;

const state = {
  data: null,
  activeCampaignId: null,
  activeView: "campaigns"
};

const elements = {
  workspaceIdentity: document.querySelector("#workspaceIdentity"),
  telephonyStatus: document.querySelector("#telephonyStatus"),
  metricsGrid: document.querySelector("#metricsGrid"),
  workspaceTabs: document.querySelector(".workspace-tabs"),
  campaignList: document.querySelector("#campaignList"),
  campaignForm: document.querySelector("#campaignForm"),
  campaignCustomerPicker: document.querySelector("#campaignCustomerPicker"),
  campaignEditorTitle: document.querySelector("#campaignEditorTitle"),
  newCampaign: document.querySelector("#newCampaign"),
  previewScript: document.querySelector("#previewScript"),
  saveScript: document.querySelector("#saveScript"),
  previewMessages: document.querySelector("#previewMessages"),
  scheduleMessages: document.querySelector("#scheduleMessages"),
  messagePreviewResult: document.querySelector("#messagePreviewResult"),
  scheduleCalls: document.querySelector("#scheduleCalls"),
  scriptPreview: document.querySelector("#scriptPreview"),
  questionInput: document.querySelector("#questionInput"),
  askQuestion: document.querySelector("#askQuestion"),
  answerResult: document.querySelector("#answerResult"),
  csvFile: document.querySelector("#csvFile"),
  csvText: document.querySelector("#csvText"),
  loadSampleCsv: document.querySelector("#loadSampleCsv"),
  importCsv: document.querySelector("#importCsv"),
  csvResult: document.querySelector("#csvResult"),
  customersTable: document.querySelector("#customersTable"),
  knowledgeForm: document.querySelector("#knowledgeForm"),
  kbScope: document.querySelector("#kbScope"),
  knowledgeList: document.querySelector("#knowledgeList"),
  callsTable: document.querySelector("#callsTable"),
  messagesTable: document.querySelector("#messagesTable"),
  followupsTable: document.querySelector("#followupsTable"),
  businessForm: document.querySelector("#businessForm"),
  assignedCallerNumber: document.querySelector("#assignedCallerNumber"),
  openAiKeyForm: document.querySelector("#openAiKeyForm"),
  openAiKeyMasked: document.querySelector("#openAiKeyMasked"),
  clearOpenAiKey: document.querySelector("#clearOpenAiKey"),
  adminOpenAiKeyMasked: document.querySelector("#adminOpenAiKeyMasked"),
  newWorkspace: document.querySelector("#newWorkspace"),
  workspaceForm: document.querySelector("#workspaceForm"),
  workspacesTable: document.querySelector("#workspacesTable"),
  userForm: document.querySelector("#userForm"),
  usersTable: document.querySelector("#usersTable"),
  twilioNumberForm: document.querySelector("#twilioNumberForm"),
  twilioNumbersTable: document.querySelector("#twilioNumbersTable"),
  messagingSenderForm: document.querySelector("#messagingSenderForm"),
  messagingSendersTable: document.querySelector("#messagingSendersTable"),
  deleteMessagingSender: document.querySelector("#deleteMessagingSender"),
  logoutButton: document.querySelector("#logoutButton"),
  toast: document.querySelector("#toast")
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => elements.toast.classList.remove("visible"), 3200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options,
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    window.location.href = "/login.html";
    return {};
  }
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }
  return payload;
}

function activeCampaign() {
  return state.data?.campaigns.find((campaign) => campaign.id === state.activeCampaignId) || null;
}

function contactById(id) {
  return state.data.contacts.find((contact) => contact.id === id);
}

function campaignById(id) {
  return state.data.campaigns.find((campaign) => campaign.id === id);
}

function formValue(name, value) {
  const field = elements.campaignForm.elements[name];
  if (field) field.value = value ?? "";
}

function formChecked(name, checked) {
  const field = elements.campaignForm.elements[name];
  if (field) field.checked = Boolean(checked);
}

function setCheckedValues(name, values = []) {
  const selected = new Set(values);
  elements.campaignForm.querySelectorAll(`input[name="${name}"]`).forEach((field) => {
    field.checked = selected.has(field.value);
  });
}

function campaignToForm(campaign) {
  formValue("id", campaign?.id || "");
  formValue("name", campaign?.name || "");
  formValue("type", campaign?.type || "event");
  formValue("callMode", campaign?.callMode || "conversational");
  formValue("dispatchMode", campaign?.dispatchMode || "batch");
  formValue("languageMode", campaign?.languageMode || "english");
  formValue("eventDate", campaign?.eventDate || "");
  formValue("targetTags", (campaign?.targetTags || []).join(", "));
  formValue("languageInstructions", campaign?.languageInstructions || "");
  formValue("location", campaign?.location || "");
  formValue("offer", campaign?.offer || "");
  formValue("objective", campaign?.objective || "");
  formValue("scriptNotes", campaign?.scriptNotes || "");
  formValue("scriptOverride", campaign?.scriptOverride || "");
  setCheckedValues("messageChannels", campaign?.messageChannels || []);
  formChecked("messageAiEnabled", campaign?.messageAiEnabled !== false);
  formValue("smsBody", campaign?.smsBody || "");
  formValue("whatsappContentSid", campaign?.whatsappContentSid || "");
  formValue("whatsappContentVariables", JSON.stringify(campaign?.whatsappContentVariables || {}, null, 2));
  elements.messagePreviewResult.textContent = "";
  elements.campaignEditorTitle.textContent = campaign ? "Edit campaign" : "Create campaign";
}

function campaignFormBody() {
  const formData = new FormData(elements.campaignForm);
  return {
    ...Object.fromEntries(formData),
    messageChannels: formData.getAll("messageChannels"),
    messageAiEnabled: formData.has("messageAiEnabled"),
    targetContactIds: formData.getAll("targetContactIds")
  };
}

function businessToForm() {
  const business = state.data.business;
  elements.businessForm.elements.workspaceName.value = state.data.workspace?.name || "";
  elements.assignedCallerNumber.value = state.data.workspace?.assignedTwilioNumber || "";
  elements.businessForm.elements.name.value = business.name || "";
  elements.businessForm.elements.callerId.value = business.callerId || "";
  elements.businessForm.elements.phone.value = business.phone || "";
  elements.businessForm.elements.timezone.value = business.timezone || "America/Los_Angeles";
  elements.businessForm.elements.callWindowStart.value = business.defaultCallWindow?.start || "10:00";
  elements.businessForm.elements.callWindowEnd.value = business.defaultCallWindow?.end || "18:00";
  elements.openAiKeyMasked.value = state.data.workspace?.openAiKeyMasked || "";
}

function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function tagPills(tags = []) {
  if (!tags.length) return '<span class="pill">no tags</span>';
  return tags.map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`).join("");
}

function statusClass(status) {
  if (["queued", "queued_local", "scheduled", "completed", "in_progress", "in-progress"].includes(status)) return "ok";
  if (["creating", "draft", "waiting_to_call", "initiated", "ringing", "answered", "ending"].includes(status)) return "warn";
  if (["failed", "opted_out", "canceled", "ending_failed"].includes(status)) return "danger";
  return "";
}

function canEndCall(log) {
  return ["creating", "queued", "queued_local", "waiting_to_call", "initiated", "ringing", "answered", "in-progress", "in_progress", "ending_failed"].includes(log.status);
}

function canCallAgain(log) {
  const contact = contactById(log.contactId);
  return Boolean(contact && campaignById(log.campaignId) && contact.consentSource && !contact.optedOut);
}

function callTranscriptEntries(log) {
  return log.rawTranscript?.length ? log.rawTranscript : log.transcript || [];
}

function hasTranscript(log) {
  return callTranscriptEntries(log).length > 0;
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderTelephony() {
  const config = state.data.telephony;
  const messaging = state.data.messaging || {};
  const mode = config.mode === "live" && config.liveReady ? "Live calls enabled" : "Dry-run call queue";
  const messagingMode = messaging.mode === "live" && messaging.liveReady ? "live messaging" : "dry-run messaging";
  const details =
    config.mode === "live" && !config.liveReady
      ? "Live mode needs Twilio credentials, PUBLIC_BASE_URL, and an assigned workspace number."
      : config.publicBaseUrl
        ? `Webhook base: ${config.publicBaseUrl} · ${messagingMode}`
        : "Set TELEPHONY_MODE=live with Twilio credentials to place real calls.";
  const user = state.data.currentUser;
  const workspace = state.data.workspace;
  elements.workspaceIdentity.innerHTML = `<strong>${escapeHtml(workspace?.name || "Workspace")}</strong><br>${escapeHtml(user?.email || "")}`;
  elements.telephonyStatus.innerHTML = `<strong>${mode}</strong><br>${escapeHtml(details)}`;
}

function renderMetrics() {
  const optedIn = state.data.contacts.filter((contact) => !contact.optedOut && contact.consentSource).length;
  const followUps = state.data.followUps.filter((item) => item.status !== "closed").length;
  const scheduled = state.data.callLogs.filter((log) => log.status !== "failed").length;
  const messages = (state.data.messageLogs || []).filter((log) => log.status !== "failed").length;
  const metrics = [
    ["Contacts", state.data.contacts.length, `${optedIn} callable with consent`],
    ["Campaigns", state.data.campaigns.length, "Popup and sale call flows"],
    ["Calls", scheduled, "Queued or attempted calls"],
    ["Messages", messages, "SMS and WhatsApp logs"],
    ["Follow-ups", followUps, "Questions needing the business"]
  ];

  elements.metricsGrid.innerHTML = metrics
    .map(([label, value, detail]) => `
      <article class="metric-card">
        <span>${label}</span>
        <strong>${value}</strong>
        <span>${detail}</span>
      </article>
    `)
    .join("");
}

function renderWorkspaceTabs() {
  const isAdmin = state.data.currentUser?.role === "admin";
  document.querySelectorAll(".admin-only").forEach((element) => {
    element.hidden = !isAdmin;
  });
  if (!isAdmin && state.activeView === "admin") {
    state.activeView = "campaigns";
  }
  document.querySelectorAll(".workspace-tabs .tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.activeView);
  });
  document.querySelectorAll(".workspace-view").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.viewPanel === state.activeView);
  });
}

function renderCampaignList() {
  elements.campaignList.innerHTML =
    state.data.campaigns
      .map((campaign) => `
        <button class="campaign-list-item ${campaign.id === state.activeCampaignId ? "active" : ""}" data-campaign-id="${escapeHtml(campaign.id)}">
          <strong>${escapeHtml(campaign.name)}</strong>
          <span>${escapeHtml(campaign.type)} · ${escapeHtml(campaign.callMode || "conversational")} · ${escapeHtml(campaign.languageMode || "english")} · ${formatDate(campaign.eventDate)}</span>
          <small>${escapeHtml((campaign.dispatchMode || "batch") === "one_by_one" ? "One by one" : "Batch")} · ${escapeHtml((campaign.messageChannels || []).join("/") || "voice only")} · ${escapeHtml((campaign.targetContactIds || []).length ? `${campaign.targetContactIds.length} selected` : "tags/all customers")} · ${escapeHtml(campaign.location || "No location")}</small>
        </button>
      `)
      .join("") || '<div class="inline-result">No campaigns yet.</div>';
}

function renderCampaignCustomerPicker(campaign) {
  const selected = new Set(campaign?.targetContactIds || []);
  const rows = state.data.contacts.map((contact) => {
    const callable = Boolean(contact.consentSource && !contact.optedOut);
    const reason = contact.optedOut ? "opted out" : contact.consentSource ? contact.phone : "missing consent";
    return `
      <label class="customer-choice ${callable ? "" : "disabled"}">
        <input
          type="checkbox"
          name="targetContactIds"
          value="${escapeHtml(contact.id)}"
          ${selected.has(contact.id) ? "checked" : ""}
          ${callable ? "" : "disabled"}
        />
        <span>
          <strong>${escapeHtml(contact.name)}</strong>
          <small>${escapeHtml(reason)}${contact.tags?.length ? ` · ${escapeHtml(contact.tags.join(", "))}` : ""}</small>
        </span>
      </label>
    `;
  });

  elements.campaignCustomerPicker.innerHTML = rows.join("") || '<div class="inline-result">Add customers before selecting campaign recipients.</div>';
}

function renderCampaignControls() {
  if (!state.activeCampaignId && state.data.campaigns[0]) {
    state.activeCampaignId = state.data.campaigns[0].id;
  }
  renderCampaignList();
  const campaign = activeCampaign();
  campaignToForm(campaign);
  renderCampaignCustomerPicker(campaign);

  elements.kbScope.innerHTML = [
    '<option value="global">All campaigns</option>',
    ...state.data.campaigns.map((campaign) => `<option value="${escapeHtml(campaign.id)}">${escapeHtml(campaign.name)}</option>`)
  ].join("");
}

function renderKnowledge() {
  const campaign = activeCampaign();
  const visibleItems = state.data.knowledgeBase.filter((item) => item.scope === "global" || item.scope === campaign?.id);
  const scopeOptions = (selectedScope) => [
    `<option value="global" ${selectedScope === "global" ? "selected" : ""}>All campaigns</option>`,
    ...state.data.campaigns.map((campaignItem) => `
      <option value="${escapeHtml(campaignItem.id)}" ${selectedScope === campaignItem.id ? "selected" : ""}>${escapeHtml(campaignItem.name)}</option>
    `)
  ].join("");

  elements.knowledgeList.innerHTML =
    visibleItems
      .map((item) => `
        <article class="list-item">
          <form class="form-grid knowledge-item" data-knowledge-id="${escapeHtml(item.id)}">
            <label>
              Scope
              <select name="scope">${scopeOptions(item.scope)}</select>
            </label>
            <label>
              Topic
              <input name="topic" value="${escapeHtml(item.topic)}" />
            </label>
            <label class="span-2">
              Customer question
              <input name="question" value="${escapeHtml(item.question)}" />
            </label>
            <label class="span-2">
              Approved answer
              <textarea name="answer" rows="3">${escapeHtml(item.answer)}</textarea>
            </label>
            <button type="button" class="secondary-action save-knowledge">Save answer</button>
          </form>
        </article>
      `)
      .join("") || '<div class="inline-result">No approved answers for this campaign yet.</div>';
}

function renderContactsTable() {
  elements.customersTable.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Phone</th>
            <th>Consent</th>
            <th>Tags</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${state.data.contacts
            .map((contact) => `
              <tr>
                <td>${escapeHtml(contact.name)}</td>
                <td>${escapeHtml(contact.phone)}</td>
                <td>${escapeHtml(contact.consentSource || "missing")}</td>
                <td><div class="pill-row">${tagPills(contact.tags)}</div></td>
                <td>
                  <span class="status ${contact.optedOut ? "danger" : "ok"}">${contact.optedOut ? "opted out" : "contactable"}</span>
                  <div class="pill-row">
                    <span class="pill ${contact.channelOptOuts?.sms ? "danger-pill" : ""}">SMS ${contact.channelOptOuts?.sms ? "off" : "on"}</span>
                    <span class="pill ${contact.channelOptOuts?.whatsapp ? "danger-pill" : ""}">WhatsApp ${contact.channelOptOuts?.whatsapp ? "off" : "on"}</span>
                  </div>
                </td>
                <td>
                  <button
                    class="secondary-action call-permission"
                    data-contact-id="${escapeHtml(contact.id)}"
                    data-opted-out="${contact.optedOut ? "false" : "true"}"
                    ${!contact.consentSource ? "disabled" : ""}
                  >
                    ${contact.optedOut ? "Opt in" : "Opt out"}
                  </button>
                  <button class="secondary-action delete-contact" data-contact-id="${escapeHtml(contact.id)}">Delete</button>
                </td>
              </tr>
            `)
            .join("") || '<tr><td colspan="6">No customers yet.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function renderCallsTable() {
  elements.callsTable.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Contact</th>
            <th>Campaign</th>
            <th>Status</th>
            <th>Provider</th>
            <th>Summary</th>
            <th>Created</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${state.data.callLogs
            .map((log) => {
              const contact = contactById(log.contactId);
              const campaign = campaignById(log.campaignId);
              const transcript = callTranscriptEntries(log).slice(-2).map((line) => `${line.role}: ${line.text}`).join(" ");
              return `
                <tr>
                  <td>${escapeHtml(contact?.name || "Unknown")}<br><small>${escapeHtml(contact?.phone || "")}</small></td>
                  <td>
                    <strong>${escapeHtml(campaign?.name || "Unknown")}</strong><br>
                    <small>${escapeHtml(campaign?.callMode || "conversational")} · ${escapeHtml(campaign?.dispatchMode || "batch")}</small>
                  </td>
                  <td><span class="status ${statusClass(log.status)}">${escapeHtml(log.status)}</span></td>
                  <td>${escapeHtml(log.provider || "none")}<br><small>${escapeHtml(log.providerCallId || log.providerNote || "")}</small></td>
                  <td>${escapeHtml(log.summary || transcript || log.error || "Awaiting call activity.")}</td>
                  <td>${formatDate(log.createdAt)}</td>
                  <td>
                    ${
                      canCallAgain(log)
                        ? `<button class="secondary-action call-again" data-call-id="${escapeHtml(log.id)}">Call again</button>`
                        : ""
                    }
                    ${
                      hasTranscript(log)
                        ? `<button class="secondary-action export-transcript" data-call-id="${escapeHtml(log.id)}">Export transcript</button>`
                        : ""
                    }
                    ${
                      canEndCall(log)
                        ? `<button class="secondary-action end-call" data-call-id="${escapeHtml(log.id)}">End call</button>`
                        : ""
                    }
                  </td>
                </tr>
              `;
            })
            .join("") || '<tr><td colspan="7">No calls scheduled yet.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function threadById(id) {
  return (state.data.messageThreads || []).find((thread) => thread.id === id);
}

function renderMessagesTable() {
  elements.messagesTable.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Contact</th>
            <th>Campaign</th>
            <th>Channel</th>
            <th>Direction</th>
            <th>Status</th>
            <th>Message</th>
            <th>Created</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${(state.data.messageLogs || [])
            .map((log) => {
              const contact = contactById(log.contactId);
              const campaign = campaignById(log.campaignId);
              const thread = threadById(log.threadId);
              return `
                <tr>
                  <td>${escapeHtml(contact?.name || "Unknown")}<br><small>${escapeHtml(contact?.phone || "")}</small></td>
                  <td>${escapeHtml(campaign?.name || "Unknown")}</td>
                  <td>${escapeHtml(log.channel || "")}</td>
                  <td>${escapeHtml(log.direction || "")}</td>
                  <td><span class="status ${statusClass(log.status)}">${escapeHtml(log.status || "")}</span><br><small>${escapeHtml(log.providerMessageId || log.error || "")}</small></td>
                  <td>${escapeHtml(log.body || log.contentSid || "Template message")}</td>
                  <td>${formatDate(log.createdAt)}</td>
                  <td>
                    ${
                      thread?.handoffRequired
                        ? `<button class="secondary-action reset-thread-ai" data-thread-id="${escapeHtml(thread.id)}">Reset AI</button>`
                        : ""
                    }
                  </td>
                </tr>
              `;
            })
            .join("") || '<tr><td colspan="8">No messages yet.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function renderFollowUpsTable() {
  elements.followupsTable.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Contact</th>
            <th>Campaign</th>
            <th>Question</th>
            <th>Status</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          ${state.data.followUps
            .map((item) => `
              <tr>
                <td>${escapeHtml(contactById(item.contactId)?.name || "Unknown")}</td>
                <td>${escapeHtml(campaignById(item.campaignId)?.name || "Unknown")}</td>
                <td>${escapeHtml(item.question || "No question captured")}</td>
                <td><span class="status warn">${escapeHtml(item.status)}</span></td>
                <td>${formatDate(item.createdAt)}</td>
              </tr>
            `)
            .join("") || '<tr><td colspan="5">No follow-ups yet.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function workspaceOptions(selected = "", includeBlank = false) {
  const workspaces = state.data.admin?.workspaces || [];
  return [
    includeBlank ? `<option value="" ${!selected ? "selected" : ""}>Unassigned</option>` : "",
    ...workspaces.map((workspace) => `
      <option value="${escapeHtml(workspace.id)}" ${selected === workspace.id ? "selected" : ""}>${escapeHtml(workspace.name)}</option>
    `)
  ].join("");
}

function twilioNumberOptions(selected = "") {
  const numbers = state.data.admin?.twilioNumbers || [];
  return [
    `<option value="" ${!selected ? "selected" : ""}>No number assigned</option>`,
    ...numbers.map((number) => {
      const workspace = state.data.admin?.workspaces?.find((item) => item.id === number.workspaceId);
      const suffix = workspace ? ` - ${workspace.name}` : " - unassigned";
      return `<option value="${escapeHtml(number.id)}" ${selected === number.id ? "selected" : ""}>${escapeHtml(number.phoneNumber + suffix)}</option>`;
    })
  ].join("");
}

function resetWorkspaceAdminForm() {
  elements.workspaceForm.reset();
  elements.workspaceForm.elements.id.value = "";
  elements.adminOpenAiKeyMasked.value = "";
  elements.workspaceForm.elements.clearOpenAiKey.checked = false;
  elements.workspaceForm.elements.assignedTwilioNumberId.innerHTML = twilioNumberOptions("");
}

function resetMessagingSenderForm() {
  elements.messagingSenderForm.reset();
  elements.messagingSenderForm.elements.id.value = "";
  elements.messagingSenderForm.elements.active.checked = true;
  elements.messagingSenderForm.elements.isDefault.checked = false;
  elements.messagingSenderForm.elements.workspaceId.innerHTML = workspaceOptions(elements.messagingSenderForm.elements.workspaceId.value || state.data.workspace?.id || "");
}

function renderAdmin() {
  if (!state.data.admin) return;

  elements.workspaceForm.elements.assignedTwilioNumberId.innerHTML = twilioNumberOptions(elements.workspaceForm.elements.assignedTwilioNumberId.value);
  elements.userForm.elements.workspaceId.innerHTML = workspaceOptions(elements.userForm.elements.workspaceId.value);
  elements.twilioNumberForm.elements.workspaceId.innerHTML = workspaceOptions(elements.twilioNumberForm.elements.workspaceId.value, true);
  elements.messagingSenderForm.elements.workspaceId.innerHTML = workspaceOptions(elements.messagingSenderForm.elements.workspaceId.value || state.data.workspace?.id || "");

  elements.workspacesTable.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Workspace</th><th>Caller number</th><th>OpenAI key</th><th>Action</th></tr></thead>
        <tbody>
          ${state.data.admin.workspaces
            .map((workspace) => `
              <tr>
                <td><strong>${escapeHtml(workspace.name)}</strong><br><small>${escapeHtml(workspace.business?.name || "")}</small></td>
                <td>${escapeHtml(workspace.assignedTwilioNumber || "Not assigned")}</td>
                <td>${escapeHtml(workspace.openAiKeyMasked || "No key saved")}</td>
                <td><button class="secondary-action edit-workspace" data-workspace-id="${escapeHtml(workspace.id)}">Edit</button></td>
              </tr>
            `)
            .join("") || '<tr><td colspan="4">No workspaces yet.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  elements.usersTable.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Email</th><th>Role</th><th>Workspace</th><th>Action</th></tr></thead>
        <tbody>
          ${state.data.admin.users
            .map((user) => {
              const workspace = state.data.admin.workspaces.find((item) => item.id === user.workspaceId);
              return `
                <tr>
                  <td>${escapeHtml(user.email)}</td>
                  <td>${escapeHtml(user.role)}</td>
                  <td>${escapeHtml(workspace?.name || "Missing")}</td>
                  <td><button class="secondary-action edit-user" data-user-id="${escapeHtml(user.id)}">Edit</button></td>
                </tr>
              `;
            })
            .join("") || '<tr><td colspan="4">No users yet.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  elements.twilioNumbersTable.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Number</th><th>Label</th><th>Workspace</th><th>Action</th></tr></thead>
        <tbody>
          ${state.data.admin.twilioNumbers
            .map((number) => {
              const workspace = state.data.admin.workspaces.find((item) => item.id === number.workspaceId);
              return `
                <tr>
                  <td>${escapeHtml(number.phoneNumber)}</td>
                  <td>${escapeHtml(number.label || "")}</td>
                  <td>${escapeHtml(workspace?.name || "Unassigned")}</td>
                  <td><button class="secondary-action edit-twilio-number" data-number-id="${escapeHtml(number.id)}">Edit</button></td>
                </tr>
              `;
            })
            .join("") || '<tr><td colspan="4">No Twilio numbers yet.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  elements.messagingSendersTable.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Sender</th><th>Workspace</th><th>Channel</th><th>Route</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>
          ${(state.data.admin.messagingSenders || [])
            .map((sender) => {
              const workspace = state.data.admin.workspaces.find((item) => item.id === sender.workspaceId);
              const route = sender.messagingServiceSid || sender.fromAddress || "Missing route";
              return `
                <tr>
                  <td><strong>${escapeHtml(sender.label || "Sender")}</strong><br><small>${escapeHtml(sender.whatsappContentSid || "")}</small></td>
                  <td>${escapeHtml(workspace?.name || "Missing")}</td>
                  <td>${escapeHtml(sender.channel || "")}</td>
                  <td>${escapeHtml(route)}</td>
                  <td>
                    <span class="status ${sender.active === false ? "danger" : "ok"}">${sender.active === false ? "inactive" : "active"}</span>
                    ${sender.isDefault ? '<span class="status ok">default</span>' : ""}
                  </td>
                  <td><button class="secondary-action edit-messaging-sender" data-sender-id="${escapeHtml(sender.id)}">Edit</button></td>
                </tr>
              `;
            })
            .join("") || '<tr><td colspan="6">No messaging senders yet.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function render() {
  if (!state.data) return;
  renderTelephony();
  renderMetrics();
  renderWorkspaceTabs();
  renderCampaignControls();
  renderKnowledge();
  renderContactsTable();
  renderCallsTable();
  renderMessagesTable();
  renderFollowUpsTable();
  businessToForm();
  renderAdmin();
}

async function loadState() {
  state.data = await api("/api/state");
  if (!state.activeCampaignId && state.data.campaigns[0]) {
    state.activeCampaignId = state.data.campaigns[0].id;
  }
  render();
}

elements.workspaceTabs.addEventListener("click", (event) => {
  const button = event.target.closest(".tab");
  if (!button) return;
  state.activeView = button.dataset.view;
  renderWorkspaceTabs();
});

elements.campaignList.addEventListener("click", (event) => {
  const button = event.target.closest(".campaign-list-item");
  if (!button) return;
  state.activeCampaignId = button.dataset.campaignId;
  elements.answerResult.textContent = "";
  render();
});

elements.newCampaign.addEventListener("click", () => {
  state.activeCampaignId = null;
  campaignToForm(null);
  renderCampaignCustomerPicker(null);
  renderCampaignList();
});

elements.campaignForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = campaignFormBody();
  const id = body.id;
  delete body.id;

  try {
    const payload = id
      ? await api(`/api/campaigns/${id}`, { method: "PUT", body })
      : await api("/api/campaigns", { method: "POST", body });
    state.data = payload.state;
    state.activeCampaignId = payload.campaign.id;
    showToast(id ? "Campaign saved." : "Campaign created.");
    render();
  } catch (error) {
    showToast(error.message);
  }
});

elements.previewScript.addEventListener("click", async () => {
  const campaign = activeCampaign();
  if (!campaign) {
    showToast("Save the campaign before generating a preview script.");
    return;
  }
  try {
    const payload = await api(`/api/campaigns/${campaign.id}/preview`, { method: "POST", body: {} });
    elements.scriptPreview.value = payload.script;
  } catch (error) {
    showToast(error.message);
  }
});

elements.saveScript.addEventListener("click", async () => {
  const campaign = activeCampaign();
  if (!campaign) {
    showToast("Save the campaign before saving a script.");
    return;
  }
  try {
    const payload = await api(`/api/campaigns/${campaign.id}/script`, {
      method: "PUT",
      body: { script: elements.scriptPreview.value }
    });
    state.data = payload.state;
    state.activeCampaignId = payload.campaign.id;
    showToast("Script saved.");
    render();
  } catch (error) {
    showToast(error.message);
  }
});

elements.scheduleCalls.addEventListener("click", async () => {
  const campaign = activeCampaign();
  if (!campaign) {
    showToast("Select or save a campaign before scheduling calls.");
    return;
  }
  elements.scheduleCalls.disabled = true;
  try {
    const payload = await api(`/api/campaigns/${campaign.id}/schedule`, { method: "POST", body: {} });
    state.data = payload.state;
    state.activeView = "calls";
    showToast(`Scheduled ${payload.results.length} call(s).`);
    render();
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.scheduleCalls.disabled = false;
  }
});

elements.previewMessages.addEventListener("click", async () => {
  const campaign = activeCampaign();
  if (!campaign) {
    showToast("Save the campaign before previewing messages.");
    return;
  }
  try {
    const payload = await api(`/api/campaigns/${campaign.id}/messages/preview`, { method: "POST", body: {} });
    const rows = Object.entries(payload.preview || {})
      .map(([channel, item]) => {
        const detail =
          channel === "whatsapp"
            ? `ContentSid: ${escapeHtml(item.contentSid || "missing")}<br>Variables: ${escapeHtml(JSON.stringify(item.contentVariables || {}))}`
            : escapeHtml(item.body || "");
        return `<strong>${escapeHtml(channel.toUpperCase())}</strong> to ${escapeHtml(payload.sampleContact?.name || "sample")}<br>${detail}`;
      })
      .join("<hr>");
    elements.messagePreviewResult.innerHTML = `${payload.readinessError ? `<strong>${escapeHtml(payload.readinessError)}</strong><br>` : ""}${rows || "Enable SMS or WhatsApp first."}`;
  } catch (error) {
    showToast(error.message);
  }
});

elements.scheduleMessages.addEventListener("click", async () => {
  const campaign = activeCampaign();
  if (!campaign) {
    showToast("Select or save a campaign before scheduling messages.");
    return;
  }
  elements.scheduleMessages.disabled = true;
  try {
    const payload = await api(`/api/campaigns/${campaign.id}/messages/schedule`, { method: "POST", body: {} });
    state.data = payload.state;
    state.activeView = "messages";
    showToast(`Scheduled ${payload.results.length} message(s).`);
    render();
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.scheduleMessages.disabled = false;
  }
});

elements.messagesTable.addEventListener("click", async (event) => {
  const button = event.target.closest(".reset-thread-ai");
  if (!button) return;
  try {
    const payload = await api(`/api/message-threads/${button.dataset.threadId}/reset-ai`, { method: "POST", body: {} });
    state.data = payload.state;
    showToast("AI reset for this thread.");
    render();
  } catch (error) {
    showToast(error.message);
  }
});

elements.callsTable.addEventListener("click", async (event) => {
  const button = event.target.closest(".end-call");
  if (!button) return;
  const call = state.data.callLogs.find((log) => log.id === button.dataset.callId);
  if (!call || !window.confirm("End this call now?")) return;

  button.disabled = true;
  try {
    const payload = await api(`/api/calls/${button.dataset.callId}/end`, { method: "POST", body: {} });
    state.data = payload.state;
    showToast("Call end requested.");
    render();
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});

elements.callsTable.addEventListener("click", async (event) => {
  const button = event.target.closest(".call-again");
  if (!button) return;
  const call = state.data.callLogs.find((log) => log.id === button.dataset.callId);
  const contact = call ? contactById(call.contactId) : null;
  const campaign = call ? campaignById(call.campaignId) : null;
  if (!call || !contact || !campaign) return;
  if (!window.confirm(`Call ${contact.name} again for ${campaign.name}?`)) return;

  button.disabled = true;
  try {
    const payload = await api(`/api/calls/${button.dataset.callId}/call-again`, { method: "POST", body: {} });
    state.data = payload.state;
    state.activeView = "calls";
    showToast(`Calling ${contact.name} again.`);
    render();
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});

elements.callsTable.addEventListener("click", async (event) => {
  const button = event.target.closest(".export-transcript");
  if (!button) return;

  try {
    const payload = await api(`/api/calls/${button.dataset.callId}/transcript`);
    const contact = contactById(payload.contactId);
    const campaign = campaignById(payload.campaignId);
    downloadJson(`call-transcript-${button.dataset.callId}.json`, {
      ...payload,
      contactName: contact?.name || "",
      contactPhone: contact?.phone || "",
      campaignName: campaign?.name || ""
    });
    showToast("Transcript exported.");
  } catch (error) {
    showToast(error.message);
  }
});

elements.askQuestion.addEventListener("click", async () => {
  const campaign = activeCampaign();
  if (!campaign) return;
  try {
    const payload = await api("/api/answer", {
      method: "POST",
      body: {
        campaignId: campaign.id,
        question: elements.questionInput.value
      }
    });
    const result = payload.answer;
    elements.answerResult.innerHTML = `
      <strong>${result.canAnswer ? "Approved answer" : "Follow-up needed"}</strong><br>
      ${escapeHtml(result.answer)}
    `;
  } catch (error) {
    showToast(error.message);
  }
});

elements.csvFile.addEventListener("change", async () => {
  const file = elements.csvFile.files?.[0];
  if (file) {
    elements.csvText.value = await file.text();
  }
});

elements.loadSampleCsv.addEventListener("click", () => {
  elements.csvText.value = sampleCsv;
});

elements.importCsv.addEventListener("click", async () => {
  try {
    const payload = await api("/api/contacts/import", {
      method: "POST",
      body: { csv: elements.csvText.value }
    });
    state.data = payload.state;
    const errorText = payload.errors.length
      ? ` ${payload.errors.length} row issue(s): ${payload.errors.map((error) => `row ${error.row} ${error.message}`).join(" ")}`
      : "";
    elements.csvResult.textContent = `Imported ${payload.contacts.length} contact(s).${errorText}`;
    showToast("Contacts imported.");
    render();
  } catch (error) {
    showToast(error.message);
  }
});

elements.customersTable.addEventListener("click", async (event) => {
  const button = event.target.closest(".call-permission");
  if (!button) return;
  try {
    const nextOptedOut = button.dataset.optedOut === "true";
    const payload = await api(`/api/contacts/${button.dataset.contactId}/call-permission`, {
      method: "POST",
      body: { optedOut: nextOptedOut }
    });
    state.data = payload.state;
    showToast(nextOptedOut ? "Contact opted out." : "Contact opted in.");
    render();
  } catch (error) {
    showToast(error.message);
  }
});

elements.customersTable.addEventListener("click", async (event) => {
  const button = event.target.closest(".delete-contact");
  if (!button) return;
  const contact = contactById(button.dataset.contactId);
  if (!contact || !window.confirm(`Delete ${contact.name}? This also removes their call logs and follow-ups.`)) return;

  try {
    const payload = await api(`/api/contacts/${button.dataset.contactId}`, { method: "DELETE" });
    state.data = payload.state;
    showToast("Customer deleted.");
    render();
  } catch (error) {
    showToast(error.message);
  }
});

elements.knowledgeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(elements.knowledgeForm));
  try {
    const payload = await api("/api/knowledge", { method: "POST", body });
    state.data = payload.state;
    elements.knowledgeForm.reset();
    elements.kbScope.value = body.scope;
    showToast("Approved answer added.");
    render();
  } catch (error) {
    showToast(error.message);
  }
});

elements.knowledgeList.addEventListener("click", async (event) => {
  const button = event.target.closest(".save-knowledge");
  if (!button) return;

  const item = button.closest(".knowledge-item");
  const knowledgeId = item.dataset.knowledgeId;
  const body = Object.fromEntries(new FormData(item));

  try {
    const payload = await api(`/api/knowledge/${knowledgeId}`, { method: "PUT", body });
    state.data = payload.state;
    showToast("Knowledge answer saved.");
    render();
  } catch (error) {
    showToast(error.message);
  }
});

elements.businessForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(elements.businessForm));
  try {
    const payload = await api("/api/business", { method: "PUT", body });
    state.data = payload.state;
    showToast("Business profile saved.");
    render();
  } catch (error) {
    showToast(error.message);
  }
});

elements.openAiKeyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(elements.openAiKeyForm));
  try {
    const payload = await api("/api/workspace/openai-key", { method: "PUT", body });
    state.data = payload.state;
    elements.openAiKeyForm.reset();
    showToast("OpenAI key saved.");
    render();
  } catch (error) {
    showToast(error.message);
  }
});

elements.clearOpenAiKey.addEventListener("click", async () => {
  if (!window.confirm("Clear this workspace's saved OpenAI key?")) return;
  try {
    const payload = await api("/api/workspace/openai-key", { method: "DELETE", body: {} });
    state.data = payload.state;
    showToast("OpenAI key cleared.");
    render();
  } catch (error) {
    showToast(error.message);
  }
});

elements.newWorkspace.addEventListener("click", () => {
  resetWorkspaceAdminForm();
});

elements.workspacesTable.addEventListener("click", (event) => {
  const button = event.target.closest(".edit-workspace");
  if (!button) return;
  const workspace = state.data.admin?.workspaces.find((item) => item.id === button.dataset.workspaceId);
  if (!workspace) return;
  elements.workspaceForm.elements.id.value = workspace.id;
  elements.workspaceForm.elements.name.value = workspace.name || "";
  elements.workspaceForm.elements.businessName.value = workspace.business?.name || "";
  elements.workspaceForm.elements.openAiApiKey.value = "";
  elements.workspaceForm.elements.clearOpenAiKey.checked = false;
  elements.adminOpenAiKeyMasked.value = workspace.openAiKeyMasked || "";
  elements.workspaceForm.elements.assignedTwilioNumberId.innerHTML = twilioNumberOptions(workspace.assignedTwilioNumberId || "");
});

elements.workspaceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(elements.workspaceForm));
  const id = body.id;
  delete body.id;
  if (!body.openAiApiKey) delete body.openAiApiKey;
  try {
    const payload = id
      ? await api(`/api/admin/workspaces/${id}`, { method: "PUT", body })
      : await api("/api/admin/workspaces", { method: "POST", body });
    state.data = payload.state;
    resetWorkspaceAdminForm();
    showToast(id ? "Workspace saved." : "Workspace created.");
    render();
  } catch (error) {
    showToast(error.message);
  }
});

elements.usersTable.addEventListener("click", (event) => {
  const button = event.target.closest(".edit-user");
  if (!button) return;
  const user = state.data.admin?.users.find((item) => item.id === button.dataset.userId);
  if (!user) return;
  elements.userForm.elements.id.value = user.id;
  elements.userForm.elements.email.value = user.email || "";
  elements.userForm.elements.password.value = "";
  elements.userForm.elements.role.value = user.role || "user";
  elements.userForm.elements.workspaceId.innerHTML = workspaceOptions(user.workspaceId || "");
});

elements.userForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(elements.userForm));
  const id = body.id;
  delete body.id;
  if (!body.password) delete body.password;
  try {
    const payload = id
      ? await api(`/api/admin/users/${id}`, { method: "PUT", body })
      : await api("/api/admin/users", { method: "POST", body });
    state.data = payload.state;
    elements.userForm.reset();
    showToast(id ? "User saved." : "User created.");
    render();
  } catch (error) {
    showToast(error.message);
  }
});

elements.twilioNumbersTable.addEventListener("click", (event) => {
  const button = event.target.closest(".edit-twilio-number");
  if (!button) return;
  const number = state.data.admin?.twilioNumbers.find((item) => item.id === button.dataset.numberId);
  if (!number) return;
  elements.twilioNumberForm.elements.id.value = number.id;
  elements.twilioNumberForm.elements.phoneNumber.value = number.phoneNumber || "";
  elements.twilioNumberForm.elements.label.value = number.label || "";
  elements.twilioNumberForm.elements.workspaceId.innerHTML = workspaceOptions(number.workspaceId || "", true);
});

elements.twilioNumberForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(elements.twilioNumberForm));
  const id = body.id;
  delete body.id;
  try {
    const payload = id
      ? await api(`/api/admin/twilio-numbers/${id}`, { method: "PUT", body })
      : await api("/api/admin/twilio-numbers", { method: "POST", body });
    state.data = payload.state;
    elements.twilioNumberForm.reset();
    showToast(id ? "Twilio number saved." : "Twilio number added.");
    render();
  } catch (error) {
    showToast(error.message);
  }
});

elements.messagingSendersTable.addEventListener("click", (event) => {
  const button = event.target.closest(".edit-messaging-sender");
  if (!button) return;
  const sender = state.data.admin?.messagingSenders.find((item) => item.id === button.dataset.senderId);
  if (!sender) return;
  elements.messagingSenderForm.elements.id.value = sender.id;
  elements.messagingSenderForm.elements.label.value = sender.label || "";
  elements.messagingSenderForm.elements.workspaceId.innerHTML = workspaceOptions(sender.workspaceId || "");
  elements.messagingSenderForm.elements.channel.value = sender.channel || "sms";
  elements.messagingSenderForm.elements.fromAddress.value = sender.fromAddress || "";
  elements.messagingSenderForm.elements.messagingServiceSid.value = sender.messagingServiceSid || "";
  elements.messagingSenderForm.elements.whatsappContentSid.value = sender.whatsappContentSid || "";
  elements.messagingSenderForm.elements.whatsappContentVariables.value = JSON.stringify(sender.whatsappContentVariables || {}, null, 2);
  elements.messagingSenderForm.elements.isDefault.checked = Boolean(sender.isDefault);
  elements.messagingSenderForm.elements.active.checked = sender.active !== false;
});

elements.messagingSenderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(elements.messagingSenderForm);
  const body = {
    ...Object.fromEntries(formData),
    isDefault: formData.has("isDefault"),
    active: formData.has("active")
  };
  const id = body.id;
  delete body.id;
  try {
    const payload = id
      ? await api(`/api/admin/messaging-senders/${id}`, { method: "PUT", body })
      : await api("/api/admin/messaging-senders", { method: "POST", body });
    state.data = payload.state;
    resetMessagingSenderForm();
    showToast(id ? "Messaging sender saved." : "Messaging sender added.");
    render();
  } catch (error) {
    showToast(error.message);
  }
});

elements.deleteMessagingSender.addEventListener("click", async () => {
  const id = elements.messagingSenderForm.elements.id.value;
  if (!id) {
    resetMessagingSenderForm();
    return;
  }
  if (!window.confirm("Delete this messaging sender?")) return;
  try {
    const payload = await api(`/api/admin/messaging-senders/${id}`, { method: "DELETE", body: {} });
    state.data = payload.state;
    resetMessagingSenderForm();
    showToast("Messaging sender deleted.");
    render();
  } catch (error) {
    showToast(error.message);
  }
});

elements.logoutButton.addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST", body: {} });
  window.location.href = "/login.html";
});

loadState().catch((error) => showToast(error.message));
