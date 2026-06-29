import assert from "node:assert/strict";
import test from "node:test";
import {
  channelOptedOut,
  countryCodeForPhone,
  friendlyMessagingError,
  formatAddress,
  isMessagingOptOut,
  isWhatsappServiceWindowOpen,
  isWhatsappTemplateBlockedForRecipient,
  renderContentVariables,
  renderMessageTemplate,
  resolveWhatsappTemplate,
  resolveMessagingSender,
  serviceWindowExpiryFrom,
  setChannelOptOut
} from "../src/messaging.js";

const context = {
  business: { name: "Mina's Corner Cafe", callerId: "Mina" },
  campaign: {
    id: "campaign_1",
    name: "Latte Popup",
    location: "18 Oak Street",
    eventDate: "2026-05-23T16:00",
    offer: "Free pastry"
  },
  contact: { name: "Ava", phone: "+14155550101" }
};

test("SMS body rendering replaces customer and campaign placeholders", () => {
  assert.equal(
    renderMessageTemplate("Hi {{customer_name}}, {{business_name}} has {{campaign_name}} at {{location}}.", context),
    "Hi Ava, Mina's Corner Cafe has Latte Popup at 18 Oak Street."
  );
});

test("WhatsApp template variables render from JSON mappings", () => {
  assert.deepEqual(renderContentVariables('{"1":"{{customer_name}}","2":"{{offer}}"}', context), {
    1: "Ava",
    2: "Free pastry"
  });
});

test("sender resolution prefers active default sender for workspace channel", () => {
  const state = {
    messagingSenders: [
      { id: "old", workspaceId: "workspace_1", channel: "sms", active: false, isDefault: true },
      { id: "first", workspaceId: "workspace_1", channel: "sms", active: true },
      { id: "default", workspaceId: "workspace_1", channel: "sms", active: true, isDefault: true },
      { id: "other", workspaceId: "workspace_2", channel: "sms", active: true, isDefault: true }
    ]
  };

  assert.equal(resolveMessagingSender(state, "workspace_1", "sms").id, "default");
});

test("global and channel opt-outs block messaging", () => {
  const contact = { optedOut: false, channelOptOuts: {} };
  assert.equal(channelOptedOut(contact, "sms"), false);
  setChannelOptOut(contact, "sms", true);
  assert.equal(channelOptedOut(contact, "sms"), true);
  assert.equal(channelOptedOut({ optedOut: true }, "whatsapp"), true);
});

test("STOP and WhatsApp opt-out phrases are detected", () => {
  assert.equal(isMessagingOptOut("STOP"), true);
  assert.equal(isMessagingOptOut("please unsubscribe me"), true);
  assert.equal(isMessagingOptOut("whatsapp mat bhejo"), true);
  assert.equal(isMessagingOptOut("what time is the event?"), false);
});

test("WhatsApp addresses are prefixed only once", () => {
  assert.equal(formatAddress("whatsapp", "+14155550101"), "whatsapp:+14155550101");
  assert.equal(formatAddress("whatsapp", "whatsapp:+14155550101"), "whatsapp:+14155550101");
  assert.equal(formatAddress("sms", "whatsapp:+14155550101"), "+14155550101");
});

test("WhatsApp template selection matches workspace, campaign type, and country", () => {
  const templates = [
    {
      id: "event_in",
      workspaceId: "workspace_1",
      label: "India event",
      campaignTypes: ["event"],
      supportedCountries: ["IN"],
      category: "marketing",
      contentSid: "HXIN",
      active: true
    },
    {
      id: "sale_all",
      workspaceId: "workspace_1",
      label: "Sale",
      campaignTypes: ["sale"],
      supportedCountries: ["ALL"],
      category: "marketing",
      contentSid: "HXSALE",
      active: true
    }
  ];

  assert.equal(
    resolveWhatsappTemplate(templates, { workspaceId: "workspace_1", campaignType: "event", countryCode: "IN" }).id,
    "event_in"
  );
  assert.equal(resolveWhatsappTemplate(templates, { workspaceId: "workspace_1", campaignType: "event", countryCode: "US" }), null);
  assert.equal(
    resolveWhatsappTemplate(templates, { workspaceId: "workspace_1", templateId: "sale_all", campaignType: "event", countryCode: "US" }).id,
    "sale_all"
  );
});

test("US marketing WhatsApp templates are blocked while India marketing can proceed", () => {
  const marketingTemplate = { category: "marketing" };
  const utilityTemplate = { category: "utility" };

  assert.equal(countryCodeForPhone("+14155550101"), "US");
  assert.equal(countryCodeForPhone("+919876543210"), "IN");
  assert.equal(isWhatsappTemplateBlockedForRecipient(marketingTemplate, { phone: "+14155550101" }), true);
  assert.equal(isWhatsappTemplateBlockedForRecipient(marketingTemplate, { phone: "+919876543210" }), false);
  assert.equal(isWhatsappTemplateBlockedForRecipient(utilityTemplate, { phone: "+14155550101" }), false);
});

test("WhatsApp service window is open only before expiry", () => {
  const now = new Date("2026-06-01T10:00:00.000Z");
  const thread = {
    channel: "whatsapp",
    serviceWindowExpiresAt: serviceWindowExpiryFrom(now)
  };

  assert.equal(isWhatsappServiceWindowOpen(thread, "2026-06-02T09:59:00.000Z"), true);
  assert.equal(isWhatsappServiceWindowOpen(thread, "2026-06-02T10:01:00.000Z"), false);
  assert.equal(isWhatsappServiceWindowOpen({ channel: "sms", serviceWindowExpiresAt: thread.serviceWindowExpiresAt }, now), false);
});

test("63049 is translated into a business-facing fallback explanation", () => {
  assert.match(friendlyMessagingError("63049"), /Meta limited or blocked/);
});
