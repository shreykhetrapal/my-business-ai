import { nowIso } from "./store.js";

export function setContactCallPermission(contact, optedOut) {
  if (!optedOut && !contact.consentSource) {
    throw new Error("Cannot opt in a contact without a consent source.");
  }

  contact.optedOut = optedOut;
  if (optedOut) {
    contact.optedOutAt = nowIso();
    delete contact.optedInAt;
  } else {
    contact.optedInAt = nowIso();
    delete contact.optedOutAt;
  }

  return contact;
}
