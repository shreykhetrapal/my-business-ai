import assert from "node:assert/strict";
import test from "node:test";
import {
  channelOptedOut,
  formatAddress,
  isMessagingOptOut,
  renderContentVariables,
  renderMessageTemplate,
  resolveMessagingSender,
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
